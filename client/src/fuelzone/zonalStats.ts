import {
  FBFM40,
  fbfm40Class,
  FUEL_GROUPS,
  type FuelGroupKey,
} from '../layers/fuel/fbfm40';
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

function emptyResult(center: LngLat, radiusM: number): FuelZoneResult {
  return {
    center,
    radiusM,
    totalPixels: 0,
    areaM2: 0,
    burnablePct: 0,
    classes: [],
    groups: [],
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
    source: 'LANDFIRE (USGS/USFS)',
    version: LANDFIRE_VERSION_LABEL,
  };
}
