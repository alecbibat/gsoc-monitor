import { Router } from 'express';
import { pool } from '../db';
import { config } from '../config';
import { fetchAircraftInfo, type AircraftInfo } from '../aircraftInfo';

const router = Router();

// Aircraft this app tracks, by named group. Uses adsb.fi's per-registration
// endpoint so they appear anywhere in the world regardless of camera viewport.
//
//   company           — the operator's own tails: full-rate tracking.
//   hurricane-hunters — NOAA's reconnaissance fleet (the USAF WC-130Js fly
//                       under mission callsigns on military hexes, so the
//                       per-registration endpoint can't see them).
//   fire-tankers      — 10 Tanker's DC-10 VLAT fleet; extend this roster with
//                       other verified registrations as needed.
//
// Special groups poll on a slower fixed clock (SPECIAL_POLL_MS) so the total
// request rate stays well inside adsb.fi's guidance.
export type FlightGroupId = 'company' | 'hurricane-hunters' | 'fire-tankers';

interface TrackedAircraft {
  reg: string;
  group: FlightGroupId;
}

const TRACKED: TrackedAircraft[] = [
  { reg: 'N10AZ', group: 'company' },
  { reg: 'N14NA', group: 'company' },
  { reg: 'N154LA', group: 'company' },
  { reg: 'N42RF', group: 'hurricane-hunters' }, // WP-3D Orion "Kermit"
  { reg: 'N43RF', group: 'hurricane-hunters' }, // WP-3D Orion "Miss Piggy"
  { reg: 'N49RF', group: 'hurricane-hunters' }, // Gulfstream IV-SP "Gonzo"
  { reg: 'N17085', group: 'fire-tankers' }, // Tanker 910
  { reg: 'N522AX', group: 'fire-tankers' }, // Tanker 911
  { reg: 'N603AX', group: 'fire-tankers' }, // Tanker 912
  { reg: 'N612AX', group: 'fire-tankers' }, // Tanker 914
];
const TRACKED_TAILS = TRACKED.map((t) => t.reg);
const GROUP_OF = new Map(TRACKED.map((t) => [t.reg, t.group]));

// Per-group display persistence. Company tails are assets — they stay on the
// map forever at last-known position with a day of trail. The special rosters
// are mission context: they appear while operating (and for iconTtlMs after
// going dark), drag a short trail, then clear off the globe until their next
// mission. Hidden aircraft stay in lastKnown/the snapshot, so they reappear
// the moment they transmit again.
interface GroupConfig {
  /** How long a trail breadcrumb lives. */
  trailAgeMs: number;
  /** Hide the marker this long after the last fix; null = keep forever. */
  iconTtlMs: number | null;
}

const HOUR_MS = 60 * 60_000;
const GROUP_CONFIG: Record<FlightGroupId, GroupConfig> = {
  company: { trailAgeMs: 24 * HOUR_MS, iconTtlMs: null },
  'hurricane-hunters': { trailAgeMs: 2 * HOUR_MS, iconTtlMs: 2 * HOUR_MS },
  'fire-tankers': { trailAgeMs: 2 * HOUR_MS, iconTtlMs: 2 * HOUR_MS },
};

function configFor(reg: string): GroupConfig {
  return GROUP_CONFIG[GROUP_OF.get(reg) ?? 'company'];
}

/** Whether a tail's marker has aged off the map. Exported for tests. */
export function iconExpired(reg: string, updatedAt: number, now: number): boolean {
  const ttl = configFor(reg).iconTtlMs;
  return ttl !== null && now - updatedAt > ttl;
}

// adsb.fi open data API — free, no authentication. Per-registration endpoint
// returns an array of matching aircraft (usually 0 or 1 per registration).
interface AdsbAircraft {
  hex?: string;
  flight?: string;
  r?: string; // registration
  t?: string; // ICAO type code
  lat?: number;
  lon?: number;
  alt_baro?: number | 'ground';
  gs?: number; // ground speed, knots
  track?: number; // true ground track, degrees
  true_heading?: number;
  baro_rate?: number; // vertical rate, ft/min
  geom_rate?: number;
  squawk?: string;
  seen?: number; // seconds since last message of any kind
  seen_pos?: number; // seconds since the last decoded *position*
}

interface NormalizedFlight {
  icao24: string;
  callsign: string | null;
  registration: string | null;
  type: string | null;
  latitude: number;
  longitude: number;
  altitudeFt: number | null;
  onGround: boolean;
  groundSpeedKt: number | null;
  track: number | null;
  verticalRateFpm: number | null;
  squawk: string | null;
  lastSeenSec: number;
}

function normalizeOne(a: AdsbAircraft): NormalizedFlight | null {
  if (typeof a.lat !== 'number' || typeof a.lon !== 'number') return null;
  const onGround = a.alt_baro === 'ground';
  return {
    icao24: String(a.hex ?? '').toLowerCase(),
    callsign: typeof a.flight === 'string' ? a.flight.trim() || null : null,
    registration: a.r ?? null,
    type: a.t ?? null,
    latitude: a.lat,
    longitude: a.lon,
    altitudeFt: onGround ? 0 : typeof a.alt_baro === 'number' ? a.alt_baro : null,
    onGround,
    groundSpeedKt: typeof a.gs === 'number' ? a.gs : null,
    track:
      typeof a.track === 'number'
        ? a.track
        : typeof a.true_heading === 'number'
          ? a.true_heading
          : null,
    verticalRateFpm:
      typeof a.baro_rate === 'number'
        ? a.baro_rate
        : typeof a.geom_rate === 'number'
          ? a.geom_rate
          : null,
    squawk: a.squawk ?? null,
    // Age of the *position*, not of any message: a fringe-coverage aircraft can
    // keep chirping (seen ≈ 0) while its lat/lon is minutes old (seen_pos
    // growing), and the whole point of lastSeenSec is fix freshness.
    lastSeenSec:
      typeof a.seen_pos === 'number' ? a.seen_pos : typeof a.seen === 'number' ? a.seen : 0,
  };
}

// Last-known position per tail. ADS-B only shows aircraft with a live
// transponder, so a jet that lands and powers down vanishes from adsb.fi. We
// keep its last reported position — never evicted, never aged out — so it stays
// on the map (drawn grounded/dimmed) instead of disappearing, and persist it to
// Postgres below so a restart or deploy doesn't lose a parked aircraft either.
interface StoredFlight extends NormalizedFlight {
  updatedAt: number;
}
const lastKnown = new Map<string, StoredFlight>();

// --- Trail history -----------------------------------------------------------
// Breadcrumbs of where each aircraft has been, with the altitude at each fix so
// the client can draw the tar1090-style altitude-coloured trail. Points are
// appended as the background poll sees the aircraft move; `ground` marks
// taxi/parked fixes so the client can clamp those to the surface.
export interface FlightTrackPoint {
  lat: number;
  lon: number;
  altFt: number | null;
  ground: boolean;
  t: number;
}
const history = new Map<string, FlightTrackPoint[]>();

const MAX_TRACK_POINTS = 2500; // ~7h of continuous flight at the 10s cadence
// Default trail window; each group overrides via GROUP_CONFIG.trailAgeMs.
const DEFAULT_TRACK_AGE_MS = 24 * 60 * 60_000;
const MIN_TRACK_MOVE_M = 30; // ignore transponder jitter while parked

function haversineM(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6_371_000;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// Append a fix to a trail in place, applying the movement threshold and the
// age/count caps. Exported for tests.
export function recordTrackPoint(
  pts: FlightTrackPoint[],
  p: FlightTrackPoint,
  maxAgeMs: number = DEFAULT_TRACK_AGE_MS
): void {
  const last = pts[pts.length - 1];
  if (last && haversineM(last.lat, last.lon, p.lat, p.lon) < MIN_TRACK_MOVE_M) return;
  pts.push(p);
  const cutoff = p.t - maxAgeMs;
  while (pts.length > MAX_TRACK_POINTS || (pts.length > 0 && pts[0].t < cutoff)) pts.shift();
}

// Recording only purges when a new moving fix arrives, so a parked aircraft
// would otherwise keep yesterday's trail on the map (and in the snapshot)
// forever. Run each group's age cutoff on every poll instead.
function pruneHistories(): void {
  const now = Date.now();
  for (const [reg, pts] of history) {
    const cutoff = now - configFor(reg).trailAgeMs;
    let dropped = false;
    while (pts.length > 0 && pts[0].t < cutoff) {
      pts.shift();
      dropped = true;
    }
    if (dropped) snapshotDirty = true;
  }
}

// The recording cap (2,500 points) is the fidelity we keep in memory and in
// the snapshot; the wire doesn't need it. Uniform stride anchored at the end,
// so the newest breadcrumbs always survive and the response stays a few dozen
// KB instead of ~600 KB per poll once trails fill.
const MAX_SERVED_TRAIL_POINTS = 700;
export function decimateTrail(
  pts: FlightTrackPoint[],
  max: number = MAX_SERVED_TRAIL_POINTS
): FlightTrackPoint[] {
  if (pts.length <= max) return pts;
  const stride = Math.ceil(pts.length / max);
  const out: FlightTrackPoint[] = [];
  for (let i = pts.length - 1; i >= 0; i -= stride) out.push(pts[i]);
  return out.reverse();
}

// --- Takeoff / landing events ------------------------------------------------
// Every grounded↔airborne transition the tracker witnesses becomes a feed
// event ("N10AZ departed …"). The client resolves the coordinates to a nearby
// city for display, so events carry only raw state.
export interface FlightEvent {
  id: string;
  reg: string;
  group: FlightGroupId;
  kind: 'takeoff' | 'landing';
  lat: number;
  lon: number;
  t: number;
}

const events: FlightEvent[] = [];
const MAX_EVENTS = 200;
// A flip only becomes an event once the NEW state has persisted this long —
// confirm-then-emit, so a single glitched fix or a touch-and-go bounce never
// produces a phantom departure/arrival (the flip is dropped the moment the
// state reverts to the confirmed one).
const EVENT_MIN_HELD_MS = 2 * 60_000;

interface PendingTransition {
  kind: 'takeoff' | 'landing';
  lat: number;
  lon: number;
  /** Fix time of the first flip — becomes the event's timestamp when confirmed. */
  sinceT: number;
}

export interface TransitionTracker {
  /** The last on-ground state that persisted long enough to be believed. */
  confirmedOnGround: boolean;
  pending: PendingTransition | null;
}

/**
 * Advance one aircraft's takeoff/landing state machine with a fresh fix.
 * Exported for tests.
 */
export function advanceTransition(
  s: TransitionTracker | undefined,
  onGround: boolean,
  lat: number,
  lon: number,
  fixAt: number
): { state: TransitionTracker; emit: PendingTransition | null } {
  if (!s) {
    // First sighting: adopt the state, never emit — we didn't witness a flip.
    return { state: { confirmedOnGround: onGround, pending: null }, emit: null };
  }
  if (onGround === s.confirmedOnGround) {
    // Back to (or still in) the believed state — any pending flip was jitter.
    return { state: { confirmedOnGround: s.confirmedOnGround, pending: null }, emit: null };
  }
  if (!s.pending) {
    return {
      state: {
        confirmedOnGround: s.confirmedOnGround,
        pending: { kind: onGround ? 'landing' : 'takeoff', lat, lon, sinceT: fixAt },
      },
      emit: null,
    };
  }
  if (fixAt - s.pending.sinceT >= EVENT_MIN_HELD_MS) {
    return { state: { confirmedOnGround: onGround, pending: null }, emit: s.pending };
  }
  return { state: s, emit: null };
}

const transitions = new Map<string, TransitionTracker>();

function recordFlightEvent(reg: string, e: PendingTransition): void {
  events.push({
    id: `${reg}-${e.kind}-${e.sinceT}`,
    reg,
    group: GROUP_OF.get(reg) ?? 'company',
    kind: e.kind,
    lat: e.lat,
    lon: e.lon,
    t: e.sinceT,
  });
  if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
  snapshotDirty = true;
}

// --- Static airframe metadata ------------------------------------------------
// Make/model/operator and a photo per tail (see ../aircraftInfo). An airframe's
// identity is permanent, so a successful lookup is cached in memory and in the
// snapshot; a slow refresh picks up photo/owner changes, and misses (either
// service down) are retried on a shorter clock.
const aircraft = new Map<string, AircraftInfo>();
const aircraftAttemptAt = new Map<string, number>();
const INFO_RETRY_MS = 6 * 60 * 60_000;
const INFO_REFRESH_MS = 7 * 24 * 60 * 60_000;

let infoRefreshInFlight = false;

async function refreshAircraftInfo(): Promise<void> {
  if (infoRefreshInFlight) return;
  infoRefreshInFlight = true;
  try {
    const now = Date.now();
    for (const reg of TRACKED_TAILS) {
      const have = aircraft.get(reg);
      // A partial result (registry without photo, or photo without registry)
      // stays on the short retry clock so the gap fills as soon as the other
      // service recovers; only a complete record earns the slow refresh.
      const complete = have != null && have.model !== null && have.photo !== null;
      if (have && now - have.fetchedAt < (complete ? INFO_REFRESH_MS : INFO_RETRY_MS)) continue;
      const attempted = aircraftAttemptAt.get(reg) ?? 0;
      if (now - attempted < INFO_RETRY_MS) continue;
      aircraftAttemptAt.set(reg, now);
      try {
        const info = await fetchAircraftInfo(reg, config.nwsUserAgent);
        if (info) {
          // Merge onto what we had: one service failing on a refresh must not
          // erase the fields the previous lookup already resolved.
          aircraft.set(reg, {
            manufacturer: info.manufacturer ?? have?.manufacturer ?? null,
            model: info.model ?? have?.model ?? null,
            icaoType: info.icaoType ?? have?.icaoType ?? null,
            owner: info.owner ?? have?.owner ?? null,
            photo: info.photo ?? have?.photo ?? null,
            fetchedAt: info.fetchedAt,
          });
          snapshotDirty = true;
        }
      } catch {
        // Retried after INFO_RETRY_MS.
      }
    }
  } finally {
    infoRefreshInFlight = false;
  }
}

// --- Postgres persistence ----------------------------------------------------
// Last-known positions and trails survive restarts and deploys via the shared
// `snapshots` key/value table (same pattern as the wind grid). The dyno
// filesystem is wiped on both, and a powered-down aircraft never reappears in
// adsb.fi on its own — so without this a restart would empty the map until the
// next flight.
const SNAPSHOT_KEY = 'flights:v1';

interface FlightsSnapshot {
  flights: Array<{ reg: string; flight: StoredFlight }>;
  history: Array<{ reg: string; pts: FlightTrackPoint[] }>;
  /** Absent in snapshots written before airframe metadata existed. */
  aircraft?: Array<{ reg: string; info: AircraftInfo }>;
  /** Absent in snapshots written before the takeoff/landing feed existed. */
  events?: FlightEvent[];
  savedAt: number;
}

const SAVE_MIN_INTERVAL_MS = 30_000;
let snapshotDirty = false;
let lastSaveAt = 0;

function saveSnapshot(): void {
  if (!snapshotDirty || Date.now() - lastSaveAt < SAVE_MIN_INTERVAL_MS) return;
  snapshotDirty = false;
  lastSaveAt = Date.now();
  const snap: FlightsSnapshot = {
    flights: [...lastKnown.entries()].map(([reg, flight]) => ({ reg, flight })),
    history: [...history.entries()].map(([reg, pts]) => ({ reg, pts })),
    aircraft: [...aircraft.entries()].map(([reg, info]) => ({ reg, info })),
    events: [...events],
    savedAt: Date.now(),
  };
  pool
    .query(
      `INSERT INTO snapshots (key, data) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
      [SNAPSHOT_KEY, JSON.stringify(snap)]
    )
    .catch((err) => {
      console.warn('[flights] snapshot save failed:', err instanceof Error ? err.message : err);
      // Re-arm so a later poll retries: without this, a transient failure on
      // the LAST save of a flight (aircraft then powers down, so no new fix
      // ever re-dirties) would silently lose the landing and parked position.
      snapshotDirty = true;
      lastSaveAt = 0;
    });
}

// Restore last-known positions from Postgres. Retries briefly because the
// boot-time migration may still be creating the table; never overwrites a
// position a faster live poll already refreshed. No age cutoff on positions —
// a jet parked for weeks is genuinely still at its last reported spot — but
// trail points beyond the 24h window are dropped.
async function loadSnapshot(attempts = 5): Promise<void> {
  const tails = new Set<string>(TRACKED_TAILS);
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const { rows } = await pool.query<{ data: FlightsSnapshot }>(
        'SELECT data FROM snapshots WHERE key = $1',
        [SNAPSHOT_KEY]
      );
      const snap = rows[0]?.data;
      if (!snap) return;
      let restored = 0;
      for (const { reg, flight } of snap.flights ?? []) {
        if (!tails.has(reg) || typeof flight?.latitude !== 'number') continue;
        const existing = lastKnown.get(reg);
        if (existing && existing.updatedAt >= flight.updatedAt) continue;
        lastKnown.set(reg, flight);
        restored++;
      }
      const restoredAt = Date.now();
      for (const { reg, pts } of snap.history ?? []) {
        if (!tails.has(reg) || !Array.isArray(pts)) continue;
        const cutoff = restoredAt - configFor(reg).trailAgeMs;
        const kept = pts.filter((p) => typeof p?.lat === 'number' && p.t >= cutoff);
        if (kept.length === 0) continue;
        // A client request can trigger a live poll while this load is still
        // retrying; prepend the persisted breadcrumbs to whatever those polls
        // already recorded instead of throwing either side away.
        const live = history.get(reg) ?? [];
        const oldestLive = live[0]?.t ?? Infinity;
        const merged = [...kept.filter((p) => p.t < oldestLive), ...live];
        history.set(reg, merged.slice(-MAX_TRACK_POINTS));
      }
      for (const { reg, info } of snap.aircraft ?? []) {
        if (!tails.has(reg) || typeof info?.fetchedAt !== 'number') continue;
        const existing = aircraft.get(reg);
        if (existing && existing.fetchedAt >= info.fetchedAt) continue;
        aircraft.set(reg, info);
      }
      {
        // Same merge discipline as the trails: a live poll may have recorded
        // events while this load was retrying — prepend the persisted feed.
        const cutoffEvents = Date.now() - 7 * 24 * 60 * 60_000;
        const restoredEvents = (snap.events ?? []).filter(
          (e) => tails.has(e?.reg) && typeof e?.t === 'number' && e.t >= cutoffEvents
        );
        const oldestLive = events[0]?.t ?? Infinity;
        const merged = [...restoredEvents.filter((e) => e.t < oldestLive), ...events];
        events.length = 0;
        events.push(...merged.slice(-MAX_EVENTS));
      }
      if (restored > 0) {
        const ageMin = Math.round((Date.now() - (snap.savedAt ?? 0)) / 60_000);
        console.log(`[flights] restored ${restored} aircraft from snapshot (${ageMin} min old)`);
      }
      return;
    } catch (err) {
      if (attempt === attempts) {
        console.warn(
          '[flights] snapshot load failed:',
          err instanceof Error ? err.message : err
        );
        return;
      }
      await new Promise((res) => setTimeout(res, 2_000 * attempt));
    }
  }
}

// --- Background polling ------------------------------------------------------
// The tracker polls continuously so trails keep accumulating and last-known
// positions stay fresh even with no client connected: near-live cadence for
// the company tails while someone is watching, a slow keep-warm tick
// otherwise. The special groups (hunters, tankers) ride a fixed 60s clock
// regardless — mission aircraft don't need 10s fidelity, and the combined
// request rate stays well inside adsb.fi's 1 req/s guidance.
const FAST_POLL_MS = 10_000;
const IDLE_POLL_MS = 60_000;
const SPECIAL_POLL_MS = 60_000;
const WATCH_WINDOW_MS = 5 * 60_000;
let lastSpecialPollAt = 0;

let lastClientAt = 0;
let lastPollAt = 0;
let pollInFlight: Promise<void> | null = null;

function applyFix(reg: string, f: NormalizedFlight): void {
  const now = Date.now();
  // adsb.fi's `seen` dates the fix itself, so `updatedAt` is when the aircraft
  // actually reported — not when we happened to poll.
  const fixAt = now - Math.round(Math.min(f.lastSeenSec, 86_400) * 1000);
  const prev = lastKnown.get(reg);
  const moved =
    !prev || haversineM(prev.latitude, prev.longitude, f.latitude, f.longitude) >= MIN_TRACK_MOVE_M;
  // Never apply a fix older than what we already hold (a stale cache node, or
  // a second staler entry in the same response, would jump the plane backwards
  // and break the trail's time ordering). For an unmoved position also skip the
  // re-served same message, whose fixAt shifts by clock jitter only — otherwise
  // the snapshot would be rewritten for nothing.
  if (prev && fixAt <= prev.updatedAt + (moved ? 0 : 2_000)) return;

  const trans = advanceTransition(
    transitions.get(reg),
    f.onGround,
    f.latitude,
    f.longitude,
    fixAt
  );
  transitions.set(reg, trans.state);
  if (trans.emit) recordFlightEvent(reg, trans.emit);

  lastKnown.set(reg, { ...f, updatedAt: fixAt });
  let pts = history.get(reg);
  if (!pts) {
    pts = [];
    history.set(reg, pts);
  }
  recordTrackPoint(
    pts,
    {
      lat: f.latitude,
      lon: f.longitude,
      altFt: f.altitudeFt,
      ground: f.onGround,
      t: fixAt,
    },
    configFor(reg).trailAgeMs
  );
  snapshotDirty = true;
}

async function fetchTail(reg: string): Promise<void> {
  const url = `https://opendata.adsb.fi/api/v2/registration/${reg}`;
  const r = await fetch(url, {
    headers: { 'User-Agent': config.nwsUserAgent, Accept: 'application/json' },
    signal: AbortSignal.timeout(10_000),
  });
  if (!r.ok) {
    // Being throttled must be visible — aircraft silently freezing on the map
    // is the exact failure an operator can't diagnose from the client.
    if (r.status === 429) console.warn('[flights] adsb.fi throttled (429) for', reg);
    return;
  }
  const json = (await r.json()) as { ac?: AdsbAircraft[] };
  for (const a of json.ac ?? []) {
    const f = normalizeOne(a);
    if (f && f.registration && f.registration.toUpperCase().replace(/\s/g, '') === reg) {
      applyFix(reg, f);
    }
  }
}

// Single-flight poll: concurrent callers (the timer and a client request) share
// one round of upstream fetches.
function poll(): Promise<void> {
  if (pollInFlight) return pollInFlight;
  pollInFlight = (async () => {
    const includeSpecials = Date.now() - lastSpecialPollAt >= SPECIAL_POLL_MS - 1_000;
    // Company tails go out together (a 3-request burst, as ever); the special
    // rosters trickle sequentially behind them so a specials tick never slams
    // adsb.fi with a 10-wide burst.
    const company = TRACKED.filter((t) => t.group === 'company');
    const specials = includeSpecials ? TRACKED.filter((t) => t.group !== 'company') : [];
    await Promise.allSettled(company.map((t) => fetchTail(t.reg)));
    for (const t of specials) {
      await fetchTail(t.reg).catch(() => {});
      await new Promise((res) => setTimeout(res, 150));
    }
    if (includeSpecials) lastSpecialPollAt = Date.now();
    lastPollAt = Date.now();
    pruneHistories();
    // Airframe metadata lookups run beside the poll, not in it — the retry
    // clocks make this a no-op almost always, and the snapshot save catches
    // the result on a later cycle.
    void refreshAircraftInfo();
    saveSnapshot();
  })().finally(() => {
    pollInFlight = null;
  });
  return pollInFlight;
}

function scheduleNextPoll(): void {
  const cadence = Date.now() - lastClientAt < WATCH_WINDOW_MS ? FAST_POLL_MS : IDLE_POLL_MS;
  const timer = setTimeout(async () => {
    await poll();
    scheduleNextPoll();
  }, cadence);
  timer.unref?.();
}

export function initFlightsTracker(): void {
  void (async () => {
    await loadSnapshot();
    void refreshAircraftInfo();
    await poll();
    scheduleNextPoll();
  })();
}

// Serve every tracked tail at its last-known position (with its trail) straight
// from memory. `lastSeenSec` is measured from the fix time so the client can
// tell live aircraft (seconds) from parked ones (minutes/hours/days).
router.get('/registrations', async (_req, res) => {
  lastClientAt = Date.now();
  // First request after a cold boot or a long idle stretch: a fresh fix is one
  // fetch away, so take it rather than serving the keep-warm data.
  if (Date.now() - lastPollAt > FAST_POLL_MS + 5_000) {
    try {
      await poll();
    } catch {
      // Serve what we have — last-known is the product here.
    }
  }
  const now = Date.now();
  const flights = TRACKED_TAILS.flatMap((reg) => {
    const f = lastKnown.get(reg);
    // A special-roster aircraft past its icon TTL is hidden, not forgotten —
    // it stays persisted and reappears the moment it transmits again.
    if (!f || iconExpired(reg, f.updatedAt, now)) return [];
    return [
      {
        ...f,
        group: GROUP_OF.get(reg) ?? 'company',
        lastSeenSec: Math.max(0, Math.round((now - f.updatedAt) / 1000)),
        // `track` is already the ground-track heading, so the breadcrumb
        // history travels as `trail`.
        trail: decimateTrail(history.get(reg) ?? []),
        aircraftInfo: aircraft.get(reg) ?? null,
      },
    ];
  });
  res.json({
    flights,
    trackedTails: [...TRACKED_TAILS],
    // Newest first; the sidebar feed only shows a handful.
    events: events.slice(-40).reverse(),
  });
});

export default router;
