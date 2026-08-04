import { Router } from 'express';
import { cache } from '../cache';
import { pool } from '../db';

const router = Router();

// IQAir AirVisual API key — free "Community" key from https://www.iqair.com/
// dashboard (10,000 calls/month, 500/day, ~5/min). Without it the layer is
// simply disabled and the route reports noKey so the sidebar can say why.
const IQAIR_KEY = process.env.IQAIR_API_KEY ?? '';

// --- Call budget -------------------------------------------------------------
// The community tier has no bulk endpoint — every city is one call — so the
// sweep below is engineered against the key's quota:
//   64 seed cities × 4 sweeps/day = 256 calls/day ≈ 7,700/month
// vs limits of 500/day and 10,000/month, leaving ~25% headroom for restarts.
// Calls are spaced 15 s apart (4/min) to stay under the ~5/min throttle, so a
// full sweep takes ~16 min. The finished snapshot is persisted to Postgres and
// restored on boot, so a deploy/restart resumes the schedule instead of
// re-spending a sweep.
const SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000;
const CALL_SPACING_MS = 15_000;
const RATE_BACKOFF_MS = 70_000; // one full minute-window + slack after a 429

// Seed coordinates swept through /v2/nearest_city, which snaps each to the
// closest city IQAir actually covers — no fragile (city, state, country) name
// matching, and results are deduped by the returned identity. Curated for
// global situational awareness: megacities + capitals across every region.
// Editing this list is the supported way to tune coverage; keep the budget
// math above in mind.
const CITY_SEEDS: Array<{ label: string; lat: number; lon: number }> = [
  // Americas
  { label: 'Los Angeles', lat: 34.05, lon: -118.24 },
  { label: 'San Francisco', lat: 37.77, lon: -122.42 },
  { label: 'Seattle', lat: 47.61, lon: -122.33 },
  { label: 'Denver', lat: 39.74, lon: -104.99 },
  { label: 'Chicago', lat: 41.88, lon: -87.63 },
  { label: 'Houston', lat: 29.76, lon: -95.37 },
  { label: 'New York', lat: 40.71, lon: -74.01 },
  { label: 'Miami', lat: 25.76, lon: -80.19 },
  { label: 'Toronto', lat: 43.65, lon: -79.38 },
  { label: 'Vancouver', lat: 49.28, lon: -123.12 },
  { label: 'Mexico City', lat: 19.43, lon: -99.13 },
  { label: 'Bogotá', lat: 4.71, lon: -74.07 },
  { label: 'Lima', lat: -12.05, lon: -77.04 },
  { label: 'Santiago', lat: -33.45, lon: -70.67 },
  { label: 'São Paulo', lat: -23.55, lon: -46.63 },
  { label: 'Buenos Aires', lat: -34.6, lon: -58.38 },
  // Europe
  { label: 'London', lat: 51.51, lon: -0.13 },
  { label: 'Paris', lat: 48.86, lon: 2.35 },
  { label: 'Madrid', lat: 40.42, lon: -3.7 },
  { label: 'Rome', lat: 41.9, lon: 12.5 },
  { label: 'Berlin', lat: 52.52, lon: 13.41 },
  { label: 'Amsterdam', lat: 52.37, lon: 4.9 },
  { label: 'Warsaw', lat: 52.23, lon: 21.01 },
  { label: 'Stockholm', lat: 59.33, lon: 18.07 },
  { label: 'Athens', lat: 37.98, lon: 23.73 },
  { label: 'Istanbul', lat: 41.01, lon: 28.98 },
  { label: 'Kyiv', lat: 50.45, lon: 30.52 },
  { label: 'Moscow', lat: 55.76, lon: 37.62 },
  // Africa
  { label: 'Cairo', lat: 30.04, lon: 31.24 },
  { label: 'Lagos', lat: 6.52, lon: 3.38 },
  { label: 'Dakar', lat: 14.72, lon: -17.47 },
  { label: 'Nairobi', lat: -1.29, lon: 36.82 },
  { label: 'Addis Ababa', lat: 9.01, lon: 38.75 },
  { label: 'Johannesburg', lat: -26.2, lon: 28.05 },
  { label: 'Casablanca', lat: 33.57, lon: -7.59 },
  { label: 'Kinshasa', lat: -4.44, lon: 15.27 },
  // Middle East
  { label: 'Dubai', lat: 25.2, lon: 55.27 },
  { label: 'Riyadh', lat: 24.71, lon: 46.68 },
  { label: 'Tel Aviv', lat: 32.09, lon: 34.78 },
  { label: 'Baghdad', lat: 33.31, lon: 44.36 },
  { label: 'Tehran', lat: 35.69, lon: 51.39 },
  { label: 'Kuwait City', lat: 29.38, lon: 47.99 },
  // South & Central Asia
  { label: 'Delhi', lat: 28.61, lon: 77.21 },
  { label: 'Mumbai', lat: 19.08, lon: 72.88 },
  { label: 'Kolkata', lat: 22.57, lon: 88.36 },
  { label: 'Karachi', lat: 24.86, lon: 67.01 },
  { label: 'Lahore', lat: 31.55, lon: 74.34 },
  { label: 'Dhaka', lat: 23.81, lon: 90.41 },
  { label: 'Kathmandu', lat: 27.72, lon: 85.32 },
  { label: 'Colombo', lat: 6.93, lon: 79.85 },
  { label: 'Almaty', lat: 43.24, lon: 76.89 },
  // East & Southeast Asia
  { label: 'Beijing', lat: 39.9, lon: 116.41 },
  { label: 'Shanghai', lat: 31.23, lon: 121.47 },
  { label: 'Chengdu', lat: 30.57, lon: 104.07 },
  { label: 'Hong Kong', lat: 22.32, lon: 114.17 },
  { label: 'Taipei', lat: 25.03, lon: 121.57 },
  { label: 'Seoul', lat: 37.57, lon: 126.98 },
  { label: 'Tokyo', lat: 35.68, lon: 139.69 },
  { label: 'Bangkok', lat: 13.76, lon: 100.5 },
  { label: 'Hanoi', lat: 21.03, lon: 105.85 },
  { label: 'Ho Chi Minh City', lat: 10.82, lon: 106.63 },
  { label: 'Manila', lat: 14.6, lon: 120.98 },
  { label: 'Jakarta', lat: -6.21, lon: 106.85 },
  { label: 'Singapore', lat: 1.35, lon: 103.82 },
  { label: 'Kuala Lumpur', lat: 3.14, lon: 101.69 },
  // Oceania
  { label: 'Sydney', lat: -33.87, lon: 151.21 },
];

// AirVisual pollutant codes → the display names the AQI panels already use.
const POLLUTANT_NAME: Record<string, string> = {
  p2: 'PM2.5',
  p1: 'PM10',
  o3: 'O3',
  n2: 'NO2',
  s2: 'SO2',
  co: 'CO',
};

// --- Types -------------------------------------------------------------------

// Hourly forecast entries as returned inside a paid-tier AirVisual city
// response. The community tier omits `forecasts` entirely; when a paid key is
// configured they're passed through so the client can show IQAir's own
// forecast alongside the CAMS model forecast below.
export interface IqairForecastHour {
  ts: string; // UTC ISO timestamp
  aqius: number;
  aqicn?: number;
  tp?: number; // °C
  hu?: number; // % RH
  ws?: number; // m/s
}

export interface IqairCity {
  id: string;
  city: string;
  state: string;
  country: string;
  lat: number;
  lon: number;
  aqi: number; // aqius — US EPA AQI scale
  aqiCn: number | null;
  categoryNum: number; // 1=Good … 6=Hazardous
  categoryName: string;
  mainPollutant: string; // decoded, e.g. 'PM2.5'
  tempC: number | null;
  humidity: number | null;
  windMs: number | null;
  windDeg: number | null;
  observedAt: number | null; // epoch ms of the pollution reading
  fetchedAt: number; // epoch ms when we pulled it
  forecasts?: IqairForecastHour[]; // paid-tier keys only
}

export interface IqairResponse {
  cities: IqairCity[];
  updated: number;
  noKey?: boolean;
  sweeping?: boolean; // a background refresh sweep is in progress
  error?: string | null; // last sweep-aborting problem (quota/key), if any
}

interface AvNearestCity {
  status?: string;
  data?: {
    city?: string;
    state?: string;
    country?: string;
    location?: { coordinates?: [number, number] };
    current?: {
      pollution?: { ts?: string; aqius?: number; mainus?: string; aqicn?: number; maincn?: string };
      weather?: { ts?: string; tp?: number; hu?: number; ws?: number; wd?: number };
    };
    forecasts?: Array<{
      ts?: string;
      aqius?: number;
      aqicn?: number;
      tp?: number;
      hu?: number;
      ws?: number;
    }>;
    message?: string; // error payloads put the reason here
  };
}

// --- Shared helpers ----------------------------------------------------------

function aqiToCategory(aqi: number): { num: number; name: string } {
  if (!Number.isFinite(aqi) || aqi <= 50) return { num: 1, name: 'Good' };
  if (aqi <= 100) return { num: 2, name: 'Moderate' };
  if (aqi <= 150) return { num: 3, name: 'Unhealthy for Sensitive Groups' };
  if (aqi <= 200) return { num: 4, name: 'Unhealthy' };
  if (aqi <= 300) return { num: 5, name: 'Very Unhealthy' };
  return { num: 6, name: 'Hazardous' };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchJsonWithRetry(
  url: string,
  attempts = 3,
  timeoutMs = 8_000
): Promise<unknown> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
      if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
      return await res.json();
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) await sleep(400 * (i + 1));
    }
  }
  throw lastErr;
}

// --- City sweep --------------------------------------------------------------

const citiesById = new Map<string, IqairCity>();
let sweepCompletedAt = 0; // when the last full sweep finished (0 = never)
let sweeping = false;
let lastError: string | null = null;

const SNAPSHOT_KEY = 'iqair-cities';

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

// One nearest_city call. Retries once after a cool-down on the per-minute
// throttle; every other failure throws with the API's own reason so the sweep
// can decide whether to skip the city or stop entirely.
async function fetchNearestCity(
  seed: { label: string; lat: number; lon: number },
  attempt = 0
): Promise<IqairCity | null> {
  const url =
    `https://api.airvisual.com/v2/nearest_city?lat=${seed.lat}&lon=${seed.lon}` +
    `&key=${encodeURIComponent(IQAIR_KEY)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  let body: AvNearestCity | null = null;
  try {
    body = (await res.json()) as AvNearestCity;
  } catch {
    /* non-JSON body — handled below via status */
  }
  const reason = body?.data?.message ?? body?.status ?? `HTTP ${res.status}`;

  // Per-minute throttle: wait out the window once, then give up on this city.
  if (res.status === 429 || /too_many_requests/i.test(reason)) {
    if (attempt === 0) {
      await sleep(RATE_BACKOFF_MS);
      return fetchNearestCity(seed, 1);
    }
    throw new Error('too_many_requests');
  }
  if (!res.ok || body?.status !== 'success') throw new Error(reason);

  const d = body.data;
  const p = d?.current?.pollution;
  const aqius = num(p?.aqius);
  if (!d || !p || aqius == null) return null; // station exists but no current AQI

  // Position: the returned city's own coordinates ([lon, lat]), falling back to
  // the seed if the payload omits them.
  const coords = d.location?.coordinates;
  const lon = num(coords?.[0]) ?? seed.lon;
  const lat = num(coords?.[1]) ?? seed.lat;

  const city = (d.city ?? seed.label).trim();
  const state = (d.state ?? '').trim();
  const country = (d.country ?? '').trim();
  const cat = aqiToCategory(aqius);
  const w = d.current?.weather;
  const observed = p.ts ? Date.parse(p.ts) : NaN;

  const out: IqairCity = {
    id: `iq-${`${city}|${state}|${country}`.toLowerCase().replace(/\s+/g, '_')}`,
    city,
    state,
    country,
    lat,
    lon,
    aqi: aqius,
    aqiCn: num(p.aqicn),
    categoryNum: cat.num,
    categoryName: cat.name,
    mainPollutant: POLLUTANT_NAME[p.mainus ?? ''] ?? (p.mainus || 'PM2.5'),
    tempC: num(w?.tp),
    humidity: num(w?.hu),
    windMs: num(w?.ws),
    windDeg: num(w?.wd),
    observedAt: Number.isFinite(observed) ? observed : null,
    fetchedAt: Date.now(),
  };

  // Paid-tier pass-through: hourly IQAir forecast entries when the key's plan
  // includes them (community keys never send this field).
  if (Array.isArray(d.forecasts)) {
    const fc = d.forecasts
      .filter((f): f is { ts: string; aqius: number } & typeof f =>
        typeof f?.ts === 'string' && typeof f?.aqius === 'number' && Number.isFinite(f.aqius))
      .slice(0, 72)
      .map((f) => ({
        ts: f.ts,
        aqius: f.aqius,
        aqicn: num(f.aqicn) ?? undefined,
        tp: num(f.tp) ?? undefined,
        hu: num(f.hu) ?? undefined,
        ws: num(f.ws) ?? undefined,
      }));
    if (fc.length > 0) out.forecasts = fc;
  }
  return out;
}

function persistSnapshot(): void {
  const payload = { cities: [...citiesById.values()], sweepCompletedAt };
  pool
    .query(
      `INSERT INTO snapshots (key, data) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
      [SNAPSHOT_KEY, JSON.stringify(payload)]
    )
    .catch((err) =>
      console.warn('[iqair] snapshot save failed:', err instanceof Error ? err.message : err)
    );
}

// Restore the last sweep from Postgres so a deploy doesn't blank the layer or
// re-spend quota. Retries briefly because the boot migration may still be
// creating the table; never clobbers cities a faster live sweep already wrote.
async function loadSnapshot(attempts = 5): Promise<void> {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const { rows } = await pool.query<{ data: { cities?: IqairCity[]; sweepCompletedAt?: number } }>(
        'SELECT data FROM snapshots WHERE key = $1',
        [SNAPSHOT_KEY]
      );
      const snap = rows[0]?.data;
      if (snap?.cities?.length) {
        for (const c of snap.cities) {
          const existing = citiesById.get(c.id);
          if (!existing || c.fetchedAt > existing.fetchedAt) citiesById.set(c.id, c);
        }
        if (snap.sweepCompletedAt && snap.sweepCompletedAt > sweepCompletedAt) {
          sweepCompletedAt = snap.sweepCompletedAt;
        }
        console.log(
          `[iqair] restored ${snap.cities.length} cities from snapshot ` +
            `(${Math.round((Date.now() - (snap.sweepCompletedAt ?? 0)) / 60_000)} min old)`
        );
      }
      return;
    } catch (err) {
      if (attempt >= attempts) {
        console.warn(
          '[iqair] snapshot load failed — starting from an empty map:',
          err instanceof Error ? err.message : err
        );
        return;
      }
      await sleep(3_000);
    }
  }
}

async function sweep(): Promise<void> {
  if (sweeping || !IQAIR_KEY) return;
  sweeping = true;
  lastError = null;
  let ok = 0;
  let failed = 0;
  try {
    for (let i = 0; i < CITY_SEEDS.length; i++) {
      const seed = CITY_SEEDS[i];
      try {
        const c = await fetchNearestCity(seed);
        if (c) {
          citiesById.set(c.id, c);
          ok++;
          // Persist partial progress so a mid-sweep restart keeps what it paid for.
          if (ok % 10 === 0) persistSnapshot();
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // Quota exhausted or key rejected → stop the sweep instead of burning
        // 60 more calls into the same wall. The route surfaces the reason.
        if (/call_limit|limit_reached|api_key|permission|payment|forbidden/i.test(msg)) {
          lastError = `IQAir: ${msg}`;
          console.error(`[iqair] sweep aborted at ${seed.label}: ${msg}`);
          break;
        }
        failed++;
        console.warn(`[iqair] ${seed.label} fetch failed: ${msg}`);
      }
      if (i < CITY_SEEDS.length - 1) await sleep(CALL_SPACING_MS);
    }
    sweepCompletedAt = Date.now();
    persistSnapshot();
    console.log(`[iqair] sweep done: ${ok} cities updated, ${failed} failed, ${citiesById.size} total`);
  } finally {
    sweeping = false;
  }
}

// setTimeout chain (not setInterval) so a slow or backed-off sweep can never
// overlap the next one.
function scheduleSweep(delayMs: number): void {
  setTimeout(async () => {
    try {
      await sweep();
    } catch (err) {
      console.error('[iqair] sweep failed:', err instanceof Error ? err.message : err);
    }
    scheduleSweep(SWEEP_INTERVAL_MS);
  }, delayMs);
}

export function initIqairStream(): void {
  if (!IQAIR_KEY) {
    console.log('[iqair] IQAIR_API_KEY not set — world AQI layer disabled');
    return;
  }
  void (async () => {
    await loadSnapshot();
    // Resume the cadence where the snapshot left off: a restart right after a
    // sweep waits out the rest of the interval instead of re-spending ~64 calls.
    const sinceLast = Date.now() - sweepCompletedAt;
    const delay = sweepCompletedAt > 0 ? Math.max(5_000, SWEEP_INTERVAL_MS - sinceLast) : 5_000;
    scheduleSweep(delay);
  })();
}

// --- Per-point air-quality forecast (CAMS via Open-Meteo) --------------------
// "Show me the forecast for this point": hourly US-EPA AQI + key pollutants
// for the next 5 days from Copernicus CAMS, via Open-Meteo's free air-quality
// API (keyless, global). The community IQAir key only carries *current*
// conditions — its own forecast product is paid — so CAMS is what makes the
// forecast universal here; when a paid IQAir key is present its per-city
// forecast rides along on the city payload above and the panel shows both.

const FORECAST_TTL_MS = 60 * 60 * 1000; // CAMS runs update ~12-hourly

export interface AirQualityForecast {
  latitude: number;
  longitude: number;
  timezone: string;
  timezoneAbbr: string;
  utcOffsetSeconds: number;
  // Parallel hourly arrays; time is local ISO "YYYY-MM-DDTHH:mm". Values can be
  // null past the CAMS horizon (trailing all-null hours are trimmed).
  hourly: {
    time: string[];
    aqi: (number | null)[];
    pm25: (number | null)[];
    pm10: (number | null)[];
    o3: (number | null)[];
    no2: (number | null)[];
  };
  daily: { time: string[]; aqiMax: number[]; aqiMean: number[] };
  updated: number;
  source: string;
}

interface OmAirQuality {
  latitude?: number;
  longitude?: number;
  timezone?: string;
  timezone_abbreviation?: string;
  utc_offset_seconds?: number;
  hourly?: {
    time?: string[];
    us_aqi?: (number | null)[];
    pm2_5?: (number | null)[];
    pm10?: (number | null)[];
    ozone?: (number | null)[];
    nitrogen_dioxide?: (number | null)[];
  };
}

async function fetchAqForecast(lat: number, lon: number): Promise<AirQualityForecast> {
  const url =
    `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}` +
    `&hourly=us_aqi,pm2_5,pm10,ozone,nitrogen_dioxide&forecast_days=5&timezone=auto`;
  const d = (await fetchJsonWithRetry(url)) as OmAirQuality;
  const h = d.hourly;
  const time = h?.time;
  const aqi = h?.us_aqi;
  if (!time || !aqi || time.length === 0) throw new Error('Open-Meteo: missing air-quality fields');

  const pad = (arr: (number | null)[] | undefined): (number | null)[] =>
    Array.from({ length: time.length }, (_, i) => num(arr?.[i]));
  const aqiArr = pad(aqi);

  // Trim trailing hours with no AQI (past the model horizon) so charts don't
  // render an empty tail.
  let end = aqiArr.length;
  while (end > 0 && aqiArr[end - 1] == null) end--;
  if (end === 0) throw new Error('Open-Meteo: air-quality forecast is empty');
  const clip = <T>(arr: T[]) => arr.slice(0, end);

  const hourly = {
    time: clip(time),
    aqi: clip(aqiArr),
    pm25: clip(pad(h?.pm2_5)),
    pm10: clip(pad(h?.pm10)),
    o3: clip(pad(h?.ozone)),
    no2: clip(pad(h?.nitrogen_dioxide)),
  };

  // Daily rollup by local calendar day (times are already point-local thanks to
  // timezone=auto): max + mean AQI per day.
  const byDay = new Map<string, number[]>();
  for (let i = 0; i < hourly.time.length; i++) {
    const v = hourly.aqi[i];
    if (v == null) continue;
    const day = hourly.time[i].slice(0, 10);
    const arr = byDay.get(day);
    if (arr) arr.push(v);
    else byDay.set(day, [v]);
  }
  const daily: AirQualityForecast['daily'] = { time: [], aqiMax: [], aqiMean: [] };
  for (const [day, vals] of byDay) {
    daily.time.push(day);
    daily.aqiMax.push(Math.round(Math.max(...vals)));
    daily.aqiMean.push(Math.round(vals.reduce((s, v) => s + v, 0) / vals.length));
  }

  return {
    latitude: num(d.latitude) ?? lat,
    longitude: num(d.longitude) ?? lon,
    timezone: d.timezone ?? 'GMT',
    timezoneAbbr: d.timezone_abbreviation ?? 'GMT',
    utcOffsetSeconds: d.utc_offset_seconds ?? 0,
    hourly,
    daily,
    updated: Date.now(),
    source: 'CAMS (Copernicus) · Open-Meteo',
  };
}

// --- Routes ------------------------------------------------------------------

router.get('/', (_req, res) => {
  if (!IQAIR_KEY) {
    res.json({ cities: [], updated: Date.now(), noKey: true } satisfies IqairResponse);
    return;
  }
  const cities = [...citiesById.values()];
  const updated = cities.reduce((m, c) => Math.max(m, c.fetchedAt), sweepCompletedAt);
  res.json({ cities, updated, sweeping, error: lastError } satisfies IqairResponse);
});

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
  // Round to ~0.1° (~11 km) so nearby clicks share one cached upstream call.
  const latR = Math.round(lat * 10) / 10;
  const lonR = Math.round(lon * 10) / 10;
  try {
    const data = await cache.getOrFetch<AirQualityForecast>(
      `iqair-fc:${latR},${lonR}`,
      FORECAST_TTL_MS,
      () => fetchAqForecast(latR, lonR),
      { staleOnError: true }
    );
    res.json(data);
  } catch (err) {
    console.error('Air-quality forecast route error', err);
    res.status(502).json({ error: 'Air-quality forecast unavailable' });
  }
});

export default router;
