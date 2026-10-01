// NGFS frame cache. Each NGFS product is a series of scan frames (one per
// GOES CONUS scan, every 5 minutes). Frames don't change once published, so
// each is fetched once and kept for the longest window the API offers; every
// request is answered by folding the frames inside its window into one record
// per hot pixel (parse.ts). The upstream is a university research server, so
// only frames we haven't seen are fetched, a backlog is paged in a few frames
// at a time, nothing is polled while nobody is looking at the layer, and an
// upstream that is failing gets one or two requests per refresh, not dozens.

import { aggregatePixels, frameTimeMs, parseFrame, type NgfsFrame, type NgfsPixel, type NgfsSlot } from './parse';
import { RealEarthClient, RealEarthHttpError } from './realearth';

export interface NgfsProduct {
  product: string;
  slot: NgfsSlot;
  sat: string; // the spacecraft currently operating in the slot
}

// GOES-19 has been GOES-East since April 2025 and GOES-18 GOES-West since
// January 2023. Update `sat` (not the products) when NOAA swaps a spacecraft.
export const NGFS_PRODUCTS: NgfsProduct[] = [
  { product: 'NGFS-SCENE-CONUS-EAST', slot: 'east', sat: 'GOES-19' },
  { product: 'NGFS-SCENE-CONUS-WEST', slot: 'west', sat: 'GOES-18' },
];

export const NGFS_WINDOWS_H = [1, 3, 6] as const;
export type NgfsWindowH = (typeof NGFS_WINDOWS_H)[number];
const MAX_WINDOW_MS = 6 * 3_600_000;

// New frames land every 5 min per product and the client polls every 2 min.
// Kept under the poll interval (and measured from when a refresh starts) so a
// lone viewer's every poll refreshes, whatever the round-trip time.
const REFRESH_MS = 100_000;
// After a refresh that reached neither product, requests are answered from
// the cache for this long rather than each waiting out the upstream timeouts.
const FAILURE_BACKOFF_MS = 30_000;
const BACKFILL_PER_REFRESH = 12; // older frames paged in per product per refresh
const FRAME_GAP_MS = 250; // pause between consecutive frame downloads
// Failures that look like an outage (network, timeout, 5xx, 429) in a row
// before the backfill stops for this refresh.
const MAX_SOFT_FAILURES_IN_A_ROW = 2;
// A frame that fails this often (at most once per refresh) is skipped and
// shown as a gap, then tried again after SKIP_RETRY_MS in case the upstream
// has recovered.
const MAX_FRAME_ATTEMPTS = 3;
const SKIP_RETRY_MS = 20 * 60_000;

export interface NgfsProductStatus {
  product: string;
  slot: NgfsSlot;
  sat: string;
  newestFrame: number | null; // epoch ms of the newest frame published upstream
  newestLoaded: number | null; // epoch ms of the newest frame in the cache
  framesInWindow: number; // frames published upstream inside the window
  framesLoaded: number; // of those, how many are in the cache
  framesSkipped: number; // of those, how many keep failing and are currently given up on
  // Earliest time from which every frame up to the newest is loaded (or
  // skipped): the window is fully covered when this is at or before its start.
  // Null while the newest frame itself isn't loaded.
  coveredFrom: number | null;
  error: string | null;
}

export interface NgfsSnapshot {
  generatedAt: number;
  windowHours: NgfsWindowH;
  windowStart: number;
  products: NgfsProductStatus[];
  pixels: NgfsPixel[];
}

interface FrameFailure {
  count: number; // strikes towards MAX_FRAME_ATTEMPTS
  at: number; // last strike, epoch ms
}

interface ProductState {
  stamps: string[]; // upstream frame stamps inside MAX_WINDOW_MS, oldest first
  error: string | null; // the frame list could not be read
  failures: Map<string, FrameFailure>;
  frameErrors: Map<string, string>; // last download error per stamp not yet loaded
}

// One refresh: the frame list and newest frame in the foreground, then the
// background backfill. Failures are judged per cycle.
interface Cycle {
  tried: Set<string>; // `${product}|${stamp}` downloads attempted this cycle
  soft: Array<{ product: string; stamp: string }>; // outage-like failures, charged only if something else worked
  ok: number; // frame downloads that succeeded this cycle
}

type LoadResult = 'ok' | 'soft' | 'hard';

/**
 * Whether a failed download says something about this frame (it's missing or
 * malformed) or only about the upstream right now (unreachable, overloaded).
 */
function isFrameSpecific(err: unknown): boolean {
  if (err instanceof RealEarthHttpError) return err.status >= 400 && err.status < 500 && err.status !== 429;
  // parseFrame rejected the body; network errors and timeouts are TypeError / DOMException.
  return err instanceof Error && /FeatureCollection/.test(err.message);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class NgfsService {
  private frames = new Map<string, NgfsFrame>(); // `${product}|${stamp}`
  private state = new Map<string, ProductState>();
  private lastRefresh = 0;
  private lastFailure = 0;
  private refreshing: Promise<void> | null = null;
  private backfilling: Promise<void> | null = null;

  constructor(
    private readonly client = new RealEarthClient(),
    private readonly products: NgfsProduct[] = NGFS_PRODUCTS,
    private readonly now: () => number = Date.now,
    private readonly gapMs = FRAME_GAP_MS
  ) {
    for (const p of products) {
      this.state.set(p.product, { stamps: [], error: null, failures: new Map(), frameErrors: new Map() });
    }
  }

  private key(p: NgfsProduct, stamp: string): string {
    return `${p.product}|${stamp}`;
  }

  private loaded(p: NgfsProduct, stamp: string): boolean {
    return this.frames.has(this.key(p, stamp));
  }

  /** Given up on for now: failed MAX_FRAME_ATTEMPTS times, the last one under SKIP_RETRY_MS ago. */
  private skipped(p: NgfsProduct, stamp: string): boolean {
    const f = this.state.get(p.product)!.failures.get(stamp);
    return f != null && f.count >= MAX_FRAME_ATTEMPTS && this.now() - f.at < SKIP_RETRY_MS;
  }

  private strike(p: NgfsProduct, stamp: string): void {
    const st = this.state.get(p.product)!;
    const prev = st.failures.get(stamp);
    // A skipped frame retried after SKIP_RETRY_MS that fails again is skipped again straight away.
    st.failures.set(stamp, { count: Math.min((prev?.count ?? 0) + 1, MAX_FRAME_ATTEMPTS), at: this.now() });
  }

  private async loadFrame(p: NgfsProduct, stamp: string, cycle: Cycle): Promise<LoadResult> {
    const st = this.state.get(p.product)!;
    const t = frameTimeMs(stamp);
    if (t == null) return 'hard';
    cycle.tried.add(this.key(p, stamp));
    try {
      const observations = parseFrame(await this.client.frame(p.product, stamp), t);
      this.frames.set(this.key(p, stamp), { slot: p.slot, sat: p.sat, t, observations });
      st.failures.delete(stamp);
      st.frameErrors.delete(stamp);
      cycle.ok++;
      return 'ok';
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      st.frameErrors.set(stamp, msg);
      console.warn(`[ngfs] ${p.product} ${stamp}:`, msg);
      if (isFrameSpecific(err)) {
        this.strike(p, stamp);
        return 'hard';
      }
      cycle.soft.push({ product: p.product, stamp });
      return 'soft';
    }
  }

  /** Stamps in the window not yet cached and not given up on, newest first. */
  private missing(p: NgfsProduct): string[] {
    const st = this.state.get(p.product)!;
    return st.stamps.filter((s) => !this.loaded(p, s) && !this.skipped(p, s)).reverse();
  }

  private async refreshProduct(p: NgfsProduct, cycle: Cycle): Promise<void> {
    const st = this.state.get(p.product)!;
    try {
      const cutoff = this.now() - MAX_WINDOW_MS;
      const listed = (await this.client.frameTimes(p.product)).filter((s) => {
        const t = frameTimeMs(s);
        return t != null && t >= cutoff;
      });
      // Oldest first and unique, whatever order the catalog lists them in
      // (the stamp format sorts chronologically as text).
      st.stamps = [...new Set(listed)].sort();
      st.error = null;
    } catch (err) {
      st.error = err instanceof Error ? err.message : String(err);
      console.warn(`[ngfs] ${p.product} frame list:`, st.error);
      return;
    }
    // The newest frame is what the map is for, so it is fetched before the
    // response goes out; older ones follow in the background.
    const [newest] = this.missing(p);
    if (newest && newest === st.stamps[st.stamps.length - 1]) await this.loadFrame(p, newest, cycle);
  }

  private async backfill(cycle: Cycle): Promise<void> {
    let softInARow = 0;
    for (const p of this.products) {
      // A product whose list couldn't be read this cycle has a stale list.
      if (this.state.get(p.product)!.error !== null) continue;
      // One attempt per frame per cycle: skip what the foreground just tried.
      const todo = this.missing(p).filter((s) => !cycle.tried.has(this.key(p, s)));
      for (const stamp of todo.slice(0, BACKFILL_PER_REFRESH)) {
        if (softInARow >= MAX_SOFT_FAILURES_IN_A_ROW) break;
        await sleep(this.gapMs);
        const r = await this.loadFrame(p, stamp, cycle);
        softInARow = r === 'soft' ? softInARow + 1 : 0;
      }
    }
    // Outage-like failures count against a frame only when other downloads
    // worked this cycle, i.e. the upstream was up and that frame wasn't.
    if (cycle.ok > 0) for (const f of cycle.soft) this.strike(this.products.find((p) => p.product === f.product)!, f.stamp);
  }

  private prune(): void {
    const cutoff = this.now() - MAX_WINDOW_MS;
    for (const [k, f] of this.frames) if (f.t < cutoff) this.frames.delete(k);
    for (const st of this.state.values()) {
      const listed = new Set(st.stamps);
      for (const s of st.failures.keys()) if (!listed.has(s)) st.failures.delete(s);
      for (const s of st.frameErrors.keys()) if (!listed.has(s)) st.frameErrors.delete(s);
    }
  }

  /** Bring the cache up to date if it is older than REFRESH_MS; concurrent callers share one refresh. */
  async ensureFresh(): Promise<void> {
    const started = this.now();
    if (started - this.lastRefresh < REFRESH_MS || started - this.lastFailure < FAILURE_BACKOFF_MS) return;
    if (!this.refreshing) {
      this.refreshing = (async () => {
        try {
          const cycle: Cycle = { tried: new Set(), soft: [], ok: 0 };
          await Promise.all(this.products.map((p) => this.refreshProduct(p, cycle)));
          this.prune();
          // Only count a refresh that reached the upstream, so an outage is
          // retried after the short backoff instead of the full interval.
          if (!this.products.some((p) => this.state.get(p.product)!.error === null)) {
            this.lastFailure = this.now();
            return;
          }
          this.lastRefresh = started;
          if (!this.backfilling) {
            this.backfilling = this.backfill(cycle)
              .catch((err) => console.warn('[ngfs] backfill:', err instanceof Error ? err.message : err))
              .finally(() => {
                this.backfilling = null;
              });
          }
        } finally {
          this.refreshing = null;
        }
      })();
    }
    await this.refreshing;
  }

  snapshot(windowHours: NgfsWindowH): NgfsSnapshot {
    const now = this.now();
    const windowStart = now - windowHours * 3_600_000;
    const products: NgfsProductStatus[] = this.products.map((p) => {
      const st = this.state.get(p.product)!;
      const inWindow = st.stamps.filter((s) => (frameTimeMs(s) ?? 0) >= windowStart);
      const loaded = (s: string) => this.loaded(p, s);
      const skipped = (s: string) => !loaded(s) && this.skipped(p, s);
      let coveredFrom: number | null = null;
      for (let i = inWindow.length - 1; i >= 0; i--) {
        if (!loaded(inWindow[i]) && !skipped(inWindow[i])) break;
        coveredFrom = frameTimeMs(inWindow[i]);
      }
      const newest = st.stamps[st.stamps.length - 1];
      const newestLoaded = [...st.stamps].reverse().find(loaded);
      return {
        product: p.product,
        slot: p.slot,
        sat: p.sat,
        newestFrame: newest ? frameTimeMs(newest) : null,
        newestLoaded: newestLoaded ? frameTimeMs(newestLoaded) : null,
        framesInWindow: inWindow.length,
        framesLoaded: inWindow.filter(loaded).length,
        framesSkipped: inWindow.filter(skipped).length,
        coveredFrom,
        // A download failure matters while it is what keeps the newest frame
        // off the map; older gaps are reported through framesSkipped.
        error: st.error ?? (newest && !loaded(newest) ? (st.frameErrors.get(newest) ?? null) : null),
      };
    });
    return {
      generatedAt: now,
      windowHours,
      windowStart,
      products,
      pixels: aggregatePixels(this.frames.values(), windowStart),
    };
  }

  /** True while a refresh is talking to the upstream. */
  get busy(): boolean {
    return this.refreshing !== null;
  }

  /** True when no product has any frame cached: there is nothing to serve. */
  get empty(): boolean {
    return this.frames.size === 0;
  }

  /** Frames held in memory (tests: the cache must stay bounded). */
  get frameCount(): number {
    return this.frames.size;
  }

  /** Wait for any background backfill (tests). */
  async settle(): Promise<void> {
    await this.backfilling;
  }
}

export const ngfsService = new NgfsService();
