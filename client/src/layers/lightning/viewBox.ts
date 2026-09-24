// The box the layer asks /field for. It is snapped to a coarse grid on purpose:
//   - a small pan or zoom keeps the same box, so the 30 s poll carries on
//     instead of refetching on every camera move;
//   - equivalent views across clients share one server memo key;
//   - the box is a little larger than the view, so a short pan still has marks.
// Two cases:
//   - Zoomed in (both spans ≤ 150°): snap outward to a unit about a quarter of
//     the larger span, from a fixed ladder so the key only changes when the
//     zoom level really does.
//   - Zoomed out (whole-globe view, where Cesium's view rectangle is either
//     undefined or MAX_VALUE and says nothing useful): a hemisphere-sized box
//     around the camera's sub-point, snapped to 15°. Its latitude band is ±75°;
//     one reaching a pole takes every longitude, otherwise ±105° of longitude
//     around the sub-point (wrapping across the antimeridian when needed).
// Boxes use the server's convention: [w, s, e, n] in degrees, w > e when the
// box crosses the antimeridian.

export type Bbox = [number, number, number, number];

export interface ViewBox {
  bbox: Bbox;
  /** "w,s,e,n" — refetch only when this changes. */
  key: string;
}

/** A view rectangle in degrees (Cesium's is radians); west > east across the antimeridian. */
export interface DegRect {
  west: number;
  south: number;
  east: number;
  north: number;
}

export const HEMISPHERE_SPAN_DEG = 150;
export const SNAP_UNITS_DEG: readonly number[] = [0.5, 1, 2, 5, 10, 15, 30];
const HEMI_SNAP_DEG = 15;
const HEMI_HALF_LAT = 75;
const HEMI_HALF_LON = 105;

// Every unit divides 90 and 180, so snapped edges never overshoot ±90 / ±180;
// the clamps are only a guard against bad input.
const clampLat = (v: number) => Math.max(-90, Math.min(90, v));
const clampLon = (v: number) => Math.max(-180, Math.min(180, v));
// West edges in [-180, 180), east edges in (-180, 180], so a box ending at the
// antimeridian reads "…,180" rather than a spurious crossing "…,-180".
const wrapWest = (v: number) => ((((v + 180) % 360) + 360) % 360) - 180;
const wrapEast = (v: number) => -wrapWest(-v);
// Normalizes -0 so equal boxes always print the same key.
const n0 = (v: number) => (Object.is(v, -0) ? 0 : v);

function make(w: number, s: number, e: number, n: number): ViewBox {
  const bbox: Bbox = [n0(w), n0(s), n0(e), n0(n)];
  return { bbox, key: bbox.join(',') };
}

/** Longitudinal span of a rectangle, honouring an antimeridian crossing. */
export function lonSpan(west: number, east: number): number {
  return west <= east ? east - west : east + 360 - west;
}

/** The whole-globe box around the camera's sub-point (degrees). */
export function hemisphereBox(sub: { lat: number; lon: number }): ViewBox {
  const lat = Math.round(clampLat(sub.lat) / HEMI_SNAP_DEG) * HEMI_SNAP_DEG;
  const lon = Math.round(clampLon(sub.lon) / HEMI_SNAP_DEG) * HEMI_SNAP_DEG;
  const s = Math.max(-90, lat - HEMI_HALF_LAT);
  const n = Math.min(90, lat + HEMI_HALF_LAT);
  if (s <= -90 || n >= 90) return make(-180, s, 180, n);
  return make(wrapWest(lon - HEMI_HALF_LON), s, wrapEast(lon + HEMI_HALF_LON), n);
}

/**
 * The canonical /field box for a view rectangle (degrees; null when Cesium
 * can't compute one) and the camera's sub-point.
 */
export function viewBoxFor(
  rect: DegRect | null | undefined,
  sub: { lat: number; lon: number }
): ViewBox {
  if (!rect || ![rect.west, rect.south, rect.east, rect.north].every(Number.isFinite)) {
    return hemisphereBox(sub);
  }
  const latSpan = rect.north - rect.south;
  const lonSpanDeg = lonSpan(rect.west, rect.east);
  if (latSpan > HEMISPHERE_SPAN_DEG || lonSpanDeg > HEMISPHERE_SPAN_DEG) return hemisphereBox(sub);

  const want = Math.max(latSpan, lonSpanDeg) / 4;
  const unit = SNAP_UNITS_DEG.find((u) => u >= want) ?? SNAP_UNITS_DEG[SNAP_UNITS_DEG.length - 1];
  const down = (v: number) => Math.floor(v / unit) * unit;
  const up = (v: number) => Math.ceil(v / unit) * unit;

  let s = clampLat(down(rect.south));
  let n = clampLat(up(rect.north));
  if (n <= s) {
    // A zero-height view on a grid line — the server wants s < n.
    if (n < 90) n = s + unit;
    else s = n - unit;
  }
  let w = clampLon(down(rect.west));
  let e = clampLon(up(rect.east));
  if (rect.west > rect.east) {
    // Crossing the antimeridian: w > e is kept as is. An edge that snapped onto
    // the antimeridian itself (w = 180 or e = -180) means the box doesn't
    // really cross; restate it as the ordinary box it is.
    if (w >= 180) w = -180;
    if (e <= -180) e = 180;
  } else if (e <= w) {
    if (e < 180) e = w + unit;
    else w = e - unit;
  }
  return make(w, s, e, n);
}
