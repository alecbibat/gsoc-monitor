// Pure geographic helpers shared by the hazard layers and the proximity widget.
// No Cesium dependency so they're usable from plain data modules and widgets.

export const MILES_TO_M = 1_609.344;

export function metersToMiles(m: number): number {
  return m / MILES_TO_M;
}

const EARTH_RADIUS_M = 6_371_000;

/** Great-circle distance in metres between two lat/lon points. */
export function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
}

/**
 * Ray-casting point-in-polygon test. `ring` is an array of [lon, lat] pairs
 * (GeoJSON order). Returns true when the point lies inside the ring.
 */
export function pointInRing(lon: number, lat: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersect = yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/** True when the point falls inside any of the rings. */
export function pointInRings(lon: number, lat: number, rings: number[][][]): boolean {
  return rings.some((ring) => pointInRing(lon, lat, ring));
}
