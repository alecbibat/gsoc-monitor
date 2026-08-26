import { Router } from 'express';
import { pool } from '../db';
import { config } from '../config';

const router = Router();

// The only aircraft this app tracks. Uses adsb.fi's per-registration endpoint
// so they appear anywhere in the world regardless of camera viewport.
const TRACKED_TAILS = ['N10AZ', 'N14NA', 'N154LA'] as const;

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
const MAX_TRACK_AGE_MS = 24 * 60 * 60_000;
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
export function recordTrackPoint(pts: FlightTrackPoint[], p: FlightTrackPoint): void {
  const last = pts[pts.length - 1];
  if (last && haversineM(last.lat, last.lon, p.lat, p.lon) < MIN_TRACK_MOVE_M) return;
  pts.push(p);
  const cutoff = p.t - MAX_TRACK_AGE_MS;
  while (pts.length > MAX_TRACK_POINTS || (pts.length > 0 && pts[0].t < cutoff)) pts.shift();
}

// Recording only purges when a new moving fix arrives, so a parked aircraft
// would otherwise keep yesterday's trail on the map (and in the snapshot)
// forever. Run the age cutoff on every poll instead.
function pruneHistories(): void {
  const cutoff = Date.now() - MAX_TRACK_AGE_MS;
  for (const pts of history.values()) {
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
      const cutoff = Date.now() - MAX_TRACK_AGE_MS;
      for (const { reg, pts } of snap.history ?? []) {
        if (!tails.has(reg) || !Array.isArray(pts)) continue;
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
// positions stay fresh even with no client connected: near-live cadence while
// someone is watching, a slow keep-warm tick otherwise. Both stay well inside
// adsb.fi's 1 req/s guidance (3 small requests per tick).
const FAST_POLL_MS = 10_000;
const IDLE_POLL_MS = 60_000;
const WATCH_WINDOW_MS = 5 * 60_000;

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

  lastKnown.set(reg, { ...f, updatedAt: fixAt });
  let pts = history.get(reg);
  if (!pts) {
    pts = [];
    history.set(reg, pts);
  }
  recordTrackPoint(pts, {
    lat: f.latitude,
    lon: f.longitude,
    altFt: f.altitudeFt,
    ground: f.onGround,
    t: fixAt,
  });
  snapshotDirty = true;
}

async function fetchTail(reg: string): Promise<void> {
  const url = `https://opendata.adsb.fi/api/v2/registration/${reg}`;
  const r = await fetch(url, {
    headers: { 'User-Agent': config.nwsUserAgent, Accept: 'application/json' },
    signal: AbortSignal.timeout(10_000),
  });
  if (!r.ok) return;
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
    await Promise.allSettled(TRACKED_TAILS.map((reg) => fetchTail(reg)));
    lastPollAt = Date.now();
    pruneHistories();
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
    if (!f) return [];
    return [
      {
        ...f,
        lastSeenSec: Math.max(0, Math.round((now - f.updatedAt) / 1000)),
        // `track` is already the ground-track heading, so the breadcrumb
        // history travels as `trail`.
        trail: decimateTrail(history.get(reg) ?? []),
      },
    ];
  });
  res.json({ flights, trackedTails: [...TRACKED_TAILS] });
});

export default router;
