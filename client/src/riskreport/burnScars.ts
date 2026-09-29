import type { BurnScarInput } from './floodSections';

// ── Burn scars for the flood report ──────────────────────────────────────────
// Every wildfire perimeter reported this year, not just the active ones. The
// wildfire layer reads WFIGS "Current" perimeters, which drop a fire once it
// is contained, controlled or out — but the classic post-fire flash flood hits
// the scar of a fire that is long since out (a July fire, a September storm).
// So the flood report reads the year-to-date archive instead, queried around
// the property rather than as a national top-N, straight from the browser
// like the wildfire layer (ArcGIS Online, CORS-enabled, no key).

const YTD_PERIMETERS =
  'https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Interagency_Perimeters_YearToDate/FeatureServer/0/query';

// Same floor as the wildfire layer's perimeters: a scar smaller than this is
// rarely mapped well enough to matter at report scale.
const MIN_ACRES = 100;

interface EsriQueryResponse {
  features?: Array<{ attributes?: Record<string, unknown>; geometry?: { rings?: number[][][] } }>;
  exceededTransferLimit?: boolean;
  error?: { message?: string };
}

/**
 * This year's fire perimeters ≥100 acres within `radiusMi` of the property.
 * `truncated` = the service stopped at its record cap, so a scar near the
 * property could be missing (the caller must not claim "none nearby").
 */
export async function fetchBurnScars(
  lat: number,
  lon: number,
  radiusMi = 130
): Promise<{ scars: BurnScarInput[]; truncated: boolean }> {
  const dLat = radiusMi / 69;
  const dLon = radiusMi / (69 * Math.max(0.2, Math.cos((lat * Math.PI) / 180)));
  const qs = new URLSearchParams({
    where: `attr_IncidentSize>=${MIN_ACRES}`,
    geometry: [lon - dLon, lat - dLat, lon + dLon, lat + dLat].map((v) => v.toFixed(4)).join(','),
    geometryType: 'esriGeometryEnvelope',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: 'poly_IncidentName,attr_IncidentSize',
    returnGeometry: 'true',
    outSR: '4326',
    maxAllowableOffset: '0.002', // ~200 m — plenty for a distance to 0.1 mi
    f: 'json',
  });
  const res = await fetch(`${YTD_PERIMETERS}?${qs}`, { signal: AbortSignal.timeout(25_000) });
  if (!res.ok) throw new Error(`WFIGS perimeters HTTP ${res.status}`);
  const j = (await res.json()) as EsriQueryResponse;
  if (j.error) throw new Error(`WFIGS perimeters: ${j.error.message ?? 'service error'}`);
  if (j.features !== undefined && !Array.isArray(j.features)) throw new Error('WFIGS perimeters: malformed response');

  const scars: BurnScarInput[] = [];
  for (const f of j.features ?? []) {
    const rings = (f.geometry?.rings ?? []).filter((r) => Array.isArray(r) && r.length >= 3);
    if (rings.length === 0) continue;
    const a = f.attributes ?? {};
    const name = typeof a.poly_IncidentName === 'string' && a.poly_IncidentName.trim() ? a.poly_IncidentName.trim() : undefined;
    const acres = typeof a.attr_IncidentSize === 'number' && Number.isFinite(a.attr_IncidentSize) ? a.attr_IncidentSize : undefined;
    scars.push({ name, acres, rings });
  }
  return { scars, truncated: j.exceededTransferLimit === true };
}
