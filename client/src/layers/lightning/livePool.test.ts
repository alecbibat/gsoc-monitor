import { describe, expect, it } from 'vitest';
import { LivePool } from './livePool';

const HOLD_MS = 120_000;

// Adds `n` strikes one ms apart from `t0`, returning every key evicted.
function fill(pool: LivePool<number>, prefix: string, n: number, t0: number, near: boolean): string[] {
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const r = pool.add(`${prefix}${i}`, t0 + i, near);
    if (r.entry) r.entry.handle = i;
    for (const e of r.evicted) out.push(e.key);
  }
  return out;
}

describe('live pool', () => {
  it('holds up to the caps: far is a sub-cap of the whole pool', () => {
    const pool = new LivePool<number>({ near: 10, far: 3 });
    fill(pool, 'f', 5, 0, false);
    expect(pool.farCount).toBe(3);
    fill(pool, 'n', 7, 100, true);
    expect(pool.nearCount).toBe(7);
    expect(pool.size).toBe(10);
  });

  it('evicts the oldest far strike first, then the oldest near one', () => {
    const pool = new LivePool<number>({ near: 5, far: 2 });
    fill(pool, 'f', 2, 0, false); // f0, f1 (oldest overall)
    fill(pool, 'n', 3, 10, true); // n0..n2 — pool now full
    // A near arrival sheds the far strikes before any near one…
    expect(pool.add('n3', 20, true).evicted.map((e) => e.key)).toEqual(['f0']);
    expect(pool.add('n4', 21, true).evicted.map((e) => e.key)).toEqual(['f1']);
    // …and only then the oldest near.
    expect(pool.add('n5', 22, true).evicted.map((e) => e.key)).toEqual(['n0']);
    expect(pool.farCount).toBe(0);
    expect(pool.nearCount).toBe(5);
  });

  it('a far arrival evicts only far strikes (over its sub-cap)', () => {
    const pool = new LivePool<number>({ near: 10, far: 2 });
    fill(pool, 'n', 5, 0, true);
    fill(pool, 'f', 2, 10, false);
    const r = pool.add('f2', 20, false);
    expect(r.entry).not.toBeNull();
    expect(r.evicted.map((e) => e.key)).toEqual(['f0']);
    expect(pool.nearCount).toBe(5);
  });

  it('10k far strikes never evict a near one', () => {
    const pool = new LivePool<number>({ near: 4_000, far: 800 });
    fill(pool, 'n', 3_500, 0, true);
    const evicted = fill(pool, 'f', 10_000, 5_000, false);
    expect(pool.nearCount).toBe(3_500);
    expect(evicted.every((k) => k.startsWith('f'))).toBe(true);
    expect(pool.farCount).toBe(500); // what's left of the whole pool
    expect(pool.size).toBe(4_000);
    // With the pool full of near strikes, a far arrival is simply not admitted.
    const full = new LivePool<number>({ near: 100, far: 20 });
    fill(full, 'n', 100, 0, true);
    const r = full.add('late-far', 1_000, false);
    expect(r.entry).toBeNull();
    expect(r.evicted).toEqual([]);
    expect(full.nearCount).toBe(100);
  });

  it('orders by strike time, not arrival: an older arrival is evicted first', () => {
    const pool = new LivePool<number>({ near: 3, far: 0 });
    pool.add('a', 100, true);
    pool.add('b', 300, true);
    pool.add('old', 50, true); // e.g. from a fresh list, behind the socket
    expect(pool.add('c', 400, true).evicted.map((e) => e.key)).toEqual(['old']);
    // An arrival older than everything held is not admitted into a full pool.
    const r = pool.add('older', 10, true);
    expect(r.entry).toBeNull();
    expect(r.evicted).toEqual([]);
    expect([...pool.values()].map((e) => e.key).sort()).toEqual(['a', 'b', 'c']);
  });

  it('dedupes by key', () => {
    const pool = new LivePool<number>({ near: 10, far: 5 });
    expect(pool.add('k', 1, true).entry).not.toBeNull();
    expect(pool.add('k', 1, false).entry).toBeNull();
    expect(pool.size).toBe(1);
    expect(pool.has('k')).toBe(true);
    expect(pool.has('nope')).toBe(false);
    expect(pool.get('k')?.near).toBe(true);
  });

  it('retires strikes exactly at the hold, near and far alike', () => {
    const pool = new LivePool<number>({ near: 10, far: 5 });
    pool.add('n-old', 1_000, true);
    pool.add('f-old', 1_500, false);
    pool.add('n-new', 60_000, true);
    expect(pool.retire(1_000 + HOLD_MS - 1, HOLD_MS)).toEqual([]);
    expect(pool.retire(1_000 + HOLD_MS, HOLD_MS).map((e) => e.key)).toEqual(['n-old']);
    expect(pool.has('n-old')).toBe(false);
    expect(pool.retire(150_000, HOLD_MS).map((e) => e.key)).toEqual(['f-old']);
    expect(pool.size).toBe(1);
    expect(pool.retire(60_000 + HOLD_MS, HOLD_MS).map((e) => e.key)).toEqual(['n-new']);
    expect(pool.size).toBe(0);
  });

  it('clear() hands back every entry', () => {
    const pool = new LivePool<number>({ near: 10, far: 5 });
    fill(pool, 'n', 3, 0, true);
    fill(pool, 'f', 2, 0, false);
    expect(pool.clear()).toHaveLength(5);
    expect(pool.size).toBe(0);
    expect(pool.nearCount + pool.farCount).toBe(0);
  });
});
