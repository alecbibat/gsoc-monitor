import { Router } from 'express';
import { cache } from '../cache';

// ── FAA National Airspace System status ──────────────────────────────────────
//
// What the FAA's Air Traffic Control System Command Center is doing to traffic
// at US airports right now: ground stops, ground delay programs, closures,
// arrival and departure delays, deicing. nasstatus.faa.gov maps it; this
// proxies the JSON behind that map (the same request its page makes, no key).
// It lists only airports with something going on.
//
// The endpoint is undocumented, so it can change without notice — a failure
// shows on the layer, and the last good answer is served meanwhile. Proxied so
// one fetch per TTL serves every viewer, and so the browser never depends on
// the FAA's CORS policy. (The FAA's documented feed,
// /api/airport-status-information, is XML with airport codes only: no
// coordinates, and times as local clock text.)
export const FAA_EVENTS_URL = 'https://nasstatus.faa.gov/api/airport-events';
const TTL_MS = 60_000;
const TIMEOUT_MS = 15_000;

export interface FaaGroundStop {
  reason: string | null;
  start: string | null;
  end: string | null;
  /** The FAA's own odds that the stop runs past its end: "LOW", "MEDIUM", "HIGH". */
  extension: string | null;
  /** Air traffic centers whose departures are held. */
  facilities: string[];
  advisoryUrl: string | null;
}

export interface FaaGroundDelay {
  reason: string | null;
  avgMin: number | null;
  maxMin: number | null;
  start: string | null;
  end: string | null;
  advisoryUrl: string | null;
}

export interface FaaDelay {
  reason: string | null;
  /** The FAA's range as it words it: "16 minutes", "1 hour and 46 minutes". */
  min: string | null;
  max: string | null;
  avgMin: number | null;
  trend: string | null;
  updated: string | null;
}

/** A closure NOTAM, whole or partial. */
export interface FaaClosure {
  /** What the NOTAM says after "AP CLSD": empty for a plain closure. */
  text: string;
  /** The NOTAM as issued. */
  notam: string | null;
  start: string | null;
  end: string | null;
  /** Closed only between these UTC clock times each day ("0730", "1415"). */
  daily: { from: string; to: string } | null;
}

export interface FaaAirportStatus {
  /** FAA identifier ("SFO"). */
  id: string;
  name: string;
  lat: number;
  lon: number;
  groundStop: FaaGroundStop | null;
  groundDelay: FaaGroundDelay | null;
  arrivalDelay: FaaDelay | null;
  departureDelay: FaaDelay | null;
  /** The airport is closed (possibly only for some hours of the day). */
  closure: FaaClosure | null;
  /** Closed to some traffic only: typically transient general aviation. */
  restriction: FaaClosure | null;
  deicing: { since: string | null; until: string | null } | null;
  /** Runways in use and the arrival rate the tower is accepting, per hour. */
  config: { arrival: string | null; departure: string | null; arrivalRate: number | null } | null;
}

export interface FaaFeed {
  airports: FaaAirportStatus[];
  fetchedAt: string;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function iso(v: unknown): string | null {
  const s = str(v);
  const t = s ? Date.parse(s) : NaN;
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

/** Only links to the FAA's own advisory pages are passed on. */
function advisoryUrl(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  try {
    const u = new URL(s);
    return u.protocol === 'https:' && /(^|\.)faa\.gov$/.test(u.hostname) ? u.href : null;
  } catch {
    return null;
  }
}

function delay(v: unknown): FaaDelay | null {
  if (!isObj(v)) return null;
  const ad = isObj(v.arrivalDeparture) ? v.arrivalDeparture : {};
  return {
    reason: str(v.reason),
    min: str(ad.min),
    max: str(ad.max),
    avgMin: num(v.averageDelay),
    trend: (str(ad.trend) ?? str(v.trend))?.toLowerCase() ?? null,
    updated: iso(v.updateTime),
  };
}

function closure(v: unknown): FaaClosure | null {
  if (!isObj(v)) return null;
  const text = str(v.text) ?? '';
  const daily = /\bDLY\s+(\d{4})-(\d{4})\b/.exec(text);
  return {
    text,
    notam: str(v.simpleText),
    start: iso(v.startTime),
    end: iso(v.endTime),
    daily: daily ? { from: daily[1], to: daily[2] } : null,
  };
}

/** One record of the FAA's list as an airport with something going on, or null. */
export function normalizeFaaAirport(raw: unknown, now = Date.now()): FaaAirportStatus | null {
  if (!isObj(raw)) return null;
  const id = str(raw.airportId)?.toUpperCase();
  const lat = num(raw.latitude);
  const lon = num(raw.longitude);
  if (!id || !/^[A-Z0-9]{2,5}$/.test(id)) return null;
  if (lat === null || lon === null || Math.abs(lat) > 90 || Math.abs(lon) > 180 || (lat === 0 && lon === 0)) return null;

  const over = (end: string | null) => end !== null && Date.parse(end) <= now;
  const gs = isObj(raw.groundStop) ? raw.groundStop : null;
  const gd = isObj(raw.groundDelay) ? raw.groundDelay : null;
  const de = isObj(raw.deicing) ? raw.deicing : null;
  const cfg = isObj(raw.airportConfig) ? raw.airportConfig : null;

  const groundStop: FaaGroundStop | null = gs && {
    reason: str(gs.impactingCondition),
    start: iso(gs.startTime),
    end: iso(gs.endTime) ?? iso(gs.programExpirationTime),
    extension: str(gs.probabilityOfExtension)?.toUpperCase() ?? null,
    facilities: Array.isArray(gs.includedFacilities)
      ? gs.includedFacilities.filter((f): f is string => typeof f === 'string' && /^[A-Z0-9]{2,5}$/.test(f)).slice(0, 40)
      : [],
    advisoryUrl: advisoryUrl(gs.advisoryUrl),
  };
  const groundDelay: FaaGroundDelay | null = gd && {
    reason: str(gd.impactingCondition),
    avgMin: num(gd.avgDelay),
    maxMin: num(gd.maxDelay),
    start: iso(gd.startTime),
    end: iso(gd.endTime),
    advisoryUrl: advisoryUrl(gd.advisoryUrl),
  };
  const full = closure(raw.airportClosure);
  const partial = closure(raw.freeForm);
  const deicing = de && { since: iso(de.eventTime), until: iso(de.expTime) };

  const status: FaaAirportStatus = {
    id,
    name: str(raw.airportLongName) ?? id,
    lat,
    lon,
    // A stale answer, or a record the FAA is slow to drop, can outlive its end.
    groundStop: groundStop && !over(groundStop.end) ? groundStop : null,
    groundDelay: groundDelay && !over(groundDelay.end) ? groundDelay : null,
    arrivalDelay: delay(raw.arrivalDelay),
    departureDelay: delay(raw.departureDelay),
    closure: full && !over(full.end) ? full : null,
    restriction: partial && !over(partial.end) ? partial : null,
    deicing: deicing && !over(deicing.until) ? deicing : null,
    config: cfg && {
      arrival: str(cfg.arrivalRunwayConfig),
      departure: str(cfg.departureRunwayConfig),
      arrivalRate: num(cfg.arrivalRate),
    },
  };
  const eventful =
    status.groundStop || status.groundDelay || status.arrivalDelay || status.departureDelay ||
    status.closure || status.restriction || status.deicing;
  return eventful ? status : null;
}

export function normalizeFaaFeed(body: unknown, now = Date.now()): FaaAirportStatus[] {
  if (!Array.isArray(body)) throw new Error('FAA response is not a list of airports');
  const byId = new Map<string, FaaAirportStatus>();
  for (const raw of body) {
    const a = normalizeFaaAirport(raw, now);
    if (a && !byId.has(a.id)) byId.set(a.id, a);
  }
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

async function fetchFaa(): Promise<{ body: unknown; fetchedAt: string }> {
  const res = await fetch(FAA_EVENTS_URL, {
    headers: { 'User-Agent': 'gsoc-monitor', Accept: 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`FAA NAS status error: ${res.status}`);
  const body: unknown = await res.json();
  if (!Array.isArray(body)) throw new Error('FAA response is not a list of airports');
  return { body, fetchedAt: new Date().toISOString() };
}

const router = Router();

// GET /api/faa/airports — airports the FAA reports something at, right now.
router.get('/airports', async (_req, res) => {
  try {
    const raw = await cache.getOrFetch('faa:airport-events', TTL_MS, fetchFaa, { staleOnError: true });
    // Normalized per request: a stale answer can hold programs that have since ended.
    const feed: FaaFeed = { airports: normalizeFaaFeed(raw.body), fetchedAt: raw.fetchedAt };
    res.json(feed);
  } catch (err) {
    res.status(502).json({ error: 'FAA NAS status unavailable', detail: err instanceof Error ? err.message : String(err) });
  }
});

export default router;
