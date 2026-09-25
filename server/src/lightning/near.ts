// Strikes near a location: exact counts, the nearest strike and map points.
// This is what the risk report reads, so the counts are computed over every
// stored strike before any thinning (the old route strided the points and then
// presented the thinned count as the truth). "Every stored strike" is the
// catch: records the memory cap evicted are not counted, so `exact` is false
// and the route's coverage leaves that time out when the window reaches it.
//
// The scan rejects cheaply before the trig: a quantized latitude band, then a
// longitude window that is exact for a spherical cap (|Δλ| ≤ asin(sin δ / cos φ))
// and wraps across the antimeridian, then haversineMi on the survivors.

import { RETENTION_MS } from './constants';
import { MarkList } from './marks';
import { QMAX, dqLat, dqLon, haversineMi, qLat, qLon, strikeHash } from './quant';
import { scanSnapshot, slicer } from './scan';
import type { StrikeStore } from './store';
import type { LightningNearResponse } from './types';

export interface NearQuery {
  lat: number;
  lon: number;
  /** ≤ 500 */
  radiusMi: number;
  /** ≤ 24 */
  hours: number;
  /** ≤ 20000 */
  maxPoints: number;
  /**
   * Thin by strike hash (a spatially unbiased sample, so inRadius / returned
   * scales a count of returned points) instead of newest-per-cell. For the
   * legacy route: the bundles it serves scale counts that way.
   */
  uniform?: boolean;
}

export type NearResult = Pick<
  LightningNearResponse,
  'v' | 'now' | 'lat' | 'lon' | 'radiusMi' | 'hours' | 'counts' | 'nearest' | 'points'
>;

const EARTH_MI = 3958.7613;
/** Thinning ladder (degrees): the newest strike per cell, at the finest level that fits maxPoints. */
const THIN_DEG = [0.02, 0.05, 0.1, 0.2, 0.4];
const round5 = (v: number): number => Math.round(v * 1e5) / 1e5;

/** Quantized longitude window of a cap (lonMin..lonMax, wrapping when wrap). */
function lonWindow(lat: number, lon: number, deltaRad: number): { lonMin: number; lonMax: number; wrap: boolean } {
  const all = { lonMin: 0, lonMax: QMAX, wrap: false };
  const phi = (lat * Math.PI) / 180;
  if (Math.abs(phi) + deltaRad >= Math.PI / 2) return all; // the cap reaches a pole
  const dLon = (Math.asin(Math.min(1, Math.sin(deltaRad) / Math.cos(phi))) * 180) / Math.PI + 1e-6;
  if (dLon >= 180) return all;
  let w = lon - dLon;
  let e = lon + dLon;
  if (w < -180) w += 360;
  if (e > 180) e -= 360;
  // One quantization step of slack each side: a stored point's dequantized
  // position is what the distance test uses.
  const lonMin = Math.max(0, qLon(w) - 1);
  const lonMax = Math.min(QMAX, qLon(e) + 1);
  return { lonMin, lonMax, wrap: w > e };
}

/**
 * Near query over the store. counts/nearest cover every record in the radius
 * and window; points are thinned only when they exceed maxPoints (the nearest
 * is always included). `exact` is false when the window holds a minute of
 * pre-upgrade (×6) history (the per-minute ring's flag) or reaches evicted time.
 */
export async function near(
  store: StrikeStore,
  q: NearQuery,
  now: number,
  fidelity: { evictedBeforeMs: number | null }
): Promise<NearResult> {
  const nowTick = Math.floor(now / 10);
  const winTicks = Math.min(RETENTION_MS / 10, Math.round(q.hours * 360_000));
  const winStartMs = now - winTicks * 10;
  const deltaRad = q.radiusMi / EARTH_MI;
  const dLatDeg = (deltaRad * 180) / Math.PI;
  const latMin = Math.max(0, qLat(q.lat - dLatDeg) - 1);
  const latMax = Math.min(QMAX, qLat(q.lat + dLatDeg) + 1);
  const { lonMin, lonMax, wrap } = lonWindow(q.lat, q.lon, deltaRad);
  const r = q.radiusMi;

  let le5 = 0;
  let le25 = 0;
  let le100 = 0;
  let inRadius = 0;
  let sawLegacy = false;
  const pts = new MarkList(1_024);
  let nearestD = Infinity;
  let nearestI = -1;

  const snap = store.snapshot();
  try {
    await scanSnapshot(
      snap,
      (words, n, weight, baseTick) => {
        for (let i = 0; i < n; i++) {
          const lo = words[2 * i];
          const latQ = lo & 0xfffff;
          if (latQ < latMin || latQ > latMax) continue;
          const hi = words[2 * i + 1];
          const lonQ = hi & 0xfffff;
          if (wrap ? lonQ < lonMin && lonQ > lonMax : lonQ < lonMin || lonQ > lonMax) continue;
          const tick = baseTick + ((lo >>> 20) | ((hi >>> 20) << 12));
          if (nowTick - tick >= winTicks) continue;
          const d = haversineMi(q.lat, q.lon, dqLat(latQ), dqLon(lonQ));
          if (d > r) continue;
          inRadius += weight;
          if (d <= 100) le100 += weight;
          if (d <= 25) le25 += weight;
          if (d <= 5) le5 += weight;
          if (weight !== 1) sawLegacy = true;
          pts.push(tick, latQ, lonQ);
          const k = pts.n - 1;
          // Nearest: smallest distance, then newest, then identity — never storage order.
          if (d < nearestD || (d === nearestD && pts.cmp(k, nearestI) > 0)) {
            nearestD = d;
            nearestI = k;
          }
        }
      },
      (s) => s.seg.maxTick > nowTick - winTicks
    );
  } finally {
    snap.release();
  }

  // --- Points: everything when it fits, else the newest per cell at the finest level that fits.
  let kept: number[];
  let sampled = false;
  if (pts.n <= q.maxPoints) {
    kept = Array.from({ length: pts.n }, (_, i) => i);
  } else {
    sampled = true;
    kept = q.uniform ? await hashSample(pts, q.maxPoints, nearestI) : await thin(pts, q.maxPoints);
    if (nearestI >= 0 && !kept.includes(nearestI)) {
      if (kept.length >= q.maxPoints) {
        // Make room by dropping the oldest other point.
        let oldest = 0;
        for (let k = 1; k < kept.length; k++) if (pts.cmp(kept[k], kept[oldest]) < 0) oldest = k;
        kept.splice(oldest, 1);
      }
      kept.push(nearestI);
    }
  }
  kept.sort((a, b) => pts.cmp(a, b));
  const lat = new Array<number>(kept.length);
  const lon = new Array<number>(kept.length);
  const t = new Array<number>(kept.length);
  for (let k = 0; k < kept.length; k++) {
    const i = kept[k];
    lat[k] = round5(dqLat(pts.la[i]));
    lon[k] = round5(dqLon(pts.lo[i]));
    t[k] = pts.tick[i] / 100;
  }

  const exact =
    !sawLegacy &&
    !store.countsWindow(now, winTicks / 6_000).legacy &&
    !(fidelity.evictedBeforeMs !== null && fidelity.evictedBeforeMs > winStartMs);

  return {
    v: 1,
    now,
    lat: q.lat,
    lon: q.lon,
    radiusMi: q.radiusMi,
    hours: q.hours,
    counts: { le5, le25, le100, inRadius, exact },
    nearest:
      nearestI < 0
        ? null
        : {
            mi: Math.round(nearestD * 100) / 100,
            ageS: Math.max(0, Math.round((now - pts.tick[nearestI] * 10) / 1000)),
            lat: round5(dqLat(pts.la[nearestI])),
            lon: round5(dqLon(pts.lo[nearestI])),
          },
    points: { lat, lon, t, sampled },
  };
}

/**
 * The newest point per cell at the finest THIN_DEG level with ≤ maxPoints
 * cells. A level is abandoned as soon as it exceeds maxPoints cells, so the
 * maps stay small; the last level runs to completion and, if it still does not
 * fit, keeps the newest maxPoints. Sliced so a huge radius cannot block.
 */
async function thin(pts: MarkList, maxPoints: number): Promise<number[]> {
  const sl = slicer();
  for (let li = 0; li < THIN_DEG.length; li++) {
    const c = THIN_DEG[li];
    const last = li === THIN_DEG.length - 1;
    const cols = Math.ceil(360 / c) + 1;
    const cells = new Map<number, number>();
    let fits = true;
    for (let i = 0; i < pts.n; i++) {
      const y = sl.tick();
      if (y) await y;
      const cell =
        Math.floor((dqLat(pts.la[i]) + 90) / c) * cols + Math.floor((dqLon(pts.lo[i]) + 180) / c);
      const j = cells.get(cell);
      if (j === undefined) {
        if (!last && cells.size >= maxPoints) {
          fits = false;
          break;
        }
        cells.set(cell, i);
      } else if (pts.cmp(i, j) > 0) {
        cells.set(cell, i);
      }
    }
    if (!fits) continue;
    let kept = [...cells.values()];
    if (kept.length > maxPoints) kept = kept.sort((a, b) => pts.cmp(b, a)).slice(0, maxPoints);
    return kept;
  }
  return [];
}

/**
 * Every point whose strike hash is below the largest 2^16-wide edge that
 * leaves room for the nearest, plus the nearest: whether a strike is kept
 * does not depend on where it is, so a count of kept points scales by
 * inRadius / returned (minus the one forced-in nearest).
 */
async function hashSample(pts: MarkList, maxPoints: number, nearestI: number): Promise<number[]> {
  const sl = slicer();
  const hs = new Uint32Array(pts.n);
  const hist = new Uint32Array(65_536);
  for (let i = 0; i < pts.n; i++) {
    const y = sl.tick();
    if (y) await y;
    hs[i] = strikeHash(pts.tick[i], pts.la[i], pts.lo[i]);
    hist[hs[i] >>> 16]++;
  }
  const room = nearestI >= 0 ? maxPoints - 1 : maxPoints;
  let k = 0;
  let sum = 0;
  while (k < hist.length && sum + hist[k] <= room) sum += hist[k++];
  const edge = k * 65_536;
  const kept: number[] = [];
  for (let i = 0; i < pts.n; i++) if (hs[i] < edge) kept.push(i);
  return kept;
}

const NEAR_MEMO_MS = 30_000;
const NEAR_MEMO_KEYS = 128;

/**
 * 30 s memo + single flight per (location, radius, window, maxPoints, thinning).
 * Nothing is memoized while `cacheable` is false (history still restoring: the
 * next request may see much more), and clear() — called when the restore
 * finishes and after each catch-up — also drops scans already running, so a
 * count taken before new history arrived is never served after it.
 */
export class NearService {
  private memo = new Map<string, { at: number; result: NearResult }>();
  private inflight = new Map<string, Promise<NearResult>>();
  private generation = 0;

  constructor(
    private store: StrikeStore,
    private fidelity: () => { evictedBeforeMs: number | null },
    private now: () => number = Date.now,
    private cacheable: () => boolean = () => true
  ) {}

  async get(q: NearQuery): Promise<NearResult> {
    const key = `${q.lat.toFixed(3)},${q.lon.toFixed(3)},${q.radiusMi},${q.hours},${q.maxPoints}${q.uniform ? ',u' : ''}`;
    const now = this.now();
    const m = this.memo.get(key);
    if (m && now - m.at < NEAR_MEMO_MS) return m.result;
    let p = this.inflight.get(key);
    if (!p) {
      const gen = this.generation;
      const memoize = this.cacheable();
      const run: Promise<NearResult> = near(this.store, q, now, this.fidelity()).finally(() => {
        if (this.inflight.get(key) === run) this.inflight.delete(key);
      });
      p = run;
      this.inflight.set(key, p);
      const result = await p;
      if (memoize && gen === this.generation) {
        for (const [k, v] of this.memo) if (now - v.at >= NEAR_MEMO_MS) this.memo.delete(k);
        if (this.memo.size >= NEAR_MEMO_KEYS) this.memo.delete(this.memo.keys().next().value as string);
        this.memo.set(key, { at: now, result });
      }
      return result;
    }
    return p;
  }

  /** Forget every result (and scan in flight): the history changed, or memory is short. */
  clear(): void {
    this.memo.clear();
    this.inflight.clear();
    this.generation++;
  }
}
