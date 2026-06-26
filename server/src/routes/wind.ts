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
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`);
  const data = (await res.json()) as OmResult[] | OmResult;
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

export default router;
