// Which alerts are NEW and close to one of our pins — the decision behind the
// flash-and-popup notification. Pure (no store, no Cesium, no fetch), so the
// rules are testable on their own; AlertNotifier feeds it each poll.

import { LOCATION_GROUPS } from '../layers/locations/locations';
import { MILES_TO_M, distanceToRingsMeters, haversineMeters, metersToMiles, pointInRings } from '../lib/geo';
import { alertColorHex, severityRank, type RawAlert } from '../layers/alerts/alertsData';
import { nwsChanges, nwsFacts, type AlertChange } from './alertChanges';
import { ENDED_COLOR, ENDED_RANK, isEndedNotice, type NwsNotice } from './notices';

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
  /** Of those, the pins inside its area. */
  inside: string[];
  lastSeen: number;
  /** What it said that matters (detectNewNear's `factsOf`), for the versions after it to compare against. */
  facts?: unknown;
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
  /** Pins it reaches, nearest first. */
  hits: PinHit[];
  /** It's a later version of an item already seen. */
  isUpdate: boolean;
  /** What changed from the version it replaces, where it still reaches a pin (see `changesOf`). */
  changes: AlertChange[];
  /** Keys of the pins it reaches that the version it replaces didn't. */
  newPins: string[];
  /** Keys of the pins inside the replaced version's area that it no longer covers. */
  endedPins: string[];
}

/**
 * The core of every "X near a pin" rule, given one poll's items and the
 * memory of what has been seen. The first poll (`baseline`) only records:
 * notifications are for what happens while the dashboard is watching, not
 * for everything already in effect when it opens. After that, an item with a
 * new id is news when it reaches a pin. A later version of an item already
 * seen (it references it) is news when, compared with the version it
 * replaces, it reaches a pin that one didn't, it no longer covers a pin that
 * one did (it ended there), or — while it still reaches a pin — `changesOf`
 * finds a change in what it says. A re-issue with none of those, the routine
 * case, stays quiet. Items `skip` rejects are neither announced nor remembered.
 */
export function detectNewNear<T, F = unknown>(opts: {
  items: readonly T[];
  idOf: (item: T) => string | null | undefined;
  hitsOf: (item: T) => PinHit[];
  refsOf?: (item: T) => readonly string[];
  skip?: (item: T) => boolean;
  /** What about an item can change and be news; kept so the versions after it can be compared. */
  factsOf?: (item: T) => F;
  /** What changed between two versions' facts — empty when nothing that matters did. */
  changesOf?: (prior: F, next: F) => AlertChange[];
  seen: SeenMap;
  baseline: boolean;
  now: number;
}): { fresh: FreshItem<T>[]; seen: SeenMap } {
  const { items, idOf, hitsOf, refsOf, skip, factsOf, changesOf, seen, baseline, now } = opts;
  const next = new Map<string, SeenEntry>();
  for (const [id, entry] of seen) {
    if (now - entry.lastSeen < SEEN_TTL_MS) next.set(id, entry);
  }
  // Pass 1: remember every item in this poll, measuring the unseen ones.
  const firstSeen = new Set<string>();
  const measured: { item: T; id: string; hits: PinHit[] }[] = [];
  for (const item of items) {
    const id = idOf(item);
    if (!id) continue;
    const known = next.get(id);
    if (known) {
      next.set(id, { ...known, lastSeen: now });
      continue;
    }
    if (skip?.(item)) continue;
    const hits = hitsOf(item);
    next.set(id, {
      pins: hits.map((h) => h.pin.key),
      inside: hits.filter((h) => h.distanceMi === 0).map((h) => h.pin.key),
      lastSeen: now,
      facts: factsOf?.(item),
    });
    firstSeen.add(id);
    measured.push({ item, id, hits });
  }
  if (baseline) return { fresh: [], seen: next };

  // Pass 2: references resolve against everything seen so far — this poll
  // included, so an original and its update arriving together notify once.
  // A version first seen in this same poll was never announced on its own,
  // so it counts for reach but isn't what a later version is compared with.
  const fresh: FreshItem<T>[] = [];
  for (const { item, id, hits } of measured) {
    let isUpdate = false;
    const reached = new Set<string>();
    let replaced: SeenEntry | undefined;
    for (const ref of refsOf?.(item) ?? []) {
      const prior = ref !== id ? next.get(ref) : undefined;
      if (!prior) continue;
      isUpdate = true;
      for (const key of prior.pins) reached.add(key);
      if (!firstSeen.has(ref) && (!replaced || prior.lastSeen > replaced.lastSeen)) replaced = prior;
    }
    if (!isUpdate) {
      if (hits.length > 0) fresh.push({ item, id, hits, isUpdate: false, changes: [], newPins: [], endedPins: [] });
      continue;
    }
    const newPins = hits.filter((h) => !reached.has(h.pin.key)).map((h) => h.pin.key);
    const inside = new Set(hits.filter((h) => h.distanceMi === 0).map((h) => h.pin.key));
    const endedPins = (replaced?.inside ?? []).filter((key) => !inside.has(key));
    const facts = next.get(id)?.facts;
    const changes =
      hits.length > 0 && replaced?.facts !== undefined && facts !== undefined && changesOf
        ? changesOf(replaced.facts as F, facts as F)
        : [];
    if (newPins.length === 0 && endedPins.length === 0 && changes.length === 0) continue;
    fresh.push({ item, id, hits, isUpdate: true, changes, newPins, endedPins });
  }
  return { fresh, seen: next };
}

/** An NWS alert's id: its CAP identifier (the feature's URL as a fallback). */
export const nwsAlertId = (a: RawAlert): string | undefined => a.properties.id ?? a.id;

/** Pins by key, for naming the ones an alert no longer covers. */
export function pinsByKey(pins: readonly PinRef[]): (keys: readonly string[]) => PinRef[] {
  const byKey = new Map(pins.map((p) => [p.key, p]));
  return (keys) => keys.map((k) => byKey.get(k)).filter((p): p is PinRef => !!p);
}

/**
 * NWS alerts within NOTIFY_RADIUS_MI of a pin that are new, or that change
 * there: a later version that moves its start or end, upgrades or downgrades
 * it (a watch becoming a warning), changes its severity or certainty (likely
 * → observed), reaches another pin, or no longer covers one. Routine re-issues
 * of an unchanged alert stay quiet (see alertChanges).
 */
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
  const named = pinsByKey(pins);
  const { fresh, seen } = detectNewNear({
    items: alerts,
    idOf: nwsAlertId,
    hitsOf: (a) => pinsNearRings(ringsFor(a), pins, radiusMi),
    refsOf: (a) => (a.properties.references ?? []).map((r) => r.identifier).filter((x): x is string => !!x),
    // Tests and exercises never notify. Nor does a cancel message itself: the
    // active feed doesn't list them, and a cancellation is told from the
    // alert it ended (see vanishedEarly).
    skip: (a) => (!!a.properties.status && a.properties.status !== 'Actual') || a.properties.messageType === 'Cancel',
    factsOf: nwsFacts,
    changesOf: nwsChanges,
    seen: opts.seen,
    baseline: opts.baseline,
    now: opts.now,
  });
  const notices = fresh.map(({ item: alert, id, hits, isUpdate, changes, newPins, endedPins }): NwsNotice => {
    const p = alert.properties;
    const endedAt = named(endedPins);
    const notice: NwsNotice = {
      category: 'nws',
      key: `nws:${id}`,
      aliases: [`nws:${id}`],
      id,
      color: alertColorHex(p.event ?? '', p.severity ?? 'Unknown'),
      rank: 10 + severityRank(p.severity),
      alert,
      hits,
      isUpdate,
      changes,
      newPins,
      endedAt,
      cancelled: null,
      bbox: hitsBbox(ringsBbox(ringsFor(alert)), [...hits, ...endedAt.map((pin) => ({ pin, distanceMi: 0 }))]),
    };
    return isEndedNotice(notice) ? { ...notice, color: ENDED_COLOR, rank: ENDED_RANK } : notice;
  });
  return { notices, seen };
}

/**
 * Alerts that reached a pin in the last poll and are gone from this one
 * before their end, with nothing in this poll replacing them. NWS cancelled
 * them — or the feed blipped, which only NWS can tell apart: the active feed
 * lists neither a cancelled alert nor the cancel message, but the alert's
 * own record names what replaced it (/api/alerts/fate).
 */
export function vanishedEarly(previous: readonly RawAlert[], current: readonly RawAlert[], now: number): RawAlert[] {
  const present = new Set<string>();
  for (const a of current) {
    const id = nwsAlertId(a);
    if (id) present.add(id);
    for (const r of a.properties.references ?? []) if (r.identifier) present.add(r.identifier);
  }
  return previous.filter((a) => {
    const id = nwsAlertId(a);
    if (!id || present.has(id)) return false;
    const end = Date.parse(a.properties.ends ?? a.properties.expires ?? '');
    return Number.isFinite(end) && end > now + 60_000;
  });
}

/** The notice for an alert NWS cancelled while it reached a pin; null if it reaches none. */
export function nwsCancelNotice(opts: {
  alert: RawAlert;
  cancel: { id: string; sent: string | null; description: string | null };
  rings: number[][][];
  pins?: readonly PinRef[];
  radiusMi?: number;
}): NwsNotice | null {
  const { alert, cancel, rings, pins = ALL_PINS, radiusMi = NOTIFY_RADIUS_MI } = opts;
  const hits = pinsNearRings(rings, pins, radiusMi);
  if (hits.length === 0) return null;
  return {
    category: 'nws',
    key: `nws:${cancel.id}`,
    aliases: [`nws:${cancel.id}`],
    id: cancel.id,
    color: ENDED_COLOR,
    rank: ENDED_RANK,
    alert,
    hits,
    isUpdate: true,
    changes: [],
    newPins: [],
    endedAt: hits.map((h) => h.pin),
    cancelled: { sent: cancel.sent, text: cancel.description },
    bbox: hitsBbox(ringsBbox(rings), hits),
  };
}
