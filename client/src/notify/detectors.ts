// The notification rules beyond NWS alerts: Wireless Emergency Alerts and
// earthquakes near a pin, National Park Service alerts at the followed parks,
// and the company aircraft's and Windstar ships' movements. Pure, like
// pinAlertMatch: AlertNotifier feeds each poll in.

import { WEA_CLASSES } from '../layers/warn/warnMeta';
import { NPS_CATEGORY } from '../nps/npsMeta';
import type { EarthquakeFeature, FlightEventWithModel, NpsAlert, ShipPortEvent, WarnAlert } from '../types';
import {
  ALL_PINS, SEEN_TTL_MS, detectNewNear, hitsBbox, mergeHits, pinsNearCircle, pinsNearRings, ringsBbox,
  type PinHit, type PinRef, type SeenMap,
} from './pinAlertMatch';
import {
  FLIGHT_COLOR, SHIP_COLOR, quakeColor,
  type FlightNotice, type NpsNotice, type QuakeInfo, type QuakeNotice, type ShipNotice, type WarnNotice,
} from './notices';

export const WARN_NOTIFY_RADIUS_MI = 50;
export const QUAKE_NOTIFY_RADIUS_MI = 50;
export const QUAKE_NOTIFY_MIN_MAG = 4.5;
/**
 * A movement or quake first seen longer than this after it happened is old
 * news, not a popup (a feed catching up after an outage, a magnitude revised
 * up hours later).
 */
export const NOTICE_MAX_AGE_MS = 6 * 60 * 60_000;

const WEA_RANK: Record<WarnAlert['weaClass'], number> = {
  presidential: 16,
  'imminent-threat': 14,
  amber: 13,
  'public-safety': 12,
};

/** Pins within `radiusMi` of a WEA's polygons or circles, nearest first. */
export function warnHits(a: WarnAlert, pins: readonly PinRef[], radiusMi: number): PinHit[] {
  return mergeHits(
    pinsNearRings(a.polygons, pins, radiusMi),
    ...a.circles.map((c) => pinsNearCircle(c.lat, c.lon, c.radiusKm * 1000, pins, radiusMi))
  );
}

function warnBbox(a: WarnAlert): [number, number, number, number] {
  const rings = [...a.polygons];
  for (const c of a.circles) {
    const dLat = c.radiusKm / 111;
    const dLon = dLat / Math.max(Math.cos((c.lat * Math.PI) / 180), 0.05);
    rings.push([[c.lon - dLon, c.lat - dLat], [c.lon + dLon, c.lat + dLat]]);
  }
  return ringsBbox(rings);
}

/** WEAs (PBS WARN) that are new and within WARN_NOTIFY_RADIUS_MI of a pin. */
export function detectWarnNotices(opts: {
  alerts: readonly WarnAlert[];
  seen: SeenMap;
  baseline: boolean;
  now: number;
  pins?: readonly PinRef[];
  radiusMi?: number;
}): { notices: WarnNotice[]; seen: SeenMap } {
  const { now, pins = ALL_PINS, radiusMi = WARN_NOTIFY_RADIUS_MI } = opts;
  const { fresh, seen } = detectNewNear({
    items: opts.alerts,
    idOf: (a) => a.id,
    hitsOf: (a) => warnHits(a, pins, radiusMi),
    refsOf: (a) => (a.referencedId ? [a.referencedId] : []),
    skip: (a) => !!a.expires && Date.parse(a.expires) <= now,
    seen: opts.seen,
    baseline: opts.baseline,
    now,
  });
  const notices = fresh.map(({ item: alert, id, hits, isUpdate }): WarnNotice => ({
    category: 'warn',
    key: `warn:${id}`,
    // An NWS warning sent to phones is the same event as the NWS alert of
    // that id (the WEA's CAP id is the NWS one plus ".IPAWS").
    aliases: alert.nws ? [`nws:${alert.capId.replace(/\.IPAWS$/, '')}`] : [],
    color: (WEA_CLASSES[alert.weaClass] ?? WEA_CLASSES['public-safety']).color,
    rank: WEA_RANK[alert.weaClass] ?? 12,
    alert,
    hits,
    isUpdate,
    bbox: hitsBbox(warnBbox(alert), hits),
  }));
  return { notices, seen };
}

export function quakeInfo(f: EarthquakeFeature): QuakeInfo | null {
  const [lon, lat, depth] = f.geometry?.coordinates ?? [];
  const mag = f.properties?.mag;
  if (typeof lat !== 'number' || typeof lon !== 'number' || typeof mag !== 'number') return null;
  return {
    id: f.id,
    mag,
    place: f.properties.place ?? '',
    time: f.properties.time ?? 0,
    lat,
    lon,
    depthKm: typeof depth === 'number' ? depth : null,
    url: f.properties.url ?? '',
    felt: f.properties.felt ?? null,
    tsunami: f.properties.tsunami ?? 0,
    status: (f.properties as { status?: string }).status ?? '',
  };
}

/** Earthquakes of QUAKE_NOTIFY_MIN_MAG+ that are new and within QUAKE_NOTIFY_RADIUS_MI of a pin. */
export function detectQuakeNotices(opts: {
  features: readonly EarthquakeFeature[];
  seen: SeenMap;
  baseline: boolean;
  now: number;
  pins?: readonly PinRef[];
  radiusMi?: number;
  minMag?: number;
}): { notices: QuakeNotice[]; seen: SeenMap } {
  const { now, pins = ALL_PINS, radiusMi = QUAKE_NOTIFY_RADIUS_MI, minMag = QUAKE_NOTIFY_MIN_MAG } = opts;
  const quakes = opts.features.map(quakeInfo).filter((q): q is QuakeInfo => q !== null);
  const { fresh, seen } = detectNewNear({
    items: quakes,
    idOf: (q) => q.id,
    hitsOf: (q) => pinsNearCircle(q.lat, q.lon, 0, pins, radiusMi),
    // Not remembered below the threshold: a magnitude revised upward later
    // still announces it (if it is still recent).
    skip: (q) => q.mag < minMag,
    seen: opts.seen,
    baseline: opts.baseline,
    now,
  });
  const notices = fresh
    .filter(({ item }) => now - item.time <= NOTICE_MAX_AGE_MS)
    .map(({ item: quake, id, hits }): QuakeNotice => ({
      category: 'quake',
      key: `quake:${id}`,
      color: quakeColor(quake.mag),
      rank: quake.mag >= 6 ? 15 : 11,
      quake,
      hits,
    }));
  return { notices, seen };
}

/** Ids seen, with when each was last in its feed. */
export type SeenIds = ReadonlyMap<string, number>;

/**
 * Feed events (takeoffs, port calls) not seen before — after the first poll,
 * which only records — that happened recently enough to announce.
 */
export function detectNewEvents<T>(opts: {
  items: readonly T[];
  idOf: (item: T) => string;
  /** When it happened (or was detected), epoch ms. */
  timeOf: (item: T) => number;
  seen: SeenIds;
  baseline: boolean;
  now: number;
  maxAgeMs?: number;
}): { fresh: T[]; seen: SeenIds } {
  const { items, idOf, timeOf, baseline, now, maxAgeMs = NOTICE_MAX_AGE_MS } = opts;
  const next = new Map<string, number>();
  for (const [id, at] of opts.seen) if (now - at < SEEN_TTL_MS) next.set(id, at);
  const fresh: T[] = [];
  for (const item of items) {
    const id = idOf(item);
    const isNew = !next.has(id);
    next.set(id, now);
    if (isNew && !baseline && now - timeOf(item) <= maxAgeMs) fresh.push(item);
  }
  return { fresh, seen: next };
}

/** New takeoffs and landings of the company aircraft. */
export function detectFlightNotices(opts: {
  events: readonly FlightEventWithModel[];
  seen: SeenIds;
  baseline: boolean;
  now: number;
}): { notices: FlightNotice[]; seen: SeenIds } {
  const { fresh, seen } = detectNewEvents({
    items: opts.events.filter((e) => (e.group ?? 'company') === 'company'),
    idOf: (e) => e.id,
    timeOf: (e) => e.t,
    seen: opts.seen,
    baseline: opts.baseline,
    now: opts.now,
  });
  const notices = fresh.map((event): FlightNotice => ({
    category: 'flight',
    key: `flight:${event.id}`,
    color: FLIGHT_COLOR,
    rank: 2,
    event,
  }));
  return { notices, seen };
}

/** New Windstar arrivals and departures. */
export function detectShipNotices(opts: {
  events: readonly ShipPortEvent[];
  seen: SeenIds;
  baseline: boolean;
  now: number;
}): { notices: ShipNotice[]; seen: SeenIds } {
  const { fresh, seen } = detectNewEvents({
    items: opts.events,
    idOf: (e) => e.id,
    // Two-hourly fixes can surface a call well after it happened: judge
    // freshness by when the server saw it.
    timeOf: (e) => e.detectedAt,
    seen: opts.seen,
    baseline: opts.baseline,
    now: opts.now,
  });
  const notices = fresh.map((event): ShipNotice => ({
    category: 'ship',
    key: `ship:${event.id}`,
    color: SHIP_COLOR,
    rank: 1,
    event,
  }));
  return { notices, seen };
}

// ── National Park Service alerts ─────────────────────────────────────────────
// Unlike the hazards above these have no area: the park is the place. An
// alert stays listed for as long as the park keeps it up (some for months),
// so — as everywhere — what is already listed when the dashboard opens is
// recorded, not announced. After that, a new alert announces, and so does an
// edit that changes what it says: parks keep standing alerts ("Trail Ridge
// Road Status Update") and edit them as conditions change, which is exactly
// the change the room wants to see. Reworded whitespace or a re-index alone
// doesn't count.

export interface NpsSeenEntry {
  /** What the alert said when last seen (npsAlertSig). */
  sig: string;
  lastSeen: number;
}

export type NpsSeen = ReadonlyMap<string, NpsSeenEntry>;

const squash = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

/** The parts of an alert whose change is news: its category, title and text. */
export function npsAlertSig(a: NpsAlert): string {
  return `${a.category}\u0001${squash(a.title)}\u0001${squash(a.description)}`;
}

/** FNV-1a, for a short, stable notice key per version of an alert. */
function hash32(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/** NPS alerts that are new, or whose category, title or text changed, since the last poll. */
export function detectNpsNotices(opts: {
  alerts: readonly NpsAlert[];
  seen: NpsSeen;
  baseline: boolean;
  now: number;
}): { notices: NpsNotice[]; seen: NpsSeen } {
  const { alerts, baseline, now } = opts;
  const next = new Map<string, NpsSeenEntry>();
  for (const [id, entry] of opts.seen) if (now - entry.lastSeen < SEEN_TTL_MS) next.set(id, entry);
  const notices: NpsNotice[] = [];
  for (const alert of alerts) {
    const sig = npsAlertSig(alert);
    const prior = next.get(alert.id);
    next.set(alert.id, { sig, lastSeen: now });
    if (baseline || (prior && prior.sig === sig)) continue;
    const cat = NPS_CATEGORY[alert.category] ?? NPS_CATEGORY.info;
    notices.push({
      category: 'nps',
      // One key per version: an edit announces once, and the same version twice never does.
      key: `nps:${alert.id}:${hash32(sig)}`,
      color: cat.color,
      rank: cat.noticeRank,
      alert,
      isUpdate: !!prior,
    });
  }
  return { notices, seen: next };
}
