// Memory guard. The whole app shares one 512 MB Basic dyno, and the strike
// store is by far its largest resident (8 bytes a strike, ~70–100 MB for 24 h
// at 100/s). If the process gets near the limit (R14 swapping, then an R15
// kill that loses everything unsaved), shed the OLDEST strikes first: counts
// stay exact (the per-minute ring is untouched) and /status reports it.

import { RSS_HIGH_BYTES, RSS_LOW_BYTES } from './constants';
import type { StrikeStore } from './store';

/** Never shrink below this many records (unless configured lower): ~5 h at 100/s. */
export const CAPACITY_FLOOR = 3_000_000;
const GROW_AFTER_MS = 10 * 60_000;

export interface MemoryGuardDeps {
  store: StrikeStore;
  /** The configured capacity (MAX_RECORDS); the guard never grows past it. */
  configured: number;
  rss: () => number;
  now?: () => number;
  /** Called on every shrink — drop caches that hold large bodies. */
  onShrink?: () => void;
  log?: (msg: string) => void;
}

export class MemoryGuard {
  /** True while the capacity is below the configured value. */
  pressure = false;
  private lowSince: number | null = null;
  private readonly now: () => number;
  private readonly log: (msg: string) => void;

  constructor(private deps: MemoryGuardDeps) {
    this.now = deps.now ?? Date.now;
    this.log = deps.log ?? ((m) => console.log(m));
  }

  /** Run once a minute. */
  tick(): void {
    const { store, configured } = this.deps;
    const rss = this.deps.rss();
    const now = this.now();
    const mb = (b: number) => Math.round(b / 1_048_576);
    if (rss > RSS_HIGH_BYTES) {
      this.lowSince = null;
      const floor = Math.min(CAPACITY_FLOOR, configured);
      const next = Math.max(floor, Math.floor(store.capacity * 0.85));
      const before = store.records;
      if (next < store.capacity) store.setCapacity(next);
      store.enforceCapacity();
      this.deps.onShrink?.();
      this.pressure = true;
      this.log(
        `[lightning] rss ${mb(rss)} MB > ${mb(RSS_HIGH_BYTES)} MB — capacity ${store.capacity}, ` +
          `evicted ${before - store.records} oldest strikes (counts stay exact)`
      );
      return;
    }
    if (rss >= RSS_LOW_BYTES) {
      this.lowSince = null;
      return;
    }
    if (this.lowSince === null) this.lowSince = now;
    if (now - this.lowSince < GROW_AFTER_MS || store.capacity >= configured) return;
    store.setCapacity(Math.min(configured, Math.floor(store.capacity * 1.1)));
    this.lowSince = now; // another 10 quiet minutes before the next step
    this.pressure = store.capacity < configured;
    this.log(`[lightning] rss ${mb(rss)} MB — capacity back up to ${store.capacity}`);
  }
}
