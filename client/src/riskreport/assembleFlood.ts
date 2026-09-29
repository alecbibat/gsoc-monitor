import { api } from '../api/client';
import { alertColorHex, alertRings, fetchActiveAlerts, fetchAlertsAtPoint, loadCounties, type RawAlert } from '../layers/alerts/alertsData';
import { LANDFIRE_CONUS_RECT } from '../layers/fuel/landfireService';
import { CAT, catSev } from '../layers/rivers/riverMeta';
import { haversineMeters, MILES_TO_M, pointInRings } from '../lib/geo';
import type { FemaZoneResponse, OfflineGauge, RiverDetail, RiverGauge } from '../types';
import { drawHatchedPolygon, drawPin, drawRing, renderMapSnapshot, type SnapshotProjection } from './mapSnapshot';
import { fetchWpcSiteQpf, renderQpfSnapshot } from './wpcQpf';
import { fetchEroPolygons, fetchEroSiteDays } from './wpcEro';
import { fetchBurnScars } from './burnScars';
import { BURN_SCAR_STYLE, FEMA_CLASS_ORDER, FEMA_CLASS_STYLE, OFFLINE_GAUGE_COLOR, femaZoneClass } from './floodPalette';
import {
  buildAntecedentSection, buildBurnScarSection, buildDischargeSection, buildEroSection, buildFemaSection,
  buildFloodAlertsSection, buildGaugeSection, buildRainSection, computeFloodOverall, countyResolvedHit,
  floodRingCounts, gaugeTier, nearestBurnScar, pickDetailGauges, rainSignalFrom, sortFloodAlerts,
  summarizePrecip, toFloodAlertHit, unavailableSection, type AntecedentSummary, type BurnScarInput,
} from './floodSections';
import { ERO_META, type EroDay, type EroPolygon, type FloodAlertHit, type FloodReportData, type GaugeDetailView, type GaugeHit } from './floodTypes';
import { RISK_RINGS, type RiskTarget, type SectionResult } from './riskTypes';
import type { FloodFeedId, OnFeedResult } from './feedManifest';

// ── Flood report assembly ────────────────────────────────────────────────────
// Thresholds live in the Flood table of docs/RISK-REPORT-MATRIX.md and are
// applied by the pure builders in floodSections.ts; this file acquires the
// feeds, hands each builder its input and renders the snapshot maps. Every
// feed fails independently: a down or out-of-coverage feed becomes an
// "unavailable" section (excluded from the overall level, surfaced in the
// report) — never a silent Low. Most flood products are US-only, so coverage
// is checked BEFORE fetching: an empty answer from outside a product's domain
// would otherwise read as a verified all-clear.

const MAX_RING_MI = RISK_RINGS[RISK_RINGS.length - 1].miles; // 100
const MAP_W = 660;

const todayUtcIso = () => new Date().toISOString().slice(0, 10);
const addDaysIso = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

// Rough boxes for NWS / NWPS / FEMA / WFIGS coverage: CONUS, Alaska (with the
// Aleutians across the antimeridian), Hawaii, Puerto Rico, the USVI, Guam +
// the Northern Marianas, American Samoa. Generous at the edges on purpose — a
// border property inside the box whose feed then answers empty still reads
// the feed's own words, while one outside is never shown a false all-clear.
// `territory`: the county outlines don't cover it, so its zone-based alerts
// can only be placed by NWS's own point lookup.
const US_BOXES: { west: number; east: number; south: number; north: number; territory?: true }[] = [
  { west: -125.5, east: -66.5, south: 24.0, north: 49.9 },
  { west: -180, east: -129.5, south: 51.0, north: 71.6 },
  { west: 172.0, east: 180, south: 51.0, north: 53.5 },
  { west: -161.0, east: -154.5, south: 18.5, north: 22.5 },
  { west: -68.0, east: -65.15, south: 17.6, north: 18.6 },
  { west: -65.15, east: -64.3, south: 17.6, north: 18.5, territory: true },
  { west: 144.5, east: 146.2, south: 13.1, north: 20.7, territory: true },
  { west: -171.2, east: -168.0, south: -14.7, north: -14.1, territory: true },
];

const boxOf = (lat: number, lon: number) =>
  US_BOXES.find((b) => lon >= b.west && lon <= b.east && lat >= b.south && lat <= b.north);

export const inUsCoverage = (lat: number, lon: number) => boxOf(lat, lon) !== undefined;

// WPC's outlook and QPF products are drawn for the lower 48 only.
export const inConusCoverage = (lat: number, lon: number) =>
  lon >= LANDFIRE_CONUS_RECT.west && lon <= LANDFIRE_CONUS_RECT.east &&
  lat >= LANDFIRE_CONUS_RECT.south && lat <= LANDFIRE_CONUS_RECT.north;

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

const skipped = <T>(reason: string): Promise<FeedOutcome<T>> => Promise.resolve({ value: null, error: reason });

// ── Snapshot drawing helpers (flood-specific) ────────────────────────────────

/**
 * One multi-ring feature as a single path filled with the even-odd rule, so
 * holes (an X island inside an AE zone, a levee cut-out) stay holes.
 */
function drawZone(
  ctx: CanvasRenderingContext2D,
  proj: SnapshotProjection,
  rings: number[][][],
  style: { fill: string | null; stroke: string; width: number; hatch?: boolean }
) {
  const path = () => {
    ctx.beginPath();
    for (const ring of rings) {
      if (ring.length < 3) continue;
      ring.forEach(([lon, lat], i) => {
        const [x, y] = proj.toXY(lon, lat);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.closePath();
    }
  };
  ctx.save();
  if (style.fill) {
    path();
    ctx.fillStyle = style.fill;
    ctx.fill('evenodd');
  }
  if (style.hatch) {
    // Diagonal texture on top of the fill — the floodway reads as "inside the
    // floodplain, and worse" on paper as well as on screen.
    ctx.save();
    path();
    ctx.clip('evenodd');
    ctx.strokeStyle = style.stroke;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let d = -proj.height; d < proj.width + proj.height; d += 14) {
      ctx.moveTo(d, 0);
      ctx.lineTo(d + proj.height, proj.height);
    }
    ctx.stroke();
    ctx.restore();
  }
  path();
  ctx.strokeStyle = style.stroke;
  ctx.lineWidth = style.width;
  ctx.stroke();
  ctx.restore();
}

/** Dark-cased bright dashed ring — readable over any fill or ramp. */
function drawCasedRing(ctx: CanvasRenderingContext2D, proj: SnapshotProjection, target: RiskTarget, miles: number, label: string) {
  drawRing(ctx, proj, target.lat, target.lon, miles * MILES_TO_M, { stroke: 'rgba(5,7,10,0.85)', width: 6 });
  drawRing(ctx, proj, target.lat, target.lon, miles * MILES_TO_M, { stroke: '#ffffff', width: 2.5, dash: [8, 6], label });
}

function drawLabel(ctx: CanvasRenderingContext2D, x: number, y: number, text: string) {
  ctx.save();
  ctx.font = '600 18px Inter, sans-serif';
  ctx.textAlign = 'left';
  const t = text.length > 30 ? `${text.slice(0, 29)}…` : text;
  const tw = ctx.measureText(t).width;
  ctx.fillStyle = 'rgba(5,7,10,0.78)';
  ctx.fillRect(x + 12, y - 12, tw + 8, 24);
  ctx.fillStyle = '#fff';
  ctx.fillText(t, x + 16, y + 5);
  ctx.restore();
}

const toDetailView = (d: RiverDetail, hit: GaugeHit): GaugeDetailView => ({
  lid: d.lid,
  name: d.name || hit.name,
  distanceMi: hit.distanceMi,
  primaryName: d.primaryName,
  unit: d.unit,
  observed: { value: d.observed.value, cat: d.observed.cat, time: d.observed.time },
  crest: { value: d.forecastCrest.value, cat: d.forecastCrest.cat, time: d.forecastCrest.time },
  trend: d.trend,
  thresholds: d.thresholds ?? [],
  observedSeries: d.observedSeries ?? [],
  forecastSeries: d.forecastSeries ?? [],
  impacts: d.impacts ?? [],
  recordCrest: d.recordCrest,
  forecastReliability: d.forecastReliability,
  inServiceMsg: d.inServiceMsg,
  offline: hit.offline,
  obsTime: hit.obsTime,
});

export async function assembleFloodReport(
  target: RiskTarget,
  onFeed?: OnFeedResult<FloodFeedId>,
  signal?: AbortSignal
): Promise<FloodReportData> {
  const inUs = inUsCoverage(target.lat, target.lon);
  const inConus = inConusCoverage(target.lat, target.lon);

  const distMi = (lat: number, lon: number) =>
    haversineMeters(target.lat, target.lon, lat, lon) / MILES_TO_M;

  // Reports each feed's outcome to the loading screen the moment it settles.
  // `ok` mirrors the section's own unavailable logic for feeds that resolve
  // with an in-band problem (a warming NWPS snapshot, a discharge answer with
  // no return-period thresholds) — the console must not show LOCK for an
  // outage the report will then call unavailable.
  const track = <T>(
    id: FloodFeedId,
    p: Promise<T>,
    ok: (v: T) => boolean = () => true
  ): Promise<FeedOutcome<T>> =>
    attempt(p).then((o) => {
      onFeed?.(id, o.error === null && o.value !== null && ok(o.value) ? 'ok' : 'failed');
      return o;
    });

  if (!inUs) {
    onFeed?.('alerts', 'skipped');
    onFeed?.('alert-areas', 'skipped');
    onFeed?.('counties', 'skipped');
    onFeed?.('fema', 'skipped');
    onFeed?.('burn-scars', 'skipped');
  }
  if (!inConus) {
    onFeed?.('ero', 'skipped');
    onFeed?.('qpf', 'skipped');
  }

  // Gauges feed the per-gauge detail stage: it needs the nearby list to pick
  // which forecast points to open, so it chains off the bulk pull while every
  // other feed runs alongside. Points that have stopped reporting come in
  // their own list and join as `offline` — a dark gauge beside the property
  // must be said, not skipped.
  const gaugesP = track('gauges', api.rivers(), (v) => !v.warming);
  const nearbyP = gaugesP.then((o): GaugeHit[] | null => {
    if (o.value === null || o.value.warming) return null;
    const hits: GaugeHit[] = [];
    const dLat = MAX_RING_MI / 69 + 0.1;
    for (const g of o.value.gauges as RiverGauge[]) {
      if (Math.abs(g.lat - target.lat) > dLat) continue; // cheap prefilter over ~12.7k points
      const d = distMi(g.lat, g.lon);
      if (d > MAX_RING_MI) continue;
      hits.push({
        lid: g.lid, name: g.name, state: g.state, lat: g.lat, lon: g.lon, distanceMi: d,
        cat: g.cat, fcat: g.fcat, stage: g.stage, unit: g.unit, isFlow: g.isFlow,
      });
    }
    for (const g of (o.value.offline ?? []) as OfflineGauge[]) {
      if (Math.abs(g.lat - target.lat) > dLat) continue;
      const d = distMi(g.lat, g.lon);
      if (d > MAX_RING_MI) continue;
      hits.push({
        lid: g.lid, name: g.name, state: g.state, lat: g.lat, lon: g.lon, distanceMi: d,
        cat: 'none', fcat: g.fcat, stage: null, unit: '', isFlow: false,
        offline: g.status, obsTime: g.obsTime,
      });
    }
    return hits.sort((a, b) => a.distanceMi - b.distanceMi);
  });
  const detailsP = nearbyP.then(async (nearby): Promise<GaugeDetailView[]> => {
    const picks = nearby ? pickDetailGauges(nearby) : [];
    if (picks.length === 0) {
      onFeed?.('gauge-detail', 'skipped');
      return [];
    }
    const settled = await Promise.allSettled(picks.map((p) => api.riverDetail(p.lid)));
    const views: GaugeDetailView[] = [];
    settled.forEach((r, i) => {
      if (r.status === 'fulfilled') views.push(toDetailView(r.value, picks[i]));
    });
    onFeed?.('gauge-detail', views.length > 0 ? 'ok' : 'failed');
    return views;
  });

  const [
    siteAlertsRes, alertsRes, countiesRes, nearby, gaugesRes, gaugeDetails, eroRes, eroPolysRes, qpfRes,
    femaRes, precipRes, dischargeRes, scarsRes, dailyRes,
  ] = await Promise.all([
    inUs ? track('alerts', fetchAlertsAtPoint(target.lat, target.lon)) : skipped<RawAlert[]>('outside NWS coverage'),
    inUs ? track('alert-areas', fetchActiveAlerts()) : skipped<RawAlert[]>('outside NWS coverage'),
    inUs ? track('counties', loadCounties()) : skipped<Map<string, GeoJSON.Geometry>>('outside NWS coverage'),
    nearbyP,
    gaugesP,
    detailsP,
    inConus ? track('ero', fetchEroSiteDays(target.lat, target.lon)) : skipped<Awaited<ReturnType<typeof fetchEroSiteDays>>>('outside CONUS'),
    // The Day 1 map's polygons are a separate best-effort query: the section
    // stands on the exact point queries above, a failed map just hides.
    inConus ? attempt(fetchEroPolygons(target.lat, target.lon, 1)) : skipped<EroPolygon[]>('outside CONUS'),
    inConus ? track('qpf', fetchWpcSiteQpf(target.lat, target.lon)) : skipped<Awaited<ReturnType<typeof fetchWpcSiteQpf>>>('outside WPC coverage'),
    inUs ? track('fema', api.floodZone(target.lat, target.lon)) : skipped<FemaZoneResponse>('outside NFHL coverage'),
    track('precip', api.floodPrecip(target.lat, target.lon), (v) => v.daily.time.length > 0),
    // Without thresholds the section is unavailable (the chart still draws).
    track('discharge', api.floodDischarge(target.lat, target.lon), (v) => v.time.length > 0 && v.thresholds !== null),
    inUs ? track('burn-scars', fetchBurnScars(target.lat, target.lon)) : skipped<Awaited<ReturnType<typeof fetchBurnScars>>>('outside WFIGS coverage'),
    track('daily', api.weatherDaily(target.lat, target.lon)),
  ]);

  // Report closed/retargeted while feeds were in flight: skip the snapshot
  // stage (hundreds of tile requests + PNG encodes) whose result is discarded.
  if (signal?.aborted) throw new DOMException('Report closed', 'AbortError');

  // The property's local calendar day — the precip feed's UTC offset, else a
  // longitude estimate (same approximation the wildfire outlook uses).
  const off = precipRes.value?.utcOffsetSeconds;
  const offSec = typeof off === 'number' && Number.isFinite(off) ? off : Math.round(target.lon / 15) * 3600;
  const nowMs = Date.now();
  const localDate = (ms: number) => new Date(ms + offSec * 1000).toISOString().slice(0, 10);
  // Without the precip feed's offset, the daily feed's IANA zone beats the
  // longitude estimate (which ignores DST and Alaska time) for "today".
  const zoneToday = (tz: string | undefined): string | null => {
    try {
      return tz
        ? new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(nowMs))
        : null;
    } catch {
      return null;
    }
  };
  const localToday =
    typeof off === 'number' && Number.isFinite(off) ? localDate(nowMs) : zoneToday(dailyRes.value?.timezone) ?? localDate(nowMs);

  const sections: SectionResult[] = [];

  // ── Flood-family alerts at the site (+ the regional picture for the map) ──
  // The site test is NWS's own point lookup: it resolves forecast zones,
  // county zones and storm polygons the way NWS issued them. The national
  // list only draws the regional picture — and places site hits by polygon /
  // county outline when the lookup itself is down.
  let alerts: FloodAlertHit[] = [];
  const siteAlertShapes: { rings: number[][][]; colorHex: string }[] = [];
  const regionalAlertShapes: { rings: number[][][]; colorHex: string }[] = [];
  const counties = countiesRes.value; // null = county-based alerts can't be drawn or matched
  const alertId = (a: RawAlert) => a.id ?? a.properties.id ?? `${a.properties.event}|${a.properties.expires}|${a.properties.areaDesc}`;
  if (alertsRes.value !== null) {
    const siteIds = new Set((siteAlertsRes.value ?? []).map(alertId));
    for (const a of alertsRes.value) {
      if (!toFloodAlertHit(a) || siteIds.has(alertId(a))) continue;
      const rings = alertRings(a, counties);
      if (rings.length === 0) continue;
      // River Flood Warnings along a nearby reach usually don't include the
      // property's own county — they belong on the hero map regardless.
      if (rings.some((r) => r.some(([lo, la]) => distMi(la, lo) <= 140))) {
        regionalAlertShapes.push({ rings, colorHex: alertColorHex(a.properties.event ?? '', a.properties.severity ?? '') });
      }
    }
  }
  if (!inUs) {
    sections.push(unavailableSection('alerts', 'NWS alerts cover the US and its territories only'));
  } else if (siteAlertsRes.value !== null) {
    for (const a of siteAlertsRes.value) {
      const hit = toFloodAlertHit(a);
      if (!hit) continue;
      alerts.push(hit);
      const rings = alertRings(a, counties);
      if (rings.length > 0) {
        const shape = { rings, colorHex: alertColorHex(a.properties.event ?? '', a.properties.severity ?? '') };
        siteAlertShapes.push(shape);
        regionalAlertShapes.push(shape);
      }
    }
    alerts = sortFloodAlerts(alerts);
    sections.push(buildFloodAlertsSection(alerts, { countiesDown: false }));
  } else if (alertsRes.value !== null) {
    // Fallback: place the national list at the site ourselves. A storm
    // polygon is exact; a county outline is not — those hits say so, and
    // coastal-only products are capped (see countyResolvedHit).
    const hits: FloodAlertHit[] = [];
    for (const a of alertsRes.value) {
      const hit = toFloodAlertHit(a);
      if (!hit) continue;
      const rings = alertRings(a, counties);
      if (rings.length === 0 || !pointInRings(target.lon, target.lat, rings)) continue;
      const ownPolygon = a.geometry?.type === 'Polygon' || a.geometry?.type === 'MultiPolygon';
      hits.push(ownPolygon ? hit : countyResolvedHit(hit));
      siteAlertShapes.push({ rings, colorHex: alertColorHex(a.properties.event ?? '', a.properties.severity ?? '') });
    }
    alerts = sortFloodAlerts(hits);
    sections.push(buildFloodAlertsSection(alerts, {
      countiesDown: counties === null,
      pointLookupDown: true,
      unplaceable: boxOf(target.lat, target.lon)?.territory === true,
    }));
  } else {
    sections.push(unavailableSection('alerts', `NWS alerts unavailable (point lookup: ${siteAlertsRes.error ?? 'unknown error'}; national list: ${alertsRes.error ?? 'unknown error'})`));
  }

  // ── River gauges (NWPS) ───────────────────────────────────────────────────
  const gaugesAll: GaugeHit[] = nearby ?? [];
  if (gaugesRes.value === null) {
    sections.push(unavailableSection('gauges', `NWPS river gauges unavailable (${gaugesRes.error ?? 'unknown error'})`));
  } else if (gaugesRes.value.warming || nearby === null) {
    sections.push(unavailableSection('gauges', 'NWPS gauge snapshot is still loading on the server — reopen the report in a minute'));
  } else {
    sections.push(buildGaugeSection(gaugesAll, { inUs }));
  }
  // The nearest point with a current NWS river forecast — the one that
  // outranks the GloFAS model. An observation-only or threshold-less gauge
  // says nothing about where the river is going.
  // A dark gauge counts only while its forecast says something (action or
  // worse) — one the gauge section calls "state unknown" can't outrank the model.
  const forecastGauge =
    gaugesAll.find(
      (g) => g.distanceMi <= 25 && g.fcat !== null && g.fcat !== 'none' && (!g.offline || catSev(g.fcat) >= 1)
    ) ?? null;
  // Display list: within 25 mi every flooding point first, then the nearest
  // others up to 10; beyond it, points that are (or are forecast to be) in
  // flood — a flooding river 60 mi out still matters for access and supply.
  const near25 = gaugesAll.filter((g) => g.distanceMi <= 25);
  const near25Shown = [
    ...near25.filter((g) => catSev(gaugeTier(g)) >= 2),
    ...near25.filter((g) => catSev(gaugeTier(g)) < 2),
  ].slice(0, 10);
  const gaugesShown = [
    ...near25Shown.sort((a, b) => a.distanceMi - b.distanceMi),
    ...gaugesAll.filter((g) => g.distanceMi > 25 && catSev(gaugeTier(g)) >= 2).slice(0, 6),
  ];

  // ── Excessive Rainfall Outlook (WPC, Days 1–5) ────────────────────────────
  // Each day is a 12Z–12Z period. When the site sits inside a risk area the
  // product gives the period start; otherwise it is estimated from WPC's
  // cycle: the new Day 1 (starting 12Z today) is issued around 09Z, so before
  // then Day 1 is the period that started 12Z yesterday.
  let eroDays: EroDay[] | undefined;
  if (!inConus) {
    sections.push(unavailableSection('ero', "WPC's Excessive Rainfall Outlook covers the contiguous US only"));
  } else if (eroRes.value === null) {
    sections.push(unavailableSection('ero', `WPC outlook unavailable (${eroRes.error ?? 'unknown error'})`));
  } else {
    const utc = new Date(nowMs);
    const day1Start =
      Date.UTC(utc.getUTCFullYear(), utc.getUTCMonth(), utc.getUTCDate(), 12) - (utc.getUTCHours() < 9 ? 86_400_000 : 0);
    eroDays = eroRes.value.map((d) => {
      const startMs = d.startMs ?? day1Start + (d.day - 1) * 86_400_000;
      return { day: d.day, category: d.category, startMs, date: localDate(startMs) };
    });
    sections.push(buildEroSection(eroDays, nowMs));
  }

  // ── 10-day forecast strip data (also the last rainfall fallback) ──────────
  const forecastDaily: FloodReportData['forecastDaily'] = (() => {
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
        // A missing day stays NaN (prints "—"), never a dry "0 in".
        precipIn: d.precipIn[i] ?? NaN,
        precipProbPct: d.precipProbPct[i] ?? 0,
        windMaxMph: d.windMaxMph[i] ?? 0,
        gustMaxMph: d.gustMaxMph[i] ?? 0,
      })),
    };
  })();

  // ── Recent rainfall (antecedent) + what's still to come, hourly ───────────
  let antecedentSummary: AntecedentSummary | null = null;
  let hourlyRain: FloodReportData['hourlyRain'] = null;
  let hourlyAhead: ReturnType<typeof summarizePrecip>['forecast'] = {};
  const antecedent: FloodReportData['antecedent'] = {};
  if (precipRes.value === null) {
    antecedent.unavailable = `Rainfall history unavailable (${precipRes.error ?? 'unknown error'})`;
  } else {
    const summary = summarizePrecip(precipRes.value, nowMs);
    antecedentSummary = summary.antecedent;
    hourlyRain = summary.hourlyNext48;
    hourlyAhead = summary.forecast;
    Object.assign(antecedent, summary.antecedent);
  }

  // ── Forecast rainfall — WPC at the site first (the same product as the
  // map); else the hourly point forecast summed from now (the only source
  // outside the lower 48); else whole days from TOMORROW — today's calendar
  // total already holds rain that has fallen, which the antecedent counts ──
  const rain: FloodReportData['rain'] = (() => {
    if (qpfRes.value) return { ...qpfRes.value, source: 'wpc' as const };
    if (hourlyAhead.in24 !== undefined && hourlyAhead.in48 !== undefined && hourlyAhead.in72 !== undefined) {
      return { ...hourlyAhead, source: 'hourly' as const };
    }
    if ('days' in forecastDaily) {
      const ahead = forecastDaily.days.filter((d) => d.date > localToday);
      const sum = (n: number) =>
        ahead.length >= n && ahead.slice(0, n).every((d) => Number.isFinite(d.precipIn))
          ? ahead.slice(0, n).reduce((a, d) => a + d.precipIn, 0)
          : undefined;
      if (sum(1) !== undefined) {
        return { in24: sum(1), in48: sum(2), in72: sum(3), in120: sum(5), source: 'daily' as const };
      }
    }
    return {
      unavailable: `Rainfall forecast unavailable (WPC: ${qpfRes.error ?? 'unknown error'}; hourly: ${precipRes.error ?? 'incomplete series'}; daily: ${dailyRes.error ?? 'incomplete series'})`,
    };
  })();

  // A wet-ground reading from the same failed feed can't vouch for dry ground.
  const antecedentForRain = antecedent.unavailable ? null : antecedentSummary;
  sections.push(rain.unavailable ? unavailableSection('rain', rain.unavailable) : buildRainSection(rain, antecedentForRain));
  sections.push(
    antecedent.unavailable ? unavailableSection('antecedent', antecedent.unavailable) : buildAntecedentSection(antecedentSummary ?? {})
  );

  // ── FEMA flood zone (NFHL) ────────────────────────────────────────────────
  let fema: FloodReportData['fema'] = {};
  if (!inUs) {
    fema = { unavailable: 'FEMA flood maps cover the US and its territories only' };
    sections.push(unavailableSection('fema', fema.unavailable!));
  } else if (femaRes.value === null) {
    fema = { unavailable: `FEMA NFHL unavailable (${femaRes.error ?? 'unknown error'})` };
    sections.push(unavailableSection('fema', fema.unavailable!));
  } else {
    const built = buildFemaSection(femaRes.value);
    fema = built.fema;
    sections.push(built.section);
  }

  // ── Burn scars (this year's WFIGS perimeters) ─────────────────────────────
  let burnScars: FloodReportData['burnScars'] = {};
  let scarInputs: BurnScarInput[] = [];
  if (!inUs) {
    burnScars = { unavailable: 'WFIGS fire perimeters cover the US only' };
    sections.push(unavailableSection('burn-scars', burnScars.unavailable!));
  } else if (scarsRes.value === null) {
    burnScars = { unavailable: `WFIGS perimeters unavailable (${scarsRes.error ?? 'unknown error'})` };
    sections.push(unavailableSection('burn-scars', burnScars.unavailable!));
  } else {
    scarInputs = scarsRes.value.scars;
    const summary = nearestBurnScar(target, scarInputs);
    // Jan–Apr the archive holds only the new year's (few) fires.
    const yearStart = new Date(nowMs + offSec * 1000).getUTCMonth() <= 3;
    const section = buildBurnScarSection(summary, rainSignalFrom(eroDays, rain), {
      truncated: scarsRes.value.truncated,
      yearStart,
    });
    burnScars = section.unavailable ? { unavailable: section.unavailable } : summary;
    sections.push(section);
  }

  // ── River discharge (GloFAS) ──────────────────────────────────────────────
  const discharge = dischargeRes.value && dischargeRes.value.time.length > 0 ? dischargeRes.value : null;
  if (discharge === null) {
    sections.push(unavailableSection('discharge', `GloFAS river discharge unavailable (${dischargeRes.error ?? 'empty series'})`));
  } else {
    // GloFAS days are UTC days.
    sections.push(buildDischargeSection(discharge, { todayIso: todayUtcIso(), forecastGauge, gaugesKnown: nearby !== null }));
  }

  // ── Overall ───────────────────────────────────────────────────────────────
  const available = sections.filter((s) => !s.unavailable);
  if (available.length === 0) {
    throw new Error('All flood feeds are unavailable — cannot assemble a report');
  }
  // An unstudied or unreadable site zone escalates nothing.
  const overall = computeFloodOverall(sections, fema.unavailable ? null : fema.atSite ?? null);

  // ── Map snapshots (parallel, best effort — null just hides that map) ──────
  const drawSite = (ctx: CanvasRenderingContext2D, proj: SnapshotProjection) =>
    drawPin(ctx, proj, target.lat, target.lon);

  // Burn scars near enough to show on the 100 mi hero map.
  const scarsInView = scarInputs.filter((s) => (nearestBurnScar(target, [s]).nearestMi ?? Infinity) <= 130);

  const exposureSnapshot = renderMapSnapshot({
    centerLat: target.lat,
    centerLon: target.lon,
    fitRadiusM: MAX_RING_MI * MILES_TO_M,
    width: MAP_W,
    height: 420,
    signal,
    attribution: '© Esri © OSM · gauges NOAA NWPS · alerts NWS · perimeters NIFC',
    draw: (ctx, proj) => {
      for (const s of regionalAlertShapes) {
        drawZone(ctx, proj, s.rings, { fill: `${s.colorHex}2e`, stroke: `${s.colorHex}cc`, width: 2 });
      }
      for (const s of scarsInView) {
        drawHatchedPolygon(ctx, proj, s.rings, {
          color: BURN_SCAR_STYLE.color, width: 2, hatchColor: BURN_SCAR_STYLE.hatch,
          hatchSpacing: 12, hatchWidth: 2, casing: 'rgba(5,7,10,0.55)',
        });
      }
      for (const ring of RISK_RINGS) {
        drawRing(ctx, proj, target.lat, target.lon, ring.miles * MILES_TO_M, {
          stroke: 'rgba(61,220,255,0.55)', width: 2, dash: [8, 6], label: ring.label,
        });
      }
      // Dark gauges as hollow gray rings (no reading to color), under the rest;
      // a dark one with a flooding NWS forecast still draws in its tier color.
      for (const g of gaugesAll) {
        if (!g.offline || catSev(gaugeTier(g)) >= 1) continue;
        const [x, y] = proj.toXY(g.lon, g.lat);
        ctx.beginPath();
        ctx.arc(x, y, 6, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(5,7,10,0.85)';
        ctx.lineWidth = 5;
        ctx.stroke();
        ctx.strokeStyle = OFFLINE_GAUGE_COLOR;
        ctx.lineWidth = 2.5;
        ctx.stroke();
      }
      // Normal gauges first, flooding ones on top; dot size grows with tier.
      const ordered = gaugesAll
        .filter((g) => !g.offline || catSev(gaugeTier(g)) >= 1)
        .sort((a, b) => catSev(gaugeTier(a)) - catSev(gaugeTier(b)));
      for (const g of ordered) {
        const tier = gaugeTier(g);
        const sev = catSev(tier);
        const [x, y] = proj.toXY(g.lon, g.lat);
        ctx.beginPath();
        ctx.arc(x, y, sev === 0 ? 5 : 7 + sev * 2, 0, Math.PI * 2);
        ctx.fillStyle = CAT[tier]?.color ?? '#8090a6';
        ctx.strokeStyle = sev === 0 ? 'rgba(5,7,10,0.85)' : '#ffffff';
        ctx.lineWidth = sev === 0 ? 2 : 2.5;
        ctx.fill();
        ctx.stroke();
      }
      ordered
        .filter((g) => catSev(gaugeTier(g)) >= 2)
        .sort((a, b) => catSev(gaugeTier(b)) - catSev(gaugeTier(a)) || a.distanceMi - b.distanceMi)
        .slice(0, 3)
        .forEach((g) => {
          const [x, y] = proj.toXY(g.lon, g.lat);
          drawLabel(ctx, x, y, g.name);
        });
      drawSite(ctx, proj);
    },
  });

  const alertsSnapshot = siteAlertShapes.length === 0
    ? Promise.resolve(null)
    : renderMapSnapshot({
        centerLat: target.lat,
        centerLon: target.lon,
        fitRadiusM: 60 * MILES_TO_M,
        width: MAP_W,
        height: 340,
        signal,
        attribution: '© Esri © OSM · alerts NWS',
        draw: (ctx, proj) => {
          for (const s of siteAlertShapes) {
            drawZone(ctx, proj, s.rings, { fill: `${s.colorHex}38`, stroke: s.colorHex, width: 3 });
          }
          drawRing(ctx, proj, target.lat, target.lon, 25 * MILES_TO_M, {
            stroke: 'rgba(61,220,255,0.45)', width: 2, dash: [8, 6], label: '25 mi',
          });
          drawSite(ctx, proj);
        },
      });

  const femaPolys = femaRes.value?.polygons ?? [];
  const femaSnapshot = femaPolys.length === 0
    ? Promise.resolve(null)
    : renderMapSnapshot({
        centerLat: target.lat,
        centerLon: target.lon,
        fitRadiusM: 1.3 * MILES_TO_M,
        width: MAP_W,
        height: 340,
        signal,
        attribution: '© Esri © OSM · flood zones FEMA NFHL',
        draw: (ctx, proj) => {
          const byClass = femaPolys
            .map((p) => ({ p, cls: femaZoneClass(p) }))
            .sort((a, b) => FEMA_CLASS_ORDER.indexOf(a.cls) - FEMA_CLASS_ORDER.indexOf(b.cls));
          for (const { p, cls } of byClass) {
            const st = FEMA_CLASS_STYLE[cls];
            drawZone(ctx, proj, p.rings, { fill: st.fill, stroke: st.stroke, width: cls === 'minimal' ? 1 : 1.8, hatch: st.hatch });
          }
          drawCasedRing(ctx, proj, target, 1, '1 mi');
          drawSite(ctx, proj);
        },
      });

  const eroPolys = eroPolysRes.value ?? [];
  const eroSnapshot = eroPolys.length === 0
    ? Promise.resolve(null)
    : renderMapSnapshot({
        centerLat: target.lat,
        centerLon: target.lon,
        fitRadiusM: 250 * MILES_TO_M,
        width: MAP_W,
        height: 380,
        signal,
        attribution: '© Esri © OSM · outlook NOAA/WPC',
        draw: (ctx, proj) => {
          for (const p of eroPolys) {
            const hex = ERO_META[p.category].hex;
            drawZone(ctx, proj, p.rings, { fill: `${hex}55`, stroke: hex, width: 2 });
          }
          // The outlook's own definition is "within 25 mi of a point".
          drawCasedRing(ctx, proj, target, 25, '25 mi');
          drawSite(ctx, proj);
        },
      });

  const qpfSnapshot = inConus ? renderQpfSnapshot(target, MAP_W, signal) : Promise.resolve(null);

  const [exposureMap, alertsMap, femaMap, eroMap, qpfMap] = await Promise.all([
    exposureSnapshot, alertsSnapshot, femaSnapshot, eroSnapshot, qpfSnapshot,
  ]);
  onFeed?.('maps', 'ok');

  return {
    hazard: 'flood',
    target,
    generatedAt: new Date().toISOString(),
    localToday,
    overall,
    sections,
    ringCounts: floodRingCounts(gaugesAll),
    alerts,
    gauges: gaugesShown,
    gaugeDetails,
    ero: eroDays ? { days: eroDays } : { unavailable: sections.find((s) => s.id === 'ero')?.unavailable ?? 'unavailable' },
    rain,
    antecedent,
    hourlyRain,
    fema,
    burnScars,
    discharge,
    forecastDaily,
    sources: [
      { name: 'NWS api.weather.gov', detail: 'flood, surge, tsunami and tropical alerts at the property (NWS point lookup); the national list, with county geometry, for the regional map' },
      { name: 'NOAA NWPS', detail: 'river forecast points — observed and forecast flood category, hydrographs, flood-stage thresholds and impact statements; points not reporting are flagged' },
      { name: 'NOAA WPC Excessive Rainfall Outlook', detail: 'Days 1–5 probability that rainfall exceeds flash-flood guidance within 25 mi of a point' },
      { name: 'NOAA WPC QPF', detail: 'quantitative precipitation forecast, 24/48/72 h and 5-day accumulation' },
      { name: 'FEMA NFHL', detail: 'effective flood hazard zones (Flood Hazard Zones layer) at and around the property' },
      { name: 'GloFAS v4 · Open-Meteo Flood API', detail: 'ensemble river discharge forecast at the model river cell containing the property; 2/5/20-year flows from a Gumbel fit to its last 20 complete reanalysis years' },
      { name: 'Open-Meteo', detail: 'modelled rainfall over the past 7 days, hourly rain ahead (timing chart; totals outside the lower 48) and the 10-day daily forecast' },
      { name: 'NIFC / WFIGS', detail: "this year's wildfire perimeters ≥100 acres, active or out (year-to-date archive) — burn scars" },
      { name: 'Esri · OpenStreetMap', detail: 'map snapshot base tiles' },
    ],
    gaps: [
      'flash-flood guidance grids (FFG)',
      'coastal water-level / tide gauges (NOAA CO-OPS)',
      'dam and levee condition (USACE NID / NLD)',
      'snowpack and snowmelt',
      'soil moisture (recent rainfall is the proxy)',
      'observed (radar + gauge) rainfall — recent rainfall is a model estimate',
      "burn scars from earlier years' fires",
      'site elevation vs. base flood elevation',
      'urban drainage capacity',
    ],
    maps: {
      exposure: exposureMap,
      alerts: alertsMap,
      fema: femaMap,
      ero: eroMap,
      qpf: qpfMap,
    },
  };
}
