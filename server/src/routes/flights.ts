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

function normalize(ac: AdsbAircraft[]) {
  const out = [];
  for (const a of ac) {
    if (typeof a.lat !== 'number' || typeof a.lon !== 'number') continue;
    const onGround = a.alt_baro === 'ground';
    out.push({
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
    });
  }
  return out;
}

// Fetch all TRACKED_TAILS by registration — one request per tail, merged.
// Cache for 30 s so quick re-opens don't hammer adsb.fi.
router.get('/registrations', async (_req, res) => {
  try {
    const data = await cache.getOrFetch('flights:tracked-registrations', 30_000, async () => {
      const results = await Promise.allSettled(
        TRACKED_TAILS.map(async (reg) => {
          const url = `https://opendata.adsb.fi/api/v2/registration/${reg}`;
          const r = await fetch(url, {
            headers: { 'User-Agent': config.nwsUserAgent, Accept: 'application/json' },
          });
          if (!r.ok) return [];
          const json = (await r.json()) as { ac?: AdsbAircraft[] };
          return normalize(json.ac ?? []);
        })
      );
      const flights = results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
      return { flights, trackedTails: [...TRACKED_TAILS] };
    });
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: 'Failed to fetch tracked flights', detail: String(err) });
  }
});

export default router;

