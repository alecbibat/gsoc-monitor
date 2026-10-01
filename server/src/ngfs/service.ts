// NGFS frame cache. Each NGFS product is a series of scan frames (one per
// GOES CONUS scan, every 5 minutes). Frames don't change once published, so
// each is fetched once and kept for the longest window the API offers; every
// request is answered by folding the frames inside its window into one record
// per hot pixel (parse.ts). The upstream is a university research server, so
// only frames we haven't seen are fetched, a backlog is paged in a few frames
// at a time, and nothing is polled while nobody is looking at the layer.

import { aggregatePixels, frameTimeMs, parseFrame, type NgfsFrame, type NgfsPixel, type NgfsSlot } from './parse';
import { RealEarthClient } from './realearth';

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

const REFRESH_MS = 2 * 60_000; // new frames land every 5 min per product
// After a refresh that reached neither product, requests are answered from
// the cache for this long rather than each waiting out the upstream timeouts.
const FAILURE_BACKOFF_MS = 30_000;
const BACKFILL_PER_REFRESH = 12; // older frames paged in per product per refresh
const FRAME_GAP_MS = 250; // pause between consecutive frame downloads
const MAX_FRAME_ATTEMPTS = 3; // a frame that keeps failing is skipped, and shown as a gap

export interface NgfsProductStatus {
  product: string;
  slot: NgfsSlot;
  sat: string;
  newestFrame: number | null; // epoch ms of the newest frame published upstream
  framesInWindow: number; // frames published upstream inside the window
  framesLoaded: number; // of those, how many are in the cache
  framesSkipped: number; // of those, how many failed MAX_FRAME_ATTEMPTS times and were given up on
  // Earliest time from which every frame up to the newest is loaded (or
  // skipped): the window is fully covered when this is at or before its start.
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

interface ProductState {
  stamps: string[]; // upstream frame stamps inside MAX_WINDOW_MS, oldest first
  error: string | null; // the frame list could not be read
  frameError: string | null; // the last frame download failed
  failures: Map<string, number>;
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
    for (const p of products) this.state.set(p.product, { stamps: [], error: null, frameError: null, failures: new Map() });
  }

  private key(p: NgfsProduct, stamp: string): string {
    return `${p.product}|${stamp}`;
  }

  private async loadFrame(p: NgfsProduct, stamp: string): Promise<void> {
    const st = this.state.get(p.product)!;
    const t = frameTimeMs(stamp);
    if (t == null) return;
    try {
      const observations = parseFrame(await this.client.frame(p.product, stamp), t);
      this.frames.set(this.key(p, stamp), { slot: p.slot, sat: p.sat, t, observations });
      st.failures.delete(stamp);
      st.frameError = null;
    } catch (err) {
      st.failures.set(stamp, (st.failures.get(stamp) ?? 0) + 1);
      st.frameError = err instanceof Error ? err.message : String(err);
      console.warn(`[ngfs] ${p.product} ${stamp}:`, st.frameError);
    }
  }

  /** Stamps in the window not yet cached and not given up on, newest first. */
  private missing(p: NgfsProduct): string[] {
    const st = this.state.get(p.product)!;
    return st.stamps
      .filter((s) => !this.frames.has(this.key(p, s)) && (st.failures.get(s) ?? 0) < MAX_FRAME_ATTEMPTS)
      .reverse();
  }

  private async refreshProduct(p: NgfsProduct): Promise<void> {
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
    if (newest && newest === st.stamps[st.stamps.length - 1]) await this.loadFrame(p, newest);
  }

  private async backfill(): Promise<void> {
    for (const p of this.products) {
      for (const stamp of this.missing(p).slice(0, BACKFILL_PER_REFRESH)) {
        await sleep(this.gapMs);
        await this.loadFrame(p, stamp);
      }
    }
  }

  private prune(): void {
    const cutoff = this.now() - MAX_WINDOW_MS;
    for (const [k, f] of this.frames) if (f.t < cutoff) this.frames.delete(k);
    for (const st of this.state.values()) {
      for (const s of st.failures.keys()) if (!st.stamps.includes(s)) st.failures.delete(s);
    }
  }

  /** Bring the cache up to date if it is older than REFRESH_MS; concurrent callers share one refresh. */
  async ensureFresh(): Promise<void> {
    const now = this.now();
    if (now - this.lastRefresh < REFRESH_MS || now - this.lastFailure < FAILURE_BACKOFF_MS) return;
    if (!this.refreshing) {
      this.refreshing = (async () => {
        try {
          await Promise.all(this.products.map((p) => this.refreshProduct(p)));
          this.prune();
          // Only count a refresh that reached the upstream, so an outage is
          // retried on the next request instead of being cached for 2 minutes.
          if (this.products.some((p) => this.state.get(p.product)!.error === null)) {
            this.lastRefresh = this.now();
          } else {
            this.lastFailure = this.now();
          }
          if (!this.backfilling) {
            this.backfilling = this.backfill()
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
      const loaded = (s: string) => this.frames.has(this.key(p, s));
      const skipped = (s: string) => !loaded(s) && (st.failures.get(s) ?? 0) >= MAX_FRAME_ATTEMPTS;
      let coveredFrom: number | null = null;
      for (let i = inWindow.length - 1; i >= 0; i--) {
        if (!loaded(inWindow[i]) && !skipped(inWindow[i])) break;
        coveredFrom = frameTimeMs(inWindow[i]);
      }
      const newest = st.stamps[st.stamps.length - 1];
      const newestLoaded = newest != null && loaded(newest);
      return {
        product: p.product,
        slot: p.slot,
        sat: p.sat,
        newestFrame: newest ? frameTimeMs(newest) : null,
        framesInWindow: inWindow.length,
        framesLoaded: inWindow.filter(loaded).length,
        framesSkipped: inWindow.filter(skipped).length,
        coveredFrom,
        // A frame-download failure only matters while it leaves the newest frame missing.
        error: st.error ?? (newestLoaded ? null : st.frameError),
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

  /** Wait for any background backfill (tests). */
  async settle(): Promise<void> {
    await this.backfilling;
  }
}

export const ngfsService = new NgfsService();
