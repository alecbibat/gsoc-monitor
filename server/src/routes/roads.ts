import { Router } from 'express';
import { cache } from '../cache';
import { collectRoadClosures } from '../roads/service';
import { ROAD_SOURCES } from '../roads/sources';

// GET /api/roads/closures — road closures and restrictions in force around the
// followed national parks, merged from every source in roads/sources (each
// cached on its own TTL), with each source's health. See roads/service.ts.

const router = Router();

router.get('/closures', async (_req, res) => {
  try {
    const feed = await cache.getOrFetch('roads:closures', 60_000, () => collectRoadClosures(ROAD_SOURCES));
    res.json(feed);
  } catch (err) {
    res.status(502).json({ error: 'Road closures unavailable', detail: err instanceof Error ? err.message : String(err) });
  }
});

export default router;
