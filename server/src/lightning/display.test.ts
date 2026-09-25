import { describe, expect, it } from 'vitest';
import { FRESH_S, RETENTION_MS } from './constants';
import { type BBox, FieldService, computeField, fieldQuery, freshMarks } from './display';
import { createPersistence } from './persist';
import { qLat, qLon } from './quant';
import { StrikeStore } from './store';
import { FakeDb, type Rec, genStrikes, shuffled } from './testkit';
import type { LightningMarks } from './types';

const NOW = Date.UTC(2026, 8, 24, 12, 0, 0);
const H = 3_600_000;

function storeWith(recs: Rec[], opts: { live?: boolean; now?: number; writer?: string } = {}): StrikeStore {
  const s = new StrikeStore({ capacity: 50_000_000, selfWriter: opts.writer ?? 'w', now: () => opts.now ?? NOW });
  const wid = s.writerIdOf('import');
  for (const r of recs) {
    if (opts.live ?? true) s.appendLive(r.tick, r.latQ, r.lonQ);
    else s.appendImport(r.tick, r.latQ, r.lonQ, 1, wid);
  }
  return s;
}

function decode(m: LightningMarks): Rec[] {
  const out: Rec[] = [];
  let t = m.tick0;
  for (let i = 0; i < m.dt.length; i++) {
    t += m.dt[i];
    out.push({ tick: t, latQ: m.la[i], lonQ: m.lo[i] });
  }
  return out;
}
const key = (r: Rec) => `${r.tick}:${r.latQ}:${r.lonQ}`;

// Three storms over CONUS plus storms elsewhere, and 2 % scattered singletons.
const CELLS = [
  { lat: 35, lon: -97, sd: 0.4 },
  { lat: 41, lon: -88, sd: 0.3 },
  { lat: 29, lon: -82, sd: 0.5 },
  { lat: -3, lon: 20, sd: 0.8 },
  { lat: 23, lon: 88, sd: 0.6 },
  { lat: -2, lon: 110, sd: 0.7 },
  { lat: -15, lon: -60, sd: 0.9 },
  { lat: 0, lon: 179, sd: 0.4 },
];
const DAY = genStrikes({ n: 120_000, nowMs: NOW, spanMs: RETENTION_MS, seed: 7, cells: CELLS });

describe('display field sampling', () => {
  it('never exceeds the budget, and samples a busy view', async () => {
    const s = storeWith(DAY);
    for (const budget of [4_000, 16_000, 24_000]) {
      for (const bbox of [null, [-110, 20, -70, 50], [-100, 30, -94, 40]] as (BBox | null)[]) {
        const r = await fieldQuery(s, { bbox, budget, fresh: 0 }, NOW);
        expect(r.field.dt.length).toBeLessThanOrEqual(budget);
        expect(r.view.budget).toBe(budget);
        if (!bbox) expect(r.view.total).toBe(DAY.length);
      }
    }
    const g = await fieldQuery(s, { bbox: null, budget: 4_000, fresh: 0 }, NOW);
    expect(g.field.dt.length).toBeGreaterThan(3_000); // uses most of the budget
    expect(g.view.cellDeg).toBe(1.6); // 360 / 400 = 0.9 → 1.6
    expect(g.stageEndsS).toEqual([120, 600, 1800, 3600, 10800, 43200, 86400]);
    // Ascending, delta-encoded, all within 24 h.
    const marks = decode(g.field);
    for (let i = 1; i < marks.length; i++) expect(marks[i].tick).toBeGreaterThanOrEqual(marks[i - 1].tick);
    expect(marks.every((m) => NOW / 10 - m.tick < RETENTION_MS / 10)).toBe(true);
  });

  it('is identical for the same data in any insertion order, and after a restore', async () => {
    const a = storeWith(DAY);
    const b = storeWith(shuffled(DAY, 3), { live: false });
    const qa = await computeField(a, { bbox: null, budget: 8_000 }, NOW);
    const qb = await computeField(b, { bbox: null, budget: 8_000 }, NOW);
    expect(qb.fieldJson).toBe(qa.fieldJson);
    expect(qb.view).toEqual(qa.view);

    // Save a's live segments through persistence and restore them into a fresh store.
    const db = new FakeDb();
    await createPersistence({ db, store: a, writer: 'A', now: () => NOW }).save();
    const c = new StrikeStore({ capacity: 50_000_000, selfWriter: 'C', now: () => NOW });
    await createPersistence({ db, store: c, writer: 'C', now: () => NOW, sleep: async () => {} }).restore();
    expect(c.records).toBe(DAY.length);
    const qc = await computeField(c, { bbox: null, budget: 8_000 }, NOW);
    expect(qc.fieldJson).toBe(qa.fieldJson);
    const box: BBox = [-110, 20, -70, 50];
    expect((await computeField(c, { bbox: box, budget: 8_000 }, NOW)).fieldJson).toBe(
      (await computeField(a, { bbox: box, budget: 8_000 }, NOW)).fieldJson
    );
  });

  it('is stable: 30 s of new strikes keeps ≥ 95 % of the marks older than 2 min', async () => {
    const s = storeWith(DAY);
    for (const [bbox, budget] of [
      [null, 4_000],
      [null, 16_000],
      [[-110, 20, -70, 50], 8_000],
    ] as [BBox | null, number][]) {
      const before = decode((await fieldQuery(s, { bbox, budget, fresh: 0 }, NOW)).field);
      const later = NOW + 30_000;
      const s2 = storeWith(DAY);
      // 30 s at the same rate as the day (≈ 1.4/s), in the same storms.
      for (const r of genStrikes({ n: 42, nowMs: later, spanMs: 30_000, seed: 11, cells: CELLS })) s2.appendLive(r.tick, r.latQ, r.lonQ);
      const after = new Set(decode((await fieldQuery(s2, { bbox, budget, fresh: 0 }, later)).field).map(key));
      const old = before.filter((m) => NOW / 10 - m.tick >= FRESH_S * 100);
      const kept = old.filter((m) => after.has(key(m))).length;
      expect(kept / old.length).toBeGreaterThanOrEqual(0.95);
    }
  });

  it('a 10 % larger old stratum changes its marks by far less than 10 % (the threshold is cut to the strike, not to a histogram bin)', async () => {
    // A busy 12–24 h stratum: ~350k strikes in one storm against a 190-mark
    // share, so a histogram bin (1/4096 of the stratum) is half the share.
    const storm = [{ lat: 35, lon: -97, sd: 0.3 }];
    const old = (n: number, seed: number) =>
      genStrikes({ n, nowMs: NOW - 12 * H, spanMs: 12 * H, seed, cells: storm, isolatedShare: 0 });
    const base = old(350_000, 21);
    const s = storeWith(base);
    const inStratum = (m: Rec) => NOW / 10 - m.tick >= 12 * 360_000;
    const before = decode((await computeField(s, { bbox: null, budget: 1_000 }, NOW)).field).filter(inStratum);
    for (const r of old(35_000, 22)) s.appendLive(r.tick, r.latQ, r.lonQ);
    const after = decode((await computeField(s, { bbox: null, budget: 1_000 }, NOW)).field).filter(inStratum);
    expect(before.length).toBeGreaterThan(150); // the stratum's share (190) is used, not half of it
    expect(Math.abs(after.length - before.length) / before.length).toBeLessThan(0.03);
    // ~1/1.1 of the old sample stays: the threshold moved by the population change, no more.
    const kept = new Set(after.map(key));
    expect(before.filter((m) => kept.has(key(m))).length / before.length).toBeGreaterThan(0.85);
  });

  it('zooming in keeps ≥ 99 % of the parent view’s marks inside the sub-box', async () => {
    const s = storeWith(DAY);
    const cases: [BBox | null, BBox][] = [
      [null, [-110, 20, -70, 50]], // globe → CONUS
      [[-110, 20, -70, 50], [-100, 31, -93, 39]], // CONUS → one storm
      [null, [170, -10, -170, 10]], // globe → an antimeridian box
    ];
    for (const [parent, sub] of cases) {
      for (const budget of [4_000, 16_000]) {
        const p = decode((await fieldQuery(s, { bbox: parent, budget, fresh: 0 }, NOW)).field);
        const c = new Set(decode((await fieldQuery(s, { bbox: sub, budget, fresh: 0 }, NOW)).field).map(key));
        const [w, so, e, n] = sub;
        const inside = p.filter(
          (m) =>
            m.latQ >= qLat(so) &&
            m.latQ <= qLat(n) &&
            (w > e ? m.lonQ >= qLon(w) || m.lonQ <= qLon(e) : m.lonQ >= qLon(w) && m.lonQ <= qLon(e))
        );
        expect(inside.length).toBeGreaterThan(20);
        expect(inside.filter((m) => c.has(key(m))).length / inside.length).toBeGreaterThanOrEqual(0.99);
      }
    }
  });

  it('always shows an isolated strike, even 20 h old in a busy globe', async () => {
    // Isolated = alone in its cell even on the coarsest (12.8°) lattice: the
    // singletons of DAY are scattered over ±60°, the storms far away.
    const lone: Rec = { tick: (NOW - 20 * H) / 10, latQ: qLat(-70), lonQ: qLon(-120) };
    const s = storeWith([...DAY, lone]);
    for (const budget of [4_000, 16_000, 24_000]) {
      for (const bbox of [null, [-130, -75, -110, -65], [-179, -80, 179, 80]] as (BBox | null)[]) {
        const marks = decode((await fieldQuery(s, { bbox, budget, fresh: 0 }, NOW)).field).map(key);
        expect(marks).toContain(key(lone));
      }
    }
  });

  it('handles a box across the antimeridian', async () => {
    const t = NOW / 10 - 50_000;
    const recs: Rec[] = [
      { tick: t, latQ: qLat(1), lonQ: qLon(175) },
      { tick: t + 1, latQ: qLat(-1), lonQ: qLon(-175) },
      { tick: t + 2, latQ: qLat(0), lonQ: qLon(0) },
      { tick: t + 3, latQ: qLat(20), lonQ: qLon(179) }, // outside in latitude
      { tick: NOW / 10 - 100, latQ: qLat(2), lonQ: qLon(-179.5) }, // fresh
    ];
    const s = storeWith(recs);
    const r = await fieldQuery(s, { bbox: [170, -10, -170, 10], budget: 4_000, fresh: 1_000 }, NOW);
    expect(decode(r.field).map(key).sort()).toEqual([recs[0], recs[1], recs[4]].map(key).sort());
    expect(r.view.total).toBe(3);
    expect(r.view.cellDeg).toBe(0.05);
    expect(decode(r.fresh).map(key)).toEqual([key(recs[4])]);
  });
});

describe('fresh list', () => {
  it('is every strike younger than FRESH_S in the box, newest kept, ascending', () => {
    const recs: Rec[] = [];
    for (let i = 0; i < 300; i++) recs.push({ tick: NOW / 10 - i * 50, latQ: qLat(35), lonQ: qLon(-97 + i * 1e-3) });
    recs.push({ tick: NOW / 10 + 200, latQ: qLat(35), lonQ: qLon(-97) }); // slightly in the future: fresh
    recs.push({ tick: NOW / 10 - 50, latQ: qLat(-35), lonQ: qLon(-97) }); // outside the box
    const s = storeWith(shuffled(recs, 5));
    const box: BBox = [-100, 30, -90, 40];
    const all = decode(freshMarks(s, box, 8_000, NOW));
    // Ages 0 … 119.5 s: i < 240, plus the future one.
    expect(all).toHaveLength(241);
    expect(all[all.length - 1].tick).toBe(NOW / 10 + 200);
    for (let i = 1; i < all.length; i++) expect(all[i].tick).toBeGreaterThanOrEqual(all[i - 1].tick);
    const capped = decode(freshMarks(s, box, 100, NOW));
    expect(capped).toEqual(all.slice(-100));
    expect(freshMarks(s, box, 0, NOW)).toEqual({ tick0: 0, dt: [], la: [], lo: [] });
  });
});

describe('FieldService', () => {
  it('memoizes per 30 s bucket and shares one scan between concurrent requests', async () => {
    let now = NOW;
    const s = storeWith(DAY.slice(0, 5_000));
    const svc = new FieldService(s, () => now);
    const [a, b] = await Promise.all([svc.get(null, 4_000), svc.get(null, 4_000)]);
    expect(a!.result).toBe(b!.result);
    now += 10_000;
    expect((await svc.get(null, 4_000))!.result).toBe(a!.result); // same bucket
    now += 30_000;
    const c = await svc.get(null, 4_000);
    expect(c!.result).not.toBe(a!.result);
    expect(c!.degraded).toBeNull();
  });

  it('sweeps results no request can be served any more, on get() and on its own', async () => {
    let now = NOW;
    const s = storeWith(DAY.slice(0, 2_000));
    const svc = new FieldService(s, () => now);
    const boxes: BBox[] = [[-10, -10, 10, 10], [0, 0, 20, 20], [-100, 30, -90, 40], [100, -20, 120, 0]];
    for (const b of boxes) await svc.get(b, 4_000);
    expect(svc.stats()).toMatchObject({ memoKeys: 4, lastKeys: 4 });
    now += 30_000; // the next bucket: memo entries are dead, `last` can still serve 'stale'
    await svc.get(null, 4_000);
    expect(svc.stats()).toMatchObject({ memoKeys: 1, lastKeys: 5 });
    now += 5 * 60_000 + 1; // past STALE_MAX_MS: nothing can be served, even with no request
    svc.sweep();
    expect(svc.stats()).toMatchObject({ memoKeys: 0, lastKeys: 0 });
  });

  it('clear() (restore done) drops results, including one a scan already running would have memoized', async () => {
    const s = storeWith(DAY.slice(0, 2_000));
    const svc = new FieldService(s, () => NOW);
    const running = svc.get(null, 4_000);
    await new Promise((resolve) => setImmediate(resolve)); // the scan has its snapshot and yielded
    svc.clear(); // the restore finished while this scan ran on the partial history
    const first = await running;
    expect(svc.stats().memoKeys).toBe(0);
    for (const r of DAY.slice(2_000, 4_000)) s.appendLive(r.tick, r.latQ, r.lonQ);
    const next = await svc.get(null, 4_000); // same bucket, but recomputed
    expect(next!.result).not.toBe(first!.result);
    expect(next!.result.view.total).toBe(4_000);
  });

  it('serves a stale body (≤ 5 min) or null (503) when the scan queue is full', async () => {
    let now = NOW;
    const s = storeWith(DAY.slice(0, 2_000));
    const svc = new FieldService(s, () => now);
    await svc.get(null, 4_000); // remembered as the key's last body
    now += 60_000;
    // Saturate the gate: 2 running + 8 waiting on other keys.
    const holds: Promise<void>[] = [];
    for (let i = 0; i < 10; i++) holds.push(svc.gate.acquire());
    const stale = await svc.get(null, 4_000);
    expect(stale!.degraded).toBe('stale');
    expect(await svc.get([-10, -10, 10, 10], 4_000)).toBeNull(); // never computed → busy
    now += 5 * 60_000;
    expect(await svc.get(null, 4_000)).toBeNull(); // too old to serve
    for (let i = 0; i < 10; i++) svc.gate.release();
    await Promise.all(holds);
  });
});
