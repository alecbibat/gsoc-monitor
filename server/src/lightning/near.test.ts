import { describe, expect, it } from 'vitest';
import { NearService, near } from './near';
import { dqLat, dqLon, haversineMi, qLat, qLon } from './quant';
import { StrikeStore } from './store';
import { type Rec, genStrikes, prng } from './testkit';

const NOW = Date.UTC(2026, 8, 24, 12, 0, 0);
const H = 3_600_000;
const NO_FIDELITY = { legacyBeforeMs: null, evictedBeforeMs: null };
const MI_PER_DEG_LAT = (Math.PI * 3958.7613) / 180;

function storeWith(recs: Rec[]): StrikeStore {
  const s = new StrikeStore({ capacity: 50_000_000, selfWriter: 'w', now: () => NOW });
  for (const r of recs) s.appendLive(r.tick, r.latQ, r.lonQ);
  return s;
}
const at = (lat: number, lon: number, ageMs = 60_000): Rec => ({ tick: Math.floor((NOW - ageMs) / 10), latQ: qLat(lat), lonQ: qLon(lon) });

function brute(recs: Rec[], lat: number, lon: number, radiusMi: number, hours: number) {
  const c = { le5: 0, le25: 0, le100: 0, inRadius: 0 };
  let best = Infinity;
  for (const r of recs) {
    if (NOW / 10 - r.tick >= Math.round(hours * 360_000)) continue;
    const d = haversineMi(lat, lon, dqLat(r.latQ), dqLon(r.lonQ));
    if (d > radiusMi) continue;
    c.inRadius++;
    if (d <= 100) c.le100++;
    if (d <= 25) c.le25++;
    if (d <= 5) c.le5++;
    best = Math.min(best, d);
  }
  return { c, best };
}

describe('near', () => {
  it('equals a brute-force count on random data', async () => {
    const rnd = prng(17);
    const recs = genStrikes({
      n: 60_000,
      nowMs: NOW,
      spanMs: 24 * H,
      seed: 5,
      cells: [
        { lat: 35.4, lon: -97.5, sd: 1.2 },
        { lat: 37, lon: -95, sd: 0.8 },
        { lat: 40, lon: -100, sd: 2 },
      ],
    });
    const s = storeWith(recs);
    for (let i = 0; i < 6; i++) {
      const lat = 34 + rnd() * 4;
      const lon = -99 + rnd() * 4;
      const radiusMi = [30, 130, 500][i % 3];
      const hours = [1, 6, 24][Math.floor(i / 2)];
      const r = await near(s, { lat, lon, radiusMi, hours, maxPoints: 20_000 }, NOW, NO_FIDELITY);
      const b = brute(recs, lat, lon, radiusMi, hours);
      expect({ ...r.counts, exact: undefined }).toEqual({ ...b.c, exact: undefined });
      expect(r.counts.exact).toBe(true);
      if (b.c.inRadius) expect(r.nearest!.mi).toBeCloseTo(b.best, 2);
      if (r.points.sampled) expect(r.points.t.length).toBeLessThanOrEqual(20_000);
      else expect(r.points.t).toHaveLength(b.c.inRadius);
    }
  });

  it('counts the 5/25/100 mi rings inclusively at their edges', async () => {
    const lat0 = 35;
    const lon0 = -97;
    const north = (mi: number) => at(lat0 + mi / MI_PER_DEG_LAT, lon0);
    const s = storeWith([north(0.5), north(4.9), north(5.1), north(24.9), north(25.1), north(99.9), north(100.1), north(129.9), north(130.2)]);
    const r = await near(s, { lat: lat0, lon: lon0, radiusMi: 130, hours: 24, maxPoints: 100 }, NOW, NO_FIDELITY);
    expect(r.counts).toEqual({ le5: 2, le25: 4, le100: 6, inRadius: 8, exact: true });
    expect(r.nearest!.mi).toBeCloseTo(0.5, 1);
    expect(r.nearest!.ageS).toBe(60);
  });

  it('works across the antimeridian and near the pole', async () => {
    const s = storeWith([at(0, -179.9), at(0.1, 179.8), at(0, 0), at(0, 170)]);
    const r = await near(s, { lat: 0, lon: 179.95, radiusMi: 50, hours: 24, maxPoints: 100 }, NOW, NO_FIDELITY);
    expect(r.counts.inRadius).toBe(2);
    expect(r.points.lon.sort()).toEqual([-179.9, 179.8].map((v) => Math.round(dqLon(qLon(v)) * 1e5) / 1e5).sort());

    const rnd = prng(3);
    const polar: Rec[] = [];
    for (let i = 0; i < 3_000; i++) polar.push(at(78 + rnd() * 12, -180 + rnd() * 360, rnd() * 20 * H));
    const p = storeWith(polar);
    for (const [lat, lon, rad] of [
      [85, 0, 500],
      [85, 170, 200],
      [89.9, -45, 100],
    ]) {
      const got = await near(p, { lat, lon, radiusMi: rad, hours: 24, maxPoints: 20_000 }, NOW, NO_FIDELITY);
      const b = brute(polar, lat, lon, rad, 24);
      expect(got.counts.inRadius).toBe(b.c.inRadius);
      expect(got.counts.inRadius).toBeGreaterThan(0);
    }
  });

  it('thins points to maxPoints, never the counts, and always keeps the nearest', async () => {
    const recs = genStrikes({ n: 20_000, nowMs: NOW, spanMs: 24 * H, seed: 9, cells: [{ lat: 35, lon: -97, sd: 0.5 }], isolatedShare: 0 });
    const closest = at(35.0001, -97.0001, 23 * H); // old, so "newest per cell" would not pick it
    const s = storeWith([...recs, closest]);
    const full = await near(s, { lat: 35, lon: -97, radiusMi: 130, hours: 24, maxPoints: 20_000 }, NOW, NO_FIDELITY);
    for (const maxPoints of [50, 700, 5_000]) {
      const thin = await near(s, { lat: 35, lon: -97, radiusMi: 130, hours: 24, maxPoints }, NOW, NO_FIDELITY);
      expect(thin.counts).toEqual(full.counts);
      expect(thin.nearest).toEqual(full.nearest);
      expect(thin.points.sampled).toBe(true);
      expect(thin.points.t.length).toBeLessThanOrEqual(maxPoints);
      const idx = thin.points.t.indexOf(closest.tick / 100);
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(thin.points.lat[idx]).toBeCloseTo(35.0001, 3);
      for (let i = 1; i < thin.points.t.length; i++) expect(thin.points.t[i]).toBeGreaterThanOrEqual(thin.points.t[i - 1]);
    }
    expect(full.points.sampled).toBe(false);
    expect(full.points.t).toHaveLength(full.counts.inRadius);
  });

  it('only counts the requested window', async () => {
    const s = storeWith([at(35, -97, 30 * 60_000), at(35, -97, 90 * 60_000), at(35, -97, 23 * H)]);
    const q = { lat: 35, lon: -97, radiusMi: 10, maxPoints: 100 };
    expect((await near(s, { ...q, hours: 1 }, NOW, NO_FIDELITY)).counts.inRadius).toBe(1);
    expect((await near(s, { ...q, hours: 2 }, NOW, NO_FIDELITY)).counts.inRadius).toBe(2);
    expect((await near(s, { ...q, hours: 24 }, NOW, NO_FIDELITY)).counts.inRadius).toBe(3);
  });

  it('flags estimates: legacy ×6 history or evicted time inside the window', async () => {
    const s = storeWith([at(35, -97, 60_000)]);
    s.appendImport(Math.floor((NOW - 20 * H) / 10), qLat(35.01), qLon(-97), 6, s.writerIdOf('legacy'));
    const q = { lat: 35, lon: -97, radiusMi: 10, maxPoints: 100 };
    const day = await near(s, { ...q, hours: 24 }, NOW, { legacyBeforeMs: NOW - 19 * H, evictedBeforeMs: null });
    expect(day.counts).toMatchObject({ inRadius: 7, exact: false });
    const hour = await near(s, { ...q, hours: 1 }, NOW, { legacyBeforeMs: NOW - 19 * H, evictedBeforeMs: null });
    expect(hour.counts).toMatchObject({ inRadius: 1, exact: true });
    const evicted = await near(s, { ...q, hours: 6 }, NOW, { legacyBeforeMs: null, evictedBeforeMs: NOW - 2 * H });
    expect(evicted.counts.exact).toBe(false);
  });

  it('NearService memoizes for 30 s per key', async () => {
    let now = NOW;
    const s = storeWith([at(35, -97)]);
    const svc = new NearService(s, () => NO_FIDELITY, () => now);
    const q = { lat: 35, lon: -97, radiusMi: 10, hours: 24, maxPoints: 100 };
    const a = await svc.get(q);
    s.appendLive(Math.floor(NOW / 10), qLat(35), qLon(-97));
    expect(await svc.get(q)).toBe(a);
    now += 30_000;
    expect((await svc.get(q)).counts.inRadius).toBe(2);
  });
});
