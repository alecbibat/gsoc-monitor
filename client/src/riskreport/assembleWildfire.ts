import { api } from '../api/client';
import { fetchHotspotsNearPins, type FireHotspot } from '../layers/fires/firesData';
import { fetchWildfires, type NamedFire } from '../layers/wildfires/wildfiresData';
import { fetchActiveAlerts, loadCounties, alertRings, severityRank, type RawAlert } from '../layers/alerts/alertsData';
import { fmtOutlookDate, outlookStyle } from '../layers/fireOutlook/fireOutlookMeta';
import { LANDFIRE_CONUS_RECT } from '../layers/fuel/landfireService';
import { analyzeFuelZone } from '../fuelzone/zonalStats';
import { haversineMeters, MILES_TO_M, pointInRings } from '../lib/geo';
import {
  RISK_RINGS, bumpLevel, maxLevel,
  type AlertHit, type HotspotHit, type NamedFireHit, type RiskLevel,
  type RiskTarget, type SectionResult, type WildfireReportData,
} from './riskTypes';

// ── Wildfire report assembly ─────────────────────────────────────────────────
// Thresholds live in docs/RISK-REPORT-MATRIX.md — change them there first.
// Every feed fails independently: a down feed becomes an "unavailable" section
// (excluded from the overall level, surfaced in the report) — never a silent
// Low, matching the fail-honest rule the Property Watch follows.

const MPS_TO_MPH = 2.236936;
const MAX_RING_MI = RISK_RINGS[RISK_RINGS.length - 1].miles; // 100

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

  const [hotspotsRes, namedRes, alertsRes, countiesRes, outlookRes, fuelRes, windRes] = await Promise.all([
    attempt(fetchHotspotsNearPins(MAX_RING_MI * MILES_TO_M)),
    attempt(fetchWildfires()),
    attempt(fetchActiveAlerts()),
    attempt(loadCounties()),
    attempt(api.fireOutlook()),
    inConus
      ? attempt(analyzeFuelZone({ lon: target.lon, lat: target.lat }, 3 * MILES_TO_M))
      : Promise.resolve({ value: null, error: 'outside CONUS' } as FeedOutcome<Awaited<ReturnType<typeof analyzeFuelZone>>>),
    attempt(api.windForecast(target.lat, target.lon)),
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
          distanceMi: distMi(target, f.lat, f.lon),
          acres: f.acres ?? undefined,
          containmentPct: f.contained ?? undefined,
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
      } else if (withDist.length > 0) {
        level = 'guarded';
        drivers.push(`${withDist.length} incident${withDist.length === 1 ? '' : 's'} within 100 mi, all ≥50% contained`);
      }
      sections.push({ id: 'named-fires', title: 'Named fire incidents (NIFC)', level, drivers });
    }
  }

  // ── Fire-weather alerts at the site ───────────────────────────────────────
  let alerts: AlertHit[] = [];
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

      let level: RiskLevel = 'low';
      const drivers: string[] = [];
      for (const { a } of hits) {
        const e = (a.properties.event ?? '').toLowerCase();
        if (/red flag|evacuation|fire warning|extreme fire/.test(e)) level = maxLevel(level, 'high');
        else if (/fire weather/.test(e)) level = maxLevel(level, 'elevated');
        else level = maxLevel(level, 'guarded');
        drivers.push(`${a.properties.event} in effect at the property`);
      }
      const section: SectionResult = { id: 'alerts', title: 'Fire-weather alerts at site', level, drivers };
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

  // ── Rings, overall, sources ───────────────────────────────────────────────
  const ringCounts = RISK_RINGS.map((ring) => ({
    ring,
    hotspots: hotspots.filter((h) => h.distanceMi <= ring.miles).length,
    namedFires: namedFiresAll.filter((f) => f.distanceMi <= ring.miles).length,
  }));

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
    outlook: outlookRes.value === null ? { unavailable: 'feed down' } : { today: outlookToday },
    fuel,
    wind,
    sources: [
      { name: 'NASA FIRMS (VIIRS)', detail: 'satellite thermal hotspots, past 24 h, via Esri Living Atlas' },
      { name: 'NIFC / WFIGS', detail: 'named incidents ≥5 acres, acreage and containment' },
      { name: 'NWS api.weather.gov', detail: 'active alerts, county geometry resolved for zone-based alerts' },
      { name: 'NWCG Predictive Services', detail: '7-day significant fire potential by PSA' },
      { name: 'LANDFIRE LF2024 FBFM40', detail: '30 m fuel models, 3 mi zonal histogram' },
      { name: 'NOAA GFS · Open-Meteo', detail: 'point wind forecast (48 h window shown)' },
    ],
    gaps,
  };
}
