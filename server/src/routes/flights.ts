import { Router } from 'express';
import { cache } from '../cache';
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
  seen?: number; // seconds since last message
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
    lastSeenSec: typeof a.seen === 'number' ? a.seen : 0,
  };
}

// Persisted last-known position per tail. ADS-B only shows aircraft with a live
// transponder, so a jet that lands and powers down vanishes from adsb.fi. We
// keep its last reported position here (for the life of the server process) so
// it stays on the map — shown grounded/dimmed — instead of disappearing.
interface StoredFlight extends NormalizedFlight {
  updatedAt: number;
}
const lastKnown = new Map<string, StoredFlight>();

async function refresh(): Promise<void> {
  await Promise.allSettled(
    TRACKED_TAILS.map(async (reg) => {
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
          lastKnown.set(reg, { ...f, updatedAt: Date.now() });
        }
      }
    })
  );
}

// Fetch all TRACKED_TAILS by registration, refreshing live positions at most
// every 25 s, then return each tail's last-known position. `lastSeenSec` is
// computed from our persistence clock so the client can tell live aircraft
// (≈0 s) from parked ones (minutes/hours since the last ADS-B report).
router.get('/registrations', async (_req, res) => {
  try {
    await cache.getOrFetch('flights:refresh', 25_000, async () => {
      await refresh();
      return Date.now();
    });

    const now = Date.now();
    const flights = TRACKED_TAILS.map((reg) => lastKnown.get(reg))
      .filter((f): f is StoredFlight => Boolean(f))
      .map((f) => ({ ...f, lastSeenSec: Math.round((now - f.updatedAt) / 1000) }));

    res.json({ flights, trackedTails: [...TRACKED_TAILS] });
  } catch (err) {
    res.status(502).json({ error: 'Failed to fetch tracked flights', detail: String(err) });
  }
});

export default router;
