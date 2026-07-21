import { Router } from 'express';
import { cache } from '../cache';

const router = Router();

// Esri public USA Counties generalized feature service (CORS-enabled, 1:5M scale).
const ESRI_COUNTIES =
  'https://services.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/services/USA_Counties_Generalized_Boundaries/FeatureServer/0/query';

router.get('/:fips', async (req, res) => {
  const { fips } = req.params;
  if (!/^\d{5}$/.test(fips)) {
    res.status(400).json({ error: 'FIPS must be 5 digits' });
    return;
  }

  try {
    const data = await cache.getOrFetch(`county:${fips}`, 24 * 60 * 60_000, async () => {
      const url = new URL(ESRI_COUNTIES);
      url.searchParams.set('where', `FIPS='${fips}'`);
      url.searchParams.set('outFields', 'FIPS,NAME,STATE_NAME');
      url.searchParams.set('outSR', '4326');
      url.searchParams.set('returnGeometry', 'true');
      url.searchParams.set('f', 'geojson');
      const r = await fetch(url.toString(), { signal: AbortSignal.timeout(10_000) });
      if (!r.ok) throw new Error(`Esri county service: ${r.status}`);
      return r.json();
    });
    res.set('Cache-Control', 'public, max-age=86400');
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: String(err) });
  }
});

export default router;
