import { Router } from 'express';
import { NGFS_WINDOWS_H, ngfsService, type NgfsService, type NgfsWindowH } from './service';

// NOAA/CIMSS Next Generation Fire System heat detections from GOES-East and
// GOES-West, aggregated per satellite pixel over the last 1, 3 or 6 hours.

// How long a request waits for a refresh before answering from the cache.
// Normally a refresh is a couple of quick calls, so the response carries the
// newest frame; a slow or unreachable upstream (or a cold session handshake)
// can't hold a request past Heroku's 30 s router limit. With nothing cached
// yet there's nothing else to serve, so a cold start waits longer.
const WARM_WAIT_MS = 8_000;
const COLD_WAIT_MS = 20_000;

function within(p: Promise<void>, ms: number): Promise<void> {
  return Promise.race([p, new Promise<void>((r) => setTimeout(r, ms).unref())]);
}

export function createNgfsRouter(
  service: NgfsService = ngfsService,
  waits: { warmMs: number; coldMs: number } = { warmMs: WARM_WAIT_MS, coldMs: COLD_WAIT_MS }
): Router {
  const router = Router();

  router.get('/', async (req, res) => {
    const requested = Number(req.query.hours ?? 1);
    if (!NGFS_WINDOWS_H.includes(requested as NgfsWindowH)) {
      res.status(400).json({ error: `hours must be one of ${NGFS_WINDOWS_H.join(', ')}` });
      return;
    }
    try {
      await within(service.ensureFresh(), service.empty ? waits.coldMs : waits.warmMs);
      const snap = service.snapshot(requested as NgfsWindowH);
      if (service.empty) {
        if (!service.busy) {
          const why = snap.products.map((p) => p.error).find(Boolean);
          res.status(502).json({ error: `NGFS feed unavailable${why ? `: ${why}` : ''}` });
          return;
        }
        // Still on the first fetch: an empty answer the client re-polls soon.
        res.set('Cache-Control', 'no-store');
        res.json({ ...snap, warming: true });
        return;
      }
      // Shared by every client and refreshed server-side every 2 minutes.
      res.set('Cache-Control', 'no-cache');
      res.json(snap);
    } catch (err) {
      console.error('NGFS route error', err);
      res.status(502).json({ error: 'NGFS feed unavailable' });
    }
  });

  return router;
}

export default createNgfsRouter();
