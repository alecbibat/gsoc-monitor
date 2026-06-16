import { Router } from 'express';
import { cache } from '../cache';

const router = Router();

const MAGNITUDES = new Set(['significant', '4.5', '2.5', '1.0', 'all']);
const PERIODS = new Set(['hour', 'day', 'week']);

router.get('/', async (req, res) => {
  const magnitude = String(req.query.magnitude || '2.5');
  const period = String(req.query.period || 'day');

  if (!MAGNITUDES.has(magnitude) || !PERIODS.has(period)) {
    res.status(400).json({ error: 'Invalid magnitude or period' });
    return;
  }

  const feed = `${magnitude}_${period}`;
  const cacheKey = `earthquakes:${feed}`;

  try {
    const data = await cache.getOrFetch(cacheKey, 60_000, async () => {
      const upstream = await fetch(
        `https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/${feed}.geojson`
      );
      if (!upstream.ok) throw new Error(`USGS feed error: ${upstream.status}`);
      return upstream.json();
    });
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: 'Failed to fetch earthquake data', detail: String(err) });
  }
});

export default router;
