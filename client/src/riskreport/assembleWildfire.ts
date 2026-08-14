import { api } from '../api/client';
import { fetchHotspotsNearPins, type FireHotspot } from '../layers/fires/firesData';
import { fetchWildfires, type NamedFire } from '../layers/wildfires/wildfiresData';
import { fetchActiveAlerts, loadCounties, alertRings, severityRank, alertColorHex, type RawAlert } from '../layers/alerts/alertsData';
import { fmtOutlookDate, outlookStyle } from '../layers/fireOutlook/fireOutlookMeta';
import { LANDFIRE_CONUS_RECT, LANDFIRE_FBFM40_IMAGESERVER } from '../layers/fuel/landfireService';
import { analyzeFuelZone } from '../fuelzone/zonalStats';
import { haversineMeters, MILES_TO_M, pointInRings } from '../lib/geo';
import { containmentColor } from '../layers/wildfires/wildfiresData';
import { QPF_LAYER } from '../layers/precip/precipStore';
import { drawFlame, drawHatchedPolygon, drawPin, drawPolygon, drawRing, renderMapSnapshot } from './mapSnapshot';
import type { SmokePolygon } from '../types';
import {
  RISK_RINGS, bumpLevel, maxLevel,
  type AlertHit, type HotspotHit, type NamedFireHit, type OutlookDayCell,
  type RiskLevel, type RiskTarget, type SectionResult, type WildfireReportData,
} from './riskTypes';

// ── Wildfire report assembly ─────────────────────────────────────────────────
// Thresholds live in docs/RISK-REPORT-MATRIX.md — change them there first.
// Every feed fails independently: a down feed becomes an "unavailable" section
// (excluded from the overall level, surfaced in the report) — never a silent
// Low, matching the fail-honest rule the Property Watch follows.

const MPS_TO_MPH = 2.236936;
const MAX_RING_MI = RISK_RINGS[RISK_RINGS.length - 1].miles; // 100

// UTC day helpers (mirror cesium/earthBasemap — not imported from there so the
// lazy risk-report chunk never pulls Cesium in).
const todayUtcIso = () => new Date().toISOString().slice(0, 10);
const addDaysIso = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

const WPC_QPF_MAPSERVER =
  'https://mapservices.weather.noaa.gov/vector/rest/services/precip/wpc_qpf/MapServer';

// WPC QPF at the property point, read from the SAME MapServer the rainfall map
// renders — the chip strip and the map must agree on source (a point forecast
// from a different model regularly disagrees with WPC and reads as a bug).
// Identify returns each window's contour polygon containing the point; an
// empty result set means the point is outside every contour (< 0.01 in).
// Attribute values arrive as strings.
async function fetchWpcSiteQpf(
  lat: number,
  lon: number
): Promise<{ in24: number; in48: number; in72: number }> {
  const layers = [QPF_LAYER['24h'], QPF_LAYER['48h'], QPF_LAYER['72h']];
  const url =
    `${WPC_QPF_MAPSERVER}/identify?f=json&geometryType=esriGeometryPoint` +
    `&geometry=${lon.toFixed(4)},${lat.toFixed(4)}&sr=4326` +
    `&layers=all:${layers.join(',')}&tolerance=0&returnGeometry=false` +
    `&mapExtent=${(lon - 0.5).toFixed(2)},${(lat - 0.5).toFixed(2)},${(lon + 0.5).toFixed(2)},${(lat + 0.5).toFixed(2)}` +
    '&imageDisplay=400,400,96';
  const res = await fetch(url, { signal: AbortSignal.timeout(12_000) });
  if (!res.ok) throw new Error(`WPC identify HTTP ${res.status}`);
  const j = (await res.json()) as {
    results?: Array<{ layerId?: number; attributes?: Record<string, unknown> }>;
    error?: { message?: string };
  };
  if (j.error) throw new Error(`WPC identify: ${j.error.message ?? 'service error'}`);
  if (!Array.isArray(j.results)) throw new Error('WPC identify: malformed response');

  // The value field is named `qpf` today; scan defensively so a rename
  // degrades to the daily-forecast fallback instead of silently zeroing.
  const byLayer: Record<number, number> = {};
  let foundAny = false;
  for (const r of j.results) {
    if (r.layerId === undefined) continue;
    for (const [k, raw] of Object.entries(r.attributes ?? {})) {
      if (!/qpf/i.test(k)) continue;
      const n = typeof raw === 'number' ? raw : parseFloat(String(raw));
      if (!Number.isFinite(n)) continue;
      foundAny = true;
      // Nested contours stack — the highest containing value wins.
      byLayer[r.layerId] = Math.max(byLayer[r.layerId] ?? 0, n);
      break;
    }
  }
  if (j.results.length > 0 && !foundAny) throw new Error('WPC identify: no qpf attribute found');
  return {
    in24: byLayer[QPF_LAYER['24h']] ?? 0,
    in48: byLayer[QPF_LAYER['48h']] ?? 0,
    in72: byLayer[QPF_LAYER['72h']] ?? 0,
  };
}

const distMi = (target: RiskTarget, lat: number, lon: number) =>
  haversineMeters(target.lat, target.lon, lat, lon) / MILES_TO_M;

// Fire-relevant NWS events. "Evacuation Immediate/Order" carry no 'fire'
// substring, so they're listed explicitly.
const FIRE_ALERT_RE = /red flag|fire weather|fire warning|extreme fire|smoke|evacuation/;

export function hotspotAgeHours(h: FireHotspot): number | undefined {
  // FireHotspot declares these as strings, but the Esri service actually
  // returns acq_date as an epoch-ms date field and acq_time as a NUMBER
  // (e.g. 134 = 01:34 UTC) — the cast in firesData hides that. Accept both
  // shapes and never throw: a bad attribute must cost one table cell, not
  // the whole report.
  const rawDate: unknown = h.acqDate;
  const rawTime: unknown = h.acqTime;

  let ms: number | null = null;
  if (typeof rawDate === 'number' && Number.isFinite(rawDate) && rawDate > 0) {
    ms = rawDate; // midnight UTC of the acquisition date
  } else if (typeof rawDate === 'string') {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(rawDate);
    if (m) ms = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  }
  if (ms === null || Number.isNaN(ms)) return undefined;

  const t = /^(\d{2})(\d{2})$/.exec(String(rawTime ?? '').padStart(4, '0'));
  if (t) ms += +t[1] * 3600_000 + +t[2] * 60_000;

  const hours = (Date.now() - ms) / 3600_000;
  return hours >= 0 && hours < 96 ? Math.round(hours) : undefined;
}

interface FeedOutcome<T> {
  value: T | null;
  error: string | null;
}

const attempt = async <T>(p: Promise<T>): Promise<FeedOutcome<T>> => {
  try {
    return { value: await p, error: null };
  } catch (e) {
    return { value: null, error: e instanceof Error ? e.message : String(e) };
  }
};

export async function assembleWildfireReport(target: RiskTarget): Promise<WildfireReportData> {
  const inConus =
    target.lon >= LANDFIRE_CONUS_RECT.west && target.lon <= LANDFIRE_CONUS_RECT.east &&
    target.lat >= LANDFIRE_CONUS_RECT.south && target.lat <= LANDFIRE_CONUS_RECT.north;

  const [hotspotsRes, namedRes, alertsRes, countiesRes, outlookRes, fuelRes, windRes, dailyRes, smokeRes, lightningRes, wpcQpfRes] = await Promise.all([
    attempt(fetchHotspotsNearPins(MAX_RING_MI * MILES_TO_M)),
    attempt(fetchWildfires()),
    attempt(fetchActiveAlerts()),
    attempt(loadCounties()),
    attempt(api.fireOutlook()),
    inConus
      ? attempt(analyzeFuelZone({ lon: target.lon, lat: target.lat }, 3 * MILES_TO_M))
      : Promise.resolve({ value: null, error: 'outside CONUS' } as FeedOutcome<Awaited<ReturnType<typeof analyzeFuelZone>>>),
    attempt(api.windForecast(target.lat, target.lon)),
    attempt(api.weatherDaily(target.lat, target.lon)),
    attempt(api.smoke()),
    // Radius-filtered on the server so local strikes arrive unthinned — a
    // global 24 h window would be stride-sampled to ~nothing near any point.
    attempt(api.lightningHistory(1440, { lat: target.lat, lon: target.lon, radiusMi: 130 })),
    attempt(fetchWpcSiteQpf(target.lat, target.lon)),
  ]);

  const sections: SectionResult[] = [];
  const gaps: string[] = [
    'relative humidity / fuel moisture (RH grid pending)',
    'terrain slope (DEM sampling pending)',
  ];

  // ── Hotspots (FIRMS VIIRS, past 24 h) ─────────────────────────────────────
  let hotspots: HotspotHit[] = [];
  {
    const raw = hotspotsRes.value?.hotspots ?? null;
    const err = hotspotsRes.error ?? hotspotsRes.value?.error ?? null;
    if (raw === null) {
      sections.push({ id: 'hotspots', title: 'Satellite hotspots (VIIRS, 24 h)', level: 'low', drivers: [], unavailable: `FIRMS feed unavailable (${err ?? 'unknown error'})` });
    } else {
      hotspots = raw
        .map((h) => ({
          lat: h.lat, lon: h.lon,
          distanceMi: distMi(target, h.lat, h.lon),
          frp: h.frp ?? undefined,
          satellite: h.satellite || undefined,
          ageHours: hotspotAgeHours(h),
        }))
        .filter((h) => h.distanceMi <= MAX_RING_MI)
        .sort((a, b) => a.distanceMi - b.distanceMi);

      let level: RiskLevel = 'low';
      const drivers: string[] = [];
      const nearest = hotspots[0];
      if (nearest) {
        if (nearest.distanceMi <= 1) level = 'critical';
        else if (nearest.distanceMi <= 5) level = 'high';
        else if (nearest.distanceMi <= 25) level = 'elevated';
        else level = 'guarded';
        drivers.push(`Nearest satellite hotspot ${nearest.distanceMi.toFixed(1)} mi away${nearest.frp !== undefined ? ` (FRP ${Math.round(nearest.frp)} MW)` : ''}`);
        const strongNear = hotspots.find((h) => h.distanceMi <= 25 && (h.frp ?? 0) > 100);
        if (strongNear) {
          level = bumpLevel(level);
          drivers.push(`High-intensity detection (FRP ${Math.round(strongNear.frp!)} MW) within 25 mi`);
        }
        const within25 = hotspots.filter((h) => h.distanceMi <= 25).length;
        if (within25 > 1) drivers.push(`${within25} detections within 25 mi`);
      }
      sections.push({ id: 'hotspots', title: 'Satellite hotspots (VIIRS, 24 h)', level, drivers });
    }
  }

  // ── Named incidents (NIFC/WFIGS) ──────────────────────────────────────────
  let namedFires: NamedFireHit[] = [];
  let namedFiresAll: NamedFireHit[] = [];
  {
    // fetchWildfires never rejects — a total upstream failure RESOLVES with
    // fires:[] and error set. Reading only value===null here would render an
    // outage as a verified "Low, 0 named fires".
    const feedErr = namedRes.error ?? namedRes.value?.error ?? null;
    if (namedRes.value === null || (feedErr !== null && namedRes.value.fires.length === 0)) {
      sections.push({ id: 'named-fires', title: 'Named fire incidents (NIFC)', level: 'low', drivers: [], unavailable: `WFIGS feed unavailable (${feedErr ?? 'unknown error'})` });
    } else {
      const withDist = namedRes.value.fires
        .map((f: NamedFire) => ({
          name: f.name,
          lat: f.lat,
          lon: f.lon,
          distanceMi: distMi(target, f.lat, f.lon),
          acres: f.acres ?? undefined,
          containmentPct: f.contained ?? undefined,
          updatedAt: f.updated ?? undefined,
        }))
        .filter((f) => f.distanceMi <= MAX_RING_MI)
        .sort((a, b) => a.distanceMi - b.distanceMi);
      namedFiresAll = withDist;        // ring counts use the FULL list
      namedFires = withDist.slice(0, 8); // display list is capped

      let level: RiskLevel = 'low';
      const drivers: string[] = [];
      const uncontained = withDist.filter((f) => (f.containmentPct ?? 0) < 50);
      const nearestUn = uncontained[0];
      if (nearestUn) {
        level = nearestUn.distanceMi <= 25 ? 'high' : 'elevated';
        drivers.push(`${nearestUn.name} (${nearestUn.containmentPct !== undefined ? `${Math.round(nearestUn.containmentPct)}% contained` : 'containment unknown'}) ${nearestUn.distanceMi.toFixed(1)} mi away`);
        if ((nearestUn.acres ?? 0) >= 1000) {
          level = bumpLevel(level);
          drivers.push(`${Math.round(nearestUn.acres!).toLocaleString()} acres`);
        }
        // Staleness context: a day-old WFIGS record can hide a lot of fire growth.
        const ageH = nearestUn.updatedAt ? (Date.now() - nearestUn.updatedAt) / 3600_000 : null;
        if (ageH !== null && ageH >= 24) {
          drivers.push(`⚠ WFIGS record last updated ${Math.round(ageH)} h ago — treat acreage/containment as stale`);
        }
      } else if (withDist.length > 0) {
        level = 'guarded';
        drivers.push(`${withDist.length} incident${withDist.length === 1 ? '' : 's'} within 100 mi, all ≥50% contained`);
      }
      sections.push({ id: 'named-fires', title: 'Named fire incidents (NIFC)', level, drivers });
    }
  }

  // ── Fire-weather alerts at the site ───────────────────────────────────────
  let alerts: AlertHit[] = [];
  const alertShapes: { rings: number[][][]; colorHex: string }[] = [];
  {
    if (alertsRes.value === null) {
      sections.push({ id: 'alerts', title: 'Fire-weather alerts at site', level: 'low', drivers: [], unavailable: `NWS alert feed unavailable (${alertsRes.error ?? 'unknown error'})` });
    } else {
      const counties = countiesRes.value; // null = county-based alerts can't resolve
      const hits = alertsRes.value
        .filter((a: RawAlert) => FIRE_ALERT_RE.test((a.properties.event ?? '').toLowerCase()))
        .map((a) => ({ a, rings: alertRings(a, counties) }))
        .filter(({ rings }) => rings.length > 0 && pointInRings(target.lon, target.lat, rings))
        .sort((x, y) => severityRank(y.a.properties.severity) - severityRank(x.a.properties.severity));
      alerts = hits.map(({ a }) => ({
        event: a.properties.event ?? 'Alert',
        severity: a.properties.severity,
        expires: a.properties.expires,
      }));
      for (const { a, rings } of hits) {
        alertShapes.push({
          rings,
          colorHex: alertColorHex(a.properties.event ?? '', a.properties.severity ?? ''),
        });
      }

      let level: RiskLevel = 'low';
      const drivers: string[] = [];
      for (const { a } of hits) {
        const e = (a.properties.event ?? '').toLowerCase();
        if (/red flag|evacuation|fire warning|extreme fire/.test(e)) level = maxLevel(level, 'high');
        else if (/fire weather/.test(e)) level = maxLevel(level, 'elevated');
        else level = maxLevel(level, 'guarded');
        drivers.push(`${a.properties.event} in effect at the property`);
      }
      const section: SectionResult = {
        id: 'alerts',
        title: 'Fire-weather alerts at site',
        level,
        drivers,
        // This section really answers "how many, or none" — frame it that way
        // instead of a bare Low.
        countLabel: alerts.length === 0 ? 'None active' : `${alerts.length} active`,
      };
      if (counties === null && hits.length === 0) {
        // County shapes down = county-based alerts (Red Flag included) can't
        // be resolved; an empty result here is not a verified all-clear.
        section.unavailable = 'County geometry unavailable — county-based alerts (incl. Red Flag Warnings) could not be checked';
      }
      sections.push(section);
    }
  }

  // ── 7-day fire-potential outlook (site PSA) ───────────────────────────────
  let outlookToday: string | undefined;
  let outlookDays: OutlookDayCell[] | undefined;
  let outlookDayIdxs: number[] = [];
  let sitePsaRings: number[][][] | null = null;
  {
    if (outlookRes.value === null) {
      sections.push({ id: 'outlook', title: '7-day fire-potential outlook', level: 'low', drivers: [], unavailable: `Outlook feed unavailable (${outlookRes.error ?? 'unknown error'})` });
    } else {
      const psa = outlookRes.value.psas.find((p) => pointInRings(target.lon, target.lat, p.rings));
      // days[0] is day 1 of the ISSUANCE, not necessarily today — resolve
      // "today" through the dates array the server provides for exactly this.
      const dates = outlookRes.value.dates ?? [];
      const todayIso = new Date().toISOString().slice(0, 10);
      const todayIdx = Math.max(0, dates.indexOf(todayIso));
      const today = psa?.days[todayIdx] ?? null;
      const style = outlookStyle(today?.dryness ?? null, today?.type ?? null);
      outlookToday = style.label;
      sitePsaRings = psa?.rings ?? null;
      // Today-forward day cells for the strip + the regional map series.
      outlookDayIdxs = [];
      for (let i = todayIdx; i < 7; i++) outlookDayIdxs.push(i);
      outlookDays = outlookDayIdxs.map((i) => {
        const st = outlookStyle(psa?.days[i]?.dryness ?? null, psa?.days[i]?.type ?? null);
        return { date: dates[i] ?? null, label: st.label, hex: st.hex, sig: st.sig };
      });
      let level: RiskLevel = 'low';
      const drivers: string[] = [];
      if (today?.type === 'CRITICAL') { level = 'high'; drivers.push('NWCG outlook: CRITICAL fire potential today'); }
      else if (today?.type === 'IGNITION') { level = 'elevated'; drivers.push('NWCG outlook: ignition risk today'); }
      else if ((today?.dryness ?? 0) >= 2) { level = 'guarded'; drivers.push(`Fuel dryness: ${style.label.toLowerCase()}`); }
      const sigIdx = psa?.days.findIndex((d, i) => i > todayIdx && (d?.type === 'CRITICAL' || d?.type === 'IGNITION')) ?? -1;
      if (sigIdx > todayIdx && sigIdx >= 0) {
        drivers.push(`Significant fire potential flagged for ${fmtOutlookDate(dates[sigIdx] ?? null)}`);
      }
      if (!psa) drivers.push('Property is outside all Predictive Service Areas (outlook covers the US)');
      sections.push({ id: 'outlook', title: '7-day fire-potential outlook', level, drivers });
    }
  }

  // ── Fuel conditions (LANDFIRE, 3 mi ring) ─────────────────────────────────
  const fuel: WildfireReportData['fuel'] = {};
  {
    if (!inConus) {
      fuel.unavailable = 'LANDFIRE fuels cover CONUS only';
      sections.push({ id: 'fuel', title: 'Fuel conditions (3 mi ring)', level: 'low', drivers: [], unavailable: fuel.unavailable });
    } else if (fuelRes.value === null) {
      fuel.unavailable = `LANDFIRE unavailable (${fuelRes.error ?? 'unknown error'})`;
      sections.push({ id: 'fuel', title: 'Fuel conditions (3 mi ring)', level: 'low', drivers: [], unavailable: fuel.unavailable });
    } else {
      const r = fuelRes.value;
      fuel.topModels = r.classes.slice(0, 5).map((c) => ({ code: c.code, name: c.name, pct: c.pct }));
      if (r.risk) {
        fuel.score = Math.round(r.risk.score);
        fuel.level = r.risk.level;
        let level: RiskLevel = 'low';
        if (r.risk.score >= 85) level = 'high';
        else if (r.risk.score >= 70) level = 'elevated';
        else if (r.risk.score >= 40) level = 'guarded';
        sections.push({
          id: 'fuel', title: 'Fuel conditions (3 mi ring)', level,
          drivers: [
            `Fire-behavior potential ${Math.round(r.risk.score)}/100 (${r.risk.level}) at standard fire weather — ${Math.round(r.burnablePct)}% burnable`,
            ...r.risk.drivers.slice(0, 2),
          ],
        });
      } else if (r.totalPixels === 0) {
        // The empty sentinel means NO DATA at this location (ocean, coverage
        // hole, or an empty ImageServer answer) — not a verified fuel-free zone.
        fuel.unavailable = 'No LANDFIRE fuel data at this location';
        sections.push({ id: 'fuel', title: 'Fuel conditions (3 mi ring)', level: 'low', drivers: [], unavailable: fuel.unavailable });
      } else {
        sections.push({ id: 'fuel', title: 'Fuel conditions (3 mi ring)', level: 'low', drivers: ['No burnable fuel mapped in the 3 mi ring'] });
      }
    }
  }

  // ── Wind now / 48 h ───────────────────────────────────────────────────────
  const wind: WildfireReportData['wind'] = {};
  let windHourly: WildfireReportData['windHourly'] = null;
  {
    if (windRes.value === null) {
      wind.unavailable = `Wind forecast unavailable (${windRes.error ?? 'unknown error'})`;
      sections.push({ id: 'wind', title: 'Wind', level: 'low', drivers: [], unavailable: wind.unavailable });
    } else {
      const fc = windRes.value;
      // hourly.time entries are point-local ISO hour strings; find "now" via
      // the forecast's own UTC offset, fall back to the first entry.
      const localHour = new Date(Date.now() + fc.utcOffsetSeconds * 1000).toISOString().slice(0, 13);
      let idx = fc.hourly.time.findIndex((t) => t.slice(0, 13) >= localHour);
      if (idx < 0) idx = 0;
      const window = fc.hourly.speed.slice(idx, idx + 48);
      const gustWindow = fc.hourly.gust.slice(idx, idx + 48);
      wind.nowMph = (fc.hourly.speed[idx] ?? 0) * MPS_TO_MPH;
      wind.gustMph = (fc.hourly.gust[idx] ?? 0) * MPS_TO_MPH;
      wind.dirDeg = fc.hourly.dir[idx];
      wind.peak48Mph = Math.max(...window, 0) * MPS_TO_MPH;
      wind.peakGust48Mph = Math.max(...gustWindow, 0) * MPS_TO_MPH;
      windHourly = {
        times: fc.hourly.time.slice(idx, idx + 48),
        speedMph: window.map((v) => v * MPS_TO_MPH),
        gustMph: gustWindow.map((v) => v * MPS_TO_MPH),
        dirDeg: fc.hourly.dir.slice(idx, idx + 48),
      };

      let level: RiskLevel = 'low';
      const drivers: string[] = [];
      if ((wind.nowMph ?? 0) >= 35 || (wind.peakGust48Mph ?? 0) >= 50) {
        level = 'high';
        drivers.push(`Strong wind: ${Math.round(wind.nowMph!)} mph now, gusts to ${Math.round(wind.peakGust48Mph!)} mph within 48 h`);
      } else if ((wind.nowMph ?? 0) >= 25 || (wind.peakGust48Mph ?? 0) >= 35) {
        level = 'elevated';
        drivers.push(`Breezy: ${Math.round(wind.nowMph!)} mph now, gusts to ${Math.round(wind.peakGust48Mph!)} mph within 48 h`);
      }
      sections.push({ id: 'wind', title: 'Wind', level, drivers });
    }
  }

  // ── Smoke (NOAA HMS analyst-drawn plumes) ─────────────────────────────────
  // HMS analysts cover North America only — outside that domain an empty
  // point-in-polygon result is absence of coverage, not a verified clear sky.
  const HMS_RECT = { west: -170, east: -50, south: 5, north: 72 };
  const inHmsCoverage =
    target.lon >= HMS_RECT.west && target.lon <= HMS_RECT.east &&
    target.lat >= HMS_RECT.south && target.lat <= HMS_RECT.north;
  const smoke: WildfireReportData['smoke'] = {};
  const smokePolys: SmokePolygon[] = [];
  {
    // Like fetchWildfires, the smoke route can resolve with an in-band error
    // and no polygons — that's an outage, not a verified clear sky.
    const feedErr = smokeRes.error ?? smokeRes.value?.error ?? null;
    if (!inHmsCoverage) {
      smoke.unavailable = 'Property is outside NOAA HMS smoke coverage (North America)';
      sections.push({ id: 'smoke', title: 'Smoke (NOAA HMS)', level: 'low', drivers: [], unavailable: smoke.unavailable });
    } else if (smokeRes.value === null || (feedErr !== null && smokeRes.value.polygons.length === 0)) {
      smoke.unavailable = `HMS smoke feed unavailable (${feedErr ?? 'unknown error'})`;
      sections.push({ id: 'smoke', title: 'Smoke (NOAA HMS)', level: 'low', drivers: [], unavailable: smoke.unavailable });
    } else {
      const resp = smokeRes.value;
      smoke.analysisDate = /^\d{8}$/.test(resp.date)
        ? `${resp.date.slice(0, 4)}-${resp.date.slice(4, 6)}-${resp.date.slice(6, 8)}`
        : undefined;
      // Degenerate HMS rings are common — keep only sane vertices.
      for (const p of resp.polygons) {
        const ring = p.coords.filter(([lo, la]) =>
          Number.isFinite(lo) && Number.isFinite(la) && Math.abs(la) <= 90 && Math.abs(lo) <= 180);
        if (ring.length >= 3) smokePolys.push({ ...p, coords: ring });
      }
      smoke.plumeCount = smokePolys.length;

      const DENSITY_RANK: Record<string, number> = { Light: 0, Medium: 1, Heavy: 2 };
      const overhead = smokePolys
        .filter((p) => pointInRings(target.lon, target.lat, [p.coords]))
        .sort((a, b) => (DENSITY_RANK[b.density] ?? 0) - (DENSITY_RANK[a.density] ?? 0));
      smoke.densityAtSite = overhead[0]?.density ?? null;

      // Nearest plume edge (vertex approximation) for context when clear.
      let nearestMi = Infinity;
      for (const p of smokePolys) {
        for (const [lo, la] of p.coords) {
          const dm = distMi(target, la, lo);
          if (dm < nearestMi) nearestMi = dm;
        }
      }

      let level: RiskLevel = 'low';
      const drivers: string[] = [];
      if (smoke.densityAtSite === 'Heavy') { level = 'elevated'; drivers.push('Heavy smoke over the property in the latest HMS analysis'); }
      else if (smoke.densityAtSite === 'Medium') { level = 'guarded'; drivers.push('Medium-density smoke over the property'); }
      else if (smoke.densityAtSite === 'Light') { drivers.push('Light smoke over the property'); }
      else if (nearestMi <= 100) { drivers.push(`Nearest smoke plume edge ≈${Math.round(nearestMi)} mi away`); }
      if (smoke.analysisDate && smoke.analysisDate < todayUtcIso()) {
        drivers.push(`Latest HMS analysis is ${smoke.analysisDate} — plumes move, treat positions as approximate`);
      }
      sections.push({
        id: 'smoke', title: 'Smoke (NOAA HMS)', level, drivers,
        countLabel: smoke.densityAtSite ? `${smoke.densityAtSite} overhead` : 'None overhead',
      });
    }
  }

  // ── Lightning (Blitzortung network, past 24 h) ────────────────────────────
  const lightning: WildfireReportData['lightning'] = {};
  const strikes: { lat: number; lon: number; t: number; distanceMi: number }[] = [];
  {
    if (lightningRes.value === null) {
      lightning.unavailable = `Lightning history unavailable (${lightningRes.error ?? 'unknown error'})`;
      sections.push({ id: 'lightning', title: 'Lightning (24 h)', level: 'low', drivers: [], unavailable: lightning.unavailable });
    } else {
      const lt = lightningRes.value;
      // Keep everything the 110 mi map view can show (a little past 100 mi).
      for (let i = 0; i < lt.lat.length; i++) {
        const dm = distMi(target, lt.lat[i], lt.lon[i]);
        if (dm <= 130) strikes.push({ lat: lt.lat[i], lon: lt.lon[i], t: lt.t[i], distanceMi: dm });
      }
      // The radius-filtered request normally arrives unthinned, so these are
      // exact (of collected strikes). If the response WAS stride-sampled (a
      // pre-filter server, or a truly extreme local storm), scale the sampled
      // counts back up and say so — never present a sample as a census.
      const sampled = lt.thinned && lt.returned > 0;
      const scale = sampled ? lt.totalInWindow / lt.returned : 1;
      const approx = (n: number) => Math.round(n * scale);
      const n25 = strikes.filter((s) => s.distanceMi <= 25).length;
      const n100 = strikes.filter((s) => s.distanceMi <= 100).length;
      lightning.strikes25mi = approx(n25);
      lightning.strikes100mi = approx(n100);
      lightning.coverageMin = lt.coverageMin;

      const nearestMi = strikes.reduce<number>((m, s) => Math.min(m, s.distanceMi), Infinity);
      let level: RiskLevel = 'low';
      const drivers: string[] = [];
      if (nearestMi <= 5) {
        level = 'elevated';
        drivers.push(`Strike ${nearestMi < 1 ? '<1' : Math.round(nearestMi)} mi from the property in the past 24 h — direct ignition source`);
      } else if (nearestMi <= 25) {
        level = 'guarded';
        drivers.push(`Nearest ${sampled ? 'sampled ' : ''}strike ${Math.round(nearestMi)} mi away in the past 24 h`);
      }
      if ((lightning.strikes100mi ?? 0) > 0) {
        drivers.push(`${sampled ? '≈' : ''}${lightning.strikes100mi!.toLocaleString()} strike${lightning.strikes100mi === 1 ? '' : 's'} within 100 mi in the past 24 h`);
      }
      if (sampled) {
        drivers.push(`⚠ Strike data was sampled (${lt.returned.toLocaleString()} of ${lt.totalInWindow.toLocaleString()} returned) — counts are estimates and sparse nearby activity can be missed`);
      }
      if (lt.coverageMin < 23 * 60) {
        drivers.push(`⚠ Only ${(lt.coverageMin / 60).toFixed(1)} h of strike history collected — counts undercount the full day`);
      }
      sections.push({
        id: 'lightning', title: 'Lightning (24 h)', level, drivers,
        countLabel:
          n25 === 0
            ? sampled ? 'None sampled ≤25 mi' : 'None ≤25 mi'
            : `${sampled ? '≈' : ''}${lightning.strikes25mi} ≤25 mi`,
      });
    }
  }

  // ── Rings, overall, sources ───────────────────────────────────────────────
  const ringCounts = RISK_RINGS.map((ring) => ({
    ring,
    hotspots: hotspots.filter((h) => h.distanceMi <= ring.miles).length,
    namedFires: namedFiresAll.filter((f) => f.distanceMi <= ring.miles).length,
  }));

  // ── Map snapshots (parallel, best effort — null just hides that map) ──────
  const MAP_W = 660;

  const drawSite = (ctx: CanvasRenderingContext2D, proj: Parameters<NonNullable<Parameters<typeof renderMapSnapshot>[0]['draw']>>[1]) =>
    drawPin(ctx, proj, target.lat, target.lon);

  const exposureSnapshot = renderMapSnapshot({
    centerLat: target.lat,
    centerLon: target.lon,
    fitRadiusM: MAX_RING_MI * MILES_TO_M,
    width: MAP_W,
    height: 420,
    attribution: '© CARTO © OSM · hotspots NASA FIRMS · incidents NIFC',
    draw: (ctx, proj) => {
      for (const ring of RISK_RINGS) {
        drawRing(ctx, proj, target.lat, target.lon, ring.miles * MILES_TO_M, {
          stroke: 'rgba(61,220,255,0.55)', width: 2, dash: [8, 6], label: ring.label,
        });
      }
      for (const h of hotspots.slice().reverse()) {
        const [x, y] = proj.toXY(h.lon, h.lat);
        const r = 9 + Math.min(11, ((h.frp ?? 0) / 60) * 11);
        drawFlame(ctx, x, y, r);
      }
      namedFires.slice(0, 5).forEach((f, i) => {
        const [x, y] = proj.toXY(f.lon, f.lat);
        const c = containmentColor(f.containmentPct ?? null);
        ctx.beginPath();
        ctx.moveTo(x, y - 11); ctx.lineTo(x + 10, y + 7); ctx.lineTo(x - 10, y + 7);
        ctx.closePath();
        ctx.fillStyle = c;
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.fill(); ctx.stroke();
        if (i < 3) {
          ctx.font = '600 18px Inter, sans-serif';
          ctx.textAlign = 'left';
          ctx.fillStyle = 'rgba(5,7,10,0.75)';
          const tw = ctx.measureText(f.name).width;
          ctx.fillRect(x + 12, y - 12, tw + 8, 24);
          ctx.fillStyle = '#fff';
          ctx.fillText(f.name, x + 16, y + 5);
        }
      });
      drawSite(ctx, proj);
    },
  });

  const alertsSnapshot = alertShapes.length === 0
    ? Promise.resolve(null)
    : renderMapSnapshot({
        centerLat: target.lat,
        centerLon: target.lon,
        fitRadiusM: 60 * MILES_TO_M,
        width: MAP_W,
        height: 340,
        attribution: '© CARTO © OSM · alerts NWS',
        draw: (ctx, proj) => {
          for (const s of alertShapes) {
            drawPolygon(ctx, proj, s.rings, { fill: `${s.colorHex}38`, stroke: s.colorHex, width: 3 });
          }
          drawRing(ctx, proj, target.lat, target.lon, 25 * MILES_TO_M, {
            stroke: 'rgba(61,220,255,0.45)', width: 2, dash: [8, 6], label: '25 mi',
          });
          drawSite(ctx, proj);
        },
      });

  const fuelSnapshot = !inConus || fuel.unavailable
    ? Promise.resolve(null)
    : renderMapSnapshot({
        centerLat: target.lat,
        centerLon: target.lon,
        fitRadiusM: 3.4 * MILES_TO_M,
        width: MAP_W,
        height: 340,
        overlayAlpha: 0.72,
        overlayUrl: (proj) =>
          `${LANDFIRE_FBFM40_IMAGESERVER}/exportImage` +
          `?bbox=${proj.bbox3857.join(',')}` +
          `&bboxSR=3857&imageSR=3857&size=${proj.width},${proj.height}` +
          '&format=png32&transparent=true&f=image',
        attribution: '© CARTO © OSM · fuels LANDFIRE LF2024 FBFM40',
        draw: (ctx, proj) => {
          drawRing(ctx, proj, target.lat, target.lon, 3 * MILES_TO_M, {
            stroke: 'rgba(255,255,255,0.85)', width: 3, label: '3 mi analysis ring',
          });
          drawSite(ctx, proj);
        },
      });

  // Single 72 h accumulation map — the full multi-day picture in one image;
  // per-window site totals live in the strip above it (view-side).
  const qpfSnapshot = renderMapSnapshot({
    centerLat: target.lat,
    centerLon: target.lon,
    fitRadiusM: 220 * MILES_TO_M,
    width: MAP_W,
    height: 380,
    overlayAlpha: 0.68,
    overlayUrl: (proj) =>
      `${WPC_QPF_MAPSERVER}/export` +
      `?bbox=${proj.bbox3857.join(',')}` +
      `&bboxSR=3857&imageSR=3857&size=${proj.width},${proj.height}` +
      `&layers=show:${QPF_LAYER['72h']}` +
      '&format=png32&transparent=true&f=image',
    attribution: '© CARTO © OSM · QPF NOAA/WPC',
    draw: (ctx, proj) => {
      // High-contrast ring: dark casing under a bright dashed stroke — the
      // faint cyan version disappeared against the QPF ramp.
      drawRing(ctx, proj, target.lat, target.lon, 25 * MILES_TO_M, {
        stroke: 'rgba(5,7,10,0.85)', width: 6,
      });
      drawRing(ctx, proj, target.lat, target.lon, 25 * MILES_TO_M, {
        stroke: '#ffffff', width: 2.5, dash: [8, 6], label: '25 mi',
      });
      drawSite(ctx, proj);
    },
  });

  // Regional outlook, today only — every PSA colored by today's class, the
  // site's PSA outlined white; the 7-day picture is the strip above the map.
  // 'No data' PSAs are skipped so they don't gray-blanket the map.
  const outlookValue = outlookRes.value;
  const outlookTodayIdx = outlookDayIdxs[0] ?? 0;
  const outlookSnapshot =
    outlookValue === null
      ? Promise.resolve(null)
      : renderMapSnapshot({
          centerLat: target.lat,
          centerLon: target.lon,
          fitRadiusM: 250 * MILES_TO_M,
          width: MAP_W,
          height: 380,
          attribution: '© CARTO © OSM · outlook NWCG Predictive Services',
          draw: (ctx, proj) => {
            for (const p of outlookValue.psas) {
              const st = outlookStyle(p.days[outlookTodayIdx]?.dryness ?? null, p.days[outlookTodayIdx]?.type ?? null);
              if (st.label === 'No data') continue;
              drawPolygon(ctx, proj, p.rings, { fill: `${st.hex}59`, stroke: `${st.hex}cc`, width: 1.5 });
            }
            if (sitePsaRings) {
              drawPolygon(ctx, proj, sitePsaRings, { fill: 'rgba(0,0,0,0)', stroke: '#ffffff', width: 3 });
            }
            drawSite(ctx, proj);
          },
        });

  // Smoke over the latest HD satellite image: NASA GIBS MODIS Aqua true color
  // (the app's "Earth" basemap, afternoon pass — the best smoke view) with the
  // HMS plumes on top. Match the mosaic to the HMS analysis day when it's a
  // past day; for a today analysis fall back to yesterday's complete mosaic
  // (today's fills in swath by swath and shows black wedges).
  const smokeImageryDate =
    smoke.analysisDate && smoke.analysisDate < todayUtcIso()
      ? smoke.analysisDate
      : addDaysIso(todayUtcIso(), -1);
  smoke.imageryDate = smokeImageryDate;
  // Plumes as density-colored HATCHING + cased outlines — solid fills painted
  // over exactly the smoke the imagery shows, while bare outlines were too
  // easy to confuse with cloud edges. A drawn 45° texture reads unmistakably
  // as "analyst region" and still leaves most of the imagery visible; hatch
  // density scales with smoke density.
  const SMOKE_STYLE: Record<string, { stroke: string; width: number; hatch: string; spacing: number; hatchW: number }> = {
    Light:  { stroke: 'rgba(236,222,152,0.95)', width: 2,   hatch: 'rgba(236,222,152,0.5)', spacing: 30, hatchW: 2 },
    Medium: { stroke: 'rgba(245,158,11,0.95)',  width: 2.5, hatch: 'rgba(245,158,11,0.55)', spacing: 20, hatchW: 2.5 },
    Heavy:  { stroke: 'rgba(220,80,20,1)',      width: 3.5, hatch: 'rgba(220,80,20,0.6)',   spacing: 12, hatchW: 3 },
  };
  const smokeSnapshot = renderMapSnapshot({
    centerLat: target.lat,
    centerLon: target.lon,
    fitRadiusM: 140 * MILES_TO_M,
    width: MAP_W,
    height: 400,
    base: {
      url: (z, x, y) =>
        'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Aqua_CorrectedReflectance_TrueColor' +
        // GIBS WMTS paths are row-before-column: {z}/{y}/{x}.
        `/default/${smokeImageryDate}/GoogleMapsCompatible_Level9/${z}/${y}/${x}.jpg`,
      maxZoom: 9,
    },
    attribution: 'NASA GIBS MODIS Aqua · smoke NOAA HMS · labels © CARTO',
    draw: (ctx, proj) => {
      const DENSITY_RANK: Record<string, number> = { Light: 0, Medium: 1, Heavy: 2 };
      const ordered = smokePolys.slice().sort((a, b) => (DENSITY_RANK[a.density] ?? 0) - (DENSITY_RANK[b.density] ?? 0));
      for (const p of ordered) {
        const st = SMOKE_STYLE[p.density] ?? SMOKE_STYLE.Light;
        drawHatchedPolygon(ctx, proj, [p.coords], {
          color: st.stroke,
          width: st.width,
          hatchColor: st.hatch,
          hatchSpacing: st.spacing,
          hatchWidth: st.hatchW,
          casing: 'rgba(5,7,10,0.55)',
        });
      }
      // High-contrast ring — must read over both bright cloud and dark terrain.
      drawRing(ctx, proj, target.lat, target.lon, 25 * MILES_TO_M, { stroke: 'rgba(5,7,10,0.85)', width: 6 });
      drawRing(ctx, proj, target.lat, target.lon, 25 * MILES_TO_M, { stroke: '#ffffff', width: 2.5, dash: [8, 6], label: '25 mi' });
      drawSite(ctx, proj);
    },
  });

  // Lightning, past 24 h — age-tinted dots (same palette as the globe layer),
  // oldest drawn first so fresh strikes sit on top.
  const AGE_TINTS: { maxH: number; color: string }[] = [
    { maxH: 1, color: 'rgba(255,216,77,0.95)' },
    { maxH: 6, color: 'rgba(255,157,46,0.82)' },
    { maxH: 12, color: 'rgba(255,90,60,0.64)' },
    { maxH: Infinity, color: 'rgba(216,70,110,0.46)' },
  ];
  const lightningSnapshot = lightningRes.value === null
    ? Promise.resolve(null)
    : renderMapSnapshot({
        centerLat: target.lat,
        centerLon: target.lon,
        fitRadiusM: 110 * MILES_TO_M,
        width: MAP_W,
        height: 400,
        attribution: '© CARTO © OSM · strikes Blitzortung.org',
        draw: (ctx, proj) => {
          const nowS = Date.now() / 1000;
          for (const s of strikes.slice().sort((a, b) => a.t - b.t)) {
            const ageH = (nowS - s.t) / 3600;
            const tint = AGE_TINTS.find((a) => ageH < a.maxH) ?? AGE_TINTS[AGE_TINTS.length - 1];
            const [x, y] = proj.toXY(s.lon, s.lat);
            ctx.beginPath();
            ctx.arc(x, y, 3.5, 0, Math.PI * 2);
            ctx.fillStyle = tint.color;
            ctx.fill();
          }
          drawRing(ctx, proj, target.lat, target.lon, 25 * MILES_TO_M, { stroke: 'rgba(61,220,255,0.55)', width: 2, dash: [8, 6], label: '25 mi' });
          drawRing(ctx, proj, target.lat, target.lon, 100 * MILES_TO_M, { stroke: 'rgba(61,220,255,0.4)', width: 2, dash: [8, 6], label: '100 mi' });
          drawSite(ctx, proj);
        },
      });

  const [exposureMap, alertsMap, fuelMap, qpfMap, smokeMap, lightningMap, outlookMap] = await Promise.all([
    exposureSnapshot, alertsSnapshot, fuelSnapshot,
    qpfSnapshot, smokeSnapshot, lightningSnapshot, outlookSnapshot,
  ]);

  // ── 10-day forecast strip data ────────────────────────────────────────────
  const forecastDaily: WildfireReportData['forecastDaily'] = (() => {
    const d = dailyRes.value?.daily;
    if (!d || d.time.length === 0) {
      return { unavailable: `Daily forecast unavailable (${dailyRes.error ?? 'unknown error'})` };
    }
    return {
      days: d.time.map((date, i) => ({
        date,
        code: d.weatherCode[i] ?? 0,
        tMaxF: d.tMaxF[i] ?? NaN,
        tMinF: d.tMinF[i] ?? NaN,
        precipIn: d.precipIn[i] ?? 0,
        precipProbPct: d.precipProbPct[i] ?? 0,
        windMaxMph: d.windMaxMph[i] ?? 0,
        gustMaxMph: d.gustMaxMph[i] ?? 0,
      })),
    };
  })();

  // ── Site rainfall chips — WPC point values first (same product as the map),
  // daily point forecast as a clearly-labeled fallback ──────────────────────
  const rain: WildfireReportData['rain'] = (() => {
    if (wpcQpfRes.value) return { ...wpcQpfRes.value, source: 'wpc' as const };
    if ('days' in forecastDaily && forecastDaily.days.length > 0) {
      const sum = (n: number) =>
        forecastDaily.days.slice(0, n).reduce((a, d) => a + d.precipIn, 0);
      return { in24: sum(1), in48: sum(2), in72: sum(3), source: 'daily' as const };
    }
    return { unavailable: `Rainfall point values unavailable (${wpcQpfRes.error ?? 'unknown error'})` };
  })();

  const available = sections.filter((s) => !s.unavailable);
  if (available.length === 0) {
    throw new Error('All wildfire feeds are unavailable — cannot assemble a report');
  }
  const overallLevel = available.reduce<RiskLevel>((acc, s) => maxLevel(acc, s.level), 'low');
  const overallDrivers = available.flatMap((s) => (s.level === 'low' ? [] : s.drivers));
  const downFeeds = sections.filter((s) => s.unavailable);
  if (downFeeds.length > 0) {
    overallDrivers.push(`⚠ ${downFeeds.length} feed${downFeeds.length === 1 ? '' : 's'} unavailable — this picture is incomplete`);
  }

  return {
    target,
    generatedAt: new Date().toISOString(),
    overall: { level: overallLevel, drivers: overallDrivers },
    sections,
    ringCounts,
    hotspots: hotspots.slice(0, 8),
    namedFires,
    alerts,
    outlook: outlookRes.value === null ? { unavailable: 'feed down' } : { today: outlookToday, days: outlookDays },
    smoke,
    lightning,
    fuel,
    wind,
    sources: [
      { name: 'NASA FIRMS (VIIRS)', detail: 'satellite thermal hotspots, past 24 h, via Esri Living Atlas' },
      { name: 'NIFC / WFIGS', detail: 'named incidents ≥5 acres, acreage and containment' },
      { name: 'NWS api.weather.gov', detail: 'active alerts, county geometry resolved for zone-based alerts' },
      { name: 'NWCG Predictive Services', detail: '7-day significant fire potential by PSA' },
      { name: 'LANDFIRE LF2024 FBFM40', detail: '30 m fuel models, 3 mi zonal histogram + raster snapshot' },
      { name: 'NOAA GFS · Open-Meteo', detail: 'point wind forecast (48 h) and 10-day daily forecast' },
      { name: 'NOAA WPC', detail: 'quantitative precipitation forecast, 24/48/72 h accumulation' },
      { name: 'NOAA HMS', detail: 'analyst-drawn smoke plumes from GOES/VIIRS imagery, latest analysis day' },
      { name: 'NASA GIBS', detail: 'MODIS Aqua true-color daily mosaic (satellite snapshot base)' },
      { name: 'Blitzortung.org', detail: 'community lightning detection network, past 24 h of strikes' },
      { name: 'CARTO · OpenStreetMap', detail: 'map snapshot base tiles' },
    ],
    gaps,
    maps: {
      exposure: exposureMap,
      alerts: alertsMap,
      fuel: fuelMap,
      qpf: qpfMap,
      outlook: outlookMap,
      smoke: smokeMap,
      lightning: lightningMap,
    },
    windHourly,
    forecastDaily,
    rain,
  };
}
