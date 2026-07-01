// Aggregates each property GROUP's live status for the dashboard, reusing the
// proximity scan engine (NWS alerts / FIRMS fires / USGS quakes) and adding
// current weather, nearest AQI, and nearby news. Also emits a flat list of
// near-pin events the feed diffs for "new since last scan".

import { LOCATION_GROUPS, type LocationGroup } from '../layers/locations/locations';
import { MILES_TO_M, haversineMeters, metersToMiles } from '../lib/geo';
import { scanProximity, type PropertyAlert } from '../widgets/proximity/proximityScan';
import { severityRank } from '../layers/alerts/alertsData';
import { api } from '../api/client';
import type { AqiStation, NewsMapEvent } from '../types';

const RADIUS_MI = 100; // alerts/fires/quakes considered "near" a property
const AQI_RADIUS_MI = 75;
const NEWS_RADIUS_MI = 150;

export type StatusLevel = 'ok' | 'watch' | 'alert';
export type FeedType = 'alert' | 'fire' | 'quake' | 'news';

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
}

type GroupWeather = { tempF: number; windKt: number; precip7d: number | null };

export interface FeedEvent {
  id: string; // stable dedup key
  type: FeedType;
  title: string;
  groupName: string; // nearest property group
  distanceMi: number | null; // null = the alert area covers the property
  at: number; // event time (epoch ms); 0 → caller stamps first-seen
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
  const [scan, weather, aqiStations, newsEvents] = await Promise.all([
    scanProximity(RADIUS_MI),
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
    });

    // --- feed events (deduped downstream by id) ---
    for (const a of alerts) {
      events.push({ id: `alert:${a.id}`, type: 'alert', title: a.event, groupName: group.name, distanceMi: null, at: 0 });
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
      });
    }
  }

  return { groups, events, updated: Date.now(), errors };
}
