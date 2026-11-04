// Which alerts are NEW and close to one of our pins — the decision behind the
// flash-and-popup notification. Pure (no store, no Cesium, no fetch), so the
// rules are testable on their own; AlertNotifier feeds it each poll.

import { LOCATION_GROUPS } from '../layers/locations/locations';
import { MILES_TO_M, distanceToRingsMeters, haversineMeters, metersToMiles, pointInRings } from '../lib/geo';
import { alertColorHex, severityRank, type RawAlert } from '../layers/alerts/alertsData';
import type { NwsNotice } from './notices';

/** An NWS alert within this distance of a pin (or covering it) notifies. */
export const NOTIFY_RADIUS_MI = 15;

/** How long an item that left its feed is remembered, so a feed blip can't re-announce it. */
export const SEEN_TTL_MS = 6 * 60 * 60_000;

export interface PinRef {
  /** Stable id, same shape Property Watch uses: `${groupId}::${name}`. */
  key: string;
  name: string;
  groupName: string;
  lat: number;
  lon: number;
}

export interface PinHit {
  pin: PinRef;
  /** 0 when the pin is inside the area. */
  distanceMi: number;
}

interface SeenEntry {
  /** Keys of the pins the item was within range of. */
  pins: string[];
  lastSeen: number;
}

export type SeenMap = ReadonlyMap<string, SeenEntry>;

export const ALL_PINS: PinRef[] = LOCATION_GROUPS.flatMap((g) =>
  g.locations.map((l) => ({ key: `${g.id}::${l.name}`, name: l.name, groupName: g.name, lat: l.lat, lon: l.lon }))
);

export function ringsBbox(rings: number[][][]): [number, number, number, number] {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const ring of rings) {
    for (const [lon, lat] of ring) {
      if (lon < w) w = lon;
      if (lon > e) e = lon;
      if (lat < s) s = lat;
      if (lat > n) n = lat;
    }
  }
  return [w, s, e, n];
}

/** Pins inside the rings or within `radiusMi` of them, nearest first. */
export function pinsNearRings(rings: number[][][], pins: readonly PinRef[], radiusMi = NOTIFY_RADIUS_MI): PinHit[] {
  if (rings.length === 0) return [];
  const radiusM = radiusMi * MILES_TO_M;
  const [w, s, e, n] = ringsBbox(rings);
  const padLat = radiusM / 111_000;
  const hits: PinHit[] = [];
  for (const pin of pins) {
    // Cheap reject first: the pin is nowhere near the area's bounding box.
    const padLon = padLat / Math.max(Math.cos((pin.lat * Math.PI) / 180), 0.05);
    if (pin.lat < s - padLat || pin.lat > n + padLat) continue;
    if (e - w < 180 && (pin.lon < w - padLon || pin.lon > e + padLon)) continue;
    const inside = pointInRings(pin.lon, pin.lat, rings);
    const d = inside ? 0 : distanceToRingsMeters(pin.lon, pin.lat, rings);
    if (d <= radiusM) hits.push({ pin, distanceMi: metersToMiles(d) });
  }
  return hits.sort((a, b) => a.distanceMi - b.distanceMi);
}

/**
 * Pins within `radiusMi` of a circle's edge (or inside it): a point is a
 * circle of radius 0. Nearest first.
 */
export function pinsNearCircle(
  lat: number,
  lon: number,
  radiusM: number,
  pins: readonly PinRef[],
  radiusMi: number
): PinHit[] {
  const reachM = radiusMi * MILES_TO_M;
  const hits: PinHit[] = [];
  for (const pin of pins) {
    const d = Math.max(0, haversineMeters(pin.lat, pin.lon, lat, lon) - radiusM);
    if (d <= reachM) hits.push({ pin, distanceMi: metersToMiles(d) });
  }
  return hits.sort((a, b) => a.distanceMi - b.distanceMi);
}

/** Several hit lists as one: each pin once, at its nearest distance. */
export function mergeHits(...lists: PinHit[][]): PinHit[] {
  const best = new Map<string, PinHit>();
  for (const list of lists) {
    for (const h of list) {
      const prev = best.get(h.pin.key);
      if (!prev || h.distanceMi < prev.distanceMi) best.set(h.pin.key, h);
    }
  }
  return [...best.values()].sort((a, b) => a.distanceMi - b.distanceMi);
}

export function hitsBbox(
  base: [number, number, number, number],
  hits: PinHit[]
): [number, number, number, number] {
  let [w, s, e, n] = base;
  for (const { pin } of hits) {
    w = Math.min(w, pin.lon);
    e = Math.max(e, pin.lon);
    s = Math.min(s, pin.lat);
    n = Math.max(n, pin.lat);
  }
  return [w, s, e, n];
}

export interface FreshItem<T> {
  item: T;
  id: string;
  hits: PinHit[];
  /** It updates an item already seen (that now reaches a pin it didn't). */
  isUpdate: boolean;
}

/**
 * The core of every "new X near a pin" rule, given one poll's items and the
 * memory of what has been seen. The first poll (`baseline`) only records:
 * notifications are for things that appear while the dashboard is watching,
 * not for everything already in effect when it opens. After that an item is
 * news when its id is new AND it reaches a pin. An update that references an
 * item already seen only counts for pins that earlier version didn't reach,
 * so a re-issued warning doesn't re-alarm the room. Items `skip` rejects are
 * neither announced nor remembered.
 */
export function detectNewNear<T>(opts: {
  items: readonly T[];
  idOf: (item: T) => string | null | undefined;
  hitsOf: (item: T) => PinHit[];
  refsOf?: (item: T) => readonly string[];
  skip?: (item: T) => boolean;
  seen: SeenMap;
  baseline: boolean;
  now: number;
}): { fresh: FreshItem<T>[]; seen: SeenMap } {
  const { items, idOf, hitsOf, refsOf, skip, seen, baseline, now } = opts;
  const next = new Map<string, SeenEntry>();
  for (const [id, entry] of seen) {
    if (now - entry.lastSeen < SEEN_TTL_MS) next.set(id, entry);
  }
  // Pass 1: remember every item in this poll, measuring the unseen ones.
  const measured: { item: T; id: string; hits: PinHit[] }[] = [];
  for (const item of items) {
    const id = idOf(item);
    if (!id) continue;
    const known = next.get(id);
    if (known) {
      next.set(id, { pins: known.pins, lastSeen: now });
      continue;
    }
    if (skip?.(item)) continue;
    const hits = hitsOf(item);
    next.set(id, { pins: hits.map((h) => h.pin.key), lastSeen: now });
    if (hits.length > 0) measured.push({ item, id, hits });
  }
  if (baseline) return { fresh: [], seen: next };

  // Pass 2: references resolve against everything seen so far — this poll
  // included, so an original and its update arriving together notify once.
  const fresh: FreshItem<T>[] = [];
  for (const { item, id, hits } of measured) {
    let isUpdate = false;
    const reached = new Set<string>();
    for (const ref of refsOf?.(item) ?? []) {
      const prior = ref !== id ? next.get(ref) : undefined;
      if (!prior) continue;
      isUpdate = true;
      for (const key of prior.pins) reached.add(key);
    }
    if (hits.every((h) => reached.has(h.pin.key))) continue;
    fresh.push({ item, id, hits, isUpdate });
  }
  return { fresh, seen: next };
}

/** NWS alerts that are new and within NOTIFY_RADIUS_MI of a pin. */
export function detectNewAlertNotices(opts: {
  alerts: readonly RawAlert[];
  ringsOf: (alert: RawAlert) => number[][][];
  seen: SeenMap;
  baseline: boolean;
  now: number;
  pins?: readonly PinRef[];
  radiusMi?: number;
}): { notices: NwsNotice[]; seen: SeenMap } {
  const { alerts, ringsOf, pins = ALL_PINS, radiusMi = NOTIFY_RADIUS_MI } = opts;
  const rings = new Map<RawAlert, number[][][]>();
  const ringsFor = (a: RawAlert) => {
    let r = rings.get(a);
    if (!r) rings.set(a, (r = ringsOf(a)));
    return r;
  };
  const { fresh, seen } = detectNewNear({
    items: alerts,
    idOf: (a) => a.properties.id ?? a.id,
    hitsOf: (a) => pinsNearRings(ringsFor(a), pins, radiusMi),
    refsOf: (a) => (a.properties.references ?? []).map((r) => r.identifier).filter((x): x is string => !!x),
    // Tests, exercises and cancellations never notify.
    skip: (a) => (!!a.properties.status && a.properties.status !== 'Actual') || a.properties.messageType === 'Cancel',
    seen: opts.seen,
    baseline: opts.baseline,
    now: opts.now,
  });
  const notices = fresh.map(({ item: alert, id, hits, isUpdate }): NwsNotice => {
    const p = alert.properties;
    return {
      category: 'nws',
      key: `nws:${id}`,
      aliases: [`nws:${id}`],
      id,
      color: alertColorHex(p.event ?? '', p.severity ?? 'Unknown'),
      rank: 10 + severityRank(p.severity),
      alert,
      hits,
      isUpdate,
      bbox: hitsBbox(ringsBbox(ringsFor(alert)), hits),
    };
  });
  return { notices, seen };
}
