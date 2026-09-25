import { decodePng, type DecodedImage } from './pngDecode';
import { decodeRadarRgba, type RadarGrid } from './radarDecode';
import { paletteLut, type RadarPaletteId } from './radarPalettes';
import { renderRadarTile, sampleGrid } from './radarRender';
import { TileScheduler, type FetchOutcome, type ScheduledJob } from './radarTileScheduler';

// The radar tile pipeline: fetch (scheduled under RainViewer's rate limit),
// keep the compressed PNG (memory + Cache Storage, both keyed by frame and
// tile), decode the served colours back to reflectivity, and paint them
// through the chosen palette. Plain web APIs only, so the same code runs in
// the radar worker (normal case) or inline if a worker can't start.

export interface TileRequest {
  id: number;
  frameKey: string; // frame identity (its time)
  url: string;
  z: number;
  x: number;
  y: number;
  palette: RadarPaletteId;
  sigma: number;
  snow: boolean; // paint snow in its own ramp
}

export type ServiceIn =
  | { type: 'tile'; req: TileRequest }
  | { type: 'cancel'; id: number }
  | { type: 'ranks'; ranks: Record<string, number> }
  | { type: 'visible'; keys: string[] }
  | { type: 'probe'; id: number; frameKey: string; lon: number; lat: number }
  | { type: 'retain'; frameKeys: string[] };

export interface ServiceStatus {
  queued: number;
  inFlight: number;
  coolingDownMs: number;
}

export type ServiceOut =
  | { type: 'hello' }
  | {
      type: 'tile';
      id: number;
      empty: boolean; // nothing to draw (no echo): a 1×1 transparent tile will do
      gone?: boolean; // the frame expired upstream (404/410)
      rgba?: ArrayBuffer; // RGBA, rows top-down (Cesium flips on upload)
      width?: number;
      height?: number;
    }
  | { type: 'probe'; id: number; result: { dbz: number; snow: boolean } | null }
  | { type: 'status'; status: ServiceStatus };

type Post = (msg: ServiceOut, transfer?: Transferable[]) => void;

const CACHE_NAME = 'gsoc-radar-tiles-v1';
const CACHE_TIME_HEADER = 'x-gsoc-cached-at';
const CACHE_MAX_AGE_MS = 3 * 3600_000; // frames live ~2 h upstream
const PNG_BUDGET_BYTES = 48 * 1024 * 1024;
const GRID_KEEP = 48; // decoded grids kept for the hover readout
const MAX_FETCH_LEVEL = 7;
const BUDGET_CHANNEL = 'gsoc-radar-budget';

let warnedPlaceholder = false;

function tileKey(frameKey: string, z: number, x: number, y: number): string {
  return `${frameKey}/${z}/${x}/${y}`;
}

// Web Mercator tile coordinates (fractional) for a lon/lat at zoom z.
function lonLatToTile(lon: number, lat: number, z: number): { x: number; y: number } {
  const n = 2 ** z;
  const x = ((lon + 180) / 360) * n;
  const r = (Math.max(-85.0511, Math.min(85.0511, lat)) * Math.PI) / 180;
  const y = ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n;
  return { x, y };
}

async function decodeBytes(bytes: Uint8Array): Promise<DecodedImage> {
  try {
    return await decodePng(bytes);
  } catch (err) {
    // No DecompressionStream (older browsers) or an unexpected encoding: let
    // the platform decode it. Opaque colours come through exactly and the
    // translucent band decodes by alpha, which canvas storage keeps exact.
    if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas === 'undefined') throw err;
    const bmp = await createImageBitmap(new Blob([bytes as Uint8Array<ArrayBuffer>]), {
      premultiplyAlpha: 'none',
      colorSpaceConversion: 'none',
    });
    const canvas = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw err;
    ctx.drawImage(bmp, 0, 0);
    bmp.close();
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    return { width: canvas.width, height: canvas.height, data: new Uint8Array(data.buffer) };
  }
}

function parseRetryAfter(value: string | null): number | null {
  if (!value) return null;
  const secs = Number(value);
  if (Number.isFinite(secs)) return Math.min(60, Math.max(1, secs)) * 1000;
  const at = Date.parse(value);
  return Number.isFinite(at) ? Math.min(60_000, Math.max(1000, at - Date.now())) : null;
}

interface Waiter {
  req: TileRequest;
}

export class RadarTileService {
  private requests = new Map<number, TileRequest>();
  private pngs = new Map<string, Uint8Array>(); // LRU by insertion order
  private pngBytes = 0;
  private grids = new Map<string, RadarGrid>(); // small LRU, for the probe
  private loading = new Map<string, Waiter[]>(); // single-flight by tile key
  private jobOfKey = new Map<string, number>();
  private jobUrl = new Map<number, { url: string; key: string }>();
  private cache: Promise<Cache | null>;
  private scheduler: TileScheduler;
  private channel: BroadcastChannel | null = null;
  private statusTimer: ReturnType<typeof setTimeout> | null = null;
  private lastStatus = '';
  private nextJob = 1;
  private renderQueue: TileRequest[] = [];
  private rendering = false;
  private ranks = new Map<string, number>();

  constructor(private post: Post) {
    this.cache =
      typeof caches !== 'undefined' ? caches.open(CACHE_NAME).catch(() => null) : Promise.resolve(null);
    this.scheduler = new TileScheduler({
      maxInFlight: 6,
      // RainViewer allows ~100/min per IP; stay under it, and share the
      // count with other tabs of this app (same browser, same IP).
      budget: 80,
      windowMs: 60_000,
      now: () => Date.now(),
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
      fetchJob: (job) => this.fetchJob(job),
      onResult: (job, outcome) => void this.onFetched(job, outcome),
      onStart: (at) => this.channel?.postMessage({ start: at }),
      onCooldown: (until) => this.channel?.postMessage({ cooldown: until }),
    });
    if (typeof BroadcastChannel !== 'undefined') {
      try {
        this.channel = new BroadcastChannel(BUDGET_CHANNEL);
        this.channel.onmessage = (e: MessageEvent<{ start?: number; cooldown?: number }>) => {
          if (typeof e.data?.start === 'number') this.scheduler.noteExternalStart(e.data.start);
          if (typeof e.data?.cooldown === 'number') this.scheduler.noteExternalCooldown(e.data.cooldown);
        };
      } catch {
        this.channel = null;
      }
    }
    void this.pruneCache();
  }

  handle(msg: ServiceIn): void {
    try {
      switch (msg.type) {
        case 'tile':
          this.requestTile(msg.req);
          break;
        case 'cancel':
          this.cancel(msg.id);
          break;
        case 'ranks':
          this.ranks = new Map(Object.entries(msg.ranks));
          this.scheduler.setRanks(msg.ranks);
          break;
        case 'visible':
          this.scheduler.setVisible(msg.keys);
          break;
        case 'probe':
          void this.probe(msg.frameKey, msg.lon, msg.lat).then((result) =>
            this.post({ type: 'probe', id: msg.id, result })
          );
          break;
        case 'retain':
          this.retain(msg.frameKeys);
          break;
      }
    } catch (err) {
      console.warn('[radar] tile service error', err);
    }
  }

  private requestTile(req: TileRequest): void {
    if (req.z > MAX_FETCH_LEVEL) {
      // The provider never asks past z7 (RainViewer's free-tier ceiling);
      // answer anything that slips through with an empty tile, not a fetch
      // for the "zoom level not supported" placeholder.
      this.post({ type: 'tile', id: req.id, empty: true });
      return;
    }
    this.requests.set(req.id, req);
    const key = tileKey(req.frameKey, req.z, req.x, req.y);
    if (this.pngs.has(key)) {
      this.queueRender(req);
      return;
    }
    const waiting = this.loading.get(key);
    if (waiting) {
      waiting.push({ req });
      return;
    }
    this.loading.set(key, [{ req }]);
    void this.load(req, key);
  }

  private cancel(id: number): void {
    const req = this.requests.get(id);
    this.requests.delete(id);
    if (!req) return;
    const key = tileKey(req.frameKey, req.z, req.x, req.y);
    const waiting = this.loading.get(key);
    if (!waiting) return;
    const rest = waiting.filter((w) => w.req.id !== id);
    if (rest.length > 0) {
      this.loading.set(key, rest);
      return;
    }
    // Nobody wants this tile any more: drop its network job unless it is
    // already in flight (then let it land in the caches).
    const job = this.jobOfKey.get(key);
    if (job === undefined) {
      this.loading.delete(key); // still checking the local cache
    } else if (this.scheduler.has(job) && this.scheduler.cancel(job)) {
      this.jobOfKey.delete(key);
      this.jobUrl.delete(job);
      this.loading.delete(key);
    } else {
      this.loading.set(key, []);
    }
  }

  // Local copy first (Cache Storage: survives reloads, shared by tabs), then
  // the network through the scheduler.
  private async load(req: TileRequest, key: string): Promise<void> {
    const cache = await this.cache;
    if (cache) {
      try {
        const hit = await cache.match(req.url);
        if (hit) {
          const bytes = new Uint8Array(await hit.arrayBuffer());
          const grid = await this.decode(bytes, req.url);
          if (grid) {
            this.storePng(key, bytes, grid);
            this.finishLoad(key);
            return;
          }
          await cache.delete(req.url); // corrupt or not a tile: refetch
        }
      } catch {
        // Cache Storage is best-effort.
      }
    }
    if (!this.loading.get(key)?.length) {
      this.loading.delete(key); // cancelled while checking the cache
      return;
    }
    const id = this.nextJob++;
    this.jobOfKey.set(key, id);
    this.jobUrl.set(id, { url: req.url, key }); // before enqueue: it may start at once
    this.scheduler.enqueue(id, req.frameKey, req.z, `${req.z}/${req.x}/${req.y}`);
    this.reportStatus();
  }

  private async fetchJob(job: ScheduledJob): Promise<FetchOutcome> {
    const target = this.jobUrl.get(job.id);
    if (!target) return { kind: 'gone' };
    let res: Response;
    try {
      res = await fetch(target.url, { mode: 'cors', credentials: 'omit' });
    } catch (err) {
      return { kind: 'error', message: String(err) };
    }
    if (res.status === 429) return { kind: 'rate-limited', retryAfterMs: parseRetryAfter(res.headers.get('retry-after')) };
    if (res.status === 404 || res.status === 410) return { kind: 'gone' };
    if (!res.ok) return { kind: 'error', message: `HTTP ${res.status}` };
    try {
      return { kind: 'ok', bytes: new Uint8Array(await res.arrayBuffer()) };
    } catch (err) {
      return { kind: 'error', message: String(err) };
    }
  }

  private async onFetched(job: ScheduledJob, outcome: FetchOutcome): Promise<void> {
    this.reportStatus();
    const target = this.jobUrl.get(job.id);
    this.jobUrl.delete(job.id);
    if (!target) return;
    const { key, url } = target;
    this.jobOfKey.delete(key);
    if (outcome.kind === 'gone') {
      for (const w of this.loading.get(key) ?? []) {
        if (this.requests.delete(w.req.id)) this.post({ type: 'tile', id: w.req.id, empty: true, gone: true });
      }
      this.loading.delete(key);
      return;
    }
    if (outcome.kind !== 'ok') return; // the scheduler keeps retrying errors
    const grid = await this.decode(outcome.bytes, url);
    if (!grid) {
      // Not a radar tile (an error page, a truncated body): draw nothing
      // rather than garbage, and don't cache it.
      for (const w of this.loading.get(key) ?? []) {
        if (this.requests.delete(w.req.id)) this.post({ type: 'tile', id: w.req.id, empty: true });
      }
      this.loading.delete(key);
      return;
    }
    this.storePng(key, outcome.bytes, grid);
    const cache = await this.cache;
    if (cache) {
      // Frame paths are immutable; entries are pruned by age.
      cache
        .put(
          url,
          new Response(outcome.bytes as Uint8Array<ArrayBuffer>, {
            headers: { 'content-type': 'image/png', [CACHE_TIME_HEADER]: String(Date.now()) },
          })
        )
        .catch(() => undefined);
    }
    this.finishLoad(key);
  }

  private finishLoad(key: string): void {
    const waiting = this.loading.get(key) ?? [];
    this.loading.delete(key);
    for (const w of waiting) if (this.requests.has(w.req.id)) this.queueRender(w.req);
  }

  private async decode(bytes: Uint8Array, url: string): Promise<RadarGrid | null> {
    try {
      const img = await decodeBytes(bytes);
      const decoded = decodeRadarRgba(img.data, img.width, img.height);
      if (decoded.placeholder) {
        if (!warnedPlaceholder) {
          warnedPlaceholder = true;
          console.warn(`[radar] ${url} is not a radar tile (unsupported zoom level?) — drawing it empty`);
        }
        return null;
      }
      return decoded;
    } catch (err) {
      console.warn('[radar] tile decode failed', url, err);
      return null;
    }
  }

  private storePng(key: string, bytes: Uint8Array, grid: RadarGrid): void {
    const old = this.pngs.get(key);
    if (old) {
      this.pngBytes -= old.length;
      this.pngs.delete(key);
    }
    this.pngs.set(key, bytes);
    this.pngBytes += bytes.length;
    for (const [k, b] of this.pngs) {
      if (this.pngBytes <= PNG_BUDGET_BYTES) break;
      this.pngs.delete(k);
      this.pngBytes -= b.length;
    }
    this.keepGrid(key, grid);
  }

  private keepGrid(key: string, grid: RadarGrid): void {
    this.grids.delete(key);
    this.grids.set(key, grid);
    while (this.grids.size > GRID_KEEP) this.grids.delete(this.grids.keys().next().value as string);
  }

  private async gridFor(key: string): Promise<RadarGrid | null> {
    const g = this.grids.get(key);
    if (g) {
      this.keepGrid(key, g);
      return g;
    }
    const png = this.pngs.get(key);
    if (!png) return null;
    const grid = await this.decode(png, key);
    if (grid) this.keepGrid(key, grid);
    return grid;
  }

  // Paint queued tiles, most urgent frame first, yielding between tiles so
  // cancels and new priorities get through.
  private queueRender(req: TileRequest): void {
    this.renderQueue.push(req);
    if (!this.rendering) {
      this.rendering = true;
      setTimeout(() => void this.drainRenders(), 0);
    }
  }

  private async drainRenders(): Promise<void> {
    while (this.renderQueue.length > 0) {
      const rank = (r: TileRequest) => this.ranks.get(r.frameKey) ?? 1e6;
      this.renderQueue.sort((a, b) => rank(a) - rank(b) || a.z - b.z);
      const req = this.renderQueue.shift()!;
      if (!this.requests.has(req.id)) continue;
      const grid = await this.gridFor(tileKey(req.frameKey, req.z, req.x, req.y));
      if (!this.requests.has(req.id)) continue;
      this.requests.delete(req.id);
      if (!grid) {
        this.post({ type: 'tile', id: req.id, empty: true });
      } else {
        const rgba = renderRadarTile(grid, paletteLut(req.palette), {
          sigma: req.sigma,
          flipY: false,
          snow: req.snow,
        });
        if (!rgba) this.post({ type: 'tile', id: req.id, empty: true });
        else {
          this.post({ type: 'tile', id: req.id, empty: false, rgba: rgba.buffer, width: grid.width, height: grid.height }, [
            rgba.buffer,
          ]);
        }
      }
      await new Promise((r) => setTimeout(r, 0));
    }
    this.rendering = false;
  }

  // Reflectivity under a point on the given frame, from the finest tile this
  // session has loaded there.
  private async probe(frameKey: string, lon: number, lat: number): Promise<{ dbz: number; snow: boolean } | null> {
    for (let z = MAX_FETCH_LEVEL; z >= 0; z--) {
      const t = lonLatToTile(lon, lat, z);
      const tx = Math.floor(t.x);
      const ty = Math.floor(t.y);
      const key = tileKey(frameKey, z, tx, ty);
      if (!this.pngs.has(key) && !this.grids.has(key)) continue;
      const grid = await this.gridFor(key);
      if (!grid) return null;
      return sampleGrid(grid, (t.x - tx) * grid.width - 0.5, (t.y - ty) * grid.height - 0.5);
    }
    return null;
  }

  private retain(frameKeys: string[]): void {
    const keep = new Set(frameKeys);
    const frameOf = (k: string) => k.slice(0, k.indexOf('/'));
    for (const [k, b] of this.pngs) {
      if (!keep.has(frameOf(k))) {
        this.pngs.delete(k);
        this.pngBytes -= b.length;
      }
    }
    for (const k of [...this.grids.keys()]) if (!keep.has(frameOf(k))) this.grids.delete(k);
  }

  // Drop Cache Storage entries older than any frame RainViewer still serves.
  // By age, not by this tab's window: another tab may be showing a longer loop.
  private async pruneCache(): Promise<void> {
    const cache = await this.cache;
    if (!cache) return;
    try {
      const now = Date.now();
      for (const request of await cache.keys()) {
        const res = await cache.match(request);
        const at = Number(res?.headers.get(CACHE_TIME_HEADER));
        if (!Number.isFinite(at) || now - at > CACHE_MAX_AGE_MS) await cache.delete(request);
      }
    } catch {
      // best-effort
    }
    setTimeout(() => void this.pruneCache(), 30 * 60_000);
  }

  private reportStatus(): void {
    if (this.statusTimer) return;
    this.statusTimer = setTimeout(() => {
      this.statusTimer = null;
      const s = this.scheduler.stats;
      const status: ServiceStatus = { queued: s.queued, inFlight: s.inFlight, coolingDownMs: s.coolingDownMs };
      const sig = `${status.queued > 0}|${status.inFlight > 0}|${Math.ceil(status.coolingDownMs / 5000)}`;
      if (sig !== this.lastStatus) {
        this.lastStatus = sig;
        this.post({ type: 'status', status });
      }
      if (s.queued > 0 || s.inFlight > 0 || s.coolingDownMs > 0) this.reportStatus();
    }, 500);
  }
}
