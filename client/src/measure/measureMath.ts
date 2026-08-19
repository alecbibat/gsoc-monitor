import * as Cesium from 'cesium';
import type { LngLat } from './measureStore';

// Mean Earth radius (IUGG) for the spherical-excess area approximation.
const EARTH_RADIUS_M = 6_371_008.8;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

// Geodesic length of a polyline along the ellipsoid surface, in metres.
export function totalDistanceM(pts: LngLat[]): number {
  let sum = 0;
  for (let i = 1; i < pts.length; i++) {
    const g = new Cesium.EllipsoidGeodesic(
      Cesium.Cartographic.fromDegrees(pts[i - 1].lon, pts[i - 1].lat),
      Cesium.Cartographic.fromDegrees(pts[i].lon, pts[i].lat)
    );
    sum += g.surfaceDistance;
  }
  return sum;
}

// Spherical-excess area of a closed polygon, in square metres. Good to a few
// tenths of a percent at country scale — plenty for a measure tool.
export function polygonAreaM2(pts: LngLat[]): number {
  if (pts.length < 3) return 0;
  let total = 0;
  for (let i = 0; i < pts.length; i++) {
    const p1 = pts[i];
    const p2 = pts[(i + 1) % pts.length];
    total +=
      toRad(p2.lon - p1.lon) * (2 + Math.sin(toRad(p1.lat)) + Math.sin(toRad(p2.lat)));
  }
  return Math.abs((total * EARTH_RADIUS_M * EARTH_RADIUS_M) / 2);
}

// Perimeter of the closed polygon (includes the closing edge).
export function perimeterM(pts: LngLat[]): number {
  if (pts.length < 2) return 0;
  return totalDistanceM([...pts, pts[0]]);
}

// Point reached by travelling `distM` from (lat, lon) along a great circle on
// the given initial bearing. Spherical — well inside the tool's accuracy.
function destination(lat: number, lon: number, bearingDeg: number, distM: number): LngLat {
  const d = distM / EARTH_RADIUS_M;
  const br = toRad(bearingDeg);
  const φ1 = toRad(lat);
  const λ1 = toRad(lon);
  const sinφ2 = Math.sin(φ1) * Math.cos(d) + Math.cos(φ1) * Math.sin(d) * Math.cos(br);
  const φ2 = Math.asin(Math.min(1, Math.max(-1, sinφ2)));
  const λ2 =
    λ1 +
    Math.atan2(
      Math.sin(br) * Math.sin(d) * Math.cos(φ1),
      Math.cos(d) - Math.sin(φ1) * sinφ2
    );
  return {
    lat: (φ2 * 180) / Math.PI,
    // Normalize into [-180, 180] so a circle spanning the antimeridian still
    // renders as one ring instead of wrapping the globe.
    lon: (((λ2 * 180) / Math.PI + 540) % 360) - 180,
  };
}

/**
 * The rim of a circle of `radius` metres around a centre, as a closed ring of
 * lon/lat points. Drawn as an explicit ring (rather than Cesium's ellipse
 * outline) so the rim keeps the same crisp 2.5 px stroke as the other measure
 * shapes on every platform.
 *
 * Each point starts as a spherical projection and is then corrected against
 * the ellipsoid: the sphere is up to ~0.5% out depending on latitude and
 * bearing, which at 50 km is a couple of hundred metres of daylight between
 * the circle you see and the radius the readout claims. One rescale per
 * bearing closes that to under a metre.
 */
export function circleRing(center: LngLat, radius: number, segments = 128): LngLat[] {
  if (!(radius > 0)) return [];
  const ring: LngLat[] = [];
  for (let i = 0; i <= segments; i++) {
    const bearing = (360 * i) / segments;
    const guess = destination(center.lat, center.lon, bearing, radius);
    const actual = radiusM(center, guess);
    ring.push(
      actual > 0
        ? destination(center.lat, center.lon, bearing, radius * (radius / actual))
        : guess
    );
  }
  return ring;
}

/** Great-circle distance between two points, in metres. */
export function radiusM(center: LngLat, rim: LngLat): number {
  return totalDistanceM([center, rim]);
}

/** Area enclosed by a circle of the given radius, in square metres. */
export function circleAreaM2(radius: number): number {
  return Math.PI * radius * radius;
}

/** Circumference of a circle of the given radius, in metres. */
export function circleCircumferenceM(radius: number): number {
  return 2 * Math.PI * radius;
}

/**
 * Initial great-circle bearing from one point to another, in degrees from true
 * north. What an evacuation arrow or an ingress route is actually pointing at.
 */
export function initialBearing(from: LngLat, to: LngLat): number {
  const φ1 = toRad(from.lat);
  const φ2 = toRad(to.lat);
  const Δλ = toRad(to.lon - from.lon);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (((Math.atan2(y, x) * 180) / Math.PI) + 360) % 360;
}

const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
                 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

/** "072° ENE" — the number for plotting, the point for saying out loud. */
export function formatBearing(deg: number): string {
  const d = ((deg % 360) + 360) % 360;
  return `${Math.round(d).toString().padStart(3, '0')}° ${COMPASS[Math.round(d / 22.5) % 16]}`;
}

/** "20.8911°N 156.4700°W" — a position anyone can read back over a radio. */
export function formatLatLon(lat: number, lon: number): string {
  return `${Math.abs(lat).toFixed(4)}°${lat >= 0 ? 'N' : 'S'} ${Math.abs(lon).toFixed(4)}°${lon >= 0 ? 'E' : 'W'}`;
}

const round0 = (n: number): string => n.toLocaleString('en-US', { maximumFractionDigits: 0 });

// "1.23 km" / "840 m", with the imperial equivalent appended.
export function formatDistance(m: number): string {
  const mi = m / 1609.344;
  if (m < 1000) {
    const ft = m * 3.28084;
    return `${m.toFixed(0)} m · ${ft.toFixed(0)} ft`;
  }
  // Thousands separators once the numbers get long: "4,911 km" is readable at
  // a glance where "4911.17" is a digit-counting exercise.
  if (m >= 1_000_000) return `${round0(m / 1000)} km · ${round0(mi)} mi`;
  return `${(m / 1000).toFixed(2)} km · ${mi.toFixed(2)} mi`;
}

// Same distance in nautical miles — the unit every conversation about a ship's
// position happens in. Shown alongside, not instead: the shore-side reader
// wants km.
export function formatNauticalMiles(m: number): string {
  const nm = m / 1852;
  return nm < 10 ? `${nm.toFixed(2)} nm` : `${nm.toFixed(1)} nm`;
}

// "12.3 km²" / "4,200 m²", with acres or square miles appended.
export function formatArea(m2: number): string {
  if (m2 < 10_000) {
    const sqft = m2 * 10.7639;
    return `${m2.toFixed(0)} m² · ${sqft.toFixed(0)} ft²`;
  }
  const km2 = m2 / 1_000_000;
  const acres = m2 / 4046.8564224;
  if (km2 < 1) {
    return `${(m2 / 10_000).toFixed(2)} ha · ${acres.toFixed(1)} ac`;
  }
  const sqmi = m2 / 2_589_988.11;
  if (km2 >= 1000) return `${round0(km2)} km² · ${round0(sqmi)} mi²`;
  return `${km2.toFixed(2)} km² · ${sqmi.toFixed(2)} mi²`;
}
