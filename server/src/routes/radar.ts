import { Router } from 'express';
import { cache } from '../cache';

const router = Router();

// RainViewer's frame manifest. Tile images are fetched directly by the client
// from RainViewer's CDN (host comes back in this payload) to avoid proxying
// large amounts of image traffic through our single dyno.
router.get('/', async (_req, res) => {
  try {
    const data = await cache.getOrFetch('radar:manifest', 2 * 60_000, async () => {
      const upstream = await fetch('https://api.rainviewer.com/public/weather-maps.json', {
        signal: AbortSignal.timeout(10_000),
      });
      if (!upstream.ok) throw new Error(`RainViewer error: ${upstream.status}`);
      return upstream.json();
    }, { staleOnError: true });
    res.set('Cache-Control', 'public, max-age=60');
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: 'Failed to fetch radar manifest', detail: String(err) });
  }
});

export default router;
