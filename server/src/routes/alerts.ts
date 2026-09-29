import { Router } from 'express';
import { cache } from '../cache';
import { config } from '../config';

const router = Router();

// Server-side fallback for the NWS active-alerts feed. The client fetches
// api.weather.gov directly from the browser (NWS sends CORS headers); this
// proxy is the backup path for when that direct fetch fails — NWS edge
// instability, or a corporate/guest network that filters weather.gov. The
// dyno reaches NWS over a different network path than the viewer's browser,
// so the two rarely fail together.
//
// api.weather.gov rejects requests without an identifying User-Agent
// (HTTP 403), so this sends the same NWS_USER_AGENT the other NOAA routes use.
const NWS_ALERTS_URL = 'https://api.weather.gov/alerts/active';

// ?point=lat,lon — the alerts in force AT one location, resolved by NWS's own
// forecast-zone/county/polygon logic. The flood report uses it to say whether
// a flood alert covers the property itself, which the national feed can't
// answer without re-implementing NWS's zone geometry. Validated strictly: the
// value is spliced into the upstream URL and used as a cache key, and NWS
// itself only takes up to 4 decimals.
const POINT_RE = /^-?\d{1,2}(\.\d{1,4})?,-?\d{1,3}(\.\d{1,4})?$/;

function readPoint(raw: unknown): string | null {
  if (typeof raw !== 'string' || !POINT_RE.test(raw)) return null;
  const [lat, lon] = raw.split(',').map(Number);
  return Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? raw : null;
}

router.get('/active', async (req, res, next) => {
  if (req.query.point === undefined) {
    next();
    return;
  }
  const point = readPoint(req.query.point);
  if (!point) {
    res.status(400).json({ error: 'point must be "lat,lon" in decimal degrees (up to 4 decimals)' });
    return;
  }
  try {
    // No staleOnError, unlike the national feed below: this answer is a
    // present-tense test of one site, and an hours-old cached "no alert here"
    // served through an NWS outage would print as the property's current
    // status. A failure 502s instead, so the client falls back to its
    // caveated county-outline check. The 60 s entry still spares NWS the
    // repeats of one report's render.
    const body = await cache.getOrFetch<Buffer>(`alerts:point:${point}`, 60_000, async () => {
      const upstream = await fetch(`${NWS_ALERTS_URL}?point=${point}`, {
        headers: { 'User-Agent': config.nwsUserAgent, Accept: 'application/geo+json' },
        // One location's alerts are a small document; fail over sooner than
        // the national feed does.
        signal: AbortSignal.timeout(15_000),
      });
      if (!upstream.ok) throw new Error(`NWS point alerts error: ${upstream.status}`);
      return Buffer.from(JSON.stringify(await upstream.json()));
    });
    res.type('application/json').send(body);
  } catch (err) {
    res.status(502).json({ error: 'Failed to fetch NWS alerts', detail: String(err) });
  }
});

router.get('/active', async (_req, res) => {
  try {
    const body = await cache.getOrFetch<Buffer>(
      'alerts:active',
      60_000,
      async () => {
        const upstream = await fetch(NWS_ALERTS_URL, {
          headers: { 'User-Agent': config.nwsUserAgent, Accept: 'application/geo+json' },
          // The national feed is a multi-MB GeoJSON document; give it more
          // headroom than the small-payload routes before failing over.
          signal: AbortSignal.timeout(20_000),
        });
        if (!upstream.ok) throw new Error(`NWS alerts error: ${upstream.status}`);
        // Parse to validate (junk upstream bodies still throw -> staleOnError),
        // then serialize once per refresh instead of once per request — the
        // feed is served to every client polling the fallback path.
        return Buffer.from(JSON.stringify(await upstream.json()));
      },
      { staleOnError: true }
    );
    res.type('application/json').send(body);
  } catch (err) {
    res.status(502).json({ error: 'Failed to fetch NWS alerts', detail: String(err) });
  }
});

export default router;
