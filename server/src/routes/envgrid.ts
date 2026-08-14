import { Router } from 'express';
import { pool } from '../db';

// ── Multi-field environmental grid (roadmap Track 4) ─────────────────────────
// Regional CONUS grid of surface temperature, relative humidity, and MSL
// pressure for the isobar/RH/temp overlays. The global wind grid's 5° spacing
// can't contour acceptably; this uses 1.25° over CONUS (~1,150 points, 3
// Open-Meteo batch calls) — dense enough for smooth marching-squares isobars
// after client-side bilinear interpolation, small enough to stay friendly to
// the shared per-IP quota alongside the wind grid's refresh.
//
// Same always-available pattern as the wind route: background refresh, the
// last live grid persisted in the snapshots table so a deploy restarts with
// data, and requests served instantly from the best grid we hold.

const router = Router();

const TTL_MS = 60 * 60 * 1000; // pressure/temp/RH evolve slowly — hourly is plenty

// CONUS with a margin so contours don't clip at the borders.
const LON0 = -126;
const LAT0 = 23;
const DLON = 1.25;
const DLAT = 1.25;
const NX = 50; // -126 … -64.75
const NY = 23; //   23 … 50.5

const BATCH = 500; // same URL-length bound as the wind grid

export interface EnvGrid {
  nx: number;
  ny: number;
  lon0: number;
  lat0: number;
  dLon: number;
  dLat: number;
  /** Row-major, south→north rows, west→east columns. null = point missing. */
  tempC: (number | null)[];
  rhPct: (number | null)[];
  mslHpa: (number | null)[];
  updated: number;
  stale?: boolean;
}

interface OmCurrent {
  current?: {
    temperature_2m?: number;
    relative_humidity_2m?: number;
    pressure_msl?: number;
  };
}

async function fetchJsonWithRetry(url: string, attempts = 3, timeoutMs = 8_000): Promise<unknown> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
      if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
      return await res.json();
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, 400 * (i + 1)));
    }
  }
  throw lastErr;
}

function gridPoints(): Array<{ lat: number; lon: number }> {
  const pts: Array<{ lat: number; lon: number }> = [];
  for (let r = 0; r < NY; r++) {
    for (let c = 0; c < NX; c++) {
      pts.push({ lat: LAT0 + r * DLAT, lon: LON0 + c * DLON });
    }
  }
  return pts;
}

async function fetchBatch(batch: Array<{ lat: number; lon: number }>): Promise<OmCurrent[]> {
  const lat = batch.map((p) => p.lat).join(',');
  const lon = batch.map((p) => p.lon).join(',');
  const url =
    `https://api.open-meteo.com/v1/gfs?latitude=${lat}&longitude=${lon}` +
    `&current=temperature_2m,relative_humidity_2m,pressure_msl`;
  const data = (await fetchJsonWithRetry(url)) as OmCurrent[] | OmCurrent;
  return Array.isArray(data) ? data : [data];
}

async function fetchEnvGrid(): Promise<EnvGrid> {
  const pts = gridPoints();
  const tempC = new Array<number | null>(pts.length).fill(null);
  const rhPct = new Array<number | null>(pts.length).fill(null);
  const mslHpa = new Array<number | null>(pts.length).fill(null);

  const batches: Array<{ start: number; pts: Array<{ lat: number; lon: number }> }> = [];
  for (let i = 0; i < pts.length; i += BATCH) {
    batches.push({ start: i, pts: pts.slice(i, i + BATCH) });
  }
  const results = await Promise.all(batches.map((b) => fetchBatch(b.pts)));

  batches.forEach((b, bi) => {
    const arr = results[bi];
    for (let j = 0; j < b.pts.length; j++) {
      const cur = arr[j]?.current;
      if (!cur) continue;
      const i = b.start + j;
      if (typeof cur.temperature_2m === 'number') tempC[i] = cur.temperature_2m;
      if (typeof cur.relative_humidity_2m === 'number') rhPct[i] = cur.relative_humidity_2m;
      if (typeof cur.pressure_msl === 'number') mslHpa[i] = cur.pressure_msl;
    }
  });

  return { nx: NX, ny: NY, lon0: LON0, lat0: LAT0, dLon: DLON, dLat: DLAT, tempC, rhPct, mslHpa, updated: Date.now() };
}

const SNAPSHOT_KEY = 'env-grid';

let latestGrid: EnvGrid | null = null;
let liveAt = 0;
let refreshing = false;

async function loadSnapshot(attempts = 5): Promise<void> {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const { rows } = await pool.query<{ data: EnvGrid }>(
        'SELECT data FROM snapshots WHERE key = $1',
        [SNAPSHOT_KEY]
      );
      const grid = rows[0]?.data;
      if (grid?.tempC?.length && (!latestGrid || grid.updated > latestGrid.updated)) {
        latestGrid = grid;
        console.log(`[envgrid] restored grid from snapshot (${Math.round((Date.now() - grid.updated) / 60_000)} min old)`);
      }
      return;
    } catch (err) {
      if (attempt >= attempts) {
        console.warn('[envgrid] snapshot load failed:', err instanceof Error ? err.message : err);
        return;
      }
      await new Promise((r) => setTimeout(r, 3_000));
    }
  }
}

async function refresh(): Promise<void> {
  if (refreshing) return;
  refreshing = true;
  try {
    const grid = await fetchEnvGrid();
    latestGrid = grid;
    liveAt = Date.now();
    pool
      .query(
        `INSERT INTO snapshots (key, data) VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
        [SNAPSHOT_KEY, JSON.stringify(grid)]
      )
      .catch((err) => console.warn('[envgrid] snapshot save failed:', err instanceof Error ? err.message : err));
  } catch (err) {
    console.error('[envgrid] refresh failed (serving last good):', err instanceof Error ? err.message : err);
  } finally {
    refreshing = false;
  }
}

export function initEnvGrid(): void {
  void loadSnapshot();
  void refresh();
  setInterval(() => void refresh(), TTL_MS).unref();
}

let body: { grid: EnvGrid; stale: boolean; buf: Buffer } | null = null;

router.get('/', (_req, res) => {
  const grid = latestGrid;
  if (!grid) {
    // No baked fallback (unlike wind — a blank env overlay is not a broken
    // page); the layer shows "still fetching" and retries.
    if (!refreshing) void refresh();
    res.status(503).json({ error: 'Environmental grid not yet available' });
    return;
  }
  const fresh = Date.now() - liveAt < TTL_MS * 1.5;
  if (!fresh) void refresh();
  if (!body || body.grid !== grid || body.stale !== !fresh) {
    body = { grid, stale: !fresh, buf: Buffer.from(JSON.stringify({ ...grid, stale: !fresh })) };
  }
  res.type('application/json').send(body.buf);
});

export default router;
