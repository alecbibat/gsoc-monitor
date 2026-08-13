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

router.get('/active', async (_req, res) => {
  try {
    const data = await cache.getOrFetch(
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
        return upstream.json();
      },
      { staleOnError: true }
    );
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: 'Failed to fetch NWS alerts', detail: String(err) });
  }
});

export default router;
