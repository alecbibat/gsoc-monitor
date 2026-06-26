import {
  FBFM40,
  fbfm40Class,
  FUEL_GROUPS,
  type FuelGroupKey,
} from '../layers/fuel/fbfm40';

// --- Fire-behavior risk scoring -------------------------------------------
// Per-FBFM40 composite score (0–100) derived from Scott & Burgan (2005) rate-
// of-spread and flame-length values at standard test conditions (20-ft wind
// 10 mph, 1-hr fuel moisture 5%).  Nonburnable codes are 0.
const CODE_SCORE: Record<number, number> = {
  // Grass (GR) — fastest surface-fire spread
  101: 25, 102: 45, 103: 50, 104: 65, 105: 60, 106: 75, 107: 85, 108: 90, 109: 95,
  // Grass-Shrub (GS)
  121: 50, 122: 65, 123: 75, 124: 90,
  // Shrub (SH)
  141: 25, 142: 30, 143: 55, 144: 40, 145: 65, 146: 40, 147: 80, 148: 75, 149: 90,
  // Timber-Understory (TU)
  161: 25, 162: 20, 163: 50, 164: 35, 165: 75,
  // Timber-Litter (TL) — slow surface fire
  181: 5,  182: 8,  183: 15, 184: 20, 185: 20, 186: 18, 187: 22, 188: 25, 189: 25,
  // Slash-Blowdown (SB) — intense, erratic
  201: 25, 202: 40, 203: 60, 204: 75,
  // Nonburnable
  91: 0, 92: 0, 93: 0, 98: 0, 99: 0,
};

// Rate-of-spread sub-score.
const CODE_SPREAD: Record<number, number> = {
  101: 20, 102: 60, 103: 55, 104: 75, 105: 65, 106: 80, 107: 90, 108: 95, 109: 100,
  121: 55, 122: 70, 123: 80, 124: 95,
  141: 20, 142: 20, 143: 40, 144: 25, 145: 60, 146: 22, 147: 75, 148: 65, 149: 80,
  161: 18, 162: 10, 163: 35, 164: 20, 165: 65,
  181: 3,  182: 3,  183: 8,  184: 7,  185: 10, 186: 8,  187: 5,  188: 12, 189: 8,
  201: 15, 202: 25, 203: 50, 204: 70,
  91: 0, 92: 0, 93: 0, 98: 0, 99: 0,
};

// Expected flame-length sub-score.
const CODE_FLAME: Record<number, number> = {
  101: 25, 102: 40, 103: 60, 104: 55, 105: 70, 106: 85, 107: 75, 108: 100, 109: 100,
  121: 50, 122: 65, 123: 85, 124: 100,
  141: 30, 142: 35, 143: 60, 144: 45, 145: 75, 146: 50, 147: 90, 148: 90, 149: 100,
  161: 28, 162: 25, 163: 55, 164: 45, 165: 85,
  181: 8,  182: 12, 183: 18, 184: 35, 185: 30, 186: 25, 187: 50, 188: 45, 189: 50,
  201: 30, 202: 60, 203: 80, 204: 90,
  91: 0, 92: 0, 93: 0, 98: 0, 99: 0,
};

export type RiskLevel = 'Low' | 'Moderate' | 'High' | 'Very High' | 'Extreme';

export interface FuelRisk {
  score: number;      // 0–100 weighted over burnable pixels only
  level: RiskLevel;
  spreadCat: 'Slow' | 'Moderate' | 'Fast' | 'Very Fast';
  flameCat: 'Short' | 'Moderate' | 'Long' | 'Very Long';
  drivers: string[];  // 1–3 concise factor strings
}
import { LANDFIRE_FBFM40_IMAGESERVER, LANDFIRE_VERSION_LABEL } from '../layers/fuel/landfireService';

export interface LngLat {
  lon: number;
  lat: number;
}

// Share of one FBFM40 class within the analyzed circle.
export interface FuelClassShare {
  value: number; // raster pixel code, e.g. 102
  code: string; // "GR2"
  name: string;
  group: FuelGroupKey;
  rgb: [number, number, number];
  pixels: number;
  pct: number; // 0–100
}

// Rolled-up share of one coarse fuel group.
export interface FuelGroupShare {
  key: FuelGroupKey;
  label: string;
  rgb: [number, number, number];
  burnable: boolean;
  pixels: number;
  pct: number; // 0–100
}

export interface FuelZoneResult {
  center: LngLat;
  radiusM: number;
  totalPixels: number;
  areaM2: number; // data-covered area (excludes NoData ocean/outside-CONUS)
  burnablePct: number; // share of burnable (non-Nonburnable) pixels
  classes: FuelClassShare[]; // sorted desc by pixels
  groups: FuelGroupShare[]; // sorted desc by pixels (only non-empty groups)
  risk: FuelRisk | null; // null when burnablePct === 0
  source: string;
  version: string;
}

const EARTH_RADIUS_M = 6378137;
// LANDFIRE FBFM40 is a 30 m product.
const PIXEL_SIZE_M = 30;
const PIXEL_AREA_M2 = PIXEL_SIZE_M * PIXEL_SIZE_M; // 900 m² per cell

// Destination point given a start, a great-circle distance (m) and a bearing
// (radians). Standard spherical formula — accurate enough for drawing the query
// polygon at any sane radius.
function destPoint(lon: number, lat: number, distM: number, bearing: number): [number, number] {
  const d = distM / EARTH_RADIUS_M;
  const lat1 = (lat * Math.PI) / 180;
  const lon1 = (lon * Math.PI) / 180;
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(bearing)
  );
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(bearing) * Math.sin(d) * Math.cos(lat1),
      Math.cos(d) - Math.sin(lat1) * Math.sin(lat2)
    );
  return [(lon2 * 180) / Math.PI, (lat2 * 180) / Math.PI];
}

// Great-circle distance between two points, in meters (haversine).
export function distanceM(a: LngLat, b: LngLat): number {
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const dLat = lat2 - lat1;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Build an ArcGIS polygon ring approximating the circle, wound clockwise (the
// orientation ArcGIS expects for an outer ring). Returned as [lon, lat] pairs in
// WGS84 — the ImageServer reprojects to its native Albers automatically. Also
// reused to draw the on-globe outline, so the rendered ring matches the exact
// geometry that gets histogrammed.
export function circleRing(center: LngLat, radiusM: number, segments = 64): number[][] {
  const ring: number[][] = [];
  for (let i = 0; i <= segments; i++) {
    // Clockwise: bearing increases 0(N) → 90(E) → 180(S) → 270(W).
    const bearing = (i / segments) * 2 * Math.PI;
    ring.push(destPoint(center.lon, center.lat, radiusM, bearing));
  }
  return ring;
}

interface Histogram {
  size: number;
  min: number;
  max: number;
  counts: number[];
}

// Decode an ArcGIS computeHistograms band into exact per-value pixel counts.
//
// CRITICAL: the `counts` array is NOT indexed 1:1 by pixel value. ArcGIS spreads
// the data range [min,max] across `size` (256) bins, so the bin→value mapping is
// affine: value(i) = round(min + i*(max-min)/(size-1)). Decoding naively as
// `min + index` yields impossible codes. (Verified against getSamples ground
// truth.) Bins that round to the same integer value are summed together; gaps
// between valid FBFM40 codes simply carry zero counts.
function decodeHistogram(h: Histogram): Map<number, number> {
  const byValue = new Map<number, number>();
  const { counts, size, min, max } = h;
  for (let i = 0; i < counts.length; i++) {
    const c = counts[i];
    if (!c) continue;
    const value = size > 1 ? Math.round(min + (i * (max - min)) / (size - 1)) : min;
    byValue.set(value, (byValue.get(value) ?? 0) + c);
  }
  return byValue;
}

// Pixel-weighted mean score over burnable pixels only.
function burnableWeightedScore(
  classes: FuelClassShare[],
  scores: Record<number, number>,
  burnablePixels: number
): number {
  if (burnablePixels === 0) return 0;
  let sum = 0;
  for (const c of classes) {
    if (c.group === 'Nonburnable') continue;
    sum += (scores[c.value] ?? 0) * c.pixels;
  }
  return sum / burnablePixels;
}

function riskLevelFromScore(s: number): RiskLevel {
  if (s < 20) return 'Low';
  if (s < 40) return 'Moderate';
  if (s < 60) return 'High';
  if (s < 78) return 'Very High';
  return 'Extreme';
}

function spreadCatFromScore(s: number): FuelRisk['spreadCat'] {
  if (s < 20) return 'Slow';
  if (s < 50) return 'Moderate';
  if (s < 75) return 'Fast';
  return 'Very Fast';
}

function flameCatFromScore(s: number): FuelRisk['flameCat'] {
  if (s < 25) return 'Short';
  if (s < 55) return 'Moderate';
  if (s < 78) return 'Long';
  return 'Very Long';
}

function buildDrivers(
  classes: FuelClassShare[],
  groups: FuelGroupShare[],
  burnablePixels: number
): string[] {
  if (burnablePixels === 0) return [];
  const drivers: string[] = [];
  const bp = (c: FuelClassShare) => (c.pixels / burnablePixels) * 100;
  const burnable = classes.filter((c) => c.group !== 'Nonburnable');

  // Fast-spread threat: grass/grass-shrub with high spread scores
  const rapidFuels = burnable.filter(
    (c) => ['Grass', 'Grass-Shrub'].includes(c.group) && (CODE_SPREAD[c.value] ?? 0) >= 60
  );
  const rapidPct = rapidFuels.reduce((s, c) => s + bp(c), 0);
  if (rapidPct > 5) {
    const codes = rapidFuels.slice(0, 3).map((c) => c.code).join('/');
    drivers.push(`Rapid-spread fuels (${codes}): ${Math.round(rapidPct)}% of burnable area`);
  }

  // High flame-length threat: any code with flame score ≥ 70 covering >3% of burnable
  const intenseFuels = burnable.filter(
    (c) => (CODE_FLAME[c.value] ?? 0) >= 70 && bp(c) > 3
  );
  const intensePct = intenseFuels.reduce((s, c) => s + bp(c), 0);
  if (intensePct > 5 && drivers.length < 3) {
    const codes = intenseFuels.slice(0, 2).map((c) => c.code).join('/');
    drivers.push(`High flame-length fuels (${codes}): ${Math.round(intensePct)}% of burnable area`);
  }

  // Slash-blowdown: erratic behavior / spotting
  const slashPct = burnable
    .filter((c) => c.group === 'Slash-Blowdown')
    .reduce((s, c) => s + bp(c), 0);
  if (slashPct > 1 && drivers.length < 3) {
    drivers.push('Slash/blowdown present — spotting and erratic behavior possible');
  }

  // Timber-dominant fallback (slower but steady)
  if (drivers.length === 0) {
    const timberPct = burnable
      .filter((c) => ['Timber-Litter', 'Timber-Understory'].includes(c.group))
      .reduce((s, c) => s + bp(c), 0);
    if (timberPct > 40) {
      drivers.push(
        `Timber fuels dominant (${Math.round(timberPct)}%) — slower surface fire, crown fire possible`
      );
    }
  }

  // Generic fallback: name the top burnable group
  if (drivers.length === 0) {
    const topGroup = groups.find((g) => g.burnable);
    if (topGroup) {
      const pct = (topGroup.pixels / burnablePixels) * 100;
      drivers.push(`${topGroup.label} is ${Math.round(pct)}% of burnable area`);
    }
  }

  return drivers.slice(0, 3);
}

function computeRisk(
  classes: FuelClassShare[],
  groups: FuelGroupShare[],
  burnablePixels: number
): FuelRisk | null {
  if (burnablePixels === 0) return null;
  const score = burnableWeightedScore(classes, CODE_SCORE, burnablePixels);
  const spreadScore = burnableWeightedScore(classes, CODE_SPREAD, burnablePixels);
  const flameScore = burnableWeightedScore(classes, CODE_FLAME, burnablePixels);
  return {
    score: Math.round(score),
    level: riskLevelFromScore(score),
    spreadCat: spreadCatFromScore(spreadScore),
    flameCat: flameCatFromScore(flameScore),
    drivers: buildDrivers(classes, groups, burnablePixels),
  };
}

function emptyResult(center: LngLat, radiusM: number): FuelZoneResult {
  return {
    center,
    radiusM,
    totalPixels: 0,
    areaM2: 0,
    burnablePct: 0,
    classes: [],
    groups: [],
    risk: null,
    source: 'LANDFIRE (USGS/USFS)',
    version: LANDFIRE_VERSION_LABEL,
  };
}

// Run the zonal histogram for a circle and return the FBFM40 fuel-type
// breakdown. Talks to the LANDFIRE ImageServer directly (open CORS); a POST with
// a form-encoded body is a "simple" CORS request, so there's no preflight.
export async function analyzeFuelZone(center: LngLat, radiusM: number): Promise<FuelZoneResult> {
  const geometry = {
    rings: [circleRing(center, radiusM)],
    spatialReference: { wkid: 4326 },
  };

  const body = new URLSearchParams();
  body.set('geometry', JSON.stringify(geometry));
  body.set('geometryType', 'esriGeometryPolygon');
  body.set('f', 'json');

  const res = await fetch(`${LANDFIRE_FBFM40_IMAGESERVER}/computeHistograms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) {
    throw new Error(`LANDFIRE request failed (${res.status})`);
  }
  const data = await res.json();
  if (data?.error) {
    throw new Error(data.error.message || 'LANDFIRE returned an error');
  }

  const hist: Histogram | undefined = data?.histograms?.[0];
  if (!hist || !Array.isArray(hist.counts) || hist.counts.length === 0) {
    // No data in the geometry — typically ocean or outside CONUS coverage.
    return emptyResult(center, radiusM);
  }

  const byValue = decodeHistogram(hist);
  let totalPixels = 0;
  for (const c of byValue.values()) totalPixels += c;
  if (totalPixels === 0) return emptyResult(center, radiusM);

  // Per-class shares.
  const classes: FuelClassShare[] = [];
  const groupPixels = new Map<FuelGroupKey, number>();
  let burnablePixels = 0;

  for (const [value, pixels] of byValue) {
    const cls = fbfm40Class(value);
    classes.push({
      value,
      code: cls.code,
      name: cls.name,
      group: cls.group,
      rgb: cls.rgb,
      pixels,
      pct: (pixels / totalPixels) * 100,
    });
    groupPixels.set(cls.group, (groupPixels.get(cls.group) ?? 0) + pixels);
    if (FBFM40[value] && cls.group !== 'Nonburnable') burnablePixels += pixels;
  }
  classes.sort((a, b) => b.pixels - a.pixels);

  // Group rollup, in canonical group order, dropping empty groups.
  const groups: FuelGroupShare[] = FUEL_GROUPS.filter((g) => (groupPixels.get(g.key) ?? 0) > 0)
    .map((g) => {
      const pixels = groupPixels.get(g.key) ?? 0;
      return {
        key: g.key,
        label: g.label,
        rgb: g.rgb,
        burnable: g.burnable,
        pixels,
        pct: (pixels / totalPixels) * 100,
      };
    })
    .sort((a, b) => b.pixels - a.pixels);

  return {
    center,
    radiusM,
    totalPixels,
    areaM2: totalPixels * PIXEL_AREA_M2,
    burnablePct: (burnablePixels / totalPixels) * 100,
    classes,
    groups,
    risk: computeRisk(classes, groups, burnablePixels),
    source: 'LANDFIRE (USGS/USFS)',
    version: LANDFIRE_VERSION_LABEL,
  };
}
