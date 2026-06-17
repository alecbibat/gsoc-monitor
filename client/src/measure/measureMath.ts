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

// "1.23 km" / "840 m", with the imperial equivalent appended.
export function formatDistance(m: number): string {
  const mi = m / 1609.344;
  if (m < 1000) {
    const ft = m * 3.28084;
    return `${m.toFixed(0)} m · ${ft.toFixed(0)} ft`;
  }
  return `${(m / 1000).toFixed(2)} km · ${mi.toFixed(2)} mi`;
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
  return `${km2.toFixed(2)} km² · ${sqmi.toFixed(2)} mi²`;
}
