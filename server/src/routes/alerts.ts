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

// ?id=urn:oid:… — what became of one alert: still in effect, replaced by a
// later version, or cancelled. The active feed never lists a cancellation
// (it drops the cancelled alert and the cancel message alike), so when an
// alert that reached a property leaves the feed before its end, the pin
// notifier asks here: NWS marks the original `replacedBy` the message that
// ended it. Only an id of NWS's own form is looked up, and the replacing
// message's URL is never followed as given — its id is checked the same way.
const ALERT_ID_RE = /^urn:oid:2\.49\.0\.1\.840\.0\.[0-9a-f]{32,64}\.\d{1,4}\.\d{1,4}$/;
const NWS_ALERT_BASE = 'https://api.weather.gov/alerts/';

export type AlertFate =
  | { id: string; status: 'not-replaced' }
  | { id: string; status: 'replaced'; by: { id: string; messageType: string | null } }
  | { id: string; status: 'cancelled'; by: { id: string; sent: string | null; description: string | null } };

/** The urn an alert's `replacedBy` names, when it is one of NWS's own. */
export function replacedById(replacedBy: unknown): string | null {
  if (typeof replacedBy !== 'string') return null;
  const urn = replacedBy.startsWith(NWS_ALERT_BASE) ? replacedBy.slice(NWS_ALERT_BASE.length) : replacedBy;
  return ALERT_ID_RE.test(urn) ? urn : null;
}

async function nwsAlertProperties(id: string): Promise<Record<string, unknown>> {
  const upstream = await fetch(`${NWS_ALERT_BASE}${id}`, {
    headers: { 'User-Agent': config.nwsUserAgent, Accept: 'application/geo+json' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!upstream.ok) throw new Error(`NWS alert lookup error: ${upstream.status}`);
  const body = (await upstream.json()) as { properties?: Record<string, unknown> };
  if (!body || typeof body.properties !== 'object' || body.properties === null) throw new Error('NWS alert has no properties');
  return body.properties;
}

const str = (v: unknown) => (typeof v === 'string' && v ? v : null);

router.get('/fate', async (req, res) => {
  const id = typeof req.query.id === 'string' && ALERT_ID_RE.test(req.query.id) ? req.query.id : null;
  if (!id) {
    res.status(400).json({ error: 'id must be an NWS alert id (urn:oid:2.49.0.1.840.0.…)' });
    return;
  }
  try {
    const fate = await cache.getOrFetch<AlertFate>(`alerts:fate:${id}`, 60_000, async () => {
      const by = replacedById((await nwsAlertProperties(id)).replacedBy);
      if (!by) return { id, status: 'not-replaced' };
      const next = await nwsAlertProperties(by);
      return next.messageType === 'Cancel'
        ? { id, status: 'cancelled', by: { id: by, sent: str(next.sent), description: str(next.description) } }
        : { id, status: 'replaced', by: { id: by, messageType: str(next.messageType) } };
    });
    res.json(fate);
  } catch (err) {
    res.status(502).json({ error: 'Failed to look up the NWS alert', detail: String(err) });
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
