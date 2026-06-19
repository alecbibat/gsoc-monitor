import { Router } from 'express';
import { cache } from '../cache';
import { config } from '../config';

const router = Router();

router.get('/', async (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  if (!q || q.length > 200) {
    res.status(400).json({ error: 'q is required (max 200 chars)' });
    return;
  }

  const cacheKey = `geocode:${q.toLowerCase()}`;

  try {
    const data = await cache.getOrFetch(cacheKey, 24 * 60 * 60_000, async () => {
      const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&q=${encodeURIComponent(q)}`;
      const upstream = await fetch(url, {
        headers: {
          // Nominatim's usage policy requires an identifying User-Agent.
          'User-Agent': config.nwsUserAgent,
        },
        signal: AbortSignal.timeout(10_000),
      });
      if (!upstream.ok) throw new Error(`Nominatim error: ${upstream.status}`);
      return upstream.json();
    }, { staleOnError: true });
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: 'Failed to geocode', detail: String(err) });
  }
});

export default router;
