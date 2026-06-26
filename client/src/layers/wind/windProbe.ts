import * as Cesium from 'cesium';
import type { WindGrid } from '../../types';

// Shared wind-field math: the bilinear grid sampler, plus the conversions used
// to read a single point (right-click probe / hover readout) — direction, speed,
// a compass label, and the world-space axis that orients the on-globe arrow.

const MPS_TO_MPH = 2.236936;

// Bilinear sampler over the grid. Longitude wraps (column nx → column 0);
// returns false outside the covered latitude band. `out` is filled with the
// eastward/northward wind components (m/s).
export function makeSampler(grid: WindGrid) {
  const { nx, ny, lon0, lat0, dLon, dLat, u, v } = grid;
  return (lon: number, lat: number, out: [number, number]): boolean => {
    let x = (lon - lon0) / dLon;
    x = ((x % nx) + nx) % nx;
    const y = (lat - lat0) / dLat;
    if (y < 0 || y > ny - 1) return false;
    const x0 = Math.floor(x);
    const x1 = (x0 + 1) % nx;
    const y0 = Math.floor(y);
    const y1 = Math.min(y0 + 1, ny - 1);
    const fx = x - x0;
    const fy = y - y0;
    const i00 = y0 * nx + x0;
    const i10 = y0 * nx + x1;
    const i01 = y1 * nx + x0;
    const i11 = y1 * nx + x1;
    const u0 = u[i00] + (u[i10] - u[i00]) * fx;
    const u1 = u[i01] + (u[i11] - u[i01]) * fx;
    const v0 = v[i00] + (v[i10] - v[i00]) * fx;
    const v1 = v[i01] + (v[i11] - v[i01]) * fx;
    out[0] = u0 + (u1 - u0) * fy;
    out[1] = v0 + (v1 - v0) * fy;
    return true;
  };
}

export interface WindReading {
  lon: number;
  lat: number;
  speedMps: number;
  speedMph: number;
  // Meteorological "from" bearing (0°=N, 90°=E) — the direction the wind blows FROM.
  fromDeg: number;
  // Bearing the wind blows TOWARD (fromDeg + 180). The on-globe arrow points this way.
  toDeg: number;
  // 16-point compass label for the "from" direction, e.g. "WSW".
  cardinal: string;
}

const DIRS = [
  'N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
  'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW',
];

export function cardinal16(deg: number): string {
  return DIRS[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16];
}

// Turn eastward/northward components into a readable reading. The velocity points
// toward atan2(eastward, northward) clockwise from north — that's the "toward"
// bearing directly; the meteorological "from" is 180° opposite.
export function computeReading(lon: number, lat: number, u: number, v: number): WindReading {
  const speedMps = Math.hypot(u, v);
  const toDeg = ((Math.atan2(u, v) * 180) / Math.PI + 360) % 360;
  const fromDeg = (toDeg + 180) % 360;
  return {
    lon,
    lat,
    speedMps,
    speedMph: speedMps * MPS_TO_MPH,
    fromDeg,
    toDeg,
    cardinal: cardinal16(fromDeg),
  };
}

// --- On-globe arrow orientation --------------------------------------------
// A billboard's `alignedAxis` is a world-space vector that the image's "up" edge
// points toward (projected to screen). Feeding it the surface-tangent flow
// direction makes the (north-up) arrow image point the true way the wind blows —
// correct under any camera heading/tilt, unlike a flat screen-space rotation.

const sOrigin = new Cesium.Cartesian3();
const sFrame = new Cesium.Matrix4();
const sRot = new Cesium.Matrix3();
const sEnu = new Cesium.Cartesian3();

export function flowAxis(
  lon: number,
  lat: number,
  toDeg: number,
  result: Cesium.Cartesian3 = new Cesium.Cartesian3()
): Cesium.Cartesian3 {
  const origin = Cesium.Cartesian3.fromDegrees(lon, lat, 0, undefined, sOrigin);
  const frame = Cesium.Transforms.eastNorthUpToFixedFrame(origin, undefined, sFrame);
  const rot = Cesium.Matrix4.getMatrix3(frame, sRot);
  const beta = (toDeg * Math.PI) / 180;
  // ENU components of a unit vector at bearing `beta` clockwise from north.
  const enu = Cesium.Cartesian3.fromElements(Math.sin(beta), Math.cos(beta), 0, sEnu);
  const world = Cesium.Matrix3.multiplyByVector(rot, enu, result);
  return Cesium.Cartesian3.normalize(world, result);
}

// --- Speed → color ----------------------------------------------------------
// Same palette as the particle field, exposed as hex for the HUD compass.

const RAMP: Array<[number, [number, number, number]]> = [
  [0, [0x3b, 0x4c, 0xc0]],
  [4, [0x2a, 0x9d, 0x8f]],
  [8, [0x2b, 0xb6, 0x73]],
  [12, [0xa7, 0xc9, 0x57]],
  [16, [0xf4, 0xd3, 0x5e]],
  [22, [0xee, 0x96, 0x4b]],
  [30, [0xe6, 0x39, 0x46]],
  [45, [0xd6, 0x33, 0x6c]],
];

function hex2(n: number): string {
  return Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0');
}

export function speedColorHex(mps: number): string {
  if (mps <= RAMP[0][0]) {
    const [r, g, b] = RAMP[0][1];
    return `#${hex2(r)}${hex2(g)}${hex2(b)}`;
  }
  const last = RAMP[RAMP.length - 1];
  if (mps >= last[0]) {
    const [r, g, b] = last[1];
    return `#${hex2(r)}${hex2(g)}${hex2(b)}`;
  }
  for (let i = 1; i < RAMP.length; i++) {
    if (mps < RAMP[i][0]) {
      const [s0, c0] = RAMP[i - 1];
      const [s1, c1] = RAMP[i];
      const t = (mps - s0) / (s1 - s0);
      const r = c0[0] + (c1[0] - c0[0]) * t;
      const g = c0[1] + (c1[1] - c0[1]) * t;
      const b = c0[2] + (c1[2] - c0[2]) * t;
      return `#${hex2(r)}${hex2(g)}${hex2(b)}`;
    }
  }
  const [r, g, b] = last[1];
  return `#${hex2(r)}${hex2(g)}${hex2(b)}`;
}

// --- On-globe arrow image ---------------------------------------------------
// A north-pointing arrow (tip up), white fill with a dark outline so it reads on
// any basemap. Orientation comes entirely from the billboard's alignedAxis.

const ARROW_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="44" height="44" viewBox="0 0 44 44">' +
  '<path d="M22 3 L34 25 L26 25 L26 41 L18 41 L18 25 L10 25 Z" ' +
  'fill="#f2fbff" stroke="#0a1722" stroke-width="2.6" stroke-linejoin="round"/>' +
  '</svg>';

export const ARROW_DATA_URI = `data:image/svg+xml,${encodeURIComponent(ARROW_SVG)}`;
