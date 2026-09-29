import { eroCategoryFromAttributes } from './floodSections';
import type { EroCategory, EroPolygon } from './floodTypes';

// ── WPC Excessive Rainfall Outlook (Days 1–5) ────────────────────────────────
// The flood analog of the NWCG fire-potential outlook: the probability that
// rainfall exceeds flash-flood guidance within 25 mi of a point. Read straight
// from NOAA's MapServer in the browser, like the WPC QPF chips (same host,
// CORS-enabled). Layers 0–4 are Day 1–Day 5; each day's risk areas nest
// (Marginal ⊃ Slight ⊃ Moderate ⊃ High), so the highest category containing
// the point wins.

export const WPC_ERO_MAPSERVER =
  'https://mapservices.weather.noaa.gov/vector/rest/services/hazards/wpc_precip_hazards/MapServer';

const ERO_DAYS = [1, 2, 3, 4, 5] as const;
const layerOf = (day: number) => day - 1;

interface EsriQueryResponse {
  features?: Array<{ attributes?: Record<string, unknown>; geometry?: { rings?: number[][][] } }>;
  error?: { message?: string };
}

async function queryLayer(day: number, params: Record<string, string>): Promise<EsriQueryResponse> {
  const qs = new URLSearchParams({ where: '1=1', outFields: '*', inSR: '4326', f: 'json', ...params });
  const res = await fetch(`${WPC_ERO_MAPSERVER}/${layerOf(day)}/query?${qs}`, {
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`WPC ERO Day ${day} HTTP ${res.status}`);
  const j = (await res.json()) as EsriQueryResponse;
  if (j.error) throw new Error(`WPC ERO Day ${day}: ${j.error.message ?? 'service error'}`);
  if (j.features !== undefined && !Array.isArray(j.features)) throw new Error(`WPC ERO Day ${day}: malformed response`);
  return j;
}

/**
 * Highest category among features; throws when features exist but none
 * parses — an unreadable outlook is an outage, not "no risk".
 */
function categoryOf(day: number, j: EsriQueryResponse): EroCategory {
  const feats = j.features ?? [];
  let best: EroCategory = 0;
  let parsed = false;
  for (const f of feats) {
    const c = eroCategoryFromAttributes(f.attributes ?? {});
    if (c === null) continue;
    parsed = true;
    if (c > best) best = c;
  }
  if (feats.length > 0 && !parsed) throw new Error(`WPC ERO Day ${day}: unrecognized outlook attribute`);
  return best;
}

/**
 * The outlook category at the property for Days 1–5 — an exact point query
 * per day (the map's generalized polygons could flip a site near an edge).
 * All-or-nothing: any day failing fails the feed, so a partial outlook never
 * reads as a quiet one.
 */
export async function fetchEroSiteDays(lat: number, lon: number): Promise<{ day: number; category: EroCategory }[]> {
  const point = {
    geometry: `${lon.toFixed(4)},${lat.toFixed(4)}`,
    geometryType: 'esriGeometryPoint',
    spatialRel: 'esriSpatialRelIntersects',
    returnGeometry: 'false',
  };
  return Promise.all(
    ERO_DAYS.map(async (day) => ({ day, category: categoryOf(day, await queryLayer(day, point)) }))
  );
}

/** Day-N risk polygons in a box around the property, for the regional map. */
export async function fetchEroPolygons(lat: number, lon: number, day = 1): Promise<EroPolygon[]> {
  // The map fits a 250 mi radius into 38% of a 660×380 canvas: ≈330 mi each
  // side horizontally, ≈190 mi vertically — query a little beyond that.
  const dLat = 220 / 69;
  const dLon = 350 / (69 * Math.max(0.2, Math.cos((lat * Math.PI) / 180)));
  const j = await queryLayer(day, {
    geometry: [lon - dLon, lat - dLat, lon + dLon, lat + dLat].map((v) => v.toFixed(3)).join(','),
    geometryType: 'esriGeometryEnvelope',
    spatialRel: 'esriSpatialRelIntersects',
    returnGeometry: 'true',
    outSR: '4326',
    maxAllowableOffset: '0.01',
  });
  const polys: EroPolygon[] = [];
  for (const f of j.features ?? []) {
    const category = eroCategoryFromAttributes(f.attributes ?? {});
    const rings = (f.geometry?.rings ?? []).filter((r) => Array.isArray(r) && r.length >= 3);
    if (!category || rings.length === 0) continue;
    polys.push({ category, rings });
  }
  // Lowest first so the higher-risk areas paint on top of the ones they sit in.
  return polys.sort((a, b) => a.category - b.category);
}
