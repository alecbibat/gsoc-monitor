import { haversineKm, nearestPort } from './navPlaces';

// ── Ship port calls ──────────────────────────────────────────────────────────
// Turns a ship's stream of position fixes into "arrived at <port>" and
// "departed <port>" events. Fixes come from two very different feeds: the
// CruiseMapper scrape (one fix per ship about every two hours, with speed but
// no AIS navigation status) and, when a ship is in a receiver's range, live
// AIS (a fix every few seconds to minutes, with status). So:
//   - A ship is STOPPED when AIS says moored / at anchor, when its reported
//     speed is under STOPPED_KT, or — with no speed at all — when it hasn't
//     moved across a long gap between fixes.
//   - An ARRIVAL is a stop within ARRIVAL_PORT_KM of a known port. On the
//     sparse feed one stopped fix is enough (the next one is two hours away);
//     on a dense feed the stop must hold for CONFIRM_MS, so a ship slowing to
//     pick up a pilot doesn't arrive. A stop far from any port (drifting,
//     waiting offshore) is not a port call.
//   - A DEPARTURE is the ship moving DEPART_KM from where it stopped, or
//     DEPART_MOVING_KM while reporting way on — distance, not a status flag,
//     so a berth shift or a swinging anchor doesn't count.
//   - The first fix after a restart only sets the state: never an event we
//     didn't witness.

export interface PortRef {
  name: string;
  /** ISO country code. */
  country: string;
  locode: string | null;
  distanceKm: number;
}

export interface ShipFix {
  lat: number;
  lon: number;
  /** Fix time, epoch ms. */
  t: number;
  speedKt: number | null;
  /** AIS navigation status (0 under way, 1 at anchor, 5 moored, 8 sailing…). */
  navStatus: number | null;
  /** AIS destination as reported. */
  destination: string | null;
}

interface Point {
  lat: number;
  lon: number;
  t: number;
}

export interface PortCallState {
  phase: 'in-port' | 'at-sea';
  /** In port: where the ship stopped, and the port that names the call. */
  stop: (Point & { port: PortRef | null }) | null;
  /** Dense feed: the first stopped fix of an arrival not yet held long enough. */
  pending: (Point & { port: PortRef }) | null;
  last: Point | null;
}

export interface PortCallEmit {
  kind: 'arrival' | 'departure';
  port: PortRef | null;
  lat: number;
  lon: number;
  /** Arrival: the first stopped fix. Departure: the first fix away from the stop. */
  t: number;
  destination: string | null;
}

export const ARRIVAL_PORT_KM = 15;
export const DEPART_KM = 3;
const DEPART_MOVING_KM = 1;
const STOP_RADIUS_KM = 1.5;
const STOPPED_KT = 0.8;
const MOVING_KT = 4;
export const SPARSE_GAP_MS = 20 * 60_000;
export const CONFIRM_MS = 10 * 60_000;

export function portAt(lat: number, lon: number): PortRef | null {
  const n = nearestPort(lat, lon, ARRIVAL_PORT_KM);
  if (!n) return null;
  return {
    name: n.place.name,
    country: n.place.country,
    locode: n.place.locode,
    distanceKm: Math.round(n.distanceKm * 10) / 10,
  };
}

const dist = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) =>
  haversineKm(a.lat, a.lon, b.lat, b.lon);

function stopped(fix: ShipFix, last: Point | null): boolean {
  if (fix.navStatus === 1 || fix.navStatus === 5) return true;
  if (fix.speedKt !== null) return fix.speedKt < STOPPED_KT;
  return last !== null && fix.t - last.t >= SPARSE_GAP_MS && dist(fix, last) < 1;
}

function makingWay(fix: ShipFix): boolean {
  if (fix.speedKt !== null && fix.speedKt >= MOVING_KT) return true;
  return (fix.navStatus === 0 || fix.navStatus === 8) && (fix.speedKt ?? 0) >= 2;
}

/**
 * Advance one ship's port-call state with a fresh fix. `namePort` is
 * injectable for tests; it defaults to the gazetteer lookup.
 */
export function advancePortCall(
  prev: PortCallState | undefined,
  fix: ShipFix,
  namePort: (lat: number, lon: number) => PortRef | null = portAt
): { state: PortCallState; emit: PortCallEmit | null } {
  const here: Point = { lat: fix.lat, lon: fix.lon, t: fix.t };

  if (!prev) {
    const port = stopped(fix, null) ? namePort(fix.lat, fix.lon) : null;
    return {
      state: port
        ? { phase: 'in-port', stop: { ...here, port }, pending: null, last: here }
        : { phase: 'at-sea', stop: null, pending: null, last: here },
      emit: null,
    };
  }
  // An older or repeated fix (a slower feed catching up) changes nothing.
  if (prev.last && fix.t <= prev.last.t) return { state: prev, emit: null };

  if (prev.phase === 'in-port' && prev.stop) {
    const away = dist(prev.stop, fix);
    if (away >= DEPART_KM || (makingWay(fix) && away >= DEPART_MOVING_KM)) {
      return {
        state: { phase: 'at-sea', stop: null, pending: null, last: here },
        emit: {
          kind: 'departure',
          port: prev.stop.port,
          lat: fix.lat,
          lon: fix.lon,
          t: fix.t,
          destination: fix.destination,
        },
      };
    }
    return { state: { ...prev, last: here }, emit: null };
  }

  if (!stopped(fix, prev.last)) return { state: { phase: 'at-sea', stop: null, pending: null, last: here }, emit: null };
  const port = namePort(fix.lat, fix.lon);
  // Stopped at sea, away from any port: not a port call.
  if (!port) return { state: { phase: 'at-sea', stop: null, pending: null, last: here }, emit: null };

  const sparse = !prev.last || fix.t - prev.last.t >= SPARSE_GAP_MS;
  const pending = prev.pending && dist(prev.pending, fix) < STOP_RADIUS_KM ? prev.pending : null;
  if (!sparse && !(pending && fix.t - pending.t >= CONFIRM_MS)) {
    return { state: { phase: 'at-sea', stop: null, pending: pending ?? { ...here, port }, last: here }, emit: null };
  }
  const first = sparse ? { ...here, port } : pending!;
  return {
    state: { phase: 'in-port', stop: first, pending: null, last: here },
    emit: {
      kind: 'arrival',
      port: first.port,
      lat: first.lat,
      lon: first.lon,
      t: first.t,
      destination: fix.destination,
    },
  };
}
