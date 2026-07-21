import { Router } from 'express';
import { cache } from '../cache';
import { pool } from '../db';
import { WIND_FALLBACK } from '../data/windFallback';

const router = Router();

// Surface wind changes slowly; a 30-minute cache keeps the upstream load to a
// handful of calls per hour while the animation always has a field to advect.
const TTL_MS = 30 * 60 * 1000;

// Global sampling grid. 5° spacing is coarse, but the client advects thousands
// of particles through a *bilinearly interpolated* field, so the large-scale
// flow (trade winds, the westerlies, the jet) reads as smooth streamlines
// without the cost of a dense GFS download. Poles are trimmed to ±80° — GFS gets
// noisy there and the 1/cos(lat) longitude blow-up makes particles unstable.
const LON0 = -180;
const LAT0 = -80;
const NX = 72; // columns: -180 … +175 in 5° steps (col NX wraps to col 0)
const NY = 33; // rows:    -80 … +80  in 5° steps
const DLON = 5;
const DLAT = 5;

// Open-Meteo encodes every coordinate into the query string, so each call is
// bounded by the server's ~8 KB URI limit (1200 points → HTTP 414). 500 points
// per request keeps the URL near 4 KB with comfortable headroom.
const BATCH = 500;

// Open-Meteo occasionally stalls or returns a transient 5xx/429. Without a
// timeout a hung request blocks until the platform's router kills it (a 30s
// H12 on Heroku); without a retry a single blip fails the whole call. For a
// freshly-dropped probe there's no cached value to fall back on, so that blip
// surfaces to the user as "Forecast unavailable". A couple of quick retries
// with a short backoff turns most one-off failures into a clean fetch. Worst
// case (all attempts time out) stays comfortably under 30s.
async function fetchJsonWithRetry(
  url: string,
  attempts = 3,
  timeoutMs = 8_000,
  headers?: Record<string, string>
): Promise<unknown> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), headers });
      if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
      return await res.json();
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, 400 * (i + 1)));
    }
  }
  throw lastErr;
}

// Row-major (row = latitude south→north, col = longitude west→east), u/v in m/s.
export interface WindGrid {
  nx: number;
  ny: number;
  lon0: number;
  lat0: number;
  dLon: number;
  dLat: number;
  u: number[]; // eastward component, m/s
  v: number[]; // northward component, m/s
  speedMax: number;
  updated: number;
  stale?: boolean; // true when served from snapshot/fallback, not a live fetch
}

interface OmResult {
  current?: { wind_speed_10m?: number; wind_direction_10m?: number };
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

// Fetch current 10 m wind for a batch of points in one Open-Meteo call. Results
// come back in request order; a single-point request returns an object rather
// than an array, so normalize to an array.
async function fetchBatch(batch: Array<{ lat: number; lon: number }>): Promise<OmResult[]> {
  const lat = batch.map((p) => p.lat).join(',');
  const lon = batch.map((p) => p.lon).join(',');
  const url =
    `https://api.open-meteo.com/v1/gfs?latitude=${lat}&longitude=${lon}` +
    `&current=wind_speed_10m,wind_direction_10m&wind_speed_unit=ms`;
  const data = (await fetchJsonWithRetry(url)) as OmResult[] | OmResult;
  return Array.isArray(data) ? data : [data];
}

async function fetchWind(): Promise<WindGrid> {
  const pts = gridPoints(); // length NX*NY, index = row*NX + col
  const u = new Array<number>(pts.length).fill(0);
  const v = new Array<number>(pts.length).fill(0);

  const batches: Array<{ start: number; pts: Array<{ lat: number; lon: number }> }> = [];
  for (let i = 0; i < pts.length; i += BATCH) {
    batches.push({ start: i, pts: pts.slice(i, i + BATCH) });
  }

  const results = await Promise.all(batches.map((b) => fetchBatch(b.pts)));

  let speedMax = 0;
  batches.forEach((b, bi) => {
    const arr = results[bi];
    for (let j = 0; j < b.pts.length; j++) {
      const cur = arr[j]?.current;
      const spd = cur?.wind_speed_10m;
      const dir = cur?.wind_direction_10m;
      if (typeof spd !== 'number' || typeof dir !== 'number') continue;
      // wind_direction is the meteorological "from" bearing; the velocity vector
      // points the opposite way: a north wind (0°) blows toward the south.
      const r = (dir * Math.PI) / 180;
      u[b.start + j] = -spd * Math.sin(r);
      v[b.start + j] = -spd * Math.cos(r);
      if (spd > speedMax) speedMax = spd;
    }
  });

  return {
    nx: NX,
    ny: NY,
    lon0: LON0,
    lat0: LAT0,
    dLon: DLON,
    dLat: DLAT,
    u,
    v,
    speedMax,
    updated: Date.now(),
  };
}

// --- Always-available grid (live → Postgres snapshot → baked-in fallback) ----
// Open-Meteo rate-limits shared (Heroku) IPs, so the grid fetch can fail —
// especially on a fresh dyno with no cached value, which surfaced to users as
// "may be slow to fetch". Like the rivers route, the grid fetch runs in the
// BACKGROUND and the request is served instantly from the best value we have.
// The last live grid is upserted into Postgres (the dyno filesystem is wiped on
// every deploy, so a disk snapshot only survived same-dyno restarts) — after a
// deploy the layer comes back with the most recent real wind, typically ≤30 min
// old, and the committed baked-in grid remains the guaranteed floor.
const SNAPSHOT_KEY = 'wind-grid';

let latestGrid: WindGrid | null = null; // freshest grid we hold
let liveAt = 0; // when latestGrid was fetched live (0 = from snapshot/never)
let refreshing = false;

// Restore the last live grid from Postgres. Retries briefly because boot-time
// migration may still be creating the table; never overwrites a grid that a
// faster live fetch already produced (compares `updated`).
async function loadWindSnapshot(attempts = 5): Promise<void> {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const { rows } = await pool.query<{ data: WindGrid }>(
        'SELECT data FROM snapshots WHERE key = $1',
        [SNAPSHOT_KEY]
      );
      const grid = rows[0]?.data;
      if (grid?.u?.length && (!latestGrid || grid.updated > latestGrid.updated)) {
        latestGrid = grid;
        console.log(`[wind] restored grid from snapshot (${Math.round((Date.now() - grid.updated) / 60_000)} min old)`);
      }
      return;
    } catch (err) {
      if (attempt >= attempts) {
        console.warn('[wind] snapshot load failed — baked-in fallback covers it:', err instanceof Error ? err.message : err);
        return;
      }
      await new Promise((r) => setTimeout(r, 3_000));
    }
  }
}

async function refreshWind(): Promise<void> {
  if (refreshing) return;
  refreshing = true;
  try {
    const grid = await fetchWind();
    latestGrid = grid;
    liveAt = Date.now();
    pool
      .query(
        `INSERT INTO snapshots (key, data) VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
        [SNAPSHOT_KEY, JSON.stringify(grid)]
      )
      .catch((err) => console.warn('[wind] snapshot save failed:', err instanceof Error ? err.message : err));
  } catch (err) {
    console.error('[wind] refresh failed (serving last good/fallback):', err instanceof Error ? err.message : err);
  } finally {
    refreshing = false;
  }
}

export function initWindStream(): void {
  // Run the DB restore and the live fetch concurrently — whichever lands first
  // serves; loadWindSnapshot only applies if it's newer than what we hold.
  void loadWindSnapshot();
  void refreshWind();
  setInterval(() => void refreshWind(), TTL_MS);
}

router.get('/', (_req, res) => {
  const grid = latestGrid ?? WIND_FALLBACK;
  // "Fresh" only if we actually fetched a live grid within ~1.5 TTLs.
  const fresh = latestGrid != null && Date.now() - liveAt < TTL_MS * 1.5;
  if (!fresh) void refreshWind(); // nudge a background refresh, never block
  res.json({ ...grid, stale: !fresh });
});

// --- Point forecast ---------------------------------------------------------
// A per-point wind forecast for a dropped wind probe: hourly speed/direction/
// gusts for the week ahead plus a daily rollup. Primary source is the same NOAA
// GFS model as the animated grid, via Open-Meteo — but the grid refresh samples
// thousands of points from this dyno's IP, which can exhaust Open-Meteo's
// per-IP quota and leave every probe 502ing with nothing cached to fall back
// on. MET Norway's locationforecast (global, keyless, a completely separate
// host/quota) is the fallback provider, so a probe still gets a real forecast
// while Open-Meteo is rate-limiting us. Speeds stay in m/s; the client converts
// for display.

const FORECAST_TTL_MS = 30 * 60 * 1000;

export interface WindForecast {
  latitude: number;
  longitude: number;
  timezone: string;
  timezoneAbbr: string;
  utcOffsetSeconds: number;
  // Hourly arrays are parallel: time[i] (local ISO) ↔ speed/dir/gust[i].
  hourly: { time: string[]; speed: number[]; dir: number[]; gust: number[] };
  daily: { time: string[]; speedMax: number[]; gustMax: number[]; dirDominant: number[] };
  updated: number;
  source: string; // human-readable attribution for the panel footer
  fallback?: boolean; // true when served by the backup provider (met.no)
}

interface OmForecast {
  latitude: number;
  longitude: number;
  timezone?: string;
  timezone_abbreviation?: string;
  utc_offset_seconds?: number;
  hourly?: {
    time: string[];
    wind_speed_10m: number[];
    wind_direction_10m: number[];
    wind_gusts_10m: number[];
  };
  daily?: {
    time: string[];
    wind_speed_10m_max: number[];
    wind_gusts_10m_max: number[];
    wind_direction_10m_dominant: number[];
  };
}

async function fetchForecastOpenMeteo(lat: number, lon: number): Promise<WindForecast> {
  const url =
    `https://api.open-meteo.com/v1/gfs?latitude=${lat}&longitude=${lon}` +
    `&hourly=wind_speed_10m,wind_direction_10m,wind_gusts_10m` +
    `&daily=wind_speed_10m_max,wind_gusts_10m_max,wind_direction_10m_dominant` +
    `&wind_speed_unit=ms&forecast_days=7&timezone=auto`;
  // Only 2 quick attempts here (not the default 3): when Open-Meteo is
  // rate-limiting this IP the answer is an instant 429 anyway, and the met.no
  // fallback still has to fit in the same ~30s response window.
  const d = (await fetchJsonWithRetry(url, 2, 6_000)) as OmForecast;
  const h = d.hourly;
  const dy = d.daily;
  if (!h || !dy) throw new Error('Open-Meteo: missing forecast fields');
  return {
    latitude: d.latitude,
    longitude: d.longitude,
    timezone: d.timezone ?? 'GMT',
    timezoneAbbr: d.timezone_abbreviation ?? 'GMT',
    utcOffsetSeconds: d.utc_offset_seconds ?? 0,
    hourly: {
      time: h.time,
      speed: h.wind_speed_10m,
      dir: h.wind_direction_10m,
      gust: h.wind_gusts_10m,
    },
    daily: {
      time: dy.time,
      speedMax: dy.wind_speed_10m_max,
      gustMax: dy.wind_gusts_10m_max,
      dirDominant: dy.wind_direction_10m_dominant,
    },
    updated: Date.now(),
    source: 'NOAA GFS · Open-Meteo',
  };
}

// --- Backup provider: MET Norway locationforecast ---------------------------
// Global coverage, no API key (just a descriptive User-Agent, per their terms).
// The timeseries is hourly for roughly the first 2½ days, then 6-hourly out to
// ~9 days — hourly entries feed the chart, and the daily rollup is computed
// from the whole series. met.no gives no timezone, so local time is
// approximated from longitude (15°/hour) and labeled as such in the UI.

interface MetNoSeries {
  time: string; // UTC ISO
  data?: {
    instant?: {
      details?: {
        wind_speed?: number;
        wind_from_direction?: number;
        wind_speed_of_gust?: number;
      };
    };
  };
}

interface MetNoForecast {
  properties?: { timeseries?: MetNoSeries[] };
}

async function fetchForecastMetNo(lat: number, lon: number): Promise<WindForecast> {
  const url =
    `https://api.met.no/weatherapi/locationforecast/2.0/complete` +
    `?lat=${lat}&lon=${lon}`;
  const d = (await fetchJsonWithRetry(url, 2, 6_000, {
    'user-agent': 'gsoc-monitor/0.1 github.com/alecbibat/gsoc-monitor',
  })) as MetNoForecast;

  const series = d.properties?.timeseries ?? [];
  const pts: Array<{ ms: number; speed: number; dir: number; gust: number }> = [];
  for (const s of series) {
    const det = s.data?.instant?.details;
    const ms = Date.parse(s.time);
    if (!det || !Number.isFinite(ms)) continue;
    const { wind_speed: speed, wind_from_direction: dir, wind_speed_of_gust: gust } = det;
    if (typeof speed !== 'number' || typeof dir !== 'number') continue;
    // Long-range entries drop the gust field; treat gust = sustained there.
    pts.push({ ms, speed, dir, gust: typeof gust === 'number' ? gust : speed });
  }
  if (pts.length === 0) throw new Error('met.no: empty timeseries');
  pts.sort((a, b) => a.ms - b.ms);

  const offsetSeconds = Math.round(lon / 15) * 3600;
  const offsetH = offsetSeconds / 3600;
  const toLocalIso = (ms: number) =>
    new Date(ms + offsetSeconds * 1000).toISOString().slice(0, 16);

  // Hourly window: consecutive hourly-spaced entries from the start of the
  // series. Stop at the first gap so the chart's per-bar spacing stays honest.
  const hourly: WindForecast['hourly'] = { time: [], speed: [], dir: [], gust: [] };
  for (let i = 0; i < pts.length; i++) {
    if (i > 0 && pts[i].ms - pts[i - 1].ms > 3_600_000) break;
    hourly.time.push(toLocalIso(pts[i].ms));
    hourly.speed.push(pts[i].speed);
    hourly.dir.push(pts[i].dir);
    hourly.gust.push(pts[i].gust);
  }

  // Daily rollup over the full series (including the 6-hourly tail): max
  // sustained/gust per local calendar day, plus a speed-weighted mean "from"
  // vector as the dominant direction — same semantics as Open-Meteo's
  // wind_direction_10m_dominant.
  const byDay = new Map<string, { speedMax: number; gustMax: number; x: number; y: number }>();
  for (const p of pts) {
    const day = toLocalIso(p.ms).slice(0, 10);
    let d0 = byDay.get(day);
    if (!d0) {
      d0 = { speedMax: 0, gustMax: 0, x: 0, y: 0 };
      byDay.set(day, d0);
    }
    d0.speedMax = Math.max(d0.speedMax, p.speed);
    d0.gustMax = Math.max(d0.gustMax, p.gust);
    const r = (p.dir * Math.PI) / 180;
    d0.x += p.speed * Math.sin(r);
    d0.y += p.speed * Math.cos(r);
  }
  const daily: WindForecast['daily'] = { time: [], speedMax: [], gustMax: [], dirDominant: [] };
  for (const [day, v] of byDay) {
    if (daily.time.length >= 7) break;
    daily.time.push(day);
    daily.speedMax.push(v.speedMax);
    daily.gustMax.push(v.gustMax);
    daily.dirDominant.push(((Math.atan2(v.x, v.y) * 180) / Math.PI + 360) % 360);
  }

  return {
    latitude: lat,
    longitude: lon,
    timezone: `UTC${offsetH >= 0 ? '+' : ''}${offsetH}`,
    timezoneAbbr: 'approx',
    utcOffsetSeconds: offsetSeconds,
    hourly,
    daily,
    updated: Date.now(),
    source: 'MET Norway · locationforecast',
    fallback: true,
  };
}

// Provider selection with a simple circuit breaker: after an Open-Meteo
// failure, later probes skip straight to met.no for a few minutes instead of
// re-paying the failed attempts — but if met.no itself breaks during that
// window, Open-Meteo still gets a last-resort try (and a success resets the
// breaker).
const OM_COOLDOWN_MS = 10 * 60 * 1000;
let omFailedAt = 0;

async function fetchForecast(lat: number, lon: number): Promise<WindForecast> {
  const omCooling = Date.now() - omFailedAt < OM_COOLDOWN_MS;
  if (!omCooling) {
    try {
      return await fetchForecastOpenMeteo(lat, lon);
    } catch (err) {
      omFailedAt = Date.now();
      console.warn(
        '[wind] Open-Meteo forecast failed, falling back to met.no:',
        err instanceof Error ? err.message : err
      );
    }
    return fetchForecastMetNo(lat, lon);
  }
  try {
    return await fetchForecastMetNo(lat, lon);
  } catch (err) {
    console.warn(
      '[wind] met.no forecast failed during Open-Meteo cooldown, retrying Open-Meteo:',
      err instanceof Error ? err.message : err
    );
    const fc = await fetchForecastOpenMeteo(lat, lon);
    omFailedAt = 0;
    return fc;
  }
}

router.get('/forecast', async (req, res) => {
  const lat = Number(req.query.lat);
  const lon = Number(req.query.lon);
  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lon) ||
    lat < -90 ||
    lat > 90 ||
    lon < -180 ||
    lon > 180
  ) {
    res.status(400).json({ error: 'valid lat and lon query params required' });
    return;
  }
  // Round to ~0.1° (~11 km) so nearby probes share one cached upstream call
  // without smearing the forecast across noticeably different locations.
  const latR = Math.round(lat * 10) / 10;
  const lonR = Math.round(lon * 10) / 10;
  try {
    const data = await cache.getOrFetch<WindForecast>(
      `wind-fc:${latR},${lonR}`,
      FORECAST_TTL_MS,
      () => fetchForecast(latR, lonR),
      { staleOnError: true }
    );
    res.json(data);
  } catch (err) {
    console.error('Wind forecast route error', err);
    res.status(502).json({ error: 'Wind forecast unavailable' });
  }
});

export default router;
