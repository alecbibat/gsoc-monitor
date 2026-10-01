// GOES-R ABI fixed-grid geometry, used to draw an NGFS detection as the
// ground footprint of the satellite pixel it came from rather than as a dot.
// An NGFS detection means "anomalous heat somewhere inside this ~2 km pixel",
// and the pixel grows and skews with distance from the sub-satellite point
// (≈ 3 × 5 km over California as seen from GOES-East). Drawing the footprint
// keeps the map honest about how coarse the location is.
//
// Formulas: GOES-R Product User's Guide (PUG) Vol. 3, §5.1.2.8 — the
// geostationary projection on the GRS80 ellipsoid with scan angles x (E/W)
// and y (N/S) in radians. Pure maths, no Cesium, so it is unit-testable.

const R_EQ = 6_378_137; // m, GRS80 semi-major axis
const R_POL = 6_356_752.31414; // m, GRS80 semi-minor axis
const H = 42_164_160; // m, from the Earth's centre (35 786 023 m perspective height + R_EQ)
const E = 0.0818191910435; // first eccentricity
const EQ2_POL2 = (R_EQ * R_EQ) / (R_POL * R_POL);

/**
 * Longitude of the projection origin for each operational slot, as carried in
 * the ABI products' `goes_imager_projection` metadata. It is the slot's
 * nominal longitude, not the spacecraft's exact station (GOES-19 sits at
 * 75.2°W): NGFS detection points land on the 2 km grid of these origins.
 */
export const SLOT_LON0: Record<'east' | 'west', number> = { east: -75, west: -137 };

/** 2 km IR pixel pitch of the ABI fixed grid (band 7, which NGFS uses), in radians. */
export const IR_PIXEL_RAD = 56e-6;

const DEG = Math.PI / 180;

/** Scan angles (radians) of a lat/lon as seen from the slot, or null when it is off the visible disk. */
export function latLonToScan(lat: number, lon: number, lon0: number): { x: number; y: number } | null {
  const phi = lat * DEG;
  const dLam = (lon - lon0) * DEG;
  const phiC = Math.atan((1 / EQ2_POL2) * Math.tan(phi)); // geocentric latitude
  const cosC = Math.cos(phiC);
  const rc = R_POL / Math.sqrt(1 - E * E * cosC * cosC);
  const sx = H - rc * cosC * Math.cos(dLam);
  const sy = -rc * cosC * Math.sin(dLam);
  const sz = rc * Math.sin(phiC);
  // The point is behind the limb when the line of sight passes through the Earth first.
  if (H * (H - sx) < sy * sy + EQ2_POL2 * sz * sz) return null;
  return {
    x: Math.asin(-sy / Math.sqrt(sx * sx + sy * sy + sz * sz)),
    y: Math.atan(sz / sx),
  };
}

/** Ground point (degrees) under a pair of scan angles, or null when the line of sight misses the Earth. */
export function scanToLatLon(x: number, y: number, lon0: number): { lat: number; lon: number } | null {
  const sinX = Math.sin(x);
  const cosX = Math.cos(x);
  const sinY = Math.sin(y);
  const cosY = Math.cos(y);
  const a = sinX * sinX + cosX * cosX * (cosY * cosY + EQ2_POL2 * sinY * sinY);
  const b = -2 * H * cosX * cosY;
  const c = H * H - R_EQ * R_EQ;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const rs = (-b - Math.sqrt(disc)) / (2 * a);
  const sx = rs * cosX * cosY;
  const sy = -rs * sinX;
  const sz = rs * cosX * sinY;
  return {
    lat: Math.atan(EQ2_POL2 * (sz / Math.sqrt((H - sx) * (H - sx) + sy * sy))) / DEG,
    lon: lon0 - Math.atan(sy / (H - sx)) / DEG,
  };
}

/**
 * The four ground corners ([lon, lat], counter-clockwise from the north-west
 * corner) of the ABI pixel centred on a detection, or null when the point is
 * not on the slot's disk. Centred on the reported point rather than snapped to
 * the grid: NGFS terrain-corrects some detections off the grid centre, and
 * the footprint should stay around the location it reports.
 */
export function pixelFootprint(
  lat: number,
  lon: number,
  lon0: number,
  pixelRad: number = IR_PIXEL_RAD
): Array<[number, number]> | null {
  const s = latLonToScan(lat, lon, lon0);
  if (!s) return null;
  const h = pixelRad / 2;
  // y grows northward and x eastward, so (−x, +y) is the north-west corner.
  const corners: Array<[number, number]> = [];
  for (const [dx, dy] of [
    [-h, h],
    [-h, -h],
    [h, -h],
    [h, h],
  ]) {
    const p = scanToLatLon(s.x + dx, s.y + dy, lon0);
    if (!p) return null;
    corners.push([p.lon, p.lat]);
  }
  return corners;
}
