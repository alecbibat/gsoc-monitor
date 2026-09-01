// Unified precipitation palette for the rebuilt radar layer.
//
// Both tile sources (IEM NEXRAD and RainViewer) arrive pre-colored in their
// own house ramps; recolor.ts inverts each back to dBZ and repaints through
// the single "storm" ramp below, so US HD and global frames read as one
// continuous product — the zoom.earth composition: light rain as an airy
// translucent blue wash, convective cores burning through magenta → red →
// orange → white-hot yellow, with per-pixel alpha so heavy cells sit solid
// while drizzle stays see-through.

export type RadarStyle = 'storm' | 'agency';

// [dBZ, r, g, b, alpha 0–1] — linearly interpolated between stops.
type Stop = [number, number, number, number, number];

const STORM_STOPS: Stop[] = [
  [2, 120, 175, 255, 0.0],
  [8, 100, 152, 250, 0.42],
  [16, 68, 122, 245, 0.62],
  [24, 52, 96, 238, 0.74],
  [30, 122, 88, 240, 0.8],
  [35, 205, 72, 195, 0.86],
  [40, 242, 64, 120, 0.9],
  [45, 248, 100, 52, 0.93],
  [50, 252, 160, 46, 0.96],
  [55, 255, 215, 75, 0.98],
  [62, 255, 246, 195, 0.99],
  [70, 255, 255, 255, 1.0],
];

// Echo below this dBZ stays invisible: ground clutter and clear-air returns
// dominate the bottom of the scale (IEM renders all the way down to −32 dBZ).
const MIN_VISIBLE_DBZ = 4;

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

// 256 RGBA entries indexed by the pipeline's magnitude byte m = 2·(dBZ + 32),
// i.e. 0.5 dBZ steps from −32 to +95.5 — the same quantization as IEM's N0Q
// product, so the HD source recolors losslessly.
let stormLut: Uint8ClampedArray | null = null;
export function getStormLut(): Uint8ClampedArray {
  if (stormLut) return stormLut;
  const lut = new Uint8ClampedArray(256 * 4);
  for (let m = 0; m < 256; m++) {
    const dbz = m / 2 - 32;
    if (dbz < MIN_VISIBLE_DBZ) continue; // transparent
    const [r, g, b, a] = sampleStops(STORM_STOPS, dbz);
    lut[m * 4] = r;
    lut[m * 4 + 1] = g;
    lut[m * 4 + 2] = b;
    lut[m * 4 + 3] = a * 255;
  }
  stormLut = lut;
  return lut;
}

// Legend gradient for the HUD legend / share page: CSS stops sampled off the
// same ramp so the legend can never drift from the imagery.
export function stormLegendGradient(): string {
  const stops: string[] = [];
  for (let dbz = 8; dbz <= 70; dbz += 4) {
    const [r, g, b] = sampleStops(STORM_STOPS, dbz);
    const pct = (((dbz - 8) / (70 - 8)) * 100).toFixed(0);
    stops.push(`rgb(${r | 0},${g | 0},${b | 0}) ${pct}%`);
  }
  return `linear-gradient(90deg, ${stops.join(', ')})`;
}
