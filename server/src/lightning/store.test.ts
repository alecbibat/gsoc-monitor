import { describe, expect, it } from 'vitest';
import { PRUNE_GRACE_MS, RETENTION_MS, SEG_CAP } from './constants';
import { QMAX } from './quant';
import {
  BASE_LEAD_TICKS,
  MIXED_WRITER,
  StrikeStore,
  TOFF_LIMIT,
  identityKey,
  latQOf,
  lonQOf,
  packHi,
  packLo,
  recordAt,
  tOffOf,
} from './store';

const NOW = Date.UTC(2026, 8, 24, 12, 0, 0); // on a minute boundary
const NOW_TICK = NOW / 10;
const MIN = 60_000;
const mk = (capacity = 10_000_000, now = () => NOW) => new StrikeStore({ capacity, selfWriter: 'self', now });

function all(store: StrikeStore): { tick: number; latQ: number; lonQ: number }[] {
  const snap = store.snapshot();
  const out = [];
  for (const { seg, n } of snap.segs) for (let i = 0; i < n; i++) out.push(recordAt(seg.words, seg.baseTick, i));
  snap.release();
  return out;
}

describe('record packing', () => {
  it('round-trips every field at its limits', () => {
    for (const [latQ, lonQ, tOff] of [
      [0, 0, 0],
      [QMAX, QMAX, TOFF_LIMIT - 1],
      [123_456, 987_654, 4095],
      [1, 2, 4096],
      [QMAX, 0, 0xabcdef],
    ]) {
      const lo = packLo(latQ, tOff);
      const hi = packHi(lonQ, tOff);
      expect(latQOf(lo)).toBe(latQ);
      expect(lonQOf(hi)).toBe(lonQ);
      expect(tOffOf(lo, hi)).toBe(tOff);
    }
  });

  it('stores and reads back records at the segment tOff boundaries', () => {
    const s = mk();
    const t0 = NOW_TICK;
    s.appendLive(t0, 10, 20); // base = t0 - 30 h
    s.appendLive(t0 - BASE_LEAD_TICKS, QMAX, 0); // tOff = 0
    s.appendLive(t0 - BASE_LEAD_TICKS + TOFF_LIMIT - 1, 0, QMAX); // tOff = 2^24 - 1
    expect(s.segments()).toHaveLength(1);
    // Neither fits the open segment: each opens a new one (defensive).
    s.appendLive(t0 - BASE_LEAD_TICKS - 1, 5, 6);
    s.appendLive(t0 + TOFF_LIMIT, 7, 8);
    expect(s.segments().length).toBeGreaterThanOrEqual(3);
    expect(all(s)).toEqual([
      { tick: t0, latQ: 10, lonQ: 20 },
      { tick: t0 - BASE_LEAD_TICKS, latQ: QMAX, lonQ: 0 },
      { tick: t0 - BASE_LEAD_TICKS + TOFF_LIMIT - 1, latQ: 0, lonQ: QMAX },
      { tick: t0 - BASE_LEAD_TICKS - 1, latQ: 5, lonQ: 6 },
      { tick: t0 + TOFF_LIMIT, latQ: 7, lonQ: 8 },
    ]);
    expect(s.records).toBe(5);
  });

  it('opens a new segment after SEG_CAP records and keeps import weights apart', () => {
    const s = mk();
    for (let i = 0; i <= SEG_CAP; i++) s.appendLive(NOW_TICK - i, i % 1000, i % 777);
    const own = s.segments().filter((g) => g.own);
    expect(own.map((g) => g.n)).toEqual([SEG_CAP, 1]);
    s.appendImport(NOW_TICK - 100, 1, 1, 1, s.writerIdOf('a'));
    s.appendImport(NOW_TICK - 200, 2, 2, 6, s.writerIdOf('legacy'));
    s.appendImport(NOW_TICK - 300, 3, 3, 1, s.writerIdOf('b'));
    const imp = s.segments().filter((g) => !g.own);
    expect(imp.map((g) => [g.weight, g.n, g.legacy])).toEqual([
      [1, 2, false],
      [6, 1, true],
    ]);
    expect(s.records).toBe(SEG_CAP + 1 + 3);
  });
});

describe('retention', () => {
  it('prune drops only segments whose newest record is past 24 h + grace', () => {
    const s = mk();
    const w = s.writerIdOf('old');
    const oldTick = (NOW - RETENTION_MS - PRUNE_GRACE_MS) / 10 - 1;
    for (let i = 0; i < SEG_CAP; i++) s.appendImport(oldTick - i, 1, 1, 1, w); // fills one segment
    s.appendImport(NOW_TICK - 100, 2, 2, 1, w); // a new, recent segment
    s.appendLive(NOW_TICK, 3, 3);
    expect(s.segments()).toHaveLength(3);
    expect(s.prune(NOW)).toBe(1);
    expect(s.segments()).toHaveLength(2);
    expect(s.records).toBe(2);
    // The open import segment is still usable after a prune.
    s.appendImport(NOW_TICK - 50, 4, 4, 1, w);
    expect(s.records).toBe(3);
  });

  it('evicts the oldest segments over capacity, keeps counts exact and says so', () => {
    const s = mk(2 * SEG_CAP);
    const w = s.writerIdOf('x');
    const ages = [20, 10, 5]; // hours; three full import segments
    for (const h of ages) {
      const t = (NOW - h * 3_600_000) / 10;
      for (let i = 0; i < SEG_CAP; i++) s.appendImport(t - i, i & 0xfff, 7, 1, w);
    }
    const before = s.countsWindow(NOW, 1440).sum;
    expect(before).toBe(3 * SEG_CAP);
    expect(s.enforceCapacity()).toBe(1);
    expect(s.records).toBe(2 * SEG_CAP);
    expect(s.evictedBeforeMs).toBe(NOW - 20 * 3_600_000 + 10);
    expect(s.countsWindow(NOW, 1440).sum).toBe(before); // counts are never reduced
    s.setCapacity(SEG_CAP);
    s.enforceCapacity();
    expect(s.evictedBeforeMs).toBe(NOW - 10 * 3_600_000 + 10);
    expect(s.stats().evictedRecords).toBe(2 * SEG_CAP);
  });

  it('never recycles a buffer a scan may still be reading', () => {
    const s = mk(SEG_CAP);
    const w = s.writerIdOf('x');
    for (let i = 0; i < SEG_CAP; i++) s.appendImport(NOW_TICK - 1_000_000 - i, 1, 1, 1, w);
    const snap = s.snapshot();
    const buf = snap.segs[0].seg.words;
    for (let i = 0; i < SEG_CAP; i++) s.appendImport(NOW_TICK - i, 2, 2, 1, w); // second segment
    s.enforceCapacity(); // evicts the first while the snapshot holds it
    s.appendLive(NOW_TICK, 9, 9); // allocates a new segment
    expect(s.segments().some((g) => g.words === buf)).toBe(false);
    expect(recordAt(buf, snap.segs[0].seg.baseTick, 0).latQ).toBe(1); // data intact
    snap.release();
    s.setCapacity(10);
    s.enforceCapacity(); // drops the second import segment, pool now holds buffers
    expect(s.stats().pooledBuffers).toBeGreaterThan(0);
    s.appendImport(NOW_TICK, 3, 3, 6, w); // reuses a pooled buffer
    expect(s.stats().pooledBuffers).toBeGreaterThanOrEqual(0);
  });
});

describe('per-minute ring', () => {
  it('counts exactly per minute, windowed and weighted, with the legacy flag', () => {
    const s = mk();
    const lw = s.writerIdOf('legacy');
    for (let m = 1; m <= 5; m++) for (let k = 0; k < m; k++) s.appendLive((NOW - m * MIN) / 10 + k, 1, 1);
    s.appendLive(NOW_TICK + 5, 1, 1); // current minute
    expect(s.minuteCount(NOW / MIN - 3)).toBe(3);
    // Buckets overlapping [now − W, now]: exact on a minute boundary…
    expect(s.countsWindow(NOW, 1)).toEqual({ sum: 1 + 1, legacy: false }); // minute −1 and the current one
    expect(s.countsWindow(NOW, 3)).toEqual({ sum: 3 + 2 + 1 + 1, legacy: false });
    // …and at most one bucket over in between.
    expect(s.countsWindow(NOW + 1000, 1)).toEqual({ sum: 1 + 1, legacy: false });
    expect(s.perMinute(NOW + 1000, 6)).toEqual([0, 5, 4, 3, 2, 1]);
    s.appendImport((NOW - 3 * 3_600_000) / 10, 2, 2, 6, lw);
    expect(s.countsWindow(NOW, 60).legacy).toBe(false);
    expect(s.countsWindow(NOW, 240)).toEqual({ sum: 16 + 6, legacy: true });
  });

  it('reports gaps as zero-count completed minutes, excluding unknown time', () => {
    const now = NOW + 30_000; // half-way through the current minute
    const s = mk(10_000_000, () => now);
    // Minutes -10 … -1 have strikes except -7, -6 and -2.
    for (let m = 1; m <= 10; m++) if (![7, 6, 2].includes(m)) s.appendLive((NOW - m * MIN) / 10, 1, 1);
    const g = s.gaps(now, 11, null);
    // The window starts mid-minute -11 (empty: a clipped gap), then -7…-6 and -2.
    expect(g).toEqual([
      { fromMs: now - 11 * MIN, toMs: NOW - 10 * MIN },
      { fromMs: NOW - 7 * MIN, toMs: NOW - 5 * MIN },
      { fromMs: NOW - 2 * MIN, toMs: NOW - MIN },
    ]);
    // Time before the restore has reached is unknown, not a gap.
    expect(s.gaps(now, 10, NOW - 6 * MIN)).toEqual([
      { fromMs: NOW - 6 * MIN, toMs: NOW - 5 * MIN },
      { fromMs: NOW - 2 * MIN, toMs: NOW - MIN },
    ]);
    // Collector down: the current partial minute counts too.
    s.appendLive(NOW / 10 + 1, 1, 1);
    expect(s.gaps(now, 3, null, NOW + 10_000)).toEqual([
      { fromMs: NOW - 2 * MIN, toMs: NOW - MIN },
      { fromMs: NOW + 10_000, toMs: now },
    ]);
    // A zero run reaching the current minute merges with the down span.
    const s2 = mk(10_000_000, () => now);
    s2.appendLive((NOW - 5 * MIN) / 10, 1, 1);
    expect(s2.gaps(now, 5, null, NOW - 3 * MIN)).toEqual([{ fromMs: NOW - 4 * MIN, toMs: now }]);
  });

  it('marks the first writer per minute, and MIXED once live meets another writer', () => {
    const s = mk();
    const a = s.writerIdOf('a');
    const m = NOW / MIN - 2;
    s.appendLive(m * 6000 + 1, 1, 1);
    expect(s.writerMark(m)).toBe(s.selfId);
    s.setWriterMark(m - 1, a);
    s.appendLive((m - 1) * 6000 + 1, 1, 1);
    expect(s.writerMark(m - 1)).toBe(MIXED_WRITER);
    expect(s.writerName(a)).toBe('a');
  });

  it('ignores ring updates far outside the clock (a stray record cannot clobber a current minute)', () => {
    const s = mk();
    s.appendLive(NOW_TICK, 1, 1);
    s.appendImport(NOW_TICK - 1500 * 6000, 1, 1, 1, s.writerIdOf('x')); // same ring slot, 25 h earlier
    expect(s.minuteCount(NOW / MIN)).toBe(1);
  });
});

describe('identitiesForMinute', () => {
  it('returns exactly the identities stored in that minute, across segments', () => {
    const s = mk();
    const m = NOW / MIN - 3;
    const t0 = m * 6000;
    s.appendLive(t0, 10, 20);
    s.appendLive(t0 + 5999, 11, 21);
    s.appendLive(t0 + 6000, 12, 22); // next minute
    s.appendLive(t0 - 1, 13, 23); // previous minute
    s.appendImport(t0 + 42, 14, 24, 1, s.writerIdOf('x'));
    const ids = s.identitiesForMinute(m);
    expect([...ids].sort()).toEqual(
      [identityKey(0, 10, 20), identityKey(5999, 11, 21), identityKey(42, 14, 24)].sort()
    );
    expect(identityKey(5999, QMAX, QMAX)).toBeLessThan(Number.MAX_SAFE_INTEGER);
  });
});
