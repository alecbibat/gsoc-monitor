import { Router } from 'express';
import { cache } from '../cache';
import { config } from '../config';

const router = Router();

// NWS/NOAA APIs reject requests without an identifying User-Agent (HTTP 403),
// so every NWPS call sends one — same convention as the Nominatim geocode route.
const NWPS_HEADERS = { 'User-Agent': config.nwsUserAgent, Accept: 'application/json' };

// NOAA National Water Prediction Service (NWPS) — the modern AHPS replacement.
// Keyless JSON API. /gauges returns ~12.7k river forecast points nationwide, each
// already carrying its current stage/flow and a flood category, so one bulk call
// renders the whole national map; per-gauge detail (thresholds, crests, impacts,
// hydrograph) is fetched lazily when a gauge is clicked.
const NWPS = 'https://api.water.noaa.gov/nwps/v1';
const BULK_TTL_MS = 15 * 60 * 1000; // NWPS observations refresh ~hourly; 15 min is plenty
const DETAIL_TTL_MS = 10 * 60 * 1000;

// Normalized flood tiers (most → least severe), plus the non-flood states we keep.
export type FloodCat = 'major' | 'moderate' | 'minor' | 'action' | 'normal' | 'low' | 'none';

const SEVERITY: Record<FloodCat, number> = {
  major: 4,
  moderate: 3,
  minor: 2,
  action: 1,
  normal: 0,
  low: 0,
  none: 0,
};

// Map NWPS floodCategory strings to our tiers. Returns null for states we drop
// from the map (stale observation, offline sensor, no current forecast).
function normalizeCat(c: string | undefined): FloodCat | null {
  switch (c) {
    case 'major':
      return 'major';
    case 'moderate':
      return 'moderate';
    case 'minor':
      return 'minor';
    case 'action':
      return 'action';
    case 'no_flooding':
      return 'normal';
    case 'low_threshold':
      return 'low';
    case 'not_defined':
      return 'none'; // monitored, but no flood thresholds defined for this gauge
    default:
      return null; // obs_not_current, out_of_service, fcst_not_current, missing
  }
}

// NWPS uses -999 / -9999 as "no data" sentinels.
function sanitize(v: unknown): number | null {
  return typeof v === 'number' && v > -900 ? v : null;
}

interface NwpsStatusSide {
  primary?: number;
  primaryUnit?: string;
  secondary?: number;
  secondaryUnit?: string;
  floodCategory?: string;
  validTime?: string;
}
interface NwpsGauge {
  lid: string;
  name: string;
  latitude: number;
  longitude: number;
  state?: { abbreviation?: string; name?: string };
  status?: { observed?: NwpsStatusSide; forecast?: NwpsStatusSide };
}

// Compact per-gauge shape sent to the client for rendering (one point each).
export interface RiverGauge {
  lid: string;
  name: string;
  lat: number;
  lon: number;
  state: string;
  cat: FloodCat; // observed flood tier
  fcat: FloodCat | null; // forecast tier (null when no current forecast)
  stage: number | null; // primary reading
  unit: string; // primary unit ('ft' for stage gauges, 'kcfs' for flow gauges)
  flow: number | null; // secondary reading (flow) when the primary is stage
  flowUnit: string;
  isFlow: boolean; // true when the primary reading is flow, not stage
}

export interface RiversResponse {
  gauges: RiverGauge[];
  counts: Record<FloodCat, number>;
  updated: number;
  warming?: boolean; // true when the snapshot isn't ready yet (cold start)
}

function round4(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}

async function fetchRivers(): Promise<RiversResponse> {
  const res = await fetch(`${NWPS}/gauges`, {
    headers: NWPS_HEADERS,
    signal: AbortSignal.timeout(90_000),
  });
  if (!res.ok) throw new Error(`NWPS /gauges HTTP ${res.status}`);
  const json = (await res.json()) as { gauges?: NwpsGauge[] };
  const raw = json.gauges ?? [];

  const counts: Record<FloodCat, number> = {
    major: 0,
    moderate: 0,
    minor: 0,
    action: 0,
    normal: 0,
    low: 0,
    none: 0,
  };
  const gauges: RiverGauge[] = [];

  for (const g of raw) {
    if (!Number.isFinite(g.latitude) || !Number.isFinite(g.longitude)) continue;
    const obs = g.status?.observed;
    const cat = normalizeCat(obs?.floodCategory);
    if (!cat) continue; // drop stale/offline/uncategorized
    const isFlow = (obs?.primaryUnit ?? 'ft') === 'kcfs';
    gauges.push({
      lid: g.lid,
      name: g.name,
      lat: round4(g.latitude),
      lon: round4(g.longitude),
      state: g.state?.abbreviation ?? '',
      cat,
      fcat: normalizeCat(g.status?.forecast?.floodCategory),
      stage: sanitize(obs?.primary),
      unit: obs?.primaryUnit ?? '',
      flow: isFlow ? null : sanitize(obs?.secondary),
      flowUnit: isFlow ? '' : obs?.secondaryUnit ?? '',
      isFlow,
    });
    counts[cat]++;
  }

  return { gauges, counts, updated: Date.now() };
}

// Background-refreshed national snapshot. NWPS's /gauges pull is ~13 MB and has
// been observed at ~50s time-to-first-byte, so it must NEVER run on the request
// path — that would blow past the platform's inbound timeout and 502 the client
// (which is exactly the "feed unavailable" symptom). The route only ever serves
// this in-memory snapshot; a background loop keeps it fresh, and a failed
// refresh simply keeps serving the last good value.
let latest: RiversResponse | null = null;
// The snapshot only changes on refresh but is served to every polling client —
// serialize it once per refresh instead of running a multi-MB JSON.stringify
// per request on the event loop.
let latestBody: Buffer | null = null;
let refreshing = false;
// Skip the ~13 MB upstream pull while nobody is looking at the layer; the
// warming path below revives it within one cycle when a viewer returns.
let lastRequestedAt = 0;
const IDLE_AFTER_MS = 2 * BULK_TTL_MS;

async function refreshRivers(): Promise<void> {
  if (refreshing) return; // coalesce — one slow pull at a time
  refreshing = true;
  try {
    latest = await fetchRivers();
    latestBody = Buffer.from(JSON.stringify(latest));
  } catch (err) {
    console.error(
      '[rivers] refresh failed (serving last good):',
      err instanceof Error ? err.message : err
    );
  } finally {
    refreshing = false;
  }
}

export function initRiversStream(): void {
  void refreshRivers();
  setInterval(() => {
    if (Date.now() - lastRequestedAt > IDLE_AFTER_MS && latest) return; // idle — pause the pull
    void refreshRivers();
  }, BULK_TTL_MS);
}

const EMPTY_COUNTS: Record<FloodCat, number> = {
  major: 0,
  moderate: 0,
  minor: 0,
  action: 0,
  normal: 0,
  low: 0,
  none: 0,
};

router.get('/', (_req, res) => {
  lastRequestedAt = Date.now();
  if (latest && latestBody) {
    // Coming back from an idle pause the snapshot may be stale — serve it now,
    // refresh behind the response.
    if (Date.now() - latest.updated > IDLE_AFTER_MS) void refreshRivers();
    res.type('application/json').send(latestBody);
    return;
  }
  // Snapshot not ready yet (cold start / just-deployed). Kick a background
  // refresh and tell the client to retry shortly — never block on the slow pull.
  void refreshRivers();
  res.json({ gauges: [], counts: { ...EMPTY_COUNTS }, updated: Date.now(), warming: true });
});

// --- Per-gauge detail -------------------------------------------------------

interface RiverThreshold {
  cat: 'action' | 'minor' | 'moderate' | 'major';
  stage: number | null;
  flow: number | null;
}
interface SeriesPoint {
  t: number; // epoch seconds
  v: number; // primary value
}
interface CrestRec {
  time: string;
  stage: number;
}

export interface RiverDetail {
  lid: string;
  name: string;
  state: string;
  county: string;
  usgsId: string | null;
  primaryName: string; // 'Stage' | 'Flow'
  unit: string;
  flowUnit: string;
  isFlow: boolean;
  observed: { value: number | null; flow: number | null; cat: FloodCat | null; time: string | null };
  forecastCrest: { value: number | null; cat: FloodCat | null; time: string | null };
  trend: 'rising' | 'falling' | 'steady' | null;
  thresholds: RiverThreshold[];
  observedSeries: SeriesPoint[];
  forecastSeries: SeriesPoint[];
  impacts: Array<{ stage: number; statement: string }>;
  recentCrest: CrestRec | null;
  recordCrest: CrestRec | null;
  forecastReliability: string | null;
  inServiceMsg: string | null;
  updated: number;
}

interface NwpsDetail {
  lid: string;
  usgsId?: string;
  name: string;
  county?: string;
  state?: { abbreviation?: string };
  forecastReliability?: string;
  inService?: { enabled?: boolean; message?: string };
  status?: { observed?: NwpsStatusSide; forecast?: NwpsStatusSide };
  flood?: {
    flowUnits?: string;
    categories?: Record<string, { stage?: number; flow?: number }>;
    crests?: { historic?: Array<{ occurredTime?: string; stage?: number }>; recent?: Array<{ occurredTime?: string; stage?: number }> };
    impacts?: Array<{ stage?: number; statement?: string }>;
  };
}
interface NwpsStageFlowSide {
  primaryName?: string;
  primaryUnits?: string;
  secondaryUnits?: string;
  data?: Array<{ validTime?: string; primary?: number; secondary?: number }>;
}

const toSec = (iso: string | undefined): number => (iso ? Math.round(Date.parse(iso) / 1000) : 0);

// Downsample a series to at most `max` points, newest-biased window of `days`.
function condense(
  data: Array<{ validTime?: string; primary?: number }> | undefined,
  max: number,
  sinceSec: number
): SeriesPoint[] {
  if (!data) return [];
  const pts: SeriesPoint[] = [];
  for (const d of data) {
    const v = sanitize(d.primary);
    const t = toSec(d.validTime);
    if (v === null || !t || t < sinceSec) continue;
    pts.push({ t, v });
  }
  pts.sort((a, b) => a.t - b.t);
  if (pts.length <= max) return pts;
  const stride = Math.ceil(pts.length / max);
  return pts.filter((_, i) => i % stride === 0 || i === pts.length - 1);
}

async function fetchRiverDetail(lid: string): Promise<RiverDetail> {
  const [dRes, sRes] = await Promise.all([
    fetch(`${NWPS}/gauges/${encodeURIComponent(lid)}`, {
      headers: NWPS_HEADERS,
      signal: AbortSignal.timeout(15_000),
    }),
    fetch(`${NWPS}/gauges/${encodeURIComponent(lid)}/stageflow`, {
      headers: NWPS_HEADERS,
      signal: AbortSignal.timeout(15_000),
    }).catch(() => null),
  ]);
  if (!dRes.ok) throw new Error(`NWPS detail HTTP ${dRes.status}`);
  const d = (await dRes.json()) as NwpsDetail;
  const sf = sRes && sRes.ok
    ? ((await sRes.json()) as { observed?: NwpsStageFlowSide; forecast?: NwpsStageFlowSide })
    : null;

  const obs = d.status?.observed;
  const fc = d.status?.forecast;
  const isFlow = (obs?.primaryUnit ?? 'ft') === 'kcfs';

  // Flood-stage thresholds (skip -9999 placeholders). NWPS reports observed flow
  // and the stageflow series in kcfs but the category thresholds in cfs, so
  // normalize threshold flow to kcfs — otherwise flow-primary gauges plot the
  // current value and the threshold lines on wildly different scales.
  const flowIsCfs = d.flood?.flowUnits === 'cfs';
  const toKcfs = (f: number | null) => (f === null ? null : flowIsCfs ? Math.round((f / 1000) * 100) / 100 : f);
  const cats: Array<RiverThreshold['cat']> = ['action', 'minor', 'moderate', 'major'];
  const thresholds: RiverThreshold[] = cats
    .map((cat) => {
      const c = d.flood?.categories?.[cat];
      return { cat, stage: sanitize(c?.stage), flow: toKcfs(sanitize(c?.flow)) };
    })
    .filter((t) => t.stage !== null || t.flow !== null);

  // Forecast crest = peak of the forecast series (fall back to status.forecast).
  const fSeriesRaw = sf?.forecast?.data ?? [];
  let crestVal: number | null = sanitize(fc?.primary);
  let crestTime: string | null = fc?.validTime ?? null;
  for (const p of fSeriesRaw) {
    const v = sanitize(p.primary);
    if (v !== null && (crestVal === null || v > crestVal)) {
      crestVal = v;
      crestTime = p.validTime ?? crestTime;
    }
  }

  const obsVal = sanitize(obs?.primary);
  let trend: RiverDetail['trend'] = null;
  if (obsVal !== null && crestVal !== null) {
    const eps = Math.max(0.2, Math.abs(obsVal) * 0.02);
    trend = crestVal > obsVal + eps ? 'rising' : crestVal < obsVal - eps ? 'falling' : 'steady';
  }

  // Impacts near the current/forecast stage (what flooding looks like as it rises).
  const hi = Math.max(obsVal ?? 0, crestVal ?? 0) + 3;
  const lo = (obsVal ?? 0) - 2;
  const impacts = (d.flood?.impacts ?? [])
    .map((i) => ({ stage: i.stage ?? NaN, statement: (i.statement ?? '').trim() }))
    .filter((i) => Number.isFinite(i.stage) && i.statement && i.stage >= lo && i.stage <= hi)
    .sort((a, b) => a.stage - b.stage)
    .slice(0, 6);

  const recent = d.flood?.crests?.recent?.[0];
  const historic = (d.flood?.crests?.historic ?? [])
    .filter((c) => sanitize(c.stage) !== null)
    .sort((a, b) => (b.stage ?? 0) - (a.stage ?? 0))[0];

  const sinceSec = Math.round(Date.now() / 1000) - 14 * 24 * 3600;

  return {
    lid: d.lid,
    name: d.name,
    state: d.state?.abbreviation ?? '',
    county: d.county ?? '',
    usgsId: d.usgsId || null,
    primaryName: sf?.observed?.primaryName ?? (isFlow ? 'Flow' : 'Stage'),
    unit: obs?.primaryUnit ?? (isFlow ? 'kcfs' : 'ft'),
    flowUnit: obs?.secondaryUnit ?? 'kcfs',
    isFlow,
    observed: {
      value: obsVal,
      flow: isFlow ? null : sanitize(obs?.secondary),
      cat: normalizeCat(obs?.floodCategory),
      time: obs?.validTime ?? null,
    },
    forecastCrest: {
      value: crestVal,
      cat: crestVal === null ? null : normalizeCat(fc?.floodCategory),
      time: crestVal === null ? null : crestTime,
    },
    trend,
    thresholds,
    observedSeries: condense(sf?.observed?.data, 160, sinceSec),
    forecastSeries: condense(sf?.forecast?.data, 80, 0),
    impacts,
    recentCrest: recent && sanitize(recent.stage) !== null
      ? { time: recent.occurredTime ?? '', stage: recent.stage as number }
      : null,
    recordCrest: historic && sanitize(historic.stage) !== null
      ? { time: historic.occurredTime ?? '', stage: historic.stage as number }
      : null,
    forecastReliability: d.forecastReliability || null,
    inServiceMsg: d.inService?.enabled === false ? d.inService?.message ?? 'Out of service' : null,
    updated: Date.now(),
  };
}

router.get('/:lid', async (req, res) => {
  const lid = String(req.params.lid).toUpperCase().slice(0, 8);
  if (!/^[A-Z0-9]{3,8}$/.test(lid)) {
    res.status(400).json({ error: 'invalid gauge id' });
    return;
  }
  try {
    const data = await cache.getOrFetch<RiverDetail>(
      `river:${lid}`,
      DETAIL_TTL_MS,
      () => fetchRiverDetail(lid),
      { staleOnError: true }
    );
    res.json(data);
  } catch (err) {
    console.error('River detail error', err);
    res.status(502).json({ error: 'Gauge detail unavailable' });
  }
});

export { SEVERITY };
export default router;
