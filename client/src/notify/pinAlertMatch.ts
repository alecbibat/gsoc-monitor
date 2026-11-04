// Which NWS alerts are NEW and close to one of our pins — the decision behind
// the flash-and-popup notification. Pure (no store, no Cesium, no fetch), so
// the rules are testable on their own; AlertNotifier feeds it each poll.

import { LOCATION_GROUPS } from '../layers/locations/locations';
import { MILES_TO_M, distanceToRingsMeters, metersToMiles, pointInRings } from '../lib/geo';
import type { RawAlert } from '../layers/alerts/alertsData';

/** An alert within this distance of a pin (or covering it) notifies. */
export const NOTIFY_RADIUS_MI = 15;

/** How long an alert that left the feed is remembered, so a feed blip can't re-announce it. */
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
  /** 0 when the pin is inside the alert's area. */
  distanceMi: number;
}

export interface AlertNotice {
  id: string;
  alert: RawAlert;
  /** Pins within the radius, nearest first. */
  hits: PinHit[];
  /** An update of an alert already on the map that now reaches a pin it didn't. */
  isUpdate: boolean;
  /** [west, south, east, north] around the alert's area and the pins it reaches. */
  bbox: [number, number, number, number];
}

interface SeenEntry {
  /** Keys of the pins this alert was within range of. */
  pins: string[];
  lastSeen: number;
}

export type SeenMap = ReadonlyMap<string, SeenEntry>;

export const ALL_PINS: PinRef[] = LOCATION_GROUPS.flatMap((g) =>
  g.locations.map((l) => ({ key: `${g.id}::${l.name}`, name: l.name, groupName: g.name, lat: l.lat, lon: l.lon }))
);

function ringsBbox(rings: number[][][]): [number, number, number, number] {
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
    // Cheap reject first: the pin is nowhere near the alert's bounding box.
    const padLon = padLat / Math.max(Math.cos((pin.lat * Math.PI) / 180), 0.05);
    if (pin.lat < s - padLat || pin.lat > n + padLat) continue;
    if (e - w < 180 && (pin.lon < w - padLon || pin.lon > e + padLon)) continue;
    const inside = pointInRings(pin.lon, pin.lat, rings);
    const d = inside ? 0 : distanceToRingsMeters(pin.lon, pin.lat, rings);
    if (d <= radiusM) hits.push({ pin, distanceMi: metersToMiles(d) });
  }
  return hits.sort((a, b) => a.distanceMi - b.distanceMi);
}

function noticeBbox(rings: number[][][], hits: PinHit[]): [number, number, number, number] {
  let [w, s, e, n] = ringsBbox(rings);
  for (const { pin } of hits) {
    w = Math.min(w, pin.lon);
    e = Math.max(e, pin.lon);
    s = Math.min(s, pin.lat);
    n = Math.max(n, pin.lat);
  }
  return [w, s, e, n];
}

/**
 * One poll's worth of alerts in, the notices to show out — plus the updated
 * memory of what has been seen. The first poll (`baseline`) only records:
 * notifications are for alerts that appear while the dashboard is watching,
 * not for everything already in effect when it opens. After that an alert is
 * news when its id is new AND it reaches a pin. An Update that references an
 * alert already seen only counts for pins that earlier version didn't reach,
 * so NWS re-issuing a warning every half hour doesn't re-alarm the room.
 * Test/exercise messages and cancellations never notify.
 */
export function detectNewAlertNotices(opts: {
  alerts: readonly RawAlert[];
  ringsOf: (alert: RawAlert) => number[][][];
  seen: SeenMap;
  baseline: boolean;
  now: number;
  pins?: readonly PinRef[];
  radiusMi?: number;
}): { notices: AlertNotice[]; seen: SeenMap } {
  const { alerts, ringsOf, seen, baseline, now, pins = ALL_PINS, radiusMi = NOTIFY_RADIUS_MI } = opts;
  const next = new Map<string, SeenEntry>();
  for (const [id, entry] of seen) {
    if (now - entry.lastSeen < SEEN_TTL_MS) next.set(id, entry);
  }
  // Pass 1: remember every alert in this poll, measuring the unseen ones.
  const fresh: { id: string; alert: RawAlert; rings: number[][][]; hits: PinHit[] }[] = [];
  for (const alert of alerts) {
    const p = alert.properties;
    const id = p.id ?? alert.id;
    if (!id) continue;
    const known = next.get(id);
    if (known) {
      next.set(id, { pins: known.pins, lastSeen: now });
      continue;
    }
    if ((p.status && p.status !== 'Actual') || p.messageType === 'Cancel') continue;
    const rings = ringsOf(alert);
    const hits = pinsNearRings(rings, pins, radiusMi);
    next.set(id, { pins: hits.map((h) => h.pin.key), lastSeen: now });
    if (hits.length > 0) fresh.push({ id, alert, rings, hits });
  }
  if (baseline) return { notices: [], seen: next };

  // Pass 2: references resolve against everything seen so far — this poll
  // included, so an original and its update arriving together notify once.
  const notices: AlertNotice[] = [];
  for (const { id, alert, rings, hits } of fresh) {
    let referencesSeen = false;
    const reached = new Set<string>();
    for (const ref of alert.properties.references ?? []) {
      const prior = ref.identifier && ref.identifier !== id ? next.get(ref.identifier) : undefined;
      if (!prior) continue;
      referencesSeen = true;
      for (const key of prior.pins) reached.add(key);
    }
    if (hits.every((h) => reached.has(h.pin.key))) continue;
    notices.push({ id, alert, hits, isUpdate: referencesSeen, bbox: noticeBbox(rings, hits) });
  }
  return { notices, seen: next };
}
