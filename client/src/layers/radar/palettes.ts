// Client-side precipitation palettes, applied to RainViewer's raw dBZ tiles
// (color scheme 0: value = (dBZ + 32) & 127, bit 7 = snow). Painting the
// gradient ourselves — instead of using RainViewer's baked-in schemes — buys
// the zoom.earth look: a perceptually smooth ramp where light rain is a soft
// translucent blue wash and convective cores burn through magenta → red →
// orange → white-hot yellow, with per-pixel alpha so heavy cells read solid
// while drizzle stays airy.

export type RadarPaletteId = 'storm' | 'classic' | 'blue' | 'mono';

// [dBZ, r, g, b, alpha 0–1] — linearly interpolated between stops.
type Stop = [number, number, number, number, number];

const RAIN_STOPS: Record<RadarPaletteId, Stop[]> = {
  // zoom.earth-class default: blue → violet → magenta → red → orange →
  // white-hot yellow.
  storm: [
    [2, 120, 175, 255, 0.0],
    [8, 100, 152, 250, 0.42],
    [16, 68, 122, 245, 0.62],
    [24, 46, 88, 232, 0.74],
    [30, 102, 58, 220, 0.82],
    [35, 190, 48, 178, 0.88],
    [40, 232, 48, 96, 0.92],
    [45, 244, 96, 44, 0.94],
    [50, 252, 158, 44, 0.96],
    [55, 255, 214, 72, 0.98],
    [62, 255, 245, 190, 0.99],
    [70, 255, 255, 255, 1.0],
  ],
  // Familiar meteorology greens → yellow → red, but with a translucent light
  // end instead of RainViewer's flat opaque steps.
  classic: [
    [4, 90, 200, 90, 0.0],
    [10, 70, 195, 80, 0.35],
    [20, 34, 155, 44, 0.6],
    [30, 20, 115, 32, 0.72],
    [35, 250, 210, 45, 0.82],
    [40, 255, 150, 35, 0.88],
    [45, 250, 62, 42, 0.93],
    [55, 205, 22, 92, 0.97],
    [65, 255, 165, 255, 1.0],
  ],
  // Single-hue blue for subdued ops displays.
  blue: [
    [3, 150, 195, 255, 0.0],
    [10, 130, 180, 255, 0.3],
    [22, 82, 140, 250, 0.55],
    [35, 45, 95, 235, 0.8],
    [48, 35, 70, 220, 0.92],
    [62, 230, 240, 255, 1.0],
  ],
  // Grayscale for maximum overlay neutrality.
  mono: [
    [4, 255, 255, 255, 0.0],
    [12, 255, 255, 255, 0.18],
    [30, 255, 255, 255, 0.5],
    [50, 255, 255, 255, 0.85],
    [65, 255, 255, 255, 1.0],
  ],
};

// Snow reads as an icy blue-white ramp regardless of palette, like zoom.earth
// renders winter precipitation.
const SNOW_STOPS: Stop[] = [
  [1, 205, 235, 255, 0.0],
  [6, 190, 225, 255, 0.35],
  [14, 160, 205, 255, 0.6],
  [24, 165, 175, 255, 0.78],
  [34, 205, 195, 255, 0.9],
  [46, 240, 238, 255, 1.0],
];

function sampleStops(stops: Stop[], dbz: number): [number, number, number, number] {
  if (dbz <= stops[0][0]) {
    const [, r, g, b, a] = stops[0];
    return [r, g, b, a];
  }
  for (let i = 0; i < stops.length - 1; i++) {
    const s0 = stops[i];
    const s1 = stops[i + 1];
    if (dbz <= s1[0]) {
      const t = (dbz - s0[0]) / (s1[0] - s0[0]);
      return [
        s0[1] + (s1[1] - s0[1]) * t,
        s0[2] + (s1[2] - s0[2]) * t,
        s0[3] + (s1[3] - s0[3]) * t,
        s0[4] + (s1[4] - s0[4]) * t,
      ];
    }
  }
  const last = stops[stops.length - 1];
  return [last[1], last[2], last[3], last[4]];
}

export interface RadarLut {
  // 128 RGBA entries indexed by the raw magnitude byte (dBZ + 32, 0–127).
  rain: Uint8ClampedArray;
  snow: Uint8ClampedArray;
}

// Echo below this dBZ stays invisible (sensor noise / clear-air returns).
const MIN_VISIBLE_DBZ = 1;

function buildLut(stops: Stop[]): Uint8ClampedArray {
  const lut = new Uint8ClampedArray(128 * 4);
  for (let m = 0; m < 128; m++) {
    const dbz = m - 32;
    if (dbz < MIN_VISIBLE_DBZ) continue; // transparent
    const [r, g, b, a] = sampleStops(stops, dbz);
    lut[m * 4] = r;
    lut[m * 4 + 1] = g;
    lut[m * 4 + 2] = b;
    lut[m * 4 + 3] = a * 255;
  }
  return lut;
}

const lutCache = new Map<RadarPaletteId, RadarLut>();
export function getRadarLut(palette: RadarPaletteId): RadarLut {
  let lut = lutCache.get(palette);
  if (!lut) {
    lut = { rain: buildLut(RAIN_STOPS[palette]), snow: buildLut(SNOW_STOPS) };
    lutCache.set(palette, lut);
  }
  return lut;
}

// Infrared satellite → cloud overlay: luminance (cold, high tops are bright in
// RainViewer's IR tiles) keys both the whiteness and the opacity, so clear sky
// vanishes instead of painting the globe gray, and storm anvils glow white.
export function getCloudLut(): Uint8ClampedArray {
  let lut = cloudLutCache;
  if (!lut) {
    lut = new Uint8ClampedArray(256 * 4);
    for (let v = 0; v < 256; v++) {
      const t = smoothstep(100, 220, v);
      // Cool gray-blue thin cloud → bright white anvil tops. Thin cloud fades
      // fast (t²) so the overlay reads as weather, not haze.
      lut[v * 4] = 175 + 80 * t;
      lut[v * 4 + 1] = 184 + 71 * t;
      lut[v * 4 + 2] = 200 + 55 * t;
      lut[v * 4 + 3] = Math.pow(t, 1.6) * 215;
    }
    cloudLutCache = lut;
  }
  return lut;
}
let cloudLutCache: Uint8ClampedArray | null = null;

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}
