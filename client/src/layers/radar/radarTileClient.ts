import type { RadarPaletteId } from './radarPalettes';
import { RadarTileService, type ServiceIn, type ServiceOut, type ServiceStatus } from './radarTileService';

// Main-thread side of the radar tile pipeline. Owns the worker (restarting it
// if it goes silent; running the same service inline if workers are
// unavailable), turns tile requests from the imagery providers into
// promises, cancels work Cesium no longer wants, paces texture hand-off, and
// relays probe answers, rate-limit status and expired frames.

type TileImage = ImageData | HTMLCanvasElement;

interface Pending {
  resolve: (img: TileImage) => void;
  reject: (err: TileCancelled) => void;
  wanted: () => boolean;
  frameKey: string;
  msg: ServiceIn;
}

// Tiles handed to Cesium per animation frame: each becomes a texture upload
// (plus mipmaps) inside Cesium's tile-load pass, so a burst of them — a
// palette switch, a pan back over cached tiles — would stall playback.
const MAX_SETTLES_PER_FRAME = 4;
const MAX_WORKER_RESTARTS = 3;
// A worker holding work that has said nothing for this long gets pinged, and
// restarted if it doesn't answer (it may have died without an error event).
const SILENCE_MS = 20_000;
const PONG_TIMEOUT_MS = 10_000;

// Rejection for a request the view stopped wanting; the provider tells
// Cesium to treat it as not loaded rather than failed.
export class TileCancelled extends Error {
  constructor() {
    super('radar tile no longer wanted');
    this.name = 'TileCancelled';
  }
}

let blank: HTMLCanvasElement | null = null;
// A 1×1 transparent tile for "nothing here" (no echo, expired frame, failed
// decode): tiny on the GPU, and resolved rather than rejected so Cesium
// doesn't log an imagery error for every empty tile.
function blankTile(): HTMLCanvasElement {
  if (!blank) {
    blank = document.createElement('canvas');
    blank.width = blank.height = 1;
  }
  return blank;
}

export interface TileArgs {
  frameKey: string;
  url: string;
  z: number;
  x: number;
  y: number;
  palette: RadarPaletteId;
  sigma: number;
  snow: boolean;
}

export class RadarTileClient {
  private worker: Worker | null = null;
  private workerReady = false;
  private restarts = 0;
  private inline: RadarTileService | null = null;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private probes = new Map<number, (r: { dbz: number; snow: boolean } | null) => void>();
  private settleQueue: Array<{ id: number; image: TileImage }> = [];
  private settleRaf = 0;
  private sweepTimer: ReturnType<typeof setInterval> | null = null;
  private ranks = new Map<string, number>();
  private lastRanks: Record<string, number> = {};
  private lastVisible: string[] = [];
  private recentStarts: number[] = []; // this minute's network requests, to seed a restarted worker
  private lastHeard = 0;
  private pingAt = 0;
  private statusListeners = new Set<(s: ServiceStatus) => void>();
  private goneListeners = new Set<(frameKey: string) => void>();

  constructor() {
    this.startWorker();
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => this.send({ type: 'hidden', hidden: document.hidden }));
    }
  }

  private startWorker(): void {
    try {
      const worker = new Worker(new URL('./radarWorker.ts', import.meta.url), { type: 'module' });
      this.worker = worker;
      this.workerReady = false;
      this.lastHeard = performance.now();
      this.pingAt = 0;
      worker.onmessage = (e: MessageEvent<ServiceOut>) => this.receive(e.data);
      worker.onerror = (e) => {
        if (this.workerReady) {
          // A runtime error inside a working worker isn't fatal: it keeps
          // its caches and in-flight requests. The watchdog handles a dead one.
          console.warn('[radar] tile worker error', e.message);
          return;
        }
        e.preventDefault?.();
        console.warn('[radar] tile worker failed to start; decoding on the main thread', e.message);
        this.useInline();
      };
    } catch (err) {
      console.warn('[radar] tile worker unavailable; decoding on the main thread', err);
      this.useInline();
    }
  }

  private restartWorker(): void {
    if (this.restarts >= MAX_WORKER_RESTARTS) {
      this.useInline();
      return;
    }
    console.warn('[radar] tile worker stopped answering; restarting it');
    this.restarts++;
    this.worker?.terminate();
    this.startWorker();
    this.replay();
  }

  private useInline(): void {
    this.worker?.terminate();
    this.worker = null;
    if (!this.inline) {
      this.inline = new RadarTileService((msg) => queueMicrotask(() => this.receive(msg)));
    }
    this.replay();
  }

  // Re-issue everything outstanding to a fresh service, which inherits this
  // minute's request count so a restart can't overrun the rate limit.
  private replay(): void {
    const now = Date.now();
    this.recentStarts = this.recentStarts.filter((t) => now - t < 60_000);
    this.send({ type: 'seed', starts: this.recentStarts });
    this.send({ type: 'ranks', ranks: this.lastRanks });
    this.send({ type: 'visible', keys: this.lastVisible });
    if (typeof document !== 'undefined') this.send({ type: 'hidden', hidden: document.hidden });
    const settled = new Set(this.settleQueue.map((s) => s.id));
    for (const [id, p] of this.pending) if (!settled.has(id)) this.send(p.msg);
  }

  private send(msg: ServiceIn): void {
    if (this.worker) this.worker.postMessage(msg);
    else this.inline?.handle(msg);
  }

  private receive(msg: ServiceOut): void {
    this.lastHeard = performance.now();
    this.pingAt = 0;
    switch (msg.type) {
      case 'hello':
        this.workerReady = true;
        return;
      case 'pong':
        return;
      case 'start':
        this.recentStarts.push(msg.at);
        if (this.recentStarts.length > 200) this.recentStarts.splice(0, this.recentStarts.length - 200);
        return;
      case 'status':
        for (const fn of this.statusListeners) fn(msg.status);
        return;
      case 'probe': {
        const done = this.probes.get(msg.id);
        this.probes.delete(msg.id);
        done?.(msg.result);
        return;
      }
      case 'tile': {
        const p = this.pending.get(msg.id);
        if (!p) return;
        if (msg.gone) for (const fn of this.goneListeners) fn(p.frameKey);
        const image =
          !msg.empty && msg.rgba && msg.width && msg.height
            ? new ImageData(new Uint8ClampedArray(msg.rgba), msg.width, msg.height)
            : blankTile();
        this.settleQueue.push({ id: msg.id, image });
        this.scheduleSettle();
        return;
      }
    }
  }

  private scheduleSettle(): void {
    if (this.settleRaf) return;
    this.settleRaf = requestAnimationFrame(() => {
      this.settleRaf = 0;
      const rank = (id: number) => this.ranks.get(this.pending.get(id)?.frameKey ?? '') ?? 1e6;
      this.settleQueue.sort((a, b) => rank(a.id) - rank(b.id));
      const batch = this.settleQueue.splice(0, MAX_SETTLES_PER_FRAME);
      for (const { id, image } of batch) {
        const p = this.pending.get(id);
        if (!p) continue;
        this.pending.delete(id);
        p.resolve(image);
      }
      if (this.settleQueue.length > 0) this.scheduleSettle();
    });
  }

  // Cesium drops imagery for tiles it no longer holds without cancelling the
  // request (Imagery.releaseReference just destroys the object), so poll the
  // providers' "still wanted" checks and give the queue slot — and the rate
  // budget — to tiles that are. Also watches for a silent worker.
  private ensureSweep(): void {
    if (this.sweepTimer) return;
    this.sweepTimer = setInterval(() => {
      for (const [id, p] of this.pending) {
        if (!p.wanted()) {
          this.pending.delete(id);
          this.send({ type: 'cancel', id });
          p.reject(new TileCancelled());
        }
      }
      this.settleQueue = this.settleQueue.filter((s) => this.pending.has(s.id));
      if (this.worker && this.pending.size > 0 && !document.hidden) {
        const now = performance.now();
        if (this.pingAt && now - this.pingAt > PONG_TIMEOUT_MS) this.restartWorker();
        else if (!this.pingAt && now - this.lastHeard > SILENCE_MS) {
          this.pingAt = now;
          this.send({ type: 'ping' });
        }
      }
      if (this.pending.size === 0 && this.sweepTimer) {
        clearInterval(this.sweepTimer);
        this.sweepTimer = null;
      }
    }, 500);
  }

  requestTile(args: TileArgs, wanted: () => boolean): Promise<TileImage> {
    const id = this.nextId++;
    return new Promise<TileImage>((resolve, reject) => {
      const msg: ServiceIn = { type: 'tile', req: { id, ...args } };
      this.pending.set(id, { resolve, reject, wanted, frameKey: args.frameKey, msg });
      this.send(msg);
      this.ensureSweep();
    });
  }

  setRanks(ranks: Record<string, number>): void {
    this.lastRanks = ranks;
    this.ranks = new Map(Object.entries(ranks));
    this.send({ type: 'ranks', ranks });
  }

  setVisible(keys: string[]): void {
    this.lastVisible = keys;
    this.send({ type: 'visible', keys });
  }

  retain(frameKeys: string[]): void {
    this.send({ type: 'retain', frameKeys });
  }

  probe(frameKey: string, lon: number, lat: number): Promise<{ dbz: number; snow: boolean } | null> {
    const id = this.nextId++;
    return new Promise((resolve) => {
      this.probes.set(id, resolve);
      this.send({ type: 'probe', id, frameKey, lon, lat });
      // Never leave a hover readout hanging on a restarted worker.
      setTimeout(() => {
        if (this.probes.delete(id)) resolve(null);
      }, 2000);
    });
  }

  onStatus(fn: (s: ServiceStatus) => void): () => void {
    this.statusListeners.add(fn);
    return () => this.statusListeners.delete(fn);
  }

  // A frame's tiles came back 404/410: the manifest is out of date.
  onGone(fn: (frameKey: string) => void): () => void {
    this.goneListeners.add(fn);
    return () => this.goneListeners.delete(fn);
  }
}

let client: RadarTileClient | null = null;

// One pipeline per page: the worker's caches and rate budget are shared by
// every radar layer (operator globe, share-page globe, context rebuilds).
export function getRadarTileClient(): RadarTileClient {
  if (!client) client = new RadarTileClient();
  return client;
}
