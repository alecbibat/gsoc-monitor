import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cache } from './cache';

// The module exports a singleton, so give every test its own key namespace to
// keep them independent.
let n = 0;
const key = () => `test:${++n}`;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('TtlCache get/set', () => {
  it('returns a value before its TTL and drops it after', () => {
    const k = key();
    cache.set(k, 'fresh', 1_000);
    expect(cache.get(k)).toBe('fresh');
    vi.advanceTimersByTime(1_001);
    expect(cache.get(k)).toBeUndefined();
  });

  it('retains the last good value past expiry for getStale', () => {
    const k = key();
    cache.set(k, 'old', 1_000);
    vi.advanceTimersByTime(5_000);
    expect(cache.get(k)).toBeUndefined();
    expect(cache.getStale(k)).toBe('old');
  });
});

describe('TtlCache getOrFetch', () => {
  it('fetches on miss and serves from cache on hit', async () => {
    const k = key();
    const fetcher = vi.fn(async () => 'value');
    await expect(cache.getOrFetch(k, 1_000, fetcher)).resolves.toBe('value');
    await expect(cache.getOrFetch(k, 1_000, fetcher)).resolves.toBe('value');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('coalesces concurrent misses into one upstream fetch', async () => {
    const k = key();
    let resolve!: (v: string) => void;
    const fetcher = vi.fn(
      () => new Promise<string>((res) => (resolve = res))
    );
    const a = cache.getOrFetch(k, 1_000, fetcher);
    const b = cache.getOrFetch(k, 1_000, fetcher);
    resolve('shared');
    await expect(a).resolves.toBe('shared');
    await expect(b).resolves.toBe('shared');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('serves the stale value when the fetcher fails and staleOnError is set', async () => {
    const k = key();
    cache.set(k, 'last-good', 1_000);
    vi.advanceTimersByTime(2_000); // expire the live entry
    const failing = vi.fn(async () => {
      throw new Error('upstream down');
    });
    await expect(
      cache.getOrFetch(k, 1_000, failing, { staleOnError: true })
    ).resolves.toBe('last-good');
  });

  it('propagates the error without staleOnError', async () => {
    const k = key();
    cache.set(k, 'last-good', 1_000);
    vi.advanceTimersByTime(2_000);
    const failing = vi.fn(async () => {
      throw new Error('upstream down');
    });
    await expect(cache.getOrFetch(k, 1_000, failing)).rejects.toThrow('upstream down');
  });

  it('propagates the error when there is no stale value even with staleOnError', async () => {
    const k = key();
    const failing = vi.fn(async () => {
      throw new Error('upstream down');
    });
    await expect(
      cache.getOrFetch(k, 1_000, failing, { staleOnError: true })
    ).rejects.toThrow('upstream down');
  });

  it('retries the upstream after a failure resolves (inflight entry is cleared)', async () => {
    const k = key();
    const fetcher = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce('recovered');
    await expect(cache.getOrFetch(k, 1_000, fetcher)).rejects.toThrow('boom');
    await expect(cache.getOrFetch(k, 1_000, fetcher)).resolves.toBe('recovered');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
