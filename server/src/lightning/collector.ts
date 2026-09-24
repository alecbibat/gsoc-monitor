// The server's own Blitzortung socket: the collector every stored strike,
// count and gap comes from.
//
// Blitzortung's community network publishes real-time strikes over a set of
// public WebSocket relays (no API key). The collector connects at init — it
// never waits for the history restore, which used to leave the first ~15 s
// (or, with a slow database, much longer) of every boot uncollected — rotates
// relays on failure, and watches for a half-open socket: the global stream is
// never silent for a minute, so an "open" socket that is must be dead (a NAT
// timeout can leave TCP up with no 'close' event).

import WebSocket from 'ws';
import { WATCHDOG_SILENCE_MS } from './constants';
import { parseFrame, qLat, qLon, tickOf } from './quant';

export const RELAYS = ['wss://ws1.blitzortung.org/', 'wss://ws7.blitzortung.org/', 'wss://ws8.blitzortung.org/'];
const WATCHDOG_EVERY_MS = 15_000;
const BACKOFF_MAX_S = 60;
const DAY_MS = 24 * 60 * 60_000;
/** Exact repeats of a recent strike (a relay replaying frames after a reconnect) are dropped. */
const DUPE_WINDOW = 4_096;

/** The subset of a ws client the collector uses (a fake in tests). */
export interface WsLike {
  on(event: 'open', fn: () => void): unknown;
  on(event: 'message', fn: (data: WebSocket.RawData) => void): unknown;
  on(event: 'close', fn: () => void): unknown;
  on(event: 'error', fn: (err: Error) => void): unknown;
  send(data: string): void;
  terminate(): void;
}
export type WsFactory = (url: string) => WsLike;

const realWs: WsFactory = (url) => new WebSocket(url, { handshakeTimeout: 15_000 });

export interface CollectorStatus {
  connected: boolean;
  downSince: number | null;
  lastStrikeAt: number | null;
  ratePerMin: number;
  relay: string | null;
  connectedSince: number | null;
  reconnects24h: number;
  networkTimePct: number;
  rejected: number;
  dupes: number;
  received: number;
  synthetic: boolean;
}

export interface CollectorOptions {
  /** Called for every accepted strike, already quantized. */
  onStrike: (tick: number, latQ: number, lonQ: number) => void;
  wsFactory?: WsFactory;
  now?: () => number;
  random?: () => number;
  log?: (msg: string) => void;
  /** Strikes/s for the dev-only synthetic feed (null = real relays). */
  syntheticRate?: number | null;
}

export class Collector {
  private ws: WsLike | null = null;
  private relayIndex = 0;
  private relay: string | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private watchdog: ReturnType<typeof setInterval> | null = null;
  private synthTimer: ReturnType<typeof setInterval> | null = null;
  private failures = 0;
  private stopped = false;
  private started = false;

  private connected = false;
  private connectedSince: number | null = null;
  private downSince: number | null;
  private lastStrikeAt: number | null = null;
  private strikeSinceOpen = false;
  private reconnectTimes: number[] = [];

  private received = 0;
  private networkTimed = 0;
  private rejected = 0;
  private dupes = 0;
  private recentKeys = new Set<number>();
  private recentRing = new Float64Array(DUPE_WINDOW).fill(-1);
  private recentHead = 0;

  // Strikes per second over the last minute (ring keyed by epoch second).
  private secStamp = new Float64Array(60).fill(-1);
  private secCount = new Uint32Array(60);

  private readonly onStrikeCb: CollectorOptions['onStrike'];
  private readonly wsFactory: WsFactory;
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly log: (msg: string) => void;
  private readonly syntheticRate: number | null;

  constructor(opts: CollectorOptions) {
    this.onStrikeCb = opts.onStrike;
    this.wsFactory = opts.wsFactory ?? realWs;
    this.now = opts.now ?? Date.now;
    this.random = opts.random ?? Math.random;
    this.log = opts.log ?? ((m) => console.log(m));
    this.syntheticRate = opts.syntheticRate ?? null;
    this.downSince = this.now();
  }

  /** Connect now (or start the synthetic feed). Idempotent. */
  start(): void {
    if (this.started || this.stopped) return;
    this.started = true;
    if (this.syntheticRate !== null) {
      this.startSynthetic(this.syntheticRate);
      return;
    }
    this.connect();
    this.watchdog = setInterval(() => this.checkSilence(), WATCHDOG_EVERY_MS);
    this.watchdog.unref?.();
  }

  /** Shutdown: close the socket and never reconnect. */
  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.watchdog) clearInterval(this.watchdog);
    if (this.synthTimer) clearInterval(this.synthTimer);
    this.reconnectTimer = this.watchdog = this.synthTimer = null;
    const ws = this.ws;
    this.ws = null;
    this.markDown();
    try {
      ws?.terminate();
    } catch {
      /* already gone */
    }
    this.log('[lightning] collector stopped');
  }

  private connect(): void {
    if (this.stopped) return;
    const url = RELAYS[this.relayIndex % RELAYS.length];
    this.relayIndex++;
    this.relay = url;
    let socket: WsLike;
    try {
      socket = this.wsFactory(url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = socket;
    this.strikeSinceOpen = false;

    socket.on('open', () => {
      if (this.ws !== socket) return;
      this.connected = true;
      this.connectedSince = this.now();
      // Subscribe to the global strike stream.
      socket.send(JSON.stringify({ a: 111 }));
      this.log(`[lightning] connected to ${url}`);
    });
    socket.on('message', (data: WebSocket.RawData) => {
      if (this.ws !== socket) return;
      this.onFrame(data.toString());
    });
    socket.on('close', () => {
      if (this.ws !== socket) return;
      this.ws = null;
      this.markDown();
      this.scheduleReconnect();
    });
    socket.on('error', () => {
      // 'close' follows and reconnects; terminate makes sure it does.
      try {
        socket.terminate();
      } catch {
        /* already gone */
      }
    });
  }

  private markDown(): void {
    // Keep an earlier downSince (e.g. the watchdog's "went quiet at").
    if (this.downSince === null) this.downSince = this.now();
    this.connected = false;
    this.connectedSince = null;
  }

  /** 1, 2, 4 … 60 s plus up to 1 s of jitter; reset by the first strike after a successful open. */
  backoffMs(): number {
    return Math.min(BACKOFF_MAX_S, 2 ** Math.min(this.failures, 6)) * 1000 + Math.floor(this.random() * 1000);
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    const delay = this.backoffMs();
    this.failures++;
    const now = this.now();
    this.reconnectTimes.push(now);
    while (this.reconnectTimes.length && this.reconnectTimes[0] < now - DAY_MS) this.reconnectTimes.shift();
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
    this.reconnectTimer.unref?.();
  }

  private checkSilence(): void {
    const ws = this.ws;
    if (!ws || !this.connected) return;
    const now = this.now();
    const lastHeard = Math.max(this.lastStrikeAt ?? 0, this.connectedSince ?? 0);
    if (now - lastHeard < WATCHDOG_SILENCE_MS) return;
    this.log(`[lightning] no strikes for ${Math.round((now - lastHeard) / 1000)} s on an open socket — reconnecting`);
    // Down since it went quiet, not since we noticed.
    this.downSince = lastHeard;
    this.connected = false;
    try {
      ws.terminate(); // → 'close' → scheduleReconnect
    } catch {
      this.ws = null;
      this.scheduleReconnect();
    }
  }

  /** One relay frame (exposed for tests). */
  onFrame(raw: string): void {
    const recv = this.now();
    const s = parseFrame(raw, recv);
    if (!s) {
      this.rejected++;
      return;
    }
    this.accept(tickOf(s.tMs), qLat(s.lat), qLon(s.lon), s.networkTime, recv);
  }

  private accept(tick: number, latQ: number, lonQ: number, networkTime: boolean, recv: number): void {
    // Exact repeat of a strike seen in the last few thousand? Drop it, so
    // counts stay exact. (tick mod 8192 keeps the key in 53 bits; a false match
    // needs the same 20-bit lat AND lon an exact multiple of 81.92 s apart.)
    const key = (tick % 8_192) * 1_099_511_627_776 + latQ * 1_048_576 + lonQ;
    if (this.recentKeys.has(key)) {
      this.dupes++;
      return;
    }
    const old = this.recentRing[this.recentHead];
    if (old >= 0) this.recentKeys.delete(old);
    this.recentRing[this.recentHead] = key;
    this.recentHead = (this.recentHead + 1) % DUPE_WINDOW;
    this.recentKeys.add(key);

    this.received++;
    if (networkTime) this.networkTimed++;
    this.lastStrikeAt = recv;
    if (!this.strikeSinceOpen) {
      this.strikeSinceOpen = true;
      this.failures = 0;
      this.downSince = null;
    }
    const sec = Math.floor(recv / 1000);
    const slot = sec % 60;
    if (this.secStamp[slot] !== sec) {
      this.secStamp[slot] = sec;
      this.secCount[slot] = 0;
    }
    this.secCount[slot]++;
    this.onStrikeCb(tick, latQ, lonQ);
  }

  ratePerMin(now = this.now()): number {
    const sec = Math.floor(now / 1000);
    let sum = 0;
    for (let i = 0; i < 60; i++) if (this.secStamp[i] > sec - 60 && this.secStamp[i] <= sec) sum += this.secCount[i];
    return sum;
  }

  status(now = this.now()): CollectorStatus {
    while (this.reconnectTimes.length && this.reconnectTimes[0] < now - DAY_MS) this.reconnectTimes.shift();
    return {
      connected: this.connected,
      downSince: this.downSince,
      lastStrikeAt: this.lastStrikeAt,
      ratePerMin: this.ratePerMin(now),
      relay: this.relay,
      connectedSince: this.connectedSince,
      reconnects24h: this.reconnectTimes.length,
      networkTimePct: this.received ? Math.round((this.networkTimed / this.received) * 1000) / 10 : 0,
      rejected: this.rejected,
      dupes: this.dupes,
      received: this.received,
      synthetic: this.syntheticRate !== null,
    };
  }

  // --- Dev-only synthetic feed ------------------------------------------------
  // LIGHTNING_SYNTHETIC_RATE (never in production) replaces the relays with
  // generated strikes through the same accept() path, so the whole pipeline —
  // store, persistence, display, near — can be exercised locally and in the
  // end-to-end check without reaching blitzortung.org.

  private startSynthetic(rate: number): void {
    this.log(`[lightning] SYNTHETIC feed at ${rate} strikes/s — dev only, no relay connection`);
    const cells = Array.from({ length: 25 }, () => this.spawnCell());
    this.relay = 'synthetic';
    this.connected = true;
    this.connectedSince = this.now();
    this.downSince = null;
    let carry = 0;
    let last = this.now();
    this.synthTimer = setInterval(() => {
      const now = this.now();
      const dtS = Math.min(5, (now - last) / 1000);
      last = now;
      carry += rate * dtS;
      const n = Math.floor(carry);
      carry -= n;
      for (const c of cells) {
        c.lat += c.vLat * dtS;
        c.lon += c.vLon * dtS;
        c.ttlS -= dtS;
      }
      for (let i = 0; i < cells.length; i++) if (cells[i].ttlS <= 0) cells[i] = this.spawnCell();
      const totalW = cells.reduce((a, c) => a + c.weight, 0);
      for (let k = 0; k < n; k++) {
        let lat: number;
        let lon: number;
        if (this.random() < 0.03) {
          // Isolated singletons anywhere in the lightning belt.
          lat = (this.random() - 0.5) * 100;
          lon = (this.random() - 0.5) * 360;
        } else {
          let pick = this.random() * totalW;
          let c = cells[0];
          for (const cell of cells) {
            pick -= cell.weight;
            if (pick <= 0) {
              c = cell;
              break;
            }
          }
          lat = c.lat + this.gauss() * 0.15;
          lon = c.lon + this.gauss() * 0.15;
        }
        lat = Math.max(-90, Math.min(90, lat));
        lon = ((((lon + 180) % 360) + 360) % 360) - 180;
        const tMs = now - 1000 - this.random() * 3000; // network time 1–4 s before receipt
        this.accept(tickOf(tMs), qLat(lat), qLon(lon), true, now);
      }
    }, 100);
    this.synthTimer.unref?.();
  }

  private spawnCell(): { lat: number; lon: number; vLat: number; vLon: number; ttlS: number; weight: number } {
    // Lightning-heavy regions: CONUS (weighted ×3), Central America, Amazon,
    // Congo basin, India/Bangladesh, Maritime Continent, northern Australia, Europe.
    const regions: [number, number, number, number][] = [
      [30, 42, -105, -80], [30, 42, -105, -80], [30, 42, -105, -80],
      [8, 20, -95, -80], [-15, 0, -70, -50], [-5, 5, 15, 30],
      [20, 27, 78, 92], [-8, 5, 100, 120], [-18, -12, 125, 140], [42, 50, 0, 20],
    ];
    const [s, n, w, e] = regions[Math.floor(this.random() * regions.length)];
    return {
      lat: s + this.random() * (n - s),
      lon: w + this.random() * (e - w),
      // ~20–60 km/h drift, mostly eastward.
      vLat: (this.random() - 0.5) * 2e-4,
      vLon: 5e-5 + this.random() * 1.5e-4,
      ttlS: 1_800 + this.random() * 7_200,
      weight: 0.3 + this.random(),
    };
  }

  private gauss(): number {
    const u = Math.max(1e-12, this.random());
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * this.random());
  }
}

/** LIGHTNING_SYNTHETIC_RATE, honoured only outside production. */
export function syntheticRateFromEnv(env: NodeJS.ProcessEnv = process.env): number | null {
  if (!env.LIGHTNING_SYNTHETIC_RATE || env.NODE_ENV === 'production') return null;
  const r = Number(env.LIGHTNING_SYNTHETIC_RATE);
  return Number.isFinite(r) && r > 0 ? r : null;
}
