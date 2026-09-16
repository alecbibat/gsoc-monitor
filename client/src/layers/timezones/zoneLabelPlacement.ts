// Where to put a zone's clock label so it is on screen wherever the camera
// is looking. Pure geometry in degrees, no Cesium, unit-tested.
//
// The Natural Earth bands are tall: America/Denver's polygon runs from the
// Antarctic coast to the North Pole, so a single fixed anchor is off screen
// at any regional zoom. Instead the label slides along the band: it sits at
// the camera's own latitude (when the band reaches it) on the stretch of the
// band nearest the camera's longitude. Zooming into Colorado puts the label
// over Colorado; panning to Alberta drags it up to Alberta.

export interface LonLat {
  lon: number;
  lat: number;
}

interface Ring {
  lon: Float64Array;
  lat: Float64Array;
  minLat: number;
  maxLat: number;
}

export interface PolygonShape {
  /** Outer ring first, holes after — even-odd scanlines treat them alike. */
  rings: Ring[];
  minLat: number;
  maxLat: number;
  /** A point definitely inside this polygon, for when no scanline hits it. */
  interior: LonLat;
}

export interface ZoneShape {
  polygons: PolygonShape[];
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
  /** Rough size of the whole feature in metres (max of its N-S and E-W extents). */
  spanMeters: number;
}

export type Interval = [number, number];

const METERS_PER_DEG = 111_320;
// Scanline crossings closer together than this are the tessellation noise of
// a boundary grazing the latitude, not a place to put a label.
const MIN_INTERVAL_DEG = 0.02;

// ── Building ────────────────────────────────────────────────────────────────

function ringFromCoords(coords: number[][]): Ring {
  const n = coords.length;
  const lon = new Float64Array(n);
  const lat = new Float64Array(n);
  let minLat = Infinity;
  let maxLat = -Infinity;
  for (let i = 0; i < n; i++) {
    lon[i] = coords[i][0];
    lat[i] = coords[i][1];
    if (lat[i] < minLat) minLat = lat[i];
    if (lat[i] > maxLat) maxLat = lat[i];
  }
  return { lon, lat, minLat, maxLat };
}

/**
 * Longitude intervals inside `polygon` along the parallel `lat`, sorted west
 * to east. Even-odd over every ring, so holes cut gaps out of the outer ring.
 */
export function scanlineIntervals(polygon: PolygonShape, lat: number): Interval[] {
  const xs: number[] = [];
  for (const ring of polygon.rings) {
    if (lat < ring.minLat || lat > ring.maxLat) continue;
    const n = ring.lon.length;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const yi = ring.lat[i];
      const yj = ring.lat[j];
      // Half-open rule: an edge counts when exactly one endpoint is strictly
      // above the parallel, so a vertex sitting on it is counted once, not
      // twice (or zero times).
      if (yi > lat === yj > lat) continue;
      const xi = ring.lon[i];
      const xj = ring.lon[j];
      xs.push(xi + ((lat - yi) * (xj - xi)) / (yj - yi));
    }
  }
  if (xs.length < 2) return [];
  xs.sort((a, b) => a - b);
  const out: Interval[] = [];
  for (let k = 0; k + 1 < xs.length; k += 2) out.push([xs[k], xs[k + 1]]);
  return out;
}

function widestMidpoint(polygon: PolygonShape, lat: number): LonLat | null {
  let best: Interval | null = null;
  for (const iv of scanlineIntervals(polygon, lat)) {
    if (!best || iv[1] - iv[0] > best[1] - best[0]) best = iv;
  }
  return best ? { lon: (best[0] + best[1]) / 2, lat } : null;
}

function polygonFromRings(ringCoords: number[][][]): PolygonShape | null {
  const rings = ringCoords.filter((r) => r.length >= 3).map(ringFromCoords);
  if (rings.length === 0) return null;
  const outer = rings[0];
  const minLat = outer.minLat;
  const maxLat = outer.maxLat;
  // Interior fallback: the widest stretch across the middle of the polygon,
  // or a bit above/below it for shapes pinched at the waist.
  const interior =
    widestMidpoint({ rings, minLat, maxLat, interior: { lon: 0, lat: 0 } }, (minLat + maxLat) / 2) ??
    widestMidpoint({ rings, minLat, maxLat, interior: { lon: 0, lat: 0 } }, minLat + (maxLat - minLat) * 0.25) ??
    widestMidpoint({ rings, minLat, maxLat, interior: { lon: 0, lat: 0 } }, minLat + (maxLat - minLat) * 0.75) ??
    { lon: outer.lon[0], lat: outer.lat[0] };
  return { rings, minLat, maxLat, interior };
}

export function buildZoneShape(geometry: GeoJSON.Geometry | null | undefined): ZoneShape | null {
  if (!geometry) return null;
  const polygonCoords: number[][][][] =
    geometry.type === 'Polygon'
      ? [geometry.coordinates as number[][][]]
      : geometry.type === 'MultiPolygon'
        ? (geometry.coordinates as number[][][][])
        : [];
  const polygons: PolygonShape[] = [];
  for (const rings of polygonCoords) {
    const p = polygonFromRings(rings);
    if (p) polygons.push(p);
  }
  if (polygons.length === 0) return null;

  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLon = Infinity;
  let maxLon = -Infinity;
  for (const p of polygons) {
    if (p.minLat < minLat) minLat = p.minLat;
    if (p.maxLat > maxLat) maxLat = p.maxLat;
    for (const r of p.rings) {
      for (let i = 0; i < r.lon.length; i++) {
        if (r.lon[i] < minLon) minLon = r.lon[i];
        if (r.lon[i] > maxLon) maxLon = r.lon[i];
      }
    }
  }
  const midLat = (minLat + maxLat) / 2;
  const nsMeters = (maxLat - minLat) * METERS_PER_DEG;
  const ewMeters = (maxLon - minLon) * METERS_PER_DEG * Math.cos((midLat * Math.PI) / 180);
  return { polygons, minLat, maxLat, minLon, maxLon, spanMeters: Math.max(nsMeters, ewMeters) };
}

// ── Placement ───────────────────────────────────────────────────────────────

/** Shortest east-west separation in degrees, going the short way round. */
export function wrappedLonDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

function distanceToInterval(lon: number, iv: Interval): number {
  if (lon >= iv[0] && lon <= iv[1]) return 0;
  return Math.min(wrappedLonDistance(lon, iv[0]), wrappedLonDistance(lon, iv[1]));
}

/**
 * Label anchor for `shape` given the camera's ground point. Latitude is the
 * camera's own when the feature spans it (kept a little inside the edges),
 * otherwise the feature's middle — so an Arctic sliver labels near the pole,
 * not along its southern edge, when the camera is over the mid-latitudes.
 * Longitude is the middle of the nearest stretch of the band on that
 * parallel, or (with `lonMargin`) the point of it nearest the camera.
 */
export interface PlaceOptions {
  /**
   * How far inside the chosen stretch (degrees of longitude) the label may
   * approach the camera's longitude. Omit for "always the middle of the
   * stretch"; pass a fraction of the visible width so a neighbouring band's
   * label slides to just inside its near edge when you zoom in on a border.
   */
  lonMargin?: number;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function lonWithin(viewLon: number, iv: Interval, margin: number | undefined): number {
  const half = (iv[1] - iv[0]) / 2;
  const m = margin === undefined ? half : Math.min(margin, half);
  // Bring the camera longitude to the interval's side of the antimeridian so
  // the clamp lands on the genuinely nearer edge.
  let v = viewLon;
  if (v - iv[0] > 180) v -= 360;
  else if (iv[0] - v > 180) v += 360;
  return clamp(v, iv[0] + m, iv[1] - m);
}

export function placeLabel(
  shape: ZoneShape,
  viewLon: number,
  viewLat: number,
  opts?: PlaceOptions
): LonLat {
  const inset = Math.min(0.25, (shape.maxLat - shape.minLat) * 0.1);
  const lat =
    viewLat >= shape.minLat + inset && viewLat <= shape.maxLat - inset
      ? viewLat
      : (shape.minLat + shape.maxLat) / 2;

  let best: Interval | null = null;
  let bestD = Infinity;
  let bestAny: Interval | null = null;
  let bestAnyD = Infinity;
  for (const polygon of shape.polygons) {
    if (lat < polygon.minLat || lat > polygon.maxLat) continue;
    for (const iv of scanlineIntervals(polygon, lat)) {
      const d = distanceToInterval(viewLon, iv);
      if (iv[1] - iv[0] >= MIN_INTERVAL_DEG) {
        if (d < bestD) { bestD = d; best = iv; }
      } else if (d < bestAnyD) {
        bestAnyD = d; bestAny = iv;
      }
    }
  }
  const chosen = best ?? bestAny;
  if (chosen) return { lon: lonWithin(viewLon, chosen, opts?.lonMargin), lat };

  // Nothing on that parallel (a MultiPolygon whose parts sit at other
  // latitudes): fall back to the interior point nearest the camera.
  let nearest = shape.polygons[0].interior;
  let nearestD = Infinity;
  for (const polygon of shape.polygons) {
    const p = polygon.interior;
    const d = wrappedLonDistance(viewLon, p.lon) ** 2 + (viewLat - p.lat) ** 2;
    if (d < nearestD) { nearestD = d; nearest = p; }
  }
  return nearest;
}
