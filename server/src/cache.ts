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
  // Last successful value per key, retained *past* its TTL so a failed refresh
  // can degrade to slightly-stale data instead of erroring. Bounded so a
  // high-cardinality key space (e.g. per-query geocoding) can't grow forever.
  private lastGood = new Map<string, unknown>();
  private readonly maxLastGood = 500;

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
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
    // Refresh recency (delete+set re-inserts at the end) so eviction is LRU-ish.
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
    }
  }
}

export const cache = new TtlCache();
