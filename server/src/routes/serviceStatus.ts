import { Router } from 'express';
import { cache } from '../cache';
import { checkAllServices } from '../serviceStatus';

const router = Router();

// One shared answer for every viewer: ~35 status pages, re-read at most every
// two minutes. Takes no parameters, so it cannot be used as an open proxy.
// A page that fails is reported per service (see checkAllServices), so this
// only errors if the sweep itself throws.
router.get('/', async (_req, res) => {
  try {
    const services = await cache.getOrFetch('service-status', 120_000, () => checkAllServices(), {
      staleOnError: true,
    });
    res.json({ services, updated: Date.now() });
  } catch (err) {
    res.status(502).json({ error: 'Failed to read service status pages', detail: String(err) });
  }
});

export default router;
