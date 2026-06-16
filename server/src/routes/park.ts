import { Router } from 'express';
import { cache } from '../cache';

const router = Router();

// Official NPS Land Resources Division boundary service. Layer 2 holds the
// authoritative park unit boundary polygons, keyed by UNIT_CODE (e.g. GRCA).
const NPS_BOUNDARIES =
  'https://mapservices.nps.gov/arcgis/rest/services/LandResourcesDivisionTractAndBoundaryService/MapServer/2/query';

router.get('/:code', async (req, res) => {
  const code = req.params.code.toUpperCase();
  if (!/^[A-Z]{4}$/.test(code)) {
    res.status(400).json({ error: 'UNIT_CODE must be 4 letters' });
    return;
  }

  try {
    const data = await cache.getOrFetch(`park:${code}`, 24 * 60 * 60_000, async () => {
      const url = new URL(NPS_BOUNDARIES);
      url.searchParams.set('where', `UNIT_CODE='${code}'`);
      url.searchParams.set('outFields', 'UNIT_CODE,UNIT_NAME');
      url.searchParams.set('outSR', '4326');
      url.searchParams.set('returnGeometry', 'true');
      url.searchParams.set('f', 'geojson');
      const r = await fetch(url.toString(), { signal: AbortSignal.timeout(12_000) });
      if (!r.ok) throw new Error(`NPS boundary service: ${r.status}`);
      return r.json();
    });
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: String(err) });
  }
});

export default router;
