// /api/lightning routes. Every response is Cache-Control: no-store — the data
// changes every second and the client decides how often to poll.
//
//   GET /field?bbox=w,s,e,n&budget&fresh   the display field for a view (display.ts)
//   GET /near?lat&lon&radiusMi&hours&maxPoints   exact counts around a place (near.ts)
//   GET /status, GET /debug               collector health (status.ts)
//   GET /?minutes[&lat&lon&radiusMi]      LEGACY shape, kept for old bundles
//                                         still open on wall displays

import { Router, type Request, type Response } from 'express';
import { wrap } from '../asyncWrap';
import { BUDGETS, DEFAULT_BUDGET, DEFAULT_FRESH, FRESH_CAPS, STAGE_ENDS_S } from './constants';
import { type BBox, type FieldService, freshMarks } from './display';
import type { NearService } from './near';
import { dqLat, dqLon } from './quant';
import { type StatusSources, collectorLite, coverage, debugInfo, fidelity, statusFull, statusLite } from './status';

export interface LightningContext extends StatusSources {
  field: FieldService;
  near: NearService;
  now: () => number;
  /** Extra /debug detail (memo and scan-gate stats, …). */
  debugExtra?: () => Record<string, unknown>;
}

const RETRY_AFTER_S = 5;
const round3 = (v: number): number => Math.round(v * 1000) / 1000;

function busy(res: Response, error = 'busy'): void {
  res.setHeader('Retry-After', String(RETRY_AFTER_S));
  res.status(503).json({ error, retryAfterS: RETRY_AFTER_S });
}

/** "w,s,e,n" → a validated box (w > e crosses the antimeridian); null when invalid. */
export function parseBBox(raw: string): BBox | null {
  const parts = raw.split(',').map((p) => (p.trim() === '' ? NaN : Number(p)));
  if (parts.length !== 4 || parts.some((v) => !Number.isFinite(v))) return null;
  const [w, s, e, n] = parts.map((v) => Math.round(v * 1e5) / 1e5);
  if (w < -180 || w > 180 || e < -180 || e > 180 || w === e) return null;
  if (s < -90 || n > 90 || !(s < n)) return null;
  return [w, s, e, n];
}

/** Round a requested value DOWN to one of the allowed values (the smallest if below all). null = not a number. */
export function roundDown(raw: unknown, allowed: readonly number[], def: number): number | null {
  if (raw === undefined || raw === '') return def;
  const v = Number(raw);
  if (!Number.isFinite(v)) return null;
  let best = allowed[0];
  for (const a of allowed) if (a <= v) best = a;
  return best;
}

/** An optional numeric query parameter: def when absent, null when present but not a number. */
function num(raw: unknown, def: number): number | null {
  if (raw === undefined || raw === '') return def;
  const v = Number(raw);
  return Number.isFinite(v) ? v : null;
}

export function createLightningRouter(getCtx: () => LightningContext | null): Router {
  const router = Router();

  router.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  // Before init (or in a test app without it) every route answers 503.
  const withCtx = (fn: (ctx: LightningContext, req: Request, res: Response) => Promise<void>) =>
    wrap(async (req, res) => {
      const ctx = getCtx();
      if (!ctx) return busy(res, 'starting');
      await fn(ctx, req, res);
    }, 'lightning');

  router.get(
    '/field',
    withCtx(async (ctx, req, res) => {
      let bbox: BBox | null = null;
      if (req.query.bbox !== undefined) {
        bbox = typeof req.query.bbox === 'string' ? parseBBox(req.query.bbox) : null;
        if (!bbox) {
          res.status(400).json({ error: 'bbox must be w,s,e,n with -180 ≤ w,e ≤ 180 and -90 ≤ s < n ≤ 90' });
          return;
        }
      }
      const budget = roundDown(req.query.budget, BUDGETS, DEFAULT_BUDGET);
      const freshCap = roundDown(req.query.fresh, FRESH_CAPS, DEFAULT_FRESH);
      if (budget === null || freshCap === null) {
        res.status(400).json({ error: 'budget and fresh must be numbers' });
        return;
      }
      const got = await ctx.field.get(bbox, budget);
      if (!got) return busy(res);
      const now = ctx.now();
      const view = { ...got.result.view, degraded: got.degraded };
      // Assembled by hand so the (large, memoized) field JSON is serialized
      // once per bucket, not once per poll. Key order follows types.ts.
      const body =
        `{"v":1,"now":${now},"stageEndsS":${JSON.stringify(STAGE_ENDS_S)},"view":${JSON.stringify(view)}` +
        `,"field":${got.result.fieldJson},"fresh":${JSON.stringify(freshMarks(ctx.store, bbox, freshCap, now))}` +
        `,"status":${JSON.stringify(statusLite(ctx, now))}}`;
      res.type('application/json').send(body);
    })
  );

  router.get(
    '/near',
    withCtx(async (ctx, req, res) => {
      const lat = num(req.query.lat, NaN);
      const lon = num(req.query.lon, NaN);
      const radiusMi = num(req.query.radiusMi, 130);
      const hours = num(req.query.hours, 24);
      const maxPoints = num(req.query.maxPoints, 6_000);
      if (
        lat === null || lon === null || !(Math.abs(lat) <= 90) || !(Math.abs(lon) <= 180) ||
        radiusMi === null || !(radiusMi > 0) || hours === null || !(hours > 0) ||
        maxPoints === null || !(maxPoints >= 1)
      ) {
        res.status(400).json({ error: 'lat, lon required; radiusMi, hours, maxPoints must be positive numbers' });
        return;
      }
      const q = {
        lat: round3(lat),
        lon: round3(lon),
        radiusMi: Math.min(500, radiusMi),
        hours: Math.min(24, hours),
        maxPoints: Math.min(20_000, Math.floor(maxPoints)),
      };
      const r = await ctx.near.get(q);
      const now = ctx.now();
      const c = ctx.collector.status(now);
      res.json({
        ...r,
        fidelity: fidelity(ctx),
        coverage: coverage(ctx, now, Math.max(1, Math.round(q.hours * 60)), c),
        collector: collectorLite(c, now),
      });
    })
  );

  router.get(
    '/status',
    withCtx(async (ctx, _req, res) => {
      res.json(statusFull(ctx, ctx.now()));
    })
  );

  router.get(
    '/debug',
    withCtx(async (ctx, _req, res) => {
      res.json(debugInfo(ctx, ctx.now(), ctx.debugExtra?.() ?? {}));
    })
  );

  // LEGACY: GET /api/lightning?minutes=60[&lat&lon&radiusMi]. The shape is
  // frozen — {lat[], lon[], t[] (epoch s), windowMin, totalInWindow, returned,
  // thinned, coverageMin, connected, updated (epoch s)} — because bundles
  // loaded before this release keep polling it until someone reloads the page.
  router.get(
    '/',
    withCtx(async (ctx, req, res) => {
      const m = num(req.query.minutes, 60);
      if (m === null) {
        res.status(400).json({ error: 'minutes must be a number' });
        return;
      }
      const minutes = Math.min(1_440, Math.max(1, Math.round(m)));
      const anyNear = req.query.lat !== undefined || req.query.lon !== undefined || req.query.radiusMi !== undefined;
      const lat = num(req.query.lat, NaN);
      const lon = num(req.query.lon, NaN);
      const rad = num(req.query.radiusMi, NaN);
      if (anyNear && !(lat !== null && lon !== null && rad !== null && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && rad > 0)) {
        res.status(400).json({ error: 'lat, lon and radiusMi must be given together and be valid' });
        return;
      }

      let outLat: number[];
      let outLon: number[];
      let outT: number[];
      let totalInWindow: number;
      let thinned: boolean;
      if (anyNear) {
        const r = await ctx.near.get({
          lat: round3(lat!),
          lon: round3(lon!),
          radiusMi: Math.min(500, rad!),
          hours: minutes / 60,
          maxPoints: 20_000,
        });
        outLat = r.points.lat.map(round3);
        outLon = r.points.lon.map(round3);
        outT = r.points.t.map((t) => Math.round(t));
        totalInWindow = r.counts.inRadius;
        thinned = r.points.sampled || !r.counts.exact;
      } else {
        const got = await ctx.field.get(null, 20_000);
        if (!got) return busy(res);
        const now = ctx.now();
        const cutTick = Math.floor((now - minutes * 60_000) / 10);
        const f = got.result.field;
        outLat = [];
        outLon = [];
        outT = [];
        let tick = f.tick0;
        for (let i = 0; i < f.dt.length; i++) {
          tick += f.dt[i];
          if (tick < cutTick) continue;
          outLat.push(round3(dqLat(f.la[i])));
          outLon.push(round3(dqLon(f.lo[i])));
          outT.push(Math.round(tick / 100));
        }
        totalInWindow = ctx.store.countsWindow(now, minutes).sum;
        thinned = true;
      }
      const now = ctx.now();
      const c = ctx.collector.status(now);
      res.json({
        lat: outLat,
        lon: outLon,
        t: outT,
        windowMin: minutes,
        totalInWindow,
        returned: outLat.length,
        thinned,
        coverageMin: coverage(ctx, now, minutes, c).coveredMin,
        connected: c.connected,
        updated: Math.round(now / 1000),
      });
    })
  );

  return router;
}
