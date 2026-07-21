import { Router } from 'express';
import { cache } from '../cache';

const router = Router();

// NPS Land Resources Division Boundary — Esri-hosted FeatureServer (layer 2 = nps_boundary).
// Confirmed URL: https://services1.arcgis.com/fBc8EJBxQRMcHlei/arcgis/rest/services/
//   NPS_Land_Resources_Division_Boundary_and_Tract_Data_Service/FeatureServer/2
const NPS_BOUNDARIES =
  'https://services1.arcgis.com/fBc8EJBxQRMcHlei/arcgis/rest/services/NPS_Land_Resources_Division_Boundary_and_Tract_Data_Service/FeatureServer/2/query';

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
    res.set('Cache-Control', 'public, max-age=86400');
    res.json(data);
  } catch (err) {
    console.error(`[park] NPS boundary fetch failed for ${code}:`, err);
    res.status(502).json({ error: String(err) });
  }
});

export default router;
