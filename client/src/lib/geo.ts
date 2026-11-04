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

const M_PER_DEG = (Math.PI / 180) * EARTH_RADIUS_M;

/**
 * Shortest distance in metres from a point to the edges of the rings (each an
 * array of [lon, lat]; closed or not). Planar in a local equirectangular frame
 * centred on the point — well under 1% off at the tens-of-miles scale this is
 * used for, and longitude differences wrap so the antimeridian is no seam.
 * Inside-ness is not considered: pair it with pointInRings for "0 if inside".
 */
export function distanceToRingsMeters(lon: number, lat: number, rings: number[][][]): number {
  const kx = Math.cos((lat * Math.PI) / 180) * M_PER_DEG;
  const x = (p: number[]) => ((((p[0] - lon + 540) % 360) + 360) % 360 - 180) * kx;
  const y = (p: number[]) => (p[1] - lat) * M_PER_DEG;
  let best = Infinity;
  for (const ring of rings) {
    const n = ring.length;
    for (let i = 0; i < n; i++) {
      // Edge i → i+1, closing back to the start for an unclosed ring.
      const a = ring[i];
      const b = ring[(i + 1) % n];
      const ax = x(a), ay = y(a), bx = x(b), by = y(b);
      const dx = bx - ax, dy = by - ay;
      const len2 = dx * dx + dy * dy;
      const t = len2 > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
      const d = Math.hypot(ax + t * dx, ay + t * dy);
      if (d < best) best = d;
    }
  }
  return best;
}

/**
 * A circle on the globe as a closed ring of [lon, lat] points: `steps` points
 * at `radiusM` from the centre along every bearing (spherical destination
 * formula), the first repeated at the end.
 */
export function circleRing(lon: number, lat: number, radiusM: number, steps = 64): number[][] {
  const toRad = Math.PI / 180;
  const d = radiusM / EARTH_RADIUS_M;
  const lat1 = lat * toRad;
  const lon1 = lon * toRad;
  const ring: number[][] = [];
  for (let i = 0; i < steps; i++) {
    const brng = (i / steps) * 2 * Math.PI;
    const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(brng));
    const lon2 = lon1 + Math.atan2(
      Math.sin(brng) * Math.sin(d) * Math.cos(lat1),
      Math.cos(d) - Math.sin(lat1) * Math.sin(lat2)
    );
    ring.push([((((lon2 / toRad) + 540) % 360) - 180), lat2 / toRad]);
  }
  ring.push(ring[0]);
  return ring;
}
