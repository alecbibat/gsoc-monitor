import { Router } from 'express';
import { cache } from '../cache';

const router = Router();

const AIRNOW_KEY = process.env.AIRNOW_API_KEY ?? '';
// CONUS bounding box — covers the continental US plus a bit of Canada/Mexico
const BBOX = '-130,20,-60,55';
const PARAMETERS = 'PM25,O3,PM10,CO,NO2,SO2';
const TTL_MS = 60 * 60 * 1000; // 1 hour — AirNow updates hourly

// --- Types ---

interface AirNowEntry {
  DateObserved: string;
  HourObserved: number;
  LocalTimeZone: string;
  ReportingArea: string;
  StateCode: string;
  Latitude: number;
  Longitude: number;
  ParameterName: string;
  AQI: number;
  Category: { Number: number; Name: string };
}

export interface AqiStation {
  id: string;
  lat: number;
  lon: number;
  aqi: number;
  categoryNum: number;
  categoryName: string;
  parameter: string; // dominant (highest AQI) parameter
  reportingArea: string;
  state: string;
  hourObserved: number;
  timezone: string;
  all: Array<{ parameter: string; aqi: number; category: string }>;
}

export interface AqiResponse {
  stations: AqiStation[];
  updated: number;
  noKey?: boolean;
  error?: string;
}

// --- Fetch ---

async function fetchAqi(): Promise<AqiResponse> {
  if (!AIRNOW_KEY) {
    return { stations: [], updated: Date.now(), noKey: true };
  }

  // AirNow date format: YYYY-MM-DDTHH (local station time)
  // Request a 3-hour window ending now so every timezone is covered.
  const now = new Date();
  const endDate = now.toISOString().slice(0, 13);
  const startDate = new Date(now.getTime() - 3 * 60 * 60 * 1000).toISOString().slice(0, 13);

  const url =
    `https://www.airnowapi.org/aq/data/?startDate=${startDate}&endDate=${endDate}` +
    `&parameters=${PARAMETERS}&BBOX=${BBOX}&dataType=A&format=application%2Fjson` +
    `&verbose=0&monitorType=0&includerawconcentrations=0&API_KEY=${AIRNOW_KEY}`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`AirNow returned HTTP ${res.status}`);
  }

  const entries = (await res.json()) as AirNowEntry[];
  if (!Array.isArray(entries)) {
    throw new Error('AirNow returned unexpected format');
  }

  // Group by station location key, kepping the most recent observation per
  // (station, parameter) pair (highest HourObserved wins within a location).
  const byStation = new Map<string, Map<string, AirNowEntry>>();

  for (const e of entries) {
    if (e.AQI < 0) continue; // -1 = data not available
    const key = `${e.Latitude.toFixed(3)},${e.Longitude.toFixed(3)}`;
    let paramMap = byStation.get(key);
    if (!paramMap) {
      paramMap = new Map<string, AirNowEntry>();
      byStation.set(key, paramMap);
    }
    const existing = paramMap.get(e.ParameterName);
    if (!existing || e.HourObserved > existing.HourObserved) {
      paramMap.set(e.ParameterName, e);
    }
  }

  // Build output: one station per location, dominant parameter = highest AQI.
  const stations: AqiStation[] = [];

  for (const [key, paramMap] of byStation) {
    const allParams = [...paramMap.values()];
    const dominant = allParams.reduce((max, e) => (e.AQI > max.AQI ? e : max));

    stations.push({
      id: `aqi-${key}`,
      lat: dominant.Latitude,
      lon: dominant.Longitude,
      aqi: dominant.AQI,
      categoryNum: dominant.Category.Number,
      categoryName: dominant.Category.Name,
      parameter: dominant.ParameterName,
      reportingArea: dominant.ReportingArea,
      state: dominant.StateCode,
      hourObserved: dominant.HourObserved,
      timezone: dominant.LocalTimeZone,
      all: allParams.map((e) => ({
        parameter: e.ParameterName,
        aqi: e.AQI,
        category: e.Category.Name,
      })),
    });
  }

  return { stations, updated: Date.now() };
}

// --- Route ---

router.get('/', async (_req, res) => {
  if (!AIRNOW_KEY) {
    res.json({ stations: [], updated: Date.now(), noKey: true } satisfies AqiResponse);
    return;
  }
  try {
    const data = await cache.getOrFetch<AqiResponse>('aqi', TTL_MS, fetchAqi, {
      staleOnError: true,
    });
    res.json(data);
  } catch (err) {
    console.error('AQI route error', err);
    res.status(502).json({ stations: [], updated: Date.now(), error: 'AirNow feed unavailable' });
  }
});

export default router;
