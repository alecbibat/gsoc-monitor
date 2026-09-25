import { NO_ECHO, type RadarGrid } from './radarDecode';
import { LUT_MIN_DBZ, LUT_SIZE, LUT_STEPS_PER_DBZ, type PaletteLut } from './radarPalettes';

// Paints a decoded radar grid through a palette. Smoothing happens on the
// reflectivity values before any colour exists — blurring colours instead
// smears unrelated hues together (yellow + blue = green fringes), which is
// what made the earlier canvas-blur experiment look worse. No-echo pixels sit
// at a floor below every palette's visible range, so echo edges fade out
// through the palette's own alpha ramp.

const FLOOR_DBZ = -20;
// Snow/rain boundaries in RainViewer's data are a per-pixel classification;
// blending the two ramps through a softened mask keeps the seam from
// shimmering pixel-to-pixel between frames.
const SNOW_MASK_SIGMA = 2;
// Transparent pixels this close to echo borrow its colour, so texture
// filtering at the edge blends toward the echo's own hue.
const EDGE_BLEED_PX = 2;

function gaussianKernel(sigma: number): Float32Array {
  const r = Math.max(1, Math.ceil(sigma * 2.5));
  const k = new Float32Array(r * 2 + 1);
  let sum = 0;
  for (let i = -r; i <= r; i++) {
    const v = Math.exp(-(i * i) / (2 * sigma * sigma));
    k[i + r] = v;
    sum += v;
  }
  for (let i = 0; i < k.length; i++) k[i] /= sum;
  return k;
}

// Separable blur, edges clamped (a tile's border pixels stand in for its
// unseen neighbours; with a sub-pixel sigma the seam this leaves is below
// what the eye can find).
function blur(src: Float32Array, w: number, h: number, sigma: number): Float32Array {
  if (sigma <= 0) return src;
  const k = gaussianKernel(sigma);
  const r = (k.length - 1) >> 1;
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let i = -r; i <= r; i++) {
        const xx = x + i < 0 ? 0 : x + i >= w ? w - 1 : x + i;
        acc += src[row + xx] * k[i + r];
      }
      tmp[row + x] = acc;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let i = -r; i <= r; i++) {
        const yy = y + i < 0 ? 0 : y + i >= h ? h - 1 : y + i;
        acc += tmp[yy * w + x] * k[i + r];
      }
      out[y * w + x] = acc;
    }
  }
  return out;
}

export interface RenderOptions {
  sigma: number; // data-space blur radius in source pixels (0 = none)
  snow: boolean; // paint snow in its own ramp (otherwise as rain)
}

// RGBA for the tile (rows top-down), or null when nothing in it is visible.
export function renderRadarTile(
  grid: RadarGrid,
  lut: PaletteLut,
  opts: RenderOptions
): Uint8ClampedArray<ArrayBuffer> | null {
  const { width: w, height: h, dbz, snow } = grid;
  const n = w * h;

  let any = false;
  let anySnow = false;
  const field = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const v = dbz[i];
    if (v === NO_ECHO) field[i] = FLOOR_DBZ;
    else {
      field[i] = v;
      any = true;
      if (snow[i]) anySnow = true;
    }
  }
  if (!any) return null;

  const smooth = blur(field, w, h, opts.sigma);
  let mix: Float32Array | null = null;
  if (opts.snow && anySnow) {
    const m = new Float32Array(n);
    for (let i = 0; i < n; i++) m[i] = snow[i];
    mix = blur(m, w, h, SNOW_MASK_SIGMA);
  }

  const out = new Uint8ClampedArray(n * 4);
  const rain = lut.rain;
  const snowLut = lut.snow;
  let visible = 0;
  for (let i = 0; i < n; i++) {
    let k = Math.round((smooth[i] - LUT_MIN_DBZ) * LUT_STEPS_PER_DBZ);
    if (k < 0) k = 0;
    else if (k >= LUT_SIZE) k = LUT_SIZE - 1;
    const o = i * 4;
    const q = k * 4;
    const s = mix ? mix[i] : 0;
    let r: number, g: number, b: number, a: number;
    if (s <= 0.001) {
      r = rain[q];
      g = rain[q + 1];
      b = rain[q + 2];
      a = rain[q + 3];
    } else if (s >= 0.999) {
      r = snowLut[q];
      g = snowLut[q + 1];
      b = snowLut[q + 2];
      a = snowLut[q + 3];
    } else {
      // Blend premultiplied so a transparent side doesn't tint the other.
      const ra = rain[q + 3] * (1 - s);
      const sa = snowLut[q + 3] * s;
      a = ra + sa;
      if (a > 0) {
        r = (rain[q] * ra + snowLut[q] * sa) / a;
        g = (rain[q + 1] * ra + snowLut[q + 1] * sa) / a;
        b = (rain[q + 2] * ra + snowLut[q + 2] * sa) / a;
      } else {
        r = g = b = 0;
      }
    }
    if (a >= 1) {
      out[o] = r;
      out[o + 1] = g;
      out[o + 2] = b;
      out[o + 3] = a;
      visible++;
    }
  }
  if (visible === 0) return null;

  // Bleed edge colour outward a couple of pixels, then fill the rest with
  // the ramp's floor colour (snow's where snow dominates).
  const filled = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (out[i * 4 + 3] > 0) filled[i] = 1;
  for (let pass = 0; pass < EDGE_BLEED_PX; pass++) {
    const next = filled.slice();
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (filled[i]) continue;
        const src =
          x > 0 && filled[i - 1] ? i - 1 : x < w - 1 && filled[i + 1] ? i + 1 : y > 0 && filled[i - w] ? i - w : y < h - 1 && filled[i + w] ? i + w : -1;
        if (src < 0) continue;
        out[i * 4] = out[src * 4];
        out[i * 4 + 1] = out[src * 4 + 1];
        out[i * 4 + 2] = out[src * 4 + 2];
        next[i] = 1;
      }
    }
    filled.set(next);
  }
  const [er, eg, eb] = lut.edgeRgb;
  const [sr, sg, sb] = lut.snowEdgeRgb;
  for (let i = 0; i < n; i++) {
    if (filled[i]) continue;
    const useSnow = mix !== null && mix[i] > 0.5;
    out[i * 4] = useSnow ? sr : er;
    out[i * 4 + 1] = useSnow ? sg : eg;
    out[i * 4 + 2] = useSnow ? sb : eb;
  }

  return out;
}

// Reflectivity at a fractional pixel position of a grid, for the hover
// readout. Returns null over no echo.
export function sampleGrid(grid: RadarGrid, px: number, py: number): { dbz: number; snow: boolean } | null {
  const { width: w, height: h, dbz, snow } = grid;
  const x = Math.min(Math.max(0, Math.round(px)), w - 1);
  const y = Math.min(Math.max(0, Math.round(py)), h - 1);
  // Nearest-pixel value, but report the strongest echo within one pixel so a
  // cursor on a small core doesn't read the gap beside it.
  let best = NO_ECHO;
  let bestSnow = false;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx;
      const yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
      const v = dbz[yy * w + xx];
      if (v > best) {
        best = v;
        bestSnow = snow[yy * w + xx] === 1;
      }
    }
  }
  if (best === NO_ECHO) return null;
  return { dbz: best, snow: bestSnow };
}
