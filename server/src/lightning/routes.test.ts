import type { AddressInfo } from 'net';
import type { Server } from 'http';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { STAGE_ENDS_S } from './constants';
import type { Persistence } from './persist';
import { haversineMi, qLat, qLon } from './quant';
import { type LightningContext, createLightningRouter, parseBBox, roundDown } from './routes';
import { createLightningService } from './service';
import { FakeDb, FakeWs, type Rec, genStrikes } from './testkit';

const H = 3_600_000;

let server: Server;
let base = '';
let ctx: LightningContext;
let ready = true;

beforeAll(async () => {
  const svc = createLightningService({
    db: new FakeDb(),
    wsFactory: (url) => new FakeWs(url),
    log: () => {},
    memoryUsage: () => ({ rss: 200e6, heapUsed: 50e6, arrayBuffers: 30e6 }),
    capacity: 5_000_000,
  });
  ctx = svc.ctx;
  const now = Date.now();
  for (const r of genStrikes({ n: 30_000, nowMs: now, spanMs: 24 * 3_600_000, seed: 1, cells: [{ lat: 35, lon: -97, sd: 1 }] })) {
    ctx.store.appendLive(r.tick, r.latQ, r.lonQ);
  }
  const app = express();
  app.use('/api/lightning', createLightningRouter(() => (ready ? ctx : null)));
  await new Promise<void>((resolve) => {
    server = app.listen(0, resolve);
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/lightning`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

async function get(path: string): Promise<{ status: number; body: any; headers: Headers }> {
  const res = await fetch(base + path);
  return { status: res.status, body: await res.json(), headers: res.headers };
}

const keys = (o: object) => Object.keys(o).sort();

/** A service and app of its own (clock, capacity, history), with its restore done on an empty database. */
async function standalone(opts: { now: () => number; capacity?: number }) {
  const svc = createLightningService({
    db: new FakeDb(),
    wsFactory: (url) => new FakeWs(url),
    log: () => {},
    memoryUsage: () => ({ rss: 200e6, heapUsed: 50e6, arrayBuffers: 30e6 }),
    capacity: opts.capacity ?? 5_000_000,
    now: opts.now,
  });
  await (svc.ctx.persist as Persistence).restore();
  const app = express();
  app.use('/api/lightning', createLightningRouter(() => svc.ctx));
  const srv = await new Promise<Server>((resolve) => {
    const s2 = app.listen(0, () => resolve(s2));
  });
  const url = `http://127.0.0.1:${(srv.address() as AddressInfo).port}/api/lightning`;
  return {
    ctx: svc.ctx,
    get: async (path: string): Promise<any> => (await fetch(url + path)).json(),
    close: () => new Promise<void>((resolve) => srv.close(() => resolve())),
  };
}
const add = (c: LightningContext, recs: Rec[]) => {
  for (const r of recs.slice().sort((a, b) => a.tick - b.tick)) c.store.appendLive(r.tick, r.latQ, r.lonQ);
};

describe('GET /field', () => {
  it('answers the contract shape with no-store', async () => {
    const { status, body, headers } = await get('/field');
    expect(status).toBe(200);
    expect(headers.get('cache-control')).toBe('no-store');
    expect(keys(body)).toEqual(['field', 'fresh', 'now', 'stageEndsS', 'status', 'v', 'view']);
    expect(body.v).toBe(1);
    expect(body.stageEndsS).toEqual(STAGE_ENDS_S);
    expect(body.view).toMatchObject({ bbox: null, budget: 16_000, cellDeg: 1.6, total: 30_000, degraded: null });
    expect(keys(body.field)).toEqual(['dt', 'la', 'lo', 'tick0']);
    expect(body.field.dt.length).toBeGreaterThan(1_000);
    expect(keys(body.status)).toEqual(['collector', 'counts', 'coverage', 'fidelity', 'now', 'restore']);
    expect(keys(body.status.collector)).toEqual(['connected', 'downSince', 'lastStrikeAgeS', 'ratePerMin']);
    expect(keys(body.status.counts)).toEqual(['exact', 'm1440', 'm360', 'm60', 'm720']);
    expect(body.status.counts.m1440).toBe(30_000);
    expect(keys(body.status.coverage)).toEqual(['coveredMin', 'gaps', 'restoredBackToMs', 'restoring', 'windowMin']);
    expect(body.status.coverage.windowMin).toBe(1_440);
    expect(keys(body.status.fidelity)).toEqual(['evictedBeforeMs', 'legacyBeforeMs']);
    expect(body.status.restore).toEqual({ state: 'pending', progress: 0, backToMs: null });
  });

  it('rounds budget and fresh down to the allowed sets and validates the box', async () => {
    expect((await get('/field?budget=15000&fresh=999')).body.view.budget).toBe(12_000);
    expect((await get('/field?budget=100')).body.view.budget).toBe(4_000);
    const anti = await get('/field?bbox=170,-10,-170,10&budget=4000&fresh=1000');
    expect(anti.status).toBe(200);
    expect(anti.body.view.bbox).toEqual([170, -10, -170, 10]);
    for (const bad of ['bbox=1,2,3', 'bbox=0,10,5,5', 'bbox=-200,0,0,10', 'bbox=0,-95,10,10', 'bbox=5,0,5,10', 'bbox=a,b,c,d', 'budget=abc', 'fresh=x']) {
      expect((await get(`/field?${bad}`)).status).toBe(400);
    }
    expect(roundDown('24000', [4_000, 24_000], 1)).toBe(24_000);
    expect(roundDown(undefined, [4_000], 16_000)).toBe(16_000);
    expect(parseBBox('-97.123456,30,-90,40')).toEqual([-97.12346, 30, -90, 40]);
  });
});

describe('GET /near', () => {
  it('answers the contract shape', async () => {
    const { status, body } = await get('/near?lat=35&lon=-97&radiusMi=1000&hours=48');
    expect(status).toBe(200);
    expect(keys(body)).toEqual(
      ['collector', 'counts', 'coverage', 'fidelity', 'hours', 'lat', 'lon', 'nearest', 'now', 'points', 'radiusMi', 'v'].sort()
    );
    expect(body).toMatchObject({ v: 1, lat: 35, lon: -97, radiusMi: 500, hours: 24 });
    expect(keys(body.counts)).toEqual(['exact', 'inRadius', 'le100', 'le25', 'le5']);
    expect(keys(body.points)).toEqual(['lat', 'lon', 'sampled', 't']);
    expect(keys(body.nearest)).toEqual(['ageS', 'lat', 'lon', 'mi']);
    expect(body.points.t.length).toBeLessThanOrEqual(6_000); // default maxPoints
    expect(body.coverage.windowMin).toBe(1_440);
  });

  it('leaves evicted time out of its coverage; /status coverage and counts keep it', async () => {
    const now = Date.now();
    const t = await standalone({ now: () => now, capacity: 100_000 });
    try {
      // A storm near the site 12–24 h ago, then 12 h of strikes far away: the cap evicts the storm.
      add(t.ctx, genStrikes({ n: 60_000, nowMs: now - 12 * H, spanMs: 12 * H, seed: 61, cells: [{ lat: 35, lon: -95, sd: 0.05 }], isolatedShare: 0 }));
      add(t.ctx, genStrikes({ n: 90_000, nowMs: now, spanMs: 12 * H, seed: 62, cells: [{ lat: -10, lon: 20, sd: 1 }], isolatedShare: 0 }));
      t.ctx.store.enforceCapacity();
      const evictedBeforeMs = t.ctx.store.evictedBeforeMs!;
      expect(evictedBeforeMs).toBeGreaterThan(now - 12 * H);
      const n = await t.get('/near?lat=35&lon=-95&radiusMi=130&hours=24');
      expect(n.counts).toMatchObject({ inRadius: 0, exact: false });
      expect(n.nearest).toBeNull();
      expect(n.fidelity.evictedBeforeMs).toBe(evictedBeforeMs);
      // "None within 25 mi" is only true of the time since the evicted records ended.
      expect(Math.abs(n.coverage.coveredMin - (now - evictedBeforeMs) / 60_000)).toBeLessThanOrEqual(1);
      expect(n.coverage.gaps).toEqual([]);
      const legacy = await t.get('/?minutes=1440&lat=35&lon=-95&radiusMi=130');
      expect(legacy.coverageMin).toBe(n.coverage.coveredMin);
      // The per-minute counts never lose evicted strikes: /status still covers and counts the day.
      const st = await t.get('/status');
      expect(st.coverage.coveredMin).toBe(1_440);
      expect(st.counts).toMatchObject({ m1440: 150_000, exact: true });
      // A window that ends before the evicted span is fully covered and exact.
      const recent = await t.get('/near?lat=-10&lon=20&radiusMi=300&hours=6');
      expect(recent.coverage.coveredMin).toBe(360);
      expect(recent.counts.exact).toBe(true);
    } finally {
      await t.close();
    }
  });

  it('answers with the response time, re-basing the memoized nearest strike’s age', async () => {
    let now = Date.now();
    const t = await standalone({ now: () => now });
    try {
      t.ctx.store.appendLive(Math.floor((now - 60_000) / 10), qLat(35), qLon(-97));
      const a = await t.get('/near?lat=35&lon=-97&radiusMi=10');
      expect(a.now).toBe(now);
      expect(a.nearest.ageS).toBe(60);
      now += 20_000;
      t.ctx.store.appendLive(Math.floor((now - 1_000) / 10), qLat(35.01), qLon(-97)); // not in the memo yet
      const b = await t.get('/near?lat=35&lon=-97&radiusMi=10');
      expect(b.counts).toEqual(a.counts); // served from the ≤ 30 s memo…
      expect(b.now).toBe(now); // …but stamped with the response time
      expect(b.nearest.ageS).toBe(80);
      expect(b.coverage.windowMin).toBe(1_440);
    } finally {
      await t.close();
    }
  });

  it('rejects bad parameters', async () => {
    for (const bad of ['', 'lat=35', 'lat=95&lon=0', 'lat=0&lon=200', 'lat=0&lon=0&radiusMi=0', 'lat=0&lon=0&hours=-1', 'lat=x&lon=0']) {
      expect((await get(`/near?${bad}`)).status).toBe(400);
    }
  });
});

describe('GET /status and /debug', () => {
  it('status has every field of the contract; debug adds the detail', async () => {
    const { body } = await get('/status');
    expect(keys(body)).toEqual(
      [
        'bootId', 'collector', 'collectorDetail', 'counts', 'coverage', 'fidelity', 'mem', 'now', 'perMinute',
        'persist', 'rates', 'restore', 'restoreDetail', 'store', 'v',
      ].sort()
    );
    expect(body.perMinute).toHaveLength(60);
    expect(keys(body.rates)).toEqual(['peak1hPerSec', 'per15mPerSec', 'per1hPerSec', 'perSec']);
    expect(body.store).toMatchObject({ records: 30_000, capacity: 5_000_000 });
    expect(body.mem).toEqual({ rss: 200e6, heapUsed: 50e6, arrayBuffers: 30e6, pressure: false });
    const dbg = (await get('/debug')).body;
    expect(dbg.segments.length).toBeGreaterThan(0);
    expect(dbg.bootId).toBe(body.bootId);
  });
});

describe('GET / (legacy)', () => {
  const LEGACY_KEYS = ['connected', 'coverageMin', 'lat', 'lon', 'returned', 't', 'thinned', 'totalInWindow', 'updated', 'windowMin'];

  function expectLegacyShape(body: any) {
    expect(keys(body)).toEqual(LEGACY_KEYS);
    for (const k of ['lat', 'lon', 't']) {
      expect(Array.isArray(body[k])).toBe(true);
      expect(body[k].every((v: unknown) => typeof v === 'number')).toBe(true);
    }
    for (const k of ['windowMin', 'totalInWindow', 'returned', 'coverageMin', 'updated']) expect(typeof body[k]).toBe('number');
    expect(typeof body.thinned).toBe('boolean');
    expect(typeof body.connected).toBe('boolean');
    expect(body.returned).toBe(body.lat.length);
    expect(body.lat.length).toBe(body.t.length);
  }

  it('keeps every key and type, globally and near a point', async () => {
    const g = (await get('/?minutes=1440')).body;
    expectLegacyShape(g);
    expect(g).toMatchObject({ windowMin: 1_440, totalInWindow: 30_000, thinned: true });
    expect(g.returned).toBeGreaterThan(0);
    expect(g.updated).toBe(Math.round(g.updated)); // epoch seconds
    expect(g.t.every((t: number) => t > g.updated - 86_401 && t <= g.updated + 1)).toBe(true);

    const n = (await get('/?minutes=60&lat=35&lon=-97&radiusMi=130')).body;
    expectLegacyShape(n);
    expect(n.windowMin).toBe(60);
    expect(n.totalInWindow).toBeGreaterThan(0);
    expect(n.totalInWindow).toBeLessThan(30_000);
    expect((await get('/?minutes=5000')).body.windowMin).toBe(1_440);
    expect((await get('/')).body.windowMin).toBe(60);
  });

  it('near a point: an unbiased sample above 20000 in radius, so old bundles’ scaled counts hold', async () => {
    const now = Date.now();
    const t = await standalone({ now: () => now });
    try {
      add(t.ctx, genStrikes({ n: 60_000, nowMs: now, spanMs: 24 * H, seed: 71, cells: [{ lat: 35, lon: -95, sd: 0.1 }], isolatedShare: 0 }));
      add(t.ctx, genStrikes({ n: 8_000, nowMs: now, spanMs: 24 * H, seed: 72, cells: [{ lat: 35, lon: -95, sd: 1.5 }], isolatedShare: 0 }));
      const body = await t.get('/?minutes=1440&lat=35&lon=-95&radiusMi=130');
      const exact = (await t.get('/near?lat=35&lon=-95&radiusMi=130&hours=24&maxPoints=1')).counts;
      expect(body).toMatchObject({ thinned: true, totalInWindow: exact.inRadius });
      expect(body.returned).toBeLessThanOrEqual(20_000);
      // What a pre-upgrade bundle computes: (points within d) × totalInWindow / returned.
      for (const [d, want] of [
        [25, exact.le25],
        [100, exact.le100],
      ]) {
        const within = body.lat.filter((lat: number, i: number) => haversineMi(35, -95, lat, body.lon[i]) <= d).length;
        expect(Math.abs((within * body.totalInWindow) / body.returned - want) / want).toBeLessThan(0.05);
      }
    } finally {
      await t.close();
    }
  });

  it('rejects bad parameters with 400', async () => {
    for (const bad of ['minutes=abc', 'lat=35', 'lat=35&lon=-97', 'lat=95&lon=0&radiusMi=10', 'lat=35&lon=-97&radiusMi=-3']) {
      expect((await get(`/?${bad}`)).status).toBe(400);
    }
  });

  it('answers 503 until the service exists', async () => {
    ready = false;
    try {
      const r = await get('/field');
      expect(r.status).toBe(503);
      expect(r.headers.get('retry-after')).toBe('5');
    } finally {
      ready = true;
    }
  });
});
