import type { AddressInfo } from 'net';
import type { Server } from 'http';
import express from 'express';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import floodRouter, {
  assembleFemaZone,
  capPolygonVertices,
  clipRingToBox,
  envelopeAround,
  featureDistanceMi,
  fetchDischargeClimatology,
  fetchFemaZone,
  fetchFloodPrecip,
  fetchUpstreamJson,
  getFloodDischarge,
  nearestSfhaMi,
  normalizeDischarge,
  normalizePrecip,
  parseNfhlQuery,
  pickSiteZone,
  snapToGlofasLat,
  snapToGlofasLon,
  thinRings,
  type NfhlFeature,
  type NfhlQueryResult,
} from './flood';
import { cache } from '../cache';
import { climatologyWindow } from './glofasClimate';

// The per-cell threshold store (Postgres `snapshots`, via ./glofasClimate) is
// mocked: tests set what a read returns and record what gets saved.
const db = vi.hoisted(() => ({
  rows: [] as Array<{ data: unknown }>,
  saved: [] as Array<{ key: string; data: unknown }>,
}));
vi.mock('../db', () => ({
  pool: {
    query: async (sql: string, params: unknown[]) => {
      if (sql.startsWith('SELECT')) return { rows: db.rows };
      db.saved.push({ key: String(params[0]), data: JSON.parse(String(params[1])) });
      return { rows: [] };
    },
  },
}));

beforeEach(() => {
  db.rows = [];
  db.saved = [];
});

// ── Fixture helpers ───────────────────────────────────────────────────────────

const MI_PER_DEG = 69.0934;
const SITE = { lat: 38, lon: -90 };
const miLat = (mi: number) => mi / MI_PER_DEG;
const miLon = (mi: number, lat = SITE.lat) => mi / (MI_PER_DEG * Math.cos((lat * Math.PI) / 180));

function square(cx: number, cy: number, hx: number, hy = hx): number[][] {
  return [
    [cx - hx, cy - hy],
    [cx + hx, cy - hy],
    [cx + hx, cy + hy],
    [cx - hx, cy + hy],
    [cx - hx, cy - hy],
  ];
}

// Closed n-gon on a circle of `rMi` miles; n divisible by 4 puts a vertex due south.
function circle(lat: number, lon: number, rMi: number, n = 40): number[][] {
  const ring: number[][] = [];
  for (let k = 0; k < n; k++) {
    const a = (2 * Math.PI * k) / n;
    ring.push([lon + miLon(rMi * Math.cos(a), lat), lat + miLat(rMi * Math.sin(a))]);
  }
  ring.push([...ring[0]]);
  return ring;
}

function shoelace(ring: number[][]): number {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += (ring[j][0] - ring[i][0]) * (ring[j][1] + ring[i][1]);
  }
  return Math.abs(a) / 2;
}

function feature(partial: Partial<NfhlFeature>): NfhlFeature {
  return { zone: 'X', subtype: null, sfha: false, bfeFt: null, depthFt: null, datum: null, rings: [], ...partial };
}

function result(features: NfhlFeature[], extra: Partial<NfhlQueryResult> = {}): NfhlQueryResult {
  return { features, rawCount: features.length, exceededTransferLimit: false, ...extra };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function isoDays(year: number, count = Infinity): string[] {
  const out: string[] = [];
  for (let t = Date.UTC(year, 0, 1); out.length < count; t += 86_400_000) {
    const iso = new Date(t).toISOString().slice(0, 10);
    if (!iso.startsWith(String(year))) break;
    out.push(iso);
  }
  return out;
}

// Daily flows for whole years: a low baseline, `peak(year)` on day 200, and
// days 10–40 missing (334 finite days — still a complete year).
function climateSeries(years: number[], peak: (year: number, i: number) => number) {
  const time: string[] = [];
  const q: Array<number | null> = [];
  years.forEach((year, i) => {
    isoDays(year).forEach((d, day) => {
      time.push(d);
      q.push(day >= 10 && day <= 40 ? null : day === 200 ? peak(year, i) : 5 + (day % 7));
    });
  });
  return { time, q };
}

// The current climatology window's 20 years, peaking 100…290 in order. The
// Gumbel reference values (mean 195, sd 59.16 → 185 / 238 / 305) are the ones
// glofasClimate.test.ts checks independently.
function windowSeries() {
  const first = Number(climatologyWindow().start.slice(0, 4));
  return climateSeries(Array.from({ length: 20 }, (_, i) => first + i), (_y, i) => 100 + 10 * i);
}
const WINDOW_FIT = { rp2: 185, rp5: 238, rp20: 305, years: 20 };

// ── NFHL parsing ──────────────────────────────────────────────────────────────

describe('parseNfhlQuery', () => {
  it('reads attributes case-insensitively and nulls sentinels and blanks', () => {
    const r = parseNfhlQuery({
      features: [
        { attributes: { fld_zone: 'ae', Zone_Subty: '   ', sfha_tf: 'T', STATIC_BFE: -9999, DEPTH: -9999.0, V_DATUM: 'NAVD88' } },
        { attributes: { 'S_FLD_HAZ_AR.FLD_ZONE': 'AO', ZONE_SUBTY: null, SFHA_TF: 't', STATIC_BFE: 512.34, DEPTH: 2, V_DATUM: '' } },
        { attributes: { FLD_ZONE: 'X', ZONE_SUBTY: 'AREA OF MINIMAL FLOOD HAZARD', SFHA_TF: 'F', STATIC_BFE: '-9999', DEPTH: -8888 } },
        { attributes: { FLD_ZONE: '  ' } },
      ],
    });
    expect(r.rawCount).toBe(4);
    expect(r.exceededTransferLimit).toBe(false);
    expect(r.features).toEqual([
      { zone: 'AE', subtype: null, sfha: true, bfeFt: null, depthFt: null, datum: 'NAVD88', rings: [] },
      { zone: 'AO', subtype: null, sfha: true, bfeFt: 512.34, depthFt: 2, datum: null, rings: [] },
      { zone: 'X', subtype: 'AREA OF MINIMAL FLOOD HAZARD', sfha: false, bfeFt: null, depthFt: null, datum: null, rings: [] },
    ]);
  });

  it('nulls at the -8000 sentinel boundary, keeps a real 0, and reads string-typed numbers', () => {
    const r = parseNfhlQuery({
      features: [
        { attributes: { FLD_ZONE: 'AO', SFHA_TF: 'T', STATIC_BFE: -8000, DEPTH: 0 } },
        { attributes: { FLD_ZONE: 'AE', SFHA_TF: 'T', STATIC_BFE: ' 512.3 ', DEPTH: 'n/a' } },
        { attributes: { FLD_ZONE: 'AE', SFHA_TF: 'T', STATIC_BFE: -7999.5 } },
      ],
    });
    expect(r.features.map((f) => [f.bfeFt, f.depthFt])).toEqual([
      [null, 0], // 0 ft is a value, not "none"
      [512.3, null],
      [-7999.5, null],
    ]);
  });

  it('infers SFHA from the zone code only when SFHA_TF is missing', () => {
    const r = parseNfhlQuery({
      features: [
        { attributes: { FLD_ZONE: 'AE' } },
        { attributes: { FLD_ZONE: 'A99' } },
        { attributes: { FLD_ZONE: 'VE' } },
        { attributes: { FLD_ZONE: 'X' } },
        { attributes: { FLD_ZONE: 'AREA NOT INCLUDED' } },
        { attributes: { FLD_ZONE: 'AE', SFHA_TF: 'F' } },
      ],
    });
    expect(r.features.map((f) => f.sfha)).toEqual([true, true, true, false, false, false]);
  });

  it('throws on the Esri error object instead of reading it as "no zones"', () => {
    expect(() =>
      parseNfhlQuery({ error: { code: 400, message: 'Unable to complete operation.', details: ['Invalid query parameters'] } })
    ).toThrow(/400.*Unable to complete operation.*Invalid query parameters/);
    expect(() => parseNfhlQuery(null)).toThrow();
    expect(() => parseNfhlQuery({ exceededTransferLimit: false })).toThrow(/features/);
  });

  it('keeps holes, drops z/m values and junk vertices, and reads the transfer-limit flag', () => {
    const r = parseNfhlQuery({
      exceededTransferLimit: true,
      features: [
        {
          attributes: { FLD_ZONE: 'AE', SFHA_TF: 'T' },
          geometry: {
            rings: [
              [[0, 0, 12], [4, 0], [4, 4], [0, 'x'], [0, 4], [0, 0]],
              [[1, 1], [2, 1], [2, 2], [1, 1]],
              [[9, 9]],
              'junk',
            ],
          },
        },
      ],
    });
    expect(r.exceededTransferLimit).toBe(true);
    expect(r.features[0].rings).toEqual([
      [[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]],
      [[1, 1], [2, 1], [2, 2], [1, 1]],
    ]);
  });
});

describe('pickSiteZone', () => {
  const x = feature({ zone: 'X', subtype: 'AREA OF MINIMAL FLOOD HAZARD' });
  const shaded = feature({ zone: 'X', subtype: '0.2 PCT ANNUAL CHANCE FLOOD HAZARD' });
  const ae = feature({ zone: 'AE', sfha: true, bfeFt: 431.2, datum: 'NAVD88' });
  const floodway = feature({ zone: 'AE', subtype: 'FLOODWAY', sfha: true, bfeFt: 431.5 });
  const ve = feature({ zone: 'VE', sfha: true, bfeFt: 12 });

  it('reports the most hazardous of overlapping zones', () => {
    expect(pickSiteZone([x, ae, ve, floodway])?.subtype).toBe('FLOODWAY');
    expect(pickSiteZone([ae, ve])?.zone).toBe('VE');
    expect(pickSiteZone([x, ae])?.zone).toBe('AE');
    expect(pickSiteZone([x, shaded])?.subtype).toBe('0.2 PCT ANNUAL CHANCE FLOOD HAZARD');
  });

  it('returns the site shape without rings, or null for no feature', () => {
    expect(pickSiteZone([ae])).toEqual({ zone: 'AE', subtype: null, sfha: true, bfeFt: 431.2, depthFt: null, datum: 'NAVD88' });
    expect(pickSiteZone([])).toBeNull();
  });
});

// ── Geometry ──────────────────────────────────────────────────────────────────

describe('nearest SFHA distance', () => {
  it('is 0 inside a polygon and honours holes (even-odd)', () => {
    expect(featureDistanceMi(SITE.lat, SITE.lon, [square(SITE.lon, SITE.lat, 0.01)])).toBe(0);
    // Site in a hole: the nearest edge is the hole's east/west side, 0.01° of
    // longitude ≈ 0.544 mi at 38°N.
    const donut = [square(SITE.lon, SITE.lat, 0.05), square(SITE.lon, SITE.lat, 0.01)];
    expect(featureDistanceMi(SITE.lat, SITE.lon, donut)).toBeCloseTo(0.544, 3);
  });

  it('measures sensible miles to an SFHA outside the site', () => {
    const north = { zone: 'AE', subtype: null, sfha: true, rings: [circle(SITE.lat + miLat(1.5), SITE.lon, 0.1)] };
    const nearerButX = { zone: 'X', subtype: null, sfha: false, rings: [circle(SITE.lat + miLat(0.3), SITE.lon, 0.1)] };
    expect(nearestSfhaMi(SITE.lat, SITE.lon, [nearerButX, north], null)).toBe(1.4);
  });

  it('is null when no SFHA polygon is in the envelope', () => {
    const xOnly = { zone: 'X', subtype: null, sfha: false, rings: [square(SITE.lon, SITE.lat, 0.01)] };
    expect(nearestSfhaMi(SITE.lat, SITE.lon, [xOnly], null)).toBeNull();
    expect(nearestSfhaMi(SITE.lat, SITE.lon, [], null)).toBeNull();
  });

  it('trusts the precise point query over the generalized polygons', () => {
    const ae = { zone: 'AE', subtype: null, sfha: true, rings: [square(SITE.lon, SITE.lat, 0.01)] };
    // Point query says SFHA → 0 even with no polygons at all.
    expect(nearestSfhaMi(SITE.lat, SITE.lon, [], { zone: 'AE', subtype: null, sfha: true })).toBe(0);
    // Point query says X but a generalized AE edge covers the site → "at the edge", not inside.
    expect(nearestSfhaMi(SITE.lat, SITE.lon, [ae], { zone: 'X', subtype: null, sfha: false })).toBe(0.01);
    // No point answer at all → the polygon decides.
    expect(nearestSfhaMi(SITE.lat, SITE.lon, [ae], null)).toBe(0);
  });

  it('never rounds an outside distance down to 0 (0 means inside)', () => {
    // A 0.002° square whose south edge is `mi` north of the site.
    const northOf = (mi: number) => ({
      zone: 'AE',
      subtype: null,
      sfha: true,
      rings: [square(SITE.lon, SITE.lat + miLat(mi) + 0.001, 0.001)],
    });
    expect(nearestSfhaMi(SITE.lat, SITE.lon, [northOf(0.004)], null)).toBe(0.01);
    expect(nearestSfhaMi(SITE.lat, SITE.lon, [northOf(0.004)], { zone: 'X', subtype: null, sfha: false })).toBe(0.01);
    expect(nearestSfhaMi(SITE.lat, SITE.lon, [northOf(0.014)], null)).toBe(0.01);
    expect(nearestSfhaMi(SITE.lat, SITE.lon, [northOf(0.016)], null)).toBe(0.02);
    expect(nearestSfhaMi(SITE.lat, SITE.lon, [northOf(0.25)], null)).toBe(0.25);
  });
});

describe('clipRingToBox', () => {
  const box = { xmin: 1, ymin: 1, xmax: 3, ymax: 3 };

  it('clips a partly-overlapping ring to the intersection and closes it', () => {
    const out = clipRingToBox(square(1, 1, 1), box);
    expect(out).not.toBeNull();
    expect(shoelace(out!)).toBeCloseTo(1, 9);
    expect(out![0]).toEqual(out![out!.length - 1]);
    for (const [x, y] of out!) {
      expect(x).toBeGreaterThanOrEqual(1);
      expect(y).toBeGreaterThanOrEqual(1);
    }
  });

  it('keeps the right area for a concave ring that leaves and re-enters the box', () => {
    const u = [[0, 0], [3, 0], [3, 3], [2, 3], [2, 1], [1, 1], [1, 3], [0, 3], [0, 0]];
    const out = clipRingToBox(u, { xmin: -1, ymin: -1, xmax: 4, ymax: 2 });
    expect(shoelace(out!)).toBeCloseTo(5, 9); // 3×2 minus the 1×1 notch below y=2
  });

  it('returns null for a ring outside the box and passes an inside ring through', () => {
    expect(clipRingToBox(square(10, 10, 1), box)).toBeNull();
    expect(clipRingToBox(square(2, 2, 0.5), box)).toEqual(square(2, 2, 0.5));
  });
});

const vertices = (rings: number[][][]) => rings.reduce((s, r) => s + r.length, 0);

describe('thinRings', () => {
  it('passes rings under the budget through untouched', () => {
    const rings = [circle(SITE.lat, SITE.lon, 0.1)];
    expect(thinRings(rings, 41)).toBe(rings);
  });

  it('keeps every stride-th vertex, re-closes each ring and fits the budget', () => {
    // 40-gon (41 closed): stride 5 keeps vertices 0,5,…,35 + the closing one.
    const ring = circle(SITE.lat, SITE.lon, 0.1);
    const [out] = thinRings([ring], 10);
    expect(out).toHaveLength(9);
    expect(out.slice(0, -1)).toEqual([0, 5, 10, 15, 20, 25, 30, 35].map((i) => ring[i]));
    expect(out[out.length - 1]).toEqual(out[0]);
  });

  it('drops rings that thin below a triangle, and gives up under one triangle of budget', () => {
    const outer = circle(SITE.lat, SITE.lon, 0.5, 80);
    const speck = square(SITE.lon, SITE.lat, 0.0001); // 5 vertices
    const out = thinRings([outer, speck, speck, speck], 60);
    expect(out).toHaveLength(1);
    expect(vertices(out)).toBeLessThanOrEqual(60);
    expect(thinRings([outer], 3)).toEqual([]);
  });

  it('stays within the budget when many rings round up, dropping the smallest rings first', () => {
    // 41 + 30 × 13 = 431 vertices into 100: stride 5 leaves 9 for the big ring
    // and 4 for each small one (129), so small rings go until it fits.
    const big = circle(SITE.lat, SITE.lon, 1);
    const small = Array.from({ length: 30 }, (_, k) => circle(SITE.lat + k * 0.01, SITE.lon, 0.1, 12));
    const out = thinRings([big, ...small], 100);
    expect(vertices(out)).toBe(97); // 9 + 22 × 4; a 23rd small ring would make 101
    expect(out).toHaveLength(23);
    expect(out[0]).toHaveLength(9); // the big ring, first as it was
    for (const r of out) expect(r[r.length - 1]).toEqual(r[0]);
  });

  it('grows the stride only as far as the largest ring needs', () => {
    // 20 vertices into 10: stride 2 would leave 11 (10 + closing), stride 3 leaves 8.
    const ring = circle(SITE.lat, SITE.lon, 0.1, 19);
    expect(ring).toHaveLength(20);
    expect(thinRings([ring], 10)[0]).toHaveLength(8);
  });
});

describe('capPolygonVertices', () => {
  it('thins the nearest polygon to fit when it alone is over budget', () => {
    const { kept, dropped, thinned } = capPolygonVertices([{ rings: [circle(SITE.lat, SITE.lon, 0.1)], distMi: 0 }], 10);
    expect(kept).toHaveLength(1);
    expect(vertices(kept[0].rings)).toBeLessThanOrEqual(10);
    expect(dropped).toBe(0);
    expect(thinned).toBe(true);
  });

  it('drops everything farther once a thinned nearest polygon has spent the budget', () => {
    const here = { rings: [circle(SITE.lat, SITE.lon, 0.1, 80)], distMi: 0, id: 'here' };
    const next = { rings: [circle(SITE.lat, SITE.lon, 0.1)], distMi: 0.3, id: 'next' };
    const capped = capPolygonVertices([next, here], 50);
    expect(capped.kept.map((p) => p.id)).toEqual(['here']);
    expect(capped.dropped).toBe(1);
    expect(capped.thinned).toBe(true);
  });

  it('fills the budget exactly and drops from the first polygon that would overflow it', () => {
    // 41 vertices each (40-gon, closed); original order is kept for survivors.
    const far = { rings: [circle(SITE.lat, SITE.lon, 0.1)], distMi: 1.5, id: 'far' };
    const near = { rings: [circle(SITE.lat, SITE.lon, 0.1)], distMi: 0.2, id: 'near' };
    const mid = { rings: [circle(SITE.lat, SITE.lon, 0.1)], distMi: 0.9, id: 'mid' };
    expect(capPolygonVertices([far, near, mid], 123)).toEqual({ kept: [far, near, mid], dropped: 0, thinned: false });
    const capped = capPolygonVertices([far, near, mid], 122);
    expect(capped.kept.map((p) => p.id)).toEqual(['near', 'mid']);
    expect(capped.dropped).toBe(1);
    expect(capped.thinned).toBe(false);
  });
});

describe('assembleFemaZone', () => {
  it('reports no digital map as uncovered — never as minimal hazard', () => {
    expect(assembleFemaZone(SITE.lat, SITE.lon, result([]), result([]))).toEqual({
      covered: false,
      atSite: null,
      polygons: [],
      nearestSfhaMi: null,
      truncated: false,
    });
  });

  it('builds the at-site zone, polygons and flags from both queries', () => {
    const point = result([feature({ zone: 'AE', sfha: true, bfeFt: 431.2, datum: 'NAVD88' })]);
    const env = result(
      [
        feature({ zone: 'AE', sfha: true, rings: [circle(SITE.lat, SITE.lon, 0.2)] }),
        feature({ zone: 'X', subtype: 'AREA OF MINIMAL FLOOD HAZARD', rings: [circle(SITE.lat + miLat(1), SITE.lon, 0.2)] }),
      ],
      { exceededTransferLimit: true }
    );
    const z = assembleFemaZone(SITE.lat, SITE.lon, point, env);
    expect(z.covered).toBe(true);
    expect(z.atSite).toEqual({ zone: 'AE', subtype: null, sfha: true, bfeFt: 431.2, depthFt: null, datum: 'NAVD88' });
    expect(z.nearestSfhaMi).toBe(0);
    // FEMA's record cap, not ours: the map was not trimmed here.
    expect(z.truncated).toBe(true);
    expect(z).not.toHaveProperty('mapTrimmed');
    expect(z.polygons.map((p) => Object.keys(p).sort())).toEqual([
      ['rings', 'sfha', 'subtype', 'zone'],
      ['rings', 'sfha', 'subtype', 'zone'],
    ]);
  });

  it('counts coverage from features it could not classify', () => {
    const env = { features: [], rawCount: 3, exceededTransferLimit: false };
    expect(assembleFemaZone(SITE.lat, SITE.lon, result([]), env).covered).toBe(true);
  });

  it('clips county-sized polygons to the envelope, keeping holes', () => {
    const box = envelopeAround(SITE.lat, SITE.lon);
    const hole = square(SITE.lon, SITE.lat, 0.005);
    const env = result([feature({ zone: 'X', rings: [square(SITE.lon, SITE.lat, 1), hole] })]);
    const z = assembleFemaZone(SITE.lat, SITE.lon, result([]), env, box);
    const [outer, inner] = z.polygons[0].rings;
    expect(outer).toHaveLength(5);
    for (const [x, y] of outer) {
      expect(x).toBeGreaterThanOrEqual(box.xmin - 1e-6);
      expect(x).toBeLessThanOrEqual(box.xmax + 1e-6);
      expect(y).toBeGreaterThanOrEqual(box.ymin - 1e-6);
      expect(y).toBeLessThanOrEqual(box.ymax + 1e-6);
    }
    // The hole sits wholly inside the box: passed through (to 6 decimals).
    expect(inner).toHaveLength(hole.length);
    inner.forEach(([x, y], i) => {
      expect(x).toBeCloseTo(hole[i][0], 6);
      expect(y).toBeCloseTo(hole[i][1], 6);
    });
    expect(z.truncated).toBe(false);
    expect(z).not.toHaveProperty('mapTrimmed');
  });

  it('drops the farthest polygons first past the vertex cap and flags the map trimmed', () => {
    const far = feature({ zone: 'AE', sfha: true, rings: [circle(SITE.lat + miLat(1.5), SITE.lon, 0.1)] });
    const here = feature({ zone: 'X', rings: [circle(SITE.lat, SITE.lon, 0.1)] });
    const near = feature({ zone: 'A', sfha: true, rings: [circle(SITE.lat, SITE.lon + miLon(0.5), 0.1)] });
    const z = assembleFemaZone(SITE.lat, SITE.lon, result([here]), result([far, here, near]), undefined, 90);
    // 41 + 41 vertices fit in 90; the third polygon (1.4 mi away) does not.
    expect(z.polygons.map((p) => p.zone)).toEqual(['X', 'A']);
    // Our trim, not FEMA's: nothing is missing from the distance.
    expect(z.mapTrimmed).toBe(true);
    expect(z.truncated).toBe(false);
    // The distance still comes from the full answer, not the capped map.
    expect(z.nearestSfhaMi).toBe(0.4);
  });

  it('thins an over-budget site polygon rather than drop it, measuring on the full shape', () => {
    const here = feature({ zone: 'AE', sfha: true, rings: [circle(SITE.lat + miLat(0.3), SITE.lon, 0.2, 80)] });
    const z = assembleFemaZone(SITE.lat, SITE.lon, result([]), result([here]), undefined, 12);
    expect(z.polygons).toHaveLength(1);
    expect(vertices(z.polygons[0].rings)).toBeLessThanOrEqual(12);
    expect(z.mapTrimmed).toBe(true);
    expect(z.truncated).toBe(false);
    // 0.1 mi to the full 80-gon's south vertex; the thinned copy (stride 8)
    // skips that vertex and would read 0.11.
    expect(z.nearestSfhaMi).toBe(0.1);
    expect(nearestSfhaMi(SITE.lat, SITE.lon, [{ ...here, rings: z.polygons[0].rings }], null)).toBe(0.11);
  });
});

describe('envelopeAround', () => {
  it('spans ±2 mi with longitude widened by latitude', () => {
    const b = envelopeAround(38, -90);
    expect(b.ymax - 38).toBeCloseTo(2 / 69, 9);
    expect(b.xmax + 90).toBeCloseTo(2 / 69 / Math.cos((38 * Math.PI) / 180), 9);
  });
});

// ── Precipitation ─────────────────────────────────────────────────────────────

function precipFixture() {
  return {
    latitude: 38,
    longitude: -90,
    timezone: 'America/Chicago',
    utc_offset_seconds: -18000,
    daily: { time: ['2026-09-28', '2026-09-29', '2026-09-30'], precipitation_sum: [0.12, null, 1.4] },
    hourly: {
      time: ['2026-09-29T00:00', '2026-09-29T01:00', '2026-09-29T02:00', '2026-09-29T03:00'],
      precipitation: [null, 0.02, 0.1, 0.3],
      precipitation_probability: [null, null, 40, 85],
    },
  };
}

describe('normalizePrecip', () => {
  it('keeps missing rain as null — a hole is not a dry hour — and missing probability too', () => {
    const f = precipFixture();
    f.hourly.precipitation[2] = NaN;
    const p = normalizePrecip(f);
    expect(p).toEqual({
      timezone: 'America/Chicago',
      utcOffsetSeconds: -18000,
      daily: { time: ['2026-09-28', '2026-09-29', '2026-09-30'], precipIn: [0.12, null, 1.4] },
      hourly: {
        time: ['2026-09-29T00:00', '2026-09-29T01:00', '2026-09-29T02:00', '2026-09-29T03:00'],
        precipIn: [null, 0.02, null, 0.3],
        probPct: [null, null, 40, 85],
      },
    });
  });

  it('truncates parallel arrays to their common length', () => {
    const f = precipFixture();
    f.daily.precipitation_sum = [0.12, 0.3];
    f.hourly.precipitation_probability = [null, 10, 20];
    const p = normalizePrecip(f);
    expect(p.daily.time).toHaveLength(2);
    expect(p.daily.precipIn).toEqual([0.12, 0.3]);
    expect(p.hourly.time).toHaveLength(3);
    expect(p.hourly.precipIn).toHaveLength(3);
    expect(p.hourly.probPct).toEqual([null, 10, 20]);
  });

  it('fills probability with null when the variable is absent, defaults the zone', () => {
    const f: Record<string, unknown> = precipFixture();
    delete f.timezone;
    delete f.utc_offset_seconds;
    delete (f.hourly as Record<string, unknown>).precipitation_probability;
    const p = normalizePrecip(f);
    expect(p.timezone).toBe('UTC');
    expect(p.utcOffsetSeconds).toBe(0);
    expect(p.hourly.probPct).toEqual([null, null, null, null]);
  });

  it('throws on an empty series or an Open-Meteo error body', () => {
    expect(() => normalizePrecip({ daily: { time: [], precipitation_sum: [] }, hourly: precipFixture().hourly })).toThrow(/empty/);
    expect(() => normalizePrecip({ daily: precipFixture().daily })).toThrow(/empty/);
    expect(() => normalizePrecip({ error: true, reason: 'Cannot initialize WeatherVariable' })).toThrow(/WeatherVariable/);
  });
});

// ── River discharge ───────────────────────────────────────────────────────────

describe('normalizeDischarge', () => {
  it('lays every variable against time, nulling NaN/undefined/junk and padding short arrays', () => {
    const d = normalizeDischarge(
      {
        latitude: 38.025,
        longitude: -90.075,
        daily: {
          time: ['2026-09-28', '2026-09-29', '2026-09-30'],
          river_discharge: [12.5, null, NaN],
          river_discharge_median: [null, 14, 'x'],
          river_discharge_p25: [null, 11],
          river_discharge_p75: [null, 17, 19, 99],
          river_discharge_max: [undefined, 22, 25],
        },
      },
      38,
      -90.05
    );
    expect(d).toEqual({
      lat: 38.025,
      lon: -90.075,
      time: ['2026-09-28', '2026-09-29', '2026-09-30'],
      discharge: [12.5, null, null],
      median: [null, 14, null],
      p25: [null, 11, null],
      p75: [null, 17, 19],
      min: [null, null, null],
      max: [null, 22, 25],
    });
  });

  it('falls back to the requested cell and rejects an empty series', () => {
    const d = normalizeDischarge({ daily: { time: ['2026-09-29'], river_discharge: [3] } }, 38, -90.05);
    expect([d.lat, d.lon]).toEqual([38, -90.05]);
    expect(() => normalizeDischarge({ daily: { time: [] } }, 38, -90)).toThrow(/empty/);
    expect(() => normalizeDischarge({ error: true, reason: 'No data is available for this location' }, 38, -90)).toThrow(
      /No data is available/
    );
  });

});

describe('GloFAS cell snapping', () => {
  it('snaps to the centre of the cell holding the site, not a corner', () => {
    expect(snapToGlofasLat(38.012)).toBe(38.025);
    expect(snapToGlofasLon(-90.037)).toBe(-90.025);
    expect(snapToGlofasLat(29.974)).toBe(29.975);
    expect(snapToGlofasLat(-0.01)).toBe(-0.025);
    expect(snapToGlofasLon(0.01)).toBe(0.025);
  });

  it('gives every point in a cell that cell’s centre, always an odd multiple of 0.025°', () => {
    for (let k = 1; k < 50; k++) {
      const v = 38 + k / 1000; // 38.001 … 38.049: one cell
      expect(snapToGlofasLat(v)).toBe(38.025);
      expect(snapToGlofasLon(-v)).toBe(-38.025);
    }
    for (let v = -59.9; v < 89.9; v += 0.0137) {
      const c = snapToGlofasLat(v);
      expect(Math.abs(c - v)).toBeLessThanOrEqual(0.025 + 1e-9);
      expect(Math.abs(Math.round(c * 40)) % 2).toBe(1);
      expect(Math.abs(c * 40 - Math.round(c * 40))).toBeLessThan(1e-9);
    }
  });

  it('clamps latitude to the grid rows (-59.975 … 89.975)', () => {
    expect(snapToGlofasLat(90)).toBe(89.975);
    expect(snapToGlofasLat(89.99)).toBe(89.975);
    expect(snapToGlofasLat(-60)).toBe(-59.975);
    expect(snapToGlofasLat(-75)).toBe(-59.975);
  });

  it('wraps longitude at the antimeridian, staying inside ±180', () => {
    // Column 0 (centred at -180.025) spans 179.95…180: named 179.975.
    expect(snapToGlofasLon(179.96)).toBe(179.975);
    expect(snapToGlofasLon(179.94)).toBe(179.925);
    // ±180 is one meridian; like any cell edge it belongs to the cell east of it.
    expect(snapToGlofasLon(180)).toBe(-179.975);
    expect(snapToGlofasLon(-180)).toBe(-179.975);
    expect(snapToGlofasLon(-179.99)).toBe(-179.975);
    expect(snapToGlofasLon(-180.01)).toBe(179.975);
    expect(snapToGlofasLon(540)).toBe(-179.975);
  });
});

// The Gumbel fit itself (and the ≥300-day / ≥10-year rules) is unit-tested in
// glofasClimate.test.ts; these check flood.ts pulls the right window and wires
// the fit and the per-cell store in.
describe('fetchDischargeClimatology', () => {
  const NOW = new Date('2026-09-29T12:00:00Z');

  it('pulls the last 20 complete years, fits them and stores the fit for the cell', async () => {
    const urls: URL[] = [];
    const s = climateSeries(Array.from({ length: 20 }, (_, i) => 2006 + i), (_y, i) => 100 + 10 * i);
    // A partial final year with a huge flow must not count.
    const partial = isoDays(2026, 100);
    s.time.push(...partial);
    s.q.push(...partial.map((_, i) => (i === 50 ? 10_000 : 5)));
    vi.stubGlobal('fetch', async (input: string) => {
      urls.push(new URL(input));
      return jsonResponse({ latitude: 38.025, longitude: -90.025, daily: { time: s.time, river_discharge: s.q } });
    });
    try {
      await expect(fetchDischargeClimatology(38.025, -90.025, NOW)).resolves.toEqual({
        ...WINDOW_FIT,
        fromYear: 2006,
        toYear: 2025,
      });
    } finally {
      vi.unstubAllGlobals();
    }
    expect(urls).toHaveLength(1);
    expect(urls[0].host).toBe('flood-api.open-meteo.com');
    expect(urls[0].searchParams.get('latitude')).toBe('38.025');
    expect(urls[0].searchParams.get('longitude')).toBe('-90.025');
    expect(urls[0].searchParams.get('daily')).toBe('river_discharge');
    expect(urls[0].searchParams.get('start_date')).toBe('2006-01-01');
    expect(urls[0].searchParams.get('end_date')).toBe('2025-12-31');
    expect(db.saved).toHaveLength(1);
    expect(db.saved[0].key).toBe('glofas-rp:v1:38.025,-90.025');
  });

  it('stores "record too short" (all-null reanalysis) but throws on an empty answer', async () => {
    const days = isoDays(2006);
    vi.stubGlobal('fetch', async () => jsonResponse({ daily: { time: days, river_discharge: days.map(() => null) } }));
    try {
      await expect(fetchDischargeClimatology(10.025, 10.025, NOW)).resolves.toBeNull();
      expect(db.saved).toHaveLength(1);
      vi.stubGlobal('fetch', async () => jsonResponse({ daily: { time: [], river_discharge: [] } }));
      await expect(fetchDischargeClimatology(10.075, 10.025, NOW)).rejects.toThrow(/empty/);
      expect(db.saved).toHaveLength(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

// ── Upstream fetchers (global fetch stubbed) ──────────────────────────────────

// NFHL answers: an ArcGIS error body, an AE zone at the point, and an
// envelope holding one small AE polygon over the site.
const ESRI_ERROR = { error: { code: 500, message: 'Error performing query operation' } };
const AE_POINT = {
  features: [{ attributes: { FLD_ZONE: 'AE', ZONE_SUBTY: null, SFHA_TF: 'T', STATIC_BFE: 431.2, DEPTH: -9999, V_DATUM: 'NAVD88' } }],
};
const AE_SITE = { zone: 'AE', subtype: null, sfha: true, bfeFt: 431.2, depthFt: null, datum: 'NAVD88' };
const ENVELOPE = {
  features: [{ attributes: { FLD_ZONE: 'AE', SFHA_TF: 'T' }, geometry: { rings: [square(SITE.lon, SITE.lat, 0.002)] } }],
};
const isEnvelope = (url: URL) => url.searchParams.get('geometryType') === 'esriGeometryEnvelope';

describe('upstream fetchers', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('queries NFHL at the point and over the envelope, and assembles the answer', async () => {
    const calls: Array<{ url: URL; ua: string | null }> = [];
    vi.stubGlobal('fetch', async (input: string, init?: RequestInit) => {
      const url = new URL(input);
      calls.push({ url, ua: new Headers(init?.headers).get('user-agent') });
      if (url.searchParams.get('geometryType') === 'esriGeometryPoint') {
        return jsonResponse({
          features: [
            { attributes: { FLD_ZONE: 'AE', ZONE_SUBTY: ' ', SFHA_TF: 'T', STATIC_BFE: 431.2, DEPTH: -9999, V_DATUM: 'NAVD88' } },
            { attributes: { FLD_ZONE: 'AE', ZONE_SUBTY: 'FLOODWAY', SFHA_TF: 'T', STATIC_BFE: 431.5, DEPTH: -9999, V_DATUM: 'NAVD88' } },
          ],
        });
      }
      return jsonResponse({
        features: [
          { attributes: { FLD_ZONE: 'AE', ZONE_SUBTY: 'FLOODWAY', SFHA_TF: 'T' }, geometry: { rings: [square(SITE.lon, SITE.lat, 0.002)] } },
        ],
      });
    });

    const z = await fetchFemaZone(SITE.lat, SITE.lon);
    expect(z.atSite).toEqual({ zone: 'AE', subtype: 'FLOODWAY', sfha: true, bfeFt: 431.5, depthFt: null, datum: 'NAVD88' });
    expect(z.covered).toBe(true);
    expect(z.nearestSfhaMi).toBe(0);
    expect(z.truncated).toBe(false);
    expect(z).not.toHaveProperty('mapTrimmed');
    expect(z).not.toHaveProperty('envelopeUnavailable');
    expect(typeof z.updated).toBe('number');

    expect(calls).toHaveLength(2);
    for (const { url, ua } of calls) {
      expect(url.host).toBe('hazards.fema.gov');
      expect(url.pathname).toBe('/arcgis/rest/services/public/NFHL/MapServer/28/query');
      expect(url.searchParams.get('f')).toBe('json');
      expect(url.searchParams.get('inSR')).toBe('4326');
      expect(url.searchParams.has('resultRecordCount')).toBe(false);
      expect(ua).toBeTruthy();
    }
    const point = calls.find((c) => c.url.searchParams.get('geometryType') === 'esriGeometryPoint')!.url;
    expect(point.searchParams.get('geometry')).toBe('-90,38');
    expect(point.searchParams.get('returnGeometry')).toBe('false');
    const env = calls.find((c) => c.url.searchParams.get('geometryType') === 'esriGeometryEnvelope')!.url;
    expect(env.searchParams.get('returnGeometry')).toBe('true');
    expect(env.searchParams.get('outSR')).toBe('4326');
    expect(env.searchParams.get('maxAllowableOffset')).toBe('0.00005');
    expect(env.searchParams.get('geometry')!.split(',').map(Number)[1]).toBeCloseTo(38 - 2 / 69, 5);
  });

  // Answer the two NFHL queries separately; returns the envelope call count.
  function stubNfhl(point: () => Response, envelope: () => Response): { envelopeCalls: number } {
    const counts = { envelopeCalls: 0 };
    vi.stubGlobal('fetch', async (input: string) => {
      if (!isEnvelope(new URL(input))) return point();
      counts.envelopeCalls++;
      return envelope();
    });
    return counts;
  }

  it('serves the at-site zone alone, flagged, when only the envelope fails', async () => {
    stubNfhl(
      () => jsonResponse(AE_POINT),
      () => jsonResponse(ESRI_ERROR)
    );
    await expect(fetchFemaZone(SITE.lat, SITE.lon)).resolves.toEqual({
      covered: true,
      atSite: AE_SITE,
      polygons: [],
      nearestSfhaMi: null, // not checked — never "no SFHA nearby"
      truncated: false,
      envelopeUnavailable: true,
      updated: expect.any(Number),
    });
  });

  it('treats an oversized envelope as unavailable without reading or retrying it', async () => {
    let cancelled = false;
    const body = new ReadableStream({
      pull: (c) => c.enqueue(new Uint8Array(1024)),
      cancel: () => {
        cancelled = true;
      },
    });
    const s = stubNfhl(
      () => jsonResponse(AE_POINT),
      () => new Response(body, { headers: { 'content-length': String(26 * 1024 * 1024) } })
    );
    const z = await fetchFemaZone(SITE.lat, SITE.lon);
    expect(z.envelopeUnavailable).toBe(true);
    expect(z.atSite).toEqual(AE_SITE);
    expect(s.envelopeCalls).toBe(1);
    expect(cancelled).toBe(true);
  });

  it('fails the zone when the envelope fails and the point found no zone — coverage is unknown', async () => {
    stubNfhl(
      () => jsonResponse({ features: [] }),
      () => jsonResponse(ESRI_ERROR)
    );
    await expect(fetchFemaZone(SITE.lat, SITE.lon)).rejects.toThrow(/Error performing query operation/);
  });

  it('fails the zone when the point query fails, even with a good envelope', async () => {
    stubNfhl(
      () => new Response('<html>Service Unavailable</html>', { status: 503 }),
      () => jsonResponse(ENVELOPE)
    );
    await expect(fetchFemaZone(SITE.lat, SITE.lon)).rejects.toThrow(/FEMA NFHL point HTTP 503/);
    stubNfhl(
      () => jsonResponse(ESRI_ERROR),
      () => jsonResponse(ENVELOPE)
    );
    await expect(fetchFemaZone(SITE.lat, SITE.lon)).rejects.toThrow(/Error performing query operation/);
  });

  it('refuses a body whose Content-Length is over the cap, without retrying', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { headers: { 'content-length': '2000' } }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      fetchUpstreamJson('https://upstream.test/a', 'Test', 1_000, { attempts: 2, budgetMs: 25_000, maxBytes: 1_000 })
    ).rejects.toThrow(/Test: response too large/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('counts streamed bytes when there is no Content-Length, and cancels past the cap', async () => {
    let cancelled = false;
    const fetchMock = vi.fn(
      async () =>
        new Response(
          new ReadableStream({
            pull: (c) => c.enqueue(new TextEncoder().encode(' '.repeat(400))),
            cancel: () => {
              cancelled = true;
            },
          })
        )
    );
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      fetchUpstreamJson('https://upstream.test/a', 'Test', 1_000, { attempts: 2, budgetMs: 25_000, maxBytes: 1_000 })
    ).rejects.toThrow(/response too large/);
    expect(cancelled).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Under the cap, a chunked body reads whole.
    const chunks = ['{"a":', '[1,2,', '3]}'];
    vi.stubGlobal('fetch', async () => {
      const enc = new TextEncoder();
      return new Response(
        new ReadableStream({
          pull: (c) => {
            const next = chunks.shift();
            if (next === undefined) c.close();
            else c.enqueue(enc.encode(next));
          },
        })
      );
    });
    await expect(fetchUpstreamJson('https://upstream.test/b', 'Test', 1_000, { maxBytes: 1_000 })).resolves.toEqual({ a: [1, 2, 3] });
  });

  it('retries a 200 whose body fails mid-read, with the read error as the reason', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          new ReadableStream({
            start: (c) => {
              c.enqueue(new TextEncoder().encode('{"features":['));
              c.error(new Error('socket hang up'));
            },
          })
        )
    );
    vi.stubGlobal('fetch', fetchMock);
    await expect(fetchUpstreamJson('https://upstream.test/a', 'Test', 1_000, { attempts: 2, budgetMs: 25_000 })).rejects.toThrow(
      /Test: socket hang up/
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries precipitation once after a network blip', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(jsonResponse(precipFixture()));
    vi.stubGlobal('fetch', fetchMock);
    const p = await fetchFloodPrecip(38, -90);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(p.daily.precipIn).toEqual([0.12, null, 1.4]);
    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(url.host).toBe('api.open-meteo.com');
    expect(url.searchParams.get('past_days')).toBe('7');
    // Today + 5 days: the client's next-72 h and 5-day totals need the whole span.
    expect(url.searchParams.get('forecast_days')).toBe('6');
    expect(url.searchParams.get('precipitation_unit')).toBe('inch');
  });

  it('skips the retry once the time budget is spent', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
    vi.stubGlobal('fetch', fetchMock);
    // 400 ms backoff leaves 600 ms of a 1 s budget — too little for a retry.
    await expect(fetchUpstreamJson('https://upstream.test/a', 'Test', 1_000, { attempts: 2, budgetMs: 1_000 })).rejects.toThrow(
      /fetch failed/
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock.mockClear();
    await expect(fetchUpstreamJson('https://upstream.test/a', 'Test', 1_000, { attempts: 2, budgetMs: 25_000 })).rejects.toThrow(
      /fetch failed/
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('surfaces the Open-Meteo reason on a 400 and does not retry it', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ error: true, reason: 'Latitude must be in range of -90 to 90°.' }, 400));
    vi.stubGlobal('fetch', fetchMock);
    await expect(fetchFloodPrecip(38, -90)).rejects.toThrow(/HTTP 400: Latitude must be in range/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('serves discharge without thresholds when the climatology fails, and backs off', async () => {
    const hosts: string[] = [];
    vi.stubGlobal('fetch', async (input: string) => {
      const url = new URL(input);
      hosts.push(url.searchParams.has('start_date') ? 'climate' : 'forecast');
      if (url.searchParams.has('start_date')) return jsonResponse({ error: true, reason: 'Too many requests' }, 429);
      return jsonResponse({ latitude: 41.025, longitude: -95.975, daily: { time: ['2026-09-29'], river_discharge: [8.1] } });
    });
    const first = await getFloodDischarge(41.025, -95.975);
    expect(first.thresholds).toBeNull();
    expect(first.discharge).toEqual([8.1]);
    const second = await getFloodDischarge(41.025, -95.975);
    expect(second.thresholds).toBeNull();
    // Forecast cached; climatology not re-pulled inside the back-off window.
    expect(hosts.sort()).toEqual(['climate', 'forecast']);
    expect(db.saved).toEqual([]); // a failed pull stores nothing
  });

  it("uses the cell's stored fit without pulling the reanalysis", async () => {
    const w = climatologyWindow();
    const rp = { rp2: 11, rp5: 22, rp20: 33, years: 20, fromYear: 2006, toYear: 2025 };
    db.rows = [{ data: { window: w, rp, savedAt: 1 } }];
    const climate = vi.fn();
    vi.stubGlobal('fetch', async (input: string) => {
      if (new URL(input).searchParams.has('start_date')) climate();
      return jsonResponse({ latitude: 43.025, longitude: -99.975, daily: { time: ['2026-09-29'], river_discharge: [8.1] } });
    });
    expect((await getFloodDischarge(43.025, -99.975)).thresholds).toEqual(rp);
    expect(climate).not.toHaveBeenCalled();
  });

  it('answers without thresholds while a slow pull runs, then serves them from the cache', async () => {
    const s = windowSeries();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.stubGlobal('fetch', async (input: string) => {
      if (new URL(input).searchParams.has('start_date')) {
        await gate;
        return jsonResponse({ daily: { time: s.time, river_discharge: s.q } });
      }
      return jsonResponse({ latitude: 42.025, longitude: -97.975, daily: { time: ['2026-09-29'], river_discharge: [8.1] } });
    });
    const first = await getFloodDischarge(42.025, -97.975, 20);
    expect(first.thresholds).toBeNull();
    expect(first.discharge).toEqual([8.1]);
    release();
    await vi.waitFor(async () => {
      expect((await getFloodDischarge(42.025, -97.975, 20)).thresholds).toMatchObject(WINDOW_FIT);
    });
  });
});

// ── Routes over HTTP (loopback; upstreams stubbed) ────────────────────────────

describe('flood routes', () => {
  const realFetch = globalThis.fetch;
  let server: Server;
  let base = '';
  let upstream: (url: URL) => Response | Promise<Response>;
  const seen: URL[] = [];

  beforeAll(async () => {
    const app = express();
    app.use('/api/flood', floodRouter);
    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => resolve());
    });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/flood`;
  });
  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  beforeEach(() => {
    seen.length = 0;
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal('fetch', (input: string | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.hostname === '127.0.0.1') return realFetch(input, init);
      seen.push(url);
      return Promise.resolve(upstream(url));
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('rejects missing or out-of-range coordinates with a 400', async () => {
    upstream = () => jsonResponse({});
    for (const q of ['', '?lat=&lon=', '?lat=abc&lon=1', '?lat=91&lon=0', '?lat=0&lon=181']) {
      const res = await realFetch(`${base}/zone${q}`);
      expect(res.status).toBe(400);
    }
    expect(seen).toHaveLength(0);
  });

  it('502s the zone route when FEMA is down', async () => {
    upstream = () => new Response('<html>Service Unavailable</html>', { status: 503 });
    const res = await realFetch(`${base}/zone?lat=30.1234&lon=-91.5678`);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'FEMA flood zone unavailable' });
  });

  it('serves the zone as JSON from a cached serialized answer, for a week', async () => {
    upstream = (url) => jsonResponse(isEnvelope(url) ? ENVELOPE : AE_POINT);
    const url = `${base}/zone?lat=31.00004&lon=-91.00004`;
    const first = await realFetch(url);
    expect(first.status).toBe(200);
    expect(first.headers.get('content-type')).toMatch(/^application\/json/);
    const body = (await first.json()) as Record<string, unknown>;
    expect(body.atSite).toEqual(AE_SITE);
    expect(body.truncated).toBe(false);
    expect(seen).toHaveLength(2);
    // Stored as bytes, keyed to 4 decimals.
    expect(Buffer.isBuffer(cache.get('flood-zone:31,-91'))).toBe(true);

    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(Date.now() + 6 * 24 * 60 * 60 * 1000);
      const again = await realFetch(url);
      expect(await again.json()).toEqual(body);
      expect(seen).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('holds an at-site-only answer for minutes, not a week, so the envelope is retried', async () => {
    upstream = (url) => (isEnvelope(url) ? jsonResponse(ESRI_ERROR) : jsonResponse(AE_POINT));
    const url = `${base}/zone?lat=32.5&lon=-92.5`;
    const first = await realFetch(url);
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ covered: true, atSite: AE_SITE, envelopeUnavailable: true, polygons: [] });
    expect(seen.filter(isEnvelope)).toHaveLength(1);

    await realFetch(url); // still inside the short hold: served from cache
    expect(seen.filter(isEnvelope)).toHaveLength(1);

    upstream = (u) => jsonResponse(isEnvelope(u) ? ENVELOPE : AE_POINT);
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(Date.now() + 16 * 60 * 1000);
      const later = await realFetch(url);
      const body = (await later.json()) as Record<string, unknown>;
      expect(body).not.toHaveProperty('envelopeUnavailable');
      expect(body.nearestSfhaMi).toBe(0);
      expect(seen.filter(isEnvelope)).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('serves precipitation in the client shape', async () => {
    upstream = () => jsonResponse(precipFixture());
    const res = await realFetch(`${base}/precip?lat=35.04&lon=-85.31`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(['daily', 'hourly', 'timezone', 'updated', 'utcOffsetSeconds']);
    expect((body.hourly as { precipIn: unknown[] }).precipIn).toEqual([null, 0.02, 0.1, 0.3]);
    expect(seen[0].searchParams.get('latitude')).toBe('35');
    expect(seen[0].searchParams.get('longitude')).toBe('-85.3');
    expect(seen[0].searchParams.get('forecast_days')).toBe('6');
  });

  it('serves discharge with thresholds on the centre of the GloFAS cell holding the site', async () => {
    const clim = windowSeries();
    // Open-Meteo echoes the cell it used — the one centred on the snapped point.
    upstream = (url) =>
      url.searchParams.has('start_date')
        ? jsonResponse({ latitude: 38.025, longitude: -90.025, daily: { time: clim.time, river_discharge: clim.q } })
        : jsonResponse({
            latitude: 38.025,
            longitude: -90.025,
            daily: { time: ['2026-09-29', '2026-09-30'], river_discharge: [150, 180], river_discharge_median: [null, 175] },
          });
    const res = await realFetch(`${base}/discharge?lat=38.012&lon=-90.037`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(
      ['discharge', 'lat', 'lon', 'max', 'median', 'min', 'p25', 'p75', 'thresholds', 'time', 'updated'].sort()
    );
    expect(body.lat).toBe(38.025);
    expect(body.lon).toBe(-90.025);
    expect(body.median).toEqual([null, 175]);
    const w = climatologyWindow();
    expect(body.thresholds).toEqual({
      ...WINDOW_FIT,
      fromYear: Number(w.start.slice(0, 4)),
      toYear: Number(w.end.slice(0, 4)),
    });
    // The cell centre, never a corner (38, -90.05) that Open-Meteo would have
    // to break a four-way tie on.
    expect(seen).toHaveLength(2);
    for (const u of seen) {
      expect(u.host).toBe('flood-api.open-meteo.com');
      expect(u.searchParams.get('latitude')).toBe('38.025');
      expect(u.searchParams.get('longitude')).toBe('-90.025');
    }
    const forecastUrl = seen.find((u) => !u.searchParams.has('start_date'))!;
    expect(forecastUrl.searchParams.get('past_days')).toBe('14');
    expect(forecastUrl.searchParams.get('forecast_days')).toBe('30');
    const climUrl = seen.find((u) => u.searchParams.has('start_date'))!;
    expect(climUrl.searchParams.get('start_date')).toBe(w.start);
    expect(climUrl.searchParams.get('end_date')).toBe(w.end);
    expect(db.saved.map((s) => s.key)).toEqual(['glofas-rp:v1:38.025,-90.025']);
  });

  it('502s discharge when the forecast itself is down', async () => {
    upstream = () => jsonResponse({ error: true, reason: 'Internal error' }, 500);
    const res = await realFetch(`${base}/discharge?lat=44.5&lon=-100.2`);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'River discharge forecast unavailable' });
  });
});
