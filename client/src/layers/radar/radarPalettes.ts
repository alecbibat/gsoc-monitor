import { UB_MIN_DBZ, UB_MAX_DBZ, UB_RAIN_RGBA, UB_SNOW_RGBA } from './rainviewerTable';

// Radar colour palettes. Tiles are decoded back to reflectivity (dBZ) and
// painted here, so the layer isn't stuck with RainViewer's served colours:
// on our dark basemaps its blues get darker as rain gets heavier and most of
// the echo area is a translucent tan clutter band. These ramps keep brightness
// rising with intensity, fade light echo in with alpha instead of a hard edge,
// and drop the weakest returns (below 8 dBZ in Classic, 6 in Vivid; snow
// below 2), which are mostly clutter.

export type RadarPaletteId = 'classic' | 'vivid' | 'rainviewer';

export const RADAR_PALETTES: Array<{ id: RadarPaletteId; label: string }> = [
  { id: 'classic', label: 'Classic' },
  { id: 'vivid', label: 'Vivid' },
  { id: 'rainviewer', label: 'RainViewer' },
];

export function isRadarPalette(v: unknown): v is RadarPaletteId {
  return v === 'classic' || v === 'vivid' || v === 'rainviewer';
}

// [dBZ, '#rrggbb', alpha 0-1], interpolated linearly between stops.
type Stop = [number, string, number];

const STOPS: Record<Exclude<RadarPaletteId, 'rainviewer'>, Stop[]> = {
  // The familiar broadcast ramp (green → yellow → red → magenta), with light
  // rain as a translucent wash of bright green that firms up with intensity
  // (the served Universal Blue ramp has no greens: its light-to-moderate rain
  // runs light cyan → navy, sinking into a dark basemap as it strengthens).
  classic: [
    [8, '#5fd65f', 0],
    [12, '#63e063', 0.5],
    [18, '#46cc4f', 0.7],
    [24, '#2fb845', 0.85],
    [30, '#2aa83f', 0.92],
    [33, '#a8d62e', 0.95],
    [36, '#ffe31a', 0.97],
    [40, '#ffa51f', 0.98],
    [45, '#ff6420', 1],
    [50, '#ff3a24', 1],
    [55, '#f0194f', 1],
    [60, '#ff2fc0', 1],
    [65, '#ff9cff', 1],
    [70, '#ffffff', 1],
  ],
  // Blue → cyan → yellow → red → magenta: cooler light rain for maps where
  // green competes with vegetation (the satellite basemaps).
  vivid: [
    [6, '#3b82f6', 0],
    [10, '#4a90f0', 0.38],
    [18, '#4fa8f5', 0.6],
    [25, '#3ccbe8', 0.78],
    [30, '#3be0b8', 0.86],
    [35, '#c8ee4a', 0.92],
    [40, '#ffd93a', 0.95],
    [45, '#ff9a1f', 0.97],
    [50, '#ff4a2a', 0.98],
    [55, '#e0185a', 1],
    [60, '#c43bd6', 1],
    [65, '#f2b6ff', 1],
    [70, '#ffffff', 1],
  ],
};

// Snow in the recoloured palettes: a near-white wash deepening to pale ice
// blue — distinct from rain at a glance, without the saturated blue and
// purple blobs of the served snow ramp. Starts lower than rain: snow returns
// weaker echo for the same precipitation.
const SNOW_STOPS: Stop[] = [
  [2, '#f2f7ff', 0],
  [6, '#f2f7ff', 0.45],
  [15, '#e4efff', 0.65],
  [25, '#d6e8ff', 0.82],
  [35, '#b4d2ff', 0.94],
  [45, '#9cc2ff', 1],
];

// LUT domain: quarter-dBZ steps across the range the renderer produces.
export const LUT_MIN_DBZ = -32;
export const LUT_MAX_DBZ = 80;
export const LUT_STEPS_PER_DBZ = 4;
export const LUT_SIZE = (LUT_MAX_DBZ - LUT_MIN_DBZ) * LUT_STEPS_PER_DBZ + 1;

export interface PaletteLut {
  rain: Uint8Array; // RGBA × LUT_SIZE
  snow: Uint8Array;
  // Colours written under fully transparent pixels away from any echo, so
  // bilinear filtering and mipmaps blend toward the ramp's own light end
  // instead of black (which would draw a dark halo round every echo).
  edgeRgb: [number, number, number];
  snowEdgeRgb: [number, number, number];
}

function hexRgb(hex: string): [number, number, number] {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

export function sampleStops(stops: Stop[], dbz: number): [number, number, number, number] {
  if (dbz < stops[0][0]) return [...hexRgb(stops[0][1]), 0];
  for (let i = 0; i < stops.length - 1; i++) {
    const [d0, c0, a0] = stops[i];
    const [d1, c1, a1] = stops[i + 1];
    if (dbz <= d1) {
      const t = (dbz - d0) / (d1 - d0);
      const p = hexRgb(c0);
      const q = hexRgb(c1);
      return [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t, a0 + (a1 - a0) * t];
    }
  }
  const last = stops[stops.length - 1];
  return [...hexRgb(last[1]), last[2]];
}

function lutFromStops(stops: Stop[]): Uint8Array {
  const lut = new Uint8Array(LUT_SIZE * 4);
  for (let i = 0; i < LUT_SIZE; i++) {
    const [r, g, b, a] = sampleStops(stops, LUT_MIN_DBZ + i / LUT_STEPS_PER_DBZ);
    lut[i * 4] = Math.round(r);
    lut[i * 4 + 1] = Math.round(g);
    lut[i * 4 + 2] = Math.round(b);
    lut[i * 4 + 3] = Math.round(a * 255);
  }
  return lut;
}

// The served table as a LUT: whole-dBZ steps exactly as RainViewer paints
// them (a smoothed value rounds to the nearest served colour).
function lutFromTable(table: Uint8Array): Uint8Array {
  const lut = new Uint8Array(LUT_SIZE * 4);
  for (let i = 0; i < LUT_SIZE; i++) {
    const dbz = Math.round(LUT_MIN_DBZ + i / LUT_STEPS_PER_DBZ);
    const k = Math.min(Math.max(dbz, UB_MIN_DBZ), UB_MAX_DBZ) - UB_MIN_DBZ;
    lut.set(table.subarray(k * 4, k * 4 + 4), i * 4);
  }
  return lut;
}

const cache = new Map<RadarPaletteId, PaletteLut>();

export function paletteLut(id: RadarPaletteId): PaletteLut {
  let lut = cache.get(id);
  if (!lut) {
    lut =
      id === 'rainviewer'
        ? {
            rain: lutFromTable(UB_RAIN_RGBA),
            snow: lutFromTable(UB_SNOW_RGBA),
            edgeRgb: [99, 97, 89],
            snowEdgeRgb: [207, 255, 255],
          }
        : {
            rain: lutFromStops(STOPS[id]),
            snow: lutFromStops(SNOW_STOPS),
            edgeRgb: hexRgb(STOPS[id][0][1]),
            snowEdgeRgb: hexRgb(SNOW_STOPS[0][1]),
          };
    cache.set(id, lut);
  }
  return lut;
}

// Legend: a CSS gradient over the displayed intensity range, and the snow
// swatch colour.
export const LEGEND_MIN_DBZ = 5;
export const LEGEND_MAX_DBZ = 70;

export function legendGradient(id: RadarPaletteId): string {
  const lut = paletteLut(id).rain;
  const parts: string[] = [];
  const n = 26;
  for (let i = 0; i <= n; i++) {
    const dbz = LEGEND_MIN_DBZ + ((LEGEND_MAX_DBZ - LEGEND_MIN_DBZ) * i) / n;
    const k = Math.round((dbz - LUT_MIN_DBZ) * LUT_STEPS_PER_DBZ) * 4;
    // Legend swatches show the colour at full strength (alpha only thins it
    // on the map); the faintest end fades so "light" still reads as light.
    const a = Math.max(0.25, lut[k + 3] / 255);
    parts.push(`rgba(${lut[k]}, ${lut[k + 1]}, ${lut[k + 2]}, ${a.toFixed(2)}) ${((i / n) * 100).toFixed(1)}%`);
  }
  return `linear-gradient(to right, ${parts.join(', ')})`;
}

export function snowSwatch(id: RadarPaletteId): string {
  const lut = paletteLut(id).snow;
  const k = Math.round((25 - LUT_MIN_DBZ) * LUT_STEPS_PER_DBZ) * 4;
  return `rgb(${lut[k]}, ${lut[k + 1]}, ${lut[k + 2]})`;
}

// One intensity scale for the legend's marks and the hover readout, so a
// cell the legend calls "Heavy" reads "Heavy rain" under the cursor. Each
// band runs from its `min` dBZ up to the next band's. Heavy and Extreme
// start where every palette turns yellow (~35 dBZ) and crimson or pink (~55).
export interface IntensityBand {
  min: number;
  name: string;
  readout?: string; // readout wording, when not "<name> rain"
}

export const RAIN_INTENSITY: readonly IntensityBand[] = [
  { min: -Infinity, name: 'Light' },
  { min: 20, name: 'Moderate' },
  { min: 35, name: 'Heavy' },
  { min: 55, name: 'Extreme', readout: 'Extreme · possible hail' },
];

// Snow returns weaker echo than rain for the same precipitation rate, so its
// bands sit lower. The legend has one snow swatch, not a ramp.
export const SNOW_INTENSITY: readonly IntensityBand[] = [
  { min: -Infinity, name: 'Light' },
  { min: 15, name: 'Moderate' },
  { min: 25, name: 'Heavy' },
];

export function intensityBand(dbz: number, bands: readonly IntensityBand[] = RAIN_INTENSITY): IntensityBand {
  let band = bands[0];
  for (const b of bands) if (dbz >= b.min) band = b;
  return band;
}

// The rain bands over the legend's range, clipped to it, with their dBZ
// span in words ("20–35 dBZ") for titles and screen readers.
export function legendBands(): Array<{ name: string; from: number; to: number; range: string }> {
  return RAIN_INTENSITY.map((b, i) => {
    const next = RAIN_INTENSITY[i + 1]?.min;
    return {
      name: b.name,
      from: Math.max(b.min, LEGEND_MIN_DBZ),
      to: Math.min(next ?? Infinity, LEGEND_MAX_DBZ),
      range:
        next === undefined ? `${b.min} dBZ and above` : b.min === -Infinity ? `below ${next} dBZ` : `${b.min}–${next} dBZ`,
    };
  }).filter((b) => b.to > b.from);
}

// Plain-language intensity for a reflectivity value (hover readout).
export function intensityLabel(dbz: number, snow: boolean): string {
  if (snow) return `${intensityBand(dbz, SNOW_INTENSITY).name} snow`;
  const band = intensityBand(dbz);
  return band.readout ?? `${band.name} rain`;
}
