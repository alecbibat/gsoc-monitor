import { Router } from 'express';
import { cache } from '../cache';
import { config } from '../config';

const router = Router();

// adsb.fi open data API — free, no authentication, ~1 req/sec. Returns live
// ADS-B aircraft within a radius (max 250 NM) of a point. Response is the
// readsb / ADSBexchange-v2 shape: { ac: [ ... ], now, total }.
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

function isValidLat(n: number) {
  return Number.isFinite(n) && n >= -90 && n <= 90;
}
function isValidLon(n: number) {
  return Number.isFinite(n) && n >= -180 && n <= 180;
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

router.get('/', async (req, res) => {
  const lat = Number(req.query.lat);
  const lon = Number(req.query.lon);
  let dist = Number(req.query.dist);

  if (!isValidLat(lat) || !isValidLon(lon)) {
    res.status(400).json({ error: 'lat and lon are required valid coordinates' });
    return;
  }
  if (!Number.isFinite(dist)) dist = 50;
  dist = Math.min(250, Math.max(1, Math.round(dist)));

  // Bucket the center to ~0.5° so nearby viewports share a cache entry and we
  // stay well under adsb.fi's 1 req/sec limit.
  const round = (n: number) => Math.round(n * 2) / 2;
  const cacheKey = `flights:${round(lat)}:${round(lon)}:${dist}`;

  try {
    const data = await cache.getOrFetch(cacheKey, 8_000, async () => {
      const url = `https://opendata.adsb.fi/api/v2/lat/${lat}/lon/${lon}/dist/${dist}`;
      const upstream = await fetch(url, {
        headers: { 'User-Agent': config.nwsUserAgent, Accept: 'application/json' },
      });
      if (!upstream.ok) throw new Error(`adsb.fi error: ${upstream.status}`);
      const json = (await upstream.json()) as { ac?: AdsbAircraft[] };
      return { flights: normalize(json.ac ?? []) };
    });
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: 'Failed to fetch flight data', detail: String(err) });
  }
});

export default router;
