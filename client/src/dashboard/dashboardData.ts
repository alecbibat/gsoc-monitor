// Aggregates each property GROUP's live status for the dashboard, reusing the
// proximity scan engine (NWS alerts / FIRMS fires / USGS quakes) and adding
// current weather, nearest AQI, and nearby news. Also emits a flat list of
// near-pin events the feed diffs for "new since last scan".

import { LOCATION_GROUPS, type LocationGroup } from '../layers/locations/locations';
import { MILES_TO_M, haversineMeters, metersToMiles } from '../lib/geo';
import { scanProximity, type PropertyAlert, type ScanResult } from '../widgets/proximity/proximityScan';
import { severityRank } from '../layers/alerts/alertsData';
import { FLEET_ROSTER } from '../layers/ships/fleet';
import { api } from '../api/client';
import type { AqiStation, NewsMapEvent, OutagePoint, ShipState } from '../types';

// Deliberately wider than the Property Watch default (25 mi): the dashboard is
// a situational-awareness horizon, so a hazard 25–100 mi out can appear here
// while the watch list stays clear.
const RADIUS_MI = 100; // alerts/fires/quakes considered "near" a property
const AQI_RADIUS_MI = 75;
const NEWS_RADIUS_MI = 150;
const OUTAGE_RADIUS_MI = 100;
const STORM_PROPERTY_MI = 250; // tropical system "close to a property" threshold
const STORM_SHIP_MI = 300; // wider for ships — they must route around weather

export type StatusLevel = 'ok' | 'watch' | 'alert';
export type FeedType = 'alert' | 'fire' | 'quake' | 'news' | 'outage' | 'storm' | 'ais';

const AIS_GAP_SEC = 6 * 3600; // fleet ship silent this long → worth flagging

export interface GroupStatus {
  group: LocationGroup;
  level: StatusLevel;
  alerts: PropertyAlert[]; // deduped across the group's locations, worst-first
  nearestFireMi: number | null;
  nearestQuake: { mi: number; mag: number } | null;
  weather: { tempF: number; windKt: number } | null;
  precip7d: number | null; // 7-day forecast precipitation accumulation, inches
  aqi: { value: number; category: string } | null;
  news: { count: number; nearestMi: number | null };
  outage: { mi: number; utility: string; customers: number | null } | null; // nearest active outage
}

type GroupWeather = { tempF: number; windKt: number; precip7d: number | null };

export interface FeedEvent {
  id: string; // stable dedup key
  type: FeedType;
  title: string;
  groupName: string; // nearest property group (or fleet ship)
  distanceMi: number | null; // null = the alert area covers the property
  at: number; // event time (epoch ms); 0 → caller stamps first-seen
  lat: number | null; // event location — lets the feed fly the globe there
  lon: number | null;
}

export interface DashboardScan {
  groups: GroupStatus[];
  events: FeedEvent[];
  updated: number;
  errors: string[];
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

// The proximity scan is the expensive part (13 FIRMS envelopes + NWS alerts +
// USGS quakes + county polygons). Re-opening the dashboard used to re-fire the
// whole thing; a short memo makes reopen instant and halves steady-state load.
const SCAN_MEMO_MS = 240_000;
let scanMemo: { at: number; result: ScanResult } | null = null;
async function scanProximityMemo(): Promise<ScanResult> {
  if (scanMemo && Date.now() - scanMemo.at < SCAN_MEMO_MS) return scanMemo.result;
  const result = await scanProximity(RADIUS_MI);
  scanMemo = { at: Date.now(), result };
  return result;
}

// --- tropical threat watch ---------------------------------------------------
// Active tropical systems (NHC feed — same Esri service the hurricane layer
// draws) plus JTWC invests, reduced to one current position each.
interface StormPos {
  id: string;
  name: string;
  lat: number;
  lon: number;
}

const NHC_SERVICE =
  'https://services9.arcgis.com/RHVPKKiFTONKtxq3/arcgis/rest/services/Active_Hurricanes_v1/FeatureServer';
// Sublayer 1 = "Observed Position" (points). It previously pointed at 2, which
// is "Forecast Track" (polylines) — every feature failed the Point check below
// and the storm watch silently returned no storms.
const OBSERVED_POSITION_LAYER = 1;

const STORM_TYPE_LABEL: Record<string, string> = {
  HU: 'Hurricane',
  TY: 'Typhoon',
  STY: 'Super Typhoon',
  TS: 'Tropical Storm',
  SS: 'Subtropical Storm',
  TD: 'Tropical Depression',
  SD: 'Subtropical Depression',
};

async function fetchStormPositions(): Promise<StormPos[]> {
  const out: StormPos[] = [];
  try {
    // Only the attributes the dedup below reads — outFields=* pulls the full
    // ~17-field schema for every historical fix of every storm.
    const r = await fetch(
      `${NHC_SERVICE}/${OBSERVED_POSITION_LAYER}/query?where=1%3D1&outFields=OBJECTID,STORMID,STORMNAME,STORMTYPE&outSR=4326&f=geojson`,
      { signal: AbortSignal.timeout(12_000) }
    );
    if (r.ok) {
      const j = (await r.json()) as { features?: GeoJSON.Feature[] };
      // The observed-position layer has the full fix history; keep the latest
      // (highest object id) per storm.
      const latest = new Map<string, { rank: number; p: StormPos }>();
      for (const f of j.features ?? []) {
        if (f.geometry?.type !== 'Point') continue;
        const [lon, lat] = f.geometry.coordinates as [number, number];
        const p = (f.properties ?? {}) as Record<string, unknown>;
        const rawName = String(p.STORMNAME ?? p.stormName ?? p.NAME ?? 'system');
        const type = String(p.STORMTYPE ?? p.stormType ?? '').toUpperCase();
        const key = String(p.STORMID ?? p.stormid ?? p.ID ?? rawName);
        const rank = Number(p.OBJECTID ?? p.FID ?? 0) || 0;
        const label = `${STORM_TYPE_LABEL[type] ?? 'Tropical system'} ${rawName}`;
        const cur = latest.get(key);
        if (!cur || rank > cur.rank) {
          latest.set(key, { rank, p: { id: `nhc-${key}`, name: label, lat, lon } });
        }
      }
      out.push(...[...latest.values()].map((v) => v.p));
    }
  } catch {
    /* storms unavailable — the rest of the scan still stands */
  }
  try {
    const inv = await api.jtwcInvests();
    for (const v of inv.invests) {
      out.push({ id: `invest-${v.id}`, name: `Invest ${v.id}`, lat: v.lat, lon: v.lon });
    }
  } catch {
    /* invests optional */
  }
  return out;
}

const FLEET_MMSI = new Set(FLEET_ROSTER.map((s) => s.mmsi));

async function fetchFleetShips(): Promise<ShipState[]> {
  try {
    const r = await api.ships();
    return (r.ships ?? []).filter((s) => FLEET_MMSI.has(s.mmsi));
  } catch {
    return [];
  }
}

function nearestOutage(
  group: LocationGroup,
  outages: OutagePoint[]
): { mi: number; utility: string; customers: number | null } | null {
  let best: { mi: number; utility: string; customers: number | null } | null = null;
  for (const o of outages) {
    for (const loc of group.locations) {
      const mi = metersToMiles(haversineMeters(loc.lat, loc.lon, o.lat, o.lon));
      if (mi <= OUTAGE_RADIUS_MI && (!best || mi < best.mi)) {
        best = { mi, utility: o.utility, customers: o.customers };
      }
    }
  }
  return best;
}

// One Open-Meteo call with every group's primary location → current temp + wind
// plus the 7-day forecast precipitation-accumulation total (inches).
async function fetchGroupWeather(): Promise<Map<string, GroupWeather>> {
  const map = new Map<string, GroupWeather>();
  const groups = LOCATION_GROUPS.filter((g) => g.locations.length > 0);
  if (groups.length === 0) return map;
  const lats = groups.map((g) => g.locations[0].lat).join(',');
  const lons = groups.map((g) => g.locations[0].lon).join(',');
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lons}` +
    `&current=temperature_2m,wind_speed_10m&daily=precipitation_sum&forecast_days=7` +
    `&temperature_unit=fahrenheit&wind_speed_unit=kn&precipitation_unit=inch&timezone=auto`;
  const res = await fetch(url, { signal: AbortSignal.timeout(12_000) });
  if (!res.ok) throw new Error(`weather HTTP ${res.status}`);
  type LocForecast = {
    current?: { temperature_2m?: number; wind_speed_10m?: number };
    daily?: { precipitation_sum?: Array<number | null> };
  };
  const data = (await res.json()) as LocForecast[] | LocForecast;
  const arr = Array.isArray(data) ? data : [data];
  groups.forEach((g, i) => {
    const c = arr[i]?.current;
    if (c && typeof c.temperature_2m === 'number') {
      const ps = arr[i]?.daily?.precipitation_sum;
      const precip7d = Array.isArray(ps)
        ? ps.reduce<number>((sum, v) => sum + (typeof v === 'number' ? v : 0), 0)
        : null;
      map.set(g.id, {
        tempF: Math.round(c.temperature_2m),
        windKt: Math.round(c.wind_speed_10m ?? 0),
        precip7d,
      });
    }
  });
  return map;
}

function nearestAqi(group: LocationGroup, stations: AqiStation[]): { value: number; category: string } | null {
  const loc = group.locations[0];
  if (!loc) return null;
  let best: AqiStation | null = null;
  let bestD = Infinity;
  for (const s of stations) {
    const d = haversineMeters(loc.lat, loc.lon, s.lat, s.lon);
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  if (best && bestD <= AQI_RADIUS_MI * MILES_TO_M) return { value: best.aqi, category: best.categoryName };
  return null;
}

function newsNear(group: LocationGroup, events: NewsMapEvent[]): { count: number; nearestMi: number | null; items: { ev: NewsMapEvent; mi: number }[] } {
  const radiusM = NEWS_RADIUS_MI * MILES_TO_M;
  const items: { ev: NewsMapEvent; mi: number }[] = [];
  for (const ev of events) {
    let minD = Infinity;
    for (const loc of group.locations) {
      const d = haversineMeters(loc.lat, loc.lon, ev.lat, ev.lon);
      if (d < minD) minD = d;
    }
    if (minD <= radiusM) items.push({ ev, mi: metersToMiles(minD) });
  }
  items.sort((a, b) => a.mi - b.mi);
  return { count: items.length, nearestMi: items.length ? items[0].mi : null, items };
}

function dedupeAlerts(alerts: PropertyAlert[]): PropertyAlert[] {
  const seen = new Set<string>();
  const out: PropertyAlert[] = [];
  for (const a of alerts) {
    if (seen.has(a.id)) continue;
    seen.add(a.id);
    out.push(a);
  }
  out.sort((x, y) => severityRank(y.severity) - severityRank(x.severity));
  return out;
}

export async function scanDashboard(): Promise<DashboardScan> {
  const errors: string[] = [];
  const [scan, weather, aqiStations, newsEvents, outages, storms, fleet] = await Promise.all([
    scanProximityMemo(),
    fetchGroupWeather().catch((e) => {
      errors.push(`weather: ${e instanceof Error ? e.message : e}`);
      return new Map<string, GroupWeather>();
    }),
    api
      .aqi()
      .then((r) => r.stations)
      .catch(() => {
        errors.push('aqi');
        return [] as AqiStation[];
      }),
    api
      .newsMap()
      .then((r) => r.events)
      .catch(() => {
        errors.push('news');
        return [] as NewsMapEvent[];
      }),
    api
      .outages()
      .then((r) => r.outages)
      .catch(() => {
        errors.push('outages');
        return [] as OutagePoint[];
      }),
    fetchStormPositions(),
    fetchFleetShips(),
  ]);
  if (scan.alertError) errors.push('alerts');
  if (scan.fireError) errors.push('fires');
  if (scan.quakeError) errors.push('quakes');

  const groups: GroupStatus[] = [];
  const events: FeedEvent[] = [];

  for (const group of LOCATION_GROUPS) {
    const props = scan.properties.filter((p) => p.group.id === group.id);
    const alerts = dedupeAlerts(props.flatMap((p) => p.alerts));
    const fireMis = props.map((p) => p.nearestFireMi).filter((m): m is number => m != null);
    const nearestFireMi = fireMis.length ? Math.min(...fireMis) : null;

    let nearestQuake: { mi: number; mag: number } | null = null;
    for (const p of props) {
      for (const q of p.quakes) {
        if (!nearestQuake || q.distanceMi < nearestQuake.mi) nearestQuake = { mi: q.distanceMi, mag: q.mag };
      }
    }

    const news = newsNear(group, newsEvents);
    const worst = alerts.reduce((m, a) => Math.max(m, severityRank(a.severity)), 0);
    // severityRank: Extreme=4, Severe=3, Moderate=2, Minor=1
    const level: StatusLevel =
      worst >= 3 || (nearestFireMi != null && nearestFireMi < 25)
        ? 'alert'
        : worst >= 1 || (nearestFireMi != null && nearestFireMi < RADIUS_MI) || nearestQuake != null
          ? 'watch'
          : 'ok';

    const w = weather.get(group.id) ?? null;
    const primary = group.locations[0];
    groups.push({
      group,
      level,
      alerts,
      nearestFireMi,
      nearestQuake,
      weather: w ? { tempF: w.tempF, windKt: w.windKt } : null,
      precip7d: w?.precip7d ?? null,
      aqi: nearestAqi(group, aqiStations),
      news: { count: news.count, nearestMi: news.nearestMi },
      outage: nearestOutage(group, outages),
    });

    // --- feed events (deduped downstream by id) ---
    for (const a of alerts) {
      events.push({
        id: `alert:${a.id}`,
        type: 'alert',
        title: a.event,
        groupName: group.name,
        distanceMi: null,
        at: 0,
        lat: primary?.lat ?? null,
        lon: primary?.lon ?? null,
      });
    }
    for (const p of props) {
      for (const f of p.fires) {
        events.push({
          id: `fire:${round3(f.lat)},${round3(f.lon)}`,
          type: 'fire',
          title: f.frp != null ? `Wildfire hotspot (${Math.round(f.frp)} MW)` : 'Wildfire hotspot',
          groupName: group.name,
          distanceMi: f.distanceMi,
          at: 0,
          lat: f.lat,
          lon: f.lon,
        });
      }
      for (const q of p.quakes) {
        events.push({
          id: `quake:${q.id}`,
          type: 'quake',
          title: `M${q.mag.toFixed(1)} — ${q.place || 'earthquake'}`,
          groupName: group.name,
          distanceMi: q.distanceMi,
          at: q.time || 0,
          lat: q.lat,
          lon: q.lon,
        });
      }
    }
    for (const { ev, mi } of news.items.slice(0, 4)) {
      events.push({
        id: `news:${ev.id}`,
        type: 'news',
        title: ev.articles[0]?.title || ev.name,
        groupName: group.name,
        distanceMi: mi,
        at: 0,
        lat: ev.lat,
        lon: ev.lon,
      });
    }
  }

  // --- power outages near a property → feed (nearest group wins) --------------
  for (const o of outages) {
    let bestGroup: LocationGroup | null = null;
    let bestMi = Infinity;
    for (const group of LOCATION_GROUPS) {
      for (const loc of group.locations) {
        const mi = metersToMiles(haversineMeters(loc.lat, loc.lon, o.lat, o.lon));
        if (mi < bestMi) {
          bestMi = mi;
          bestGroup = group;
        }
      }
    }
    if (!bestGroup || bestMi > OUTAGE_RADIUS_MI) continue;
    events.push({
      id: `outage:${o.id}`,
      type: 'outage',
      title: `${o.utility}: ${o.customers != null ? o.customers.toLocaleString() : '?'} customers out`,
      groupName: bestGroup.name,
      distanceMi: bestMi,
      at: o.start ?? 0,
      lat: o.lat,
      lon: o.lon,
    });
  }

  // --- tropical threat watch: systems near properties or the Windstar fleet ---
  for (const storm of storms) {
    for (const group of LOCATION_GROUPS) {
      const loc = group.locations[0];
      if (!loc) continue;
      const mi = metersToMiles(haversineMeters(loc.lat, loc.lon, storm.lat, storm.lon));
      if (mi > STORM_PROPERTY_MI) continue;
      events.push({
        id: `storm:${storm.id}:${group.id}`,
        type: 'storm',
        title: `${storm.name} approaching`,
        groupName: group.name,
        distanceMi: mi,
        at: 0,
        lat: storm.lat,
        lon: storm.lon,
      });
    }
    for (const ship of fleet) {
      const mi = metersToMiles(
        haversineMeters(ship.latitude, ship.longitude, storm.lat, storm.lon)
      );
      if (mi > STORM_SHIP_MI) continue;
      events.push({
        id: `storm:${storm.id}:ship-${ship.mmsi}`,
        type: 'storm',
        title: `${storm.name} near vessel`,
        groupName: `${ship.name ?? 'Windstar vessel'} (fleet)`,
        distanceMi: mi,
        at: 0,
        lat: storm.lat,
        lon: storm.lon,
      });
    }
  }

  // --- fleet anomaly: AIS gone silent ----------------------------------------
  // A vessel that should be transmitting but hasn't been heard for hours is a
  // classic maritime-ops warning sign (coverage gap, transponder off, distress).
  for (const ship of fleet) {
    if (ship.lastSeenSec > AIS_GAP_SEC) {
      const hours = Math.floor(ship.lastSeenSec / 3600);
      events.push({
        id: `ais:${ship.mmsi}`,
        type: 'ais',
        title: `AIS signal silent for ${hours}h`,
        groupName: `${ship.name ?? 'Windstar vessel'} (fleet)`,
        distanceMi: null,
        at: 0,
        lat: ship.latitude,
        lon: ship.longitude,
      });
    }
  }

  return { groups, events, updated: Date.now(), errors };
}
