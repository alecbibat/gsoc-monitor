interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

/**
 * Minimal in-memory TTL cache. Good enough for a single-dyno deployment;
 * if this ever runs across multiple dynos, swap for a shared store (e.g. Redis).
 */
class TtlCache {
  private store = new Map<string, CacheEntry<unknown>>();
  // Entries expire lazily on read, so a key that's never read again (per-query
  // geocodes, per-coordinate forecasts/routes) would otherwise sit in memory
  // forever on a small dyno. Cap the map with insertion-order eviction and
  // sweep expired entries periodically.
  private readonly maxEntries = 2000;
  // Last successful value per key, retained *past* its TTL so a failed refresh
  // can degrade to slightly-stale data instead of erroring. Bounded so a
  // high-cardinality key space (e.g. per-query geocoding) can't grow forever.
  private lastGood = new Map<string, unknown>();
  private readonly maxLastGood = 500;
  // Concurrent misses on the same key share one upstream fetch instead of
  // stampeding it (several dashboards polling the same route collide at every
  // TTL expiry — costly against rate-limited/paid upstreams).
  private inflight = new Map<string, Promise<unknown>>();

  constructor() {
    const sweep = setInterval(() => {
      const now = Date.now();
      for (const [key, entry] of this.store) {
        if (now > entry.expiresAt) this.store.delete(key);
      }
    }, 10 * 60_000);
    sweep.unref();
  }

  get<T>(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value as T;
  }

  set<T>(key: string, value: T, ttlMs: number): void {
    // Refresh recency (delete+set re-inserts at the end) so eviction is LRU-ish.
    this.store.delete(key);
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
    if (this.store.size > this.maxEntries) {
      const oldest = this.store.keys().next().value;
      if (oldest !== undefined) this.store.delete(oldest);
    }
    this.lastGood.delete(key);
    this.lastGood.set(key, value);
    if (this.lastGood.size > this.maxLastGood) {
      const oldest = this.lastGood.keys().next().value;
      if (oldest !== undefined) this.lastGood.delete(oldest);
    }
  }

  /** Last successful value for a key, even if its TTL has expired (or undefined). */
  getStale<T>(key: string): T | undefined {
    return this.lastGood.get(key) as T | undefined;
  }

  /**
   * Return a cached value, or run `fetcher` and cache its result.
   *
   * With `staleOnError`, if the fetcher throws (e.g. an upstream timeout) and we
   * have a previous successful value for this key, that stale value is served
   * instead of propagating the error — so a flaky upstream degrades to old data
   * rather than a 502. Without it (the default), the error propagates.
   */
  async getOrFetch<T>(
    key: string,
    ttlMs: number,
    fetcher: () => Promise<T>,
    opts?: { staleOnError?: boolean }
  ): Promise<T> {
    const cached = this.get<T>(key);
    if (cached !== undefined) return cached;

    const pending = this.inflight.get(key);
    if (pending) return pending as Promise<T>;

    const run = (async () => {
      try {
        const fresh = await fetcher();
        this.set(key, fresh, ttlMs);
        return fresh;
      } catch (err) {
        if (opts?.staleOnError) {
          const stale = this.getStale<T>(key);
          if (stale !== undefined) {
            console.warn(
              `[cache] serving stale "${key}" after refresh failure:`,
              err instanceof Error ? err.message : err
            );
            return stale;
          }
        }
        throw err;
      } finally {
        this.inflight.delete(key);
      }
    })();
    this.inflight.set(key, run);
    return run;
  }
}

export const cache = new TtlCache();
