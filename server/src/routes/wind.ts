import { Router } from 'express';
import { cache } from '../cache';

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
  timeoutMs = 8_000
): Promise<unknown> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
      if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`);
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

router.get('/', async (_req, res) => {
  try {
    const data = await cache.getOrFetch<WindGrid>('wind', TTL_MS, fetchWind, {
      staleOnError: true,
    });
    res.json(data);
  } catch (err) {
    console.error('Wind route error', err);
    res.status(502).json({ error: 'Wind feed unavailable' });
  }
});

// --- Point forecast ---------------------------------------------------------
// A per-point wind forecast for a dropped wind probe: hourly speed/direction/
// gusts for the week ahead plus a daily rollup. Sourced from the same NOAA GFS
// model as the animated grid, via Open-Meteo. Speeds stay in m/s; the client
// converts for display.

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

async function fetchForecast(lat: number, lon: number): Promise<WindForecast> {
  const url =
    `https://api.open-meteo.com/v1/gfs?latitude=${lat}&longitude=${lon}` +
    `&hourly=wind_speed_10m,wind_direction_10m,wind_gusts_10m` +
    `&daily=wind_speed_10m_max,wind_gusts_10m_max,wind_direction_10m_dominant` +
    `&wind_speed_unit=ms&forecast_days=7&timezone=auto`;
  const d = (await fetchJsonWithRetry(url)) as OmForecast;
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
  };
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
