import { Router } from 'express';
import { cache } from '../cache';
import { config } from '../config';

const router = Router();

const STATE_CODE = /^[A-Z]{2}$/;

router.get('/', async (req, res) => {
  const area = typeof req.query.area === 'string' ? req.query.area.toUpperCase() : '';
  if (area && !STATE_CODE.test(area)) {
    res.status(400).json({ error: 'area must be a 2-letter state code' });
    return;
  }

  const cacheKey = `alerts:${area || 'all'}`;
  const url = area
    ? `https://api.weather.gov/alerts/active?area=${area}`
    : 'https://api.weather.gov/alerts/active';

  try {
    const data = await cache.getOrFetch(cacheKey, 60_000, async () => {
      const upstream = await fetch(url, {
        headers: {
          'User-Agent': config.nwsUserAgent,
          Accept: 'application/geo+json',
        },
      });
      if (!upstream.ok) throw new Error(`NWS alerts error: ${upstream.status}`);
      return upstream.json();
    });
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: 'Failed to fetch NWS alerts', detail: String(err) });
  }
});

export default router;
