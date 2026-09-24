import { Router } from 'express';
import { cache } from '../cache';

const router = Router();

const AIRNOW_KEY = process.env.AIRNOW_API_KEY ?? '';
// PurpleAir read key — free read key from https://develop.purpleair.com. Without
// it the PurpleAir source is simply skipped (AirNow still works on its own).
const PURPLEAIR_KEY = process.env.PURPLEAIR_API_KEY ?? '';
// CONUS bounding box — covers the continental US plus a bit of Canada/Mexico
const BBOX = '-130,20,-60,55';
const PARAMETERS = 'OZONE,PM25,PM10,CO,NO2,SO2';
const TTL_MS = 15 * 60 * 1000; // 15 min — AirNow is hourly; PurpleAir is ~real-time
// PurpleAir CONUS can return >15k sensors; cap what we hand the client so the map
// stays renderable. Over the cap we stride-sample to keep the spatial spread.
const MAX_PURPLEAIR = 6000;
// Drop PurpleAir sensors whose two laser counters disagree (PurpleAir's own
// 0–100 confidence score, where 100 = perfect A/B agreement).
const PA_CONFIDENCE_MIN = 70;

// --- Types ---

// aq/data ("Observations by Monitoring Site") rows: {Latitude, Longitude, UTC,
// Parameter, Unit, AQI, Category:<number>, SiteName (verbose=1)}. Reporting-area
// fields are kept optional so that schema also parses unchanged.
interface AirNowEntry {
  Latitude: number;
  Longitude: number;
  AQI: number;
  UTC?: string; // "YYYY-MM-DDTHH:MM", UTC
  Parameter?: string; // "PM2.5" | "OZONE" | "PM10" | "CO" | "NO2" | "SO2"
  Category?: number | { Number: number; Name: string };
  SiteName?: string;
  DateObserved?: string;
  HourObserved?: number;
  LocalTimeZone?: string;
  ReportingArea?: string;
  StateCode?: string;
  ParameterName?: string;
}

// One AirNow row normalized across both schemas.
interface AirNowObs {
  lat: number;
  lon: number;
  aqi: number;
  param: string;
  ts: number; // observation time, epoch ms (0 if unparseable)
  hour: number;
  tz: string;
  area: string;
  state: string;
  catNum: number;
  catName: string;
}

export interface AqiStation {
  id: string;
  source: 'airnow' | 'purpleair';
  lat: number;
  lon: number;
  aqi: number;
  categoryNum: number;
  categoryName: string;
  parameter: string; // dominant (highest AQI) parameter
  reportingArea: string;
  state: string;
  hourObserved: number; // -1 for PurpleAir (use lastSeen instead)
  timezone: string;
  all: Array<{ parameter: string; aqi: number; category: string }>;
  // PurpleAir-only extras
  pm25?: number; // EPA-corrected PM2.5 (µg/m³)
  pm25Raw?: number; // raw cf_1 PM2.5 before correction
  humidity?: number; // % RH used in the correction
  confidence?: number; // PurpleAir 0–100 channel-agreement score
  lastSeen?: number; // epoch seconds of the sensor's last report
}

export interface AqiResponse {
  stations: AqiStation[];
  updated: number;
  noKey?: boolean; // AirNow key missing
  purpleAirNoKey?: boolean; // PurpleAir key missing
  counts?: { airnow: number; purpleair: number };
  error?: string;
}

// --- AQI math ---------------------------------------------------------------

function aqiToCategory(aqi: number): { num: number; name: string } {
  if (!Number.isFinite(aqi) || aqi <= 50) return { num: 1, name: 'Good' };
  if (aqi <= 100) return { num: 2, name: 'Moderate' };
  if (aqi <= 150) return { num: 3, name: 'Unhealthy for Sensitive Groups' };
  if (aqi <= 200) return { num: 4, name: 'Unhealthy' };
  if (aqi <= 300) return { num: 5, name: 'Very Unhealthy' };
  return { num: 6, name: 'Hazardous' };
}

// EPA PM2.5 AQI breakpoints, updated 2024 (effective May 6 2024): [C_lo, C_hi,
// I_lo, I_hi] over PM2.5 truncated to 0.1 µg/m³. The 2024 revision lowered the
// AQI-50 break to 9.0 and the 200/300/500 breaks to 125.4/225.4/325.4 — matching
// the scale AirNow now returns, so the two sources stay comparable.
const PM25_BREAKS: Array<[number, number, number, number]> = [
  [0.0, 9.0, 0, 50],
  [9.1, 35.4, 51, 100],
  [35.5, 55.4, 101, 150],
  [55.5, 125.4, 151, 200],
  [125.5, 225.4, 201, 300],
  [225.5, 325.4, 301, 500],
];

function pm25ToAqi(pmRaw: number): number {
  const pm = Math.trunc(pmRaw * 10) / 10; // EPA truncates concentration to 0.1
  if (pm <= 0) return 0;
  for (const [clo, chi, ilo, ihi] of PM25_BREAKS) {
    if (pm <= chi) return Math.round(((ihi - ilo) / (chi - clo)) * (pm - clo) + ilo);
  }
  return 500; // above 325.4 µg/m³ → top of the index
}

// US-wide EPA correction for PurpleAir cf_1 PM2.5 (Barkjohn et al. 2021):
//   PM2.5 = 0.524 · PA_cf1 − 0.0862 · RH + 5.75
// PurpleAir's low-cost lasers overestimate PM2.5 by ~40%; this brings them in
// line with the reference/FEM monitors AirNow uses, so a PurpleAir dot and an
// AirNow badge in the same place read on the same scale. RH defaults to 35% when
// a sensor omits humidity. (AirNow's Fire & Smoke map adds a high-concentration
// term that only diverges in extreme smoke — where both already read Hazardous.)
function epaCorrect(paCf1: number, rh: number): number {
  const r = Number.isFinite(rh) && rh >= 0 && rh <= 100 ? rh : 35;
  return Math.max(0, 0.524 * paCf1 - 0.0862 * r + 5.75);
}

// --- AirNow -----------------------------------------------------------------

const AIRNOW_PARAM_ALIAS: Record<string, string> = { OZONE: 'O3' }; // client labels use 'O3'

function normalizeAirNow(e: AirNowEntry): AirNowObs | null {
  if (!e || typeof e !== 'object') return null;
  const lat = Number(e.Latitude);
  const lon = Number(e.Longitude);
  const aqi = Number(e.AQI);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(aqi) || aqi < 0) return null; // -1/-999 = no data
  const rawParam = String(e.ParameterName ?? e.Parameter ?? '').trim();
  if (!rawParam) return null;
  const param = AIRNOW_PARAM_ALIAS[rawParam.toUpperCase()] ?? rawParam;
  let ts: number;
  let hour: number;
  let tz: string;
  if (typeof e.UTC === 'string' && e.UTC.trim()) {
    const u = e.UTC.trim();
    ts = Date.parse(/z$/i.test(u) ? u : `${u}Z`) || 0;
    hour = ts ? new Date(ts).getUTCHours() : -1;
    tz = 'UTC';
  } else {
    // Reporting-area schema: compare full timestamps, since HourObserved alone
    // is hour-of-day (0–23) and yesterday's hour 23 would beat today's hour 0.
    const h = Number(e.HourObserved);
    ts = Date.parse(`${String(e.DateObserved ?? '').trim()}T${String(Number.isFinite(h) ? h : 0).padStart(2, '0')}:00:00Z`) || 0;
    hour = Number.isFinite(h) ? h : -1;
    tz = e.LocalTimeZone ?? '';
  }
  const cat =
    e.Category && typeof e.Category === 'object' && typeof e.Category.Name === 'string'
      ? { num: e.Category.Number, name: e.Category.Name }
      : aqiToCategory(aqi); // numeric Category: same EPA breakpoints/names
  return {
    lat,
    lon,
    aqi,
    param,
    ts,
    hour,
    tz,
    area: String(e.ReportingArea ?? e.SiteName ?? '').trim(),
    state: e.StateCode ?? '',
    catNum: cat.num,
    catName: cat.name,
  };
}

async function fetchAirNow(): Promise<AqiStation[]> {
  // aq/data date format: YYYY-MM-DDTHH, in UTC (what toISOString gives).
  // Request a 3-hour window ending now so late-reporting monitors are covered.
  const now = new Date();
  const endDate = now.toISOString().slice(0, 13);
  const startDate = new Date(now.getTime() - 3 * 60 * 60 * 1000).toISOString().slice(0, 13);

  const url =
    `https://www.airnowapi.org/aq/data/?startDate=${startDate}&endDate=${endDate}` +
    `&parameters=${PARAMETERS}&BBOX=${BBOX}&dataType=A&format=application%2Fjson` +
    `&verbose=1&monitorType=0&includerawconcentrations=0&API_KEY=${AIRNOW_KEY}`;

  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`AirNow returned HTTP ${res.status}`);

  const entries = (await res.json()) as AirNowEntry[];
  if (!Array.isArray(entries)) throw new Error('AirNow returned unexpected format');

  // Group by station location key, keeping the most recent observation per
  // (station, parameter) pair — the window holds several hours per monitor.
  const byStation = new Map<string, Map<string, AirNowObs>>();
  for (const raw of entries) {
    const o = normalizeAirNow(raw);
    if (!o) continue;
    const key = `${o.lat.toFixed(3)},${o.lon.toFixed(3)}`;
    let paramMap = byStation.get(key);
    if (!paramMap) {
      paramMap = new Map<string, AirNowObs>();
      byStation.set(key, paramMap);
    }
    const existing = paramMap.get(o.param);
    if (!existing || o.ts > existing.ts) {
      paramMap.set(o.param, o); // latest observation wins
    }
  }

  // One station per location, dominant parameter = highest AQI.
  const stations: AqiStation[] = [];
  for (const [key, paramMap] of byStation) {
    const allParams = [...paramMap.values()];
    const dominant = allParams.reduce((max, o) => (o.aqi > max.aqi ? o : max));
    stations.push({
      id: `aqi-${key}`,
      source: 'airnow',
      lat: dominant.lat,
      lon: dominant.lon,
      aqi: dominant.aqi,
      categoryNum: dominant.catNum,
      categoryName: dominant.catName,
      parameter: dominant.param,
      reportingArea: dominant.area,
      state: dominant.state,
      hourObserved: dominant.hour,
      timezone: dominant.tz,
      all: allParams.map((o) => ({
        parameter: o.param,
        aqi: o.aqi,
        category: o.catName,
      })),
    });
  }
  return stations;
}

// --- PurpleAir --------------------------------------------------------------

async function fetchPurpleAir(): Promise<AqiStation[]> {
  const fields = 'sensor_index,latitude,longitude,name,confidence,humidity,pm2.5_cf_1,last_seen';
  // location_type=0 → outdoor only; max_age=3600 → reported within the last hour.
  const url =
    `https://api.purpleair.com/v1/sensors?fields=${fields}` +
    `&location_type=0&max_age=3600&nwlng=-130&nwlat=55&selng=-60&selat=20`;

  const res = await fetch(url, {
    headers: { 'X-API-Key': PURPLEAIR_KEY },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`PurpleAir returned HTTP ${res.status}`);

  const json = (await res.json()) as { fields?: string[]; data?: Array<Array<number | string>> };
  const cols = json.fields ?? [];
  const rows = json.data ?? [];
  const col = (name: string) => cols.indexOf(name);
  const iId = col('sensor_index');
  const iLat = col('latitude');
  const iLon = col('longitude');
  const iName = col('name');
  const iConf = col('confidence');
  const iHum = col('humidity');
  const iPm = col('pm2.5_cf_1');
  const iSeen = col('last_seen');
  if (iLat < 0 || iLon < 0 || iPm < 0) throw new Error('PurpleAir response missing expected fields');

  const stations: AqiStation[] = [];
  for (const row of rows) {
    const lat = Number(row[iLat]);
    const lon = Number(row[iLon]);
    const paCf1 = Number(row[iPm]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) continue;
    if (!Number.isFinite(paCf1) || paCf1 < 0 || paCf1 > 3000) continue; // drop faulty readings
    const conf = iConf >= 0 ? Number(row[iConf]) : NaN;
    if (Number.isFinite(conf) && conf < PA_CONFIDENCE_MIN) continue;

    const rh = iHum >= 0 ? Number(row[iHum]) : NaN;
    const pm = epaCorrect(paCf1, rh);
    const aqi = pm25ToAqi(pm);
    const cat = aqiToCategory(aqi);
    const id = String(row[iId] ?? `${lat.toFixed(3)},${lon.toFixed(3)}`);
    const name = iName >= 0 ? String(row[iName] ?? '').trim() : '';

    stations.push({
      id: `pa-${id}`,
      source: 'purpleair',
      lat,
      lon,
      aqi,
      categoryNum: cat.num,
      categoryName: cat.name,
      parameter: 'PM2.5',
      reportingArea: name || `Sensor ${id}`,
      state: '',
      hourObserved: -1,
      timezone: '',
      all: [{ parameter: 'PM2.5', aqi, category: cat.name }],
      pm25: Math.round(pm * 10) / 10,
      pm25Raw: Math.round(paCf1 * 10) / 10,
      humidity: Number.isFinite(rh) ? Math.round(rh) : undefined,
      confidence: Number.isFinite(conf) ? Math.round(conf) : undefined,
      lastSeen: iSeen >= 0 ? Number(row[iSeen]) : undefined,
    });
  }

  // Cap for the client; stride-sample so the kept sensors stay spatially spread.
  if (stations.length > MAX_PURPLEAIR) {
    const stride = Math.ceil(stations.length / MAX_PURPLEAIR);
    return stations.filter((_, i) => i % stride === 0);
  }
  return stations;
}

// --- Combined fetch ---------------------------------------------------------

async function fetchAll(): Promise<AqiResponse> {
  let airnow: AqiStation[] = [];
  let purpleair: AqiStation[] = [];
  let airnowErr: string | null = null;
  let purpleErr: string | null = null;

  // Independent so one source failing never blanks the other.
  await Promise.all([
    (async () => {
      if (!AIRNOW_KEY) return;
      try {
        airnow = await fetchAirNow();
      } catch (e) {
        airnowErr = e instanceof Error ? e.message : String(e);
        console.error('[aqi] AirNow fetch failed:', airnowErr);
      }
    })(),
    (async () => {
      if (!PURPLEAIR_KEY) return;
      try {
        purpleair = await fetchPurpleAir();
      } catch (e) {
        purpleErr = e instanceof Error ? e.message : String(e);
        console.error('[aqi] PurpleAir fetch failed:', purpleErr);
      }
    })(),
  ]);

  // Both configured sources errored with nothing to show → throw so the cache
  // serves the last good value instead of caching an empty map.
  if (airnow.length === 0 && purpleair.length === 0 && (airnowErr || purpleErr)) {
    throw new Error(airnowErr || purpleErr || 'AQI feeds unavailable');
  }

  return {
    stations: [...airnow, ...purpleair],
    updated: Date.now(),
    noKey: !AIRNOW_KEY,
    purpleAirNoKey: !PURPLEAIR_KEY,
    counts: { airnow: airnow.length, purpleair: purpleair.length },
  };
}

// --- Route ---

router.get('/', async (_req, res) => {
  if (!AIRNOW_KEY && !PURPLEAIR_KEY) {
    res.json({
      stations: [],
      updated: Date.now(),
      noKey: true,
      purpleAirNoKey: true,
      counts: { airnow: 0, purpleair: 0 },
    } satisfies AqiResponse);
    return;
  }
  try {
    const data = await cache.getOrFetch<AqiResponse>('aqi', TTL_MS, fetchAll, {
      staleOnError: true,
    });
    res.json(data);
  } catch (err) {
    console.error('AQI route error', err);
    res.status(502).json({ stations: [], updated: Date.now(), error: 'AQI feeds unavailable' });
  }
});

export default router;
