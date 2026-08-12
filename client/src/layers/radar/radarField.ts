// The radar pixel pipeline's math, with every DOM dependency removed so it can
// run inside a worker. `recolor.ts` (the main-thread fallback) and
// `worker/recolor.worker.ts` both drive this code, so there is exactly one
// definition of what a RainViewer tile means.
//
// The pipeline is: served-palette RGBA → intensity field → blur → palette LUT.
// Smoothing happens in DATA space, before colors exist; blurring after
// palettization would smear unrelated hues together.

import type { RadarLut } from './palettes';

// A decoded radar tile. Two planes, both needed by the normalized convolution:
//
//   mag      magnitude (2·(dBZ+32)) PRE-SCALED by presence, so a plain linear
//            blur of this plane gives the presence-weighted magnitude sum
//   presence the tile's own alpha — RainViewer feathers echo edges with
//            semi-transparent pixels, and blurring this plane gives the
//            kernel's echo coverage, i.e. the weight to divide by
//
// Dividing the two after the blur is the normalized convolution: edges feather
// in ALPHA without their magnitude draining into a fake light-rain halo.
//
// Row 0 is the top of the tile (natural image orientation). Anything that
// hands pixels to WebGL is responsible for flipping — see `colorizeField`.
export interface RadarField {
  width: number;
  height: number;
  mag: Uint8Array;
  presence: Uint8Array;
}

export function fieldBytes(f: RadarField): number {
  return f.mag.byteLength + f.presence.byteLength;
}

// RainViewer's tile CDN ignores the {color} path segment and serves one fixed
// house palette for every scheme id (verified 2026-08 via /api/radar/diag:
// scheme 0, 2 and 4 requests returned byte-identical tiles) — a blue ramp for
// light→moderate rain rising through yellow, orange and red, with
// alpha-feathered edges. So instead of decoding a raw data product that does
// not exist, we invert that served palette: each pixel's color is matched to
// the nearest anchor on the ramp below, giving back an intensity on this
// pipeline's internal magnitude scale (2·(dBZ+32)). Anchors beyond the
// observed colors (orange → red → magenta) extend the ramp so extreme cores
// keep grading instead of clipping; colors that drift off the ramp entirely
// (if RainViewer ever changes palette) degrade to the nearest anchor's
// intensity — never to noise.
export const PALETTE_ANCHORS: Array<[number, number, number, number]> = [
  // [r, g, b, dBZ-equivalent]
  [0, 60, 92, 3],
  [0, 71, 104, 6],
  [0, 78, 120, 10],
  [0, 85, 136, 14],
  [0, 98, 149, 19],
  [0, 112, 163, 24],
  [0, 127, 180, 29],
  [255, 238, 0, 33],
  [255, 210, 0, 38],
  [255, 180, 0, 43],
  [255, 150, 0, 47],
  [255, 110, 0, 51],
  [255, 60, 0, 55],
  [230, 0, 0, 60],
  [180, 0, 40, 64],
  [255, 0, 255, 68],
  [255, 255, 255, 70],
];

// Quantized RGB (5 bits/channel) → magnitude byte (2·(dBZ+32)). 32 KB, built
// once on first use.
let inversionLut: Uint8Array | null = null;
export function getPaletteInversionLut(): Uint8Array {
  if (inversionLut) return inversionLut;
  const lut = new Uint8Array(32 * 32 * 32);
  for (let r = 0; r < 32; r++) {
    for (let g = 0; g < 32; g++) {
      for (let b = 0; b < 32; b++) {
        const pr = r * 8 + 4;
        const pg = g * 8 + 4;
        const pb = b * 8 + 4;
        let bestD = Infinity;
        let bestDbz = 0;
        for (const [ar, ag, ab, dbz] of PALETTE_ANCHORS) {
          const d = (pr - ar) ** 2 + (pg - ag) ** 2 + (pb - ab) ** 2;
          if (d < bestD) {
            bestD = d;
            bestDbz = dbz;
          }
        }
        lut[(r << 10) | (g << 5) | b] = Math.min(255, Math.round(2 * (bestDbz + 32)));
      }
    }
  }
  inversionLut = lut;
  return lut;
}

// How much data-space smoothing a tile needs, as a Gaussian standard
// deviation in pixels. RainViewer's radar mosaic is ~1 km resolution; past
// level ~6 the 512px tiles out-resolve the data and the raw field turns
// blocky, so smoothing scales up with zoom (capped — beyond the native level
// Cesium upsamples our smoothed texture bilinearly anyway, which is the same
// trick zoom.earth leans on).
//
// Floor of 1.5px at every level: real mosaics are speckled at national zoom
// even where the data out-resolves the tile, and the served palette's hard
// blue→yellow step needs a few pixels of data-space diffusion or the
// moderate-to-heavy transition renders as an abrupt ring.
export function radarBlurSigma(level: number): number {
  return Math.min(4, Math.max(1.5, 0.7 * 2 ** Math.max(0, level - 6)));
}

// Served RGBA → intensity field. Pixels below alpha 8 are treated as empty:
// RainViewer's feathering trails off into near-zero alpha, and letting that
// tail into the field just widens every echo by a pixel of noise.
export function decodeField(rgba: Uint8ClampedArray | Uint8Array, w: number, h: number): RadarField {
  const inv = getPaletteInversionLut();
  const n = w * h;
  const mag = new Uint8Array(n);
  const presence = new Uint8Array(n);
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    const a = rgba[i + 3];
    if (a < 8) continue;
    const key = ((rgba[i] >> 3) << 10) | ((rgba[i + 1] >> 3) << 5) | (rgba[i + 2] >> 3);
    mag[p] = Math.round((inv[key] * a) / 255);
    presence[p] = a;
  }
  return { width: w, height: h, mag, presence };
}

// --- Gaussian blur -----------------------------------------------------------
// Three successive box blurs, which is exactly the approximation the SVG
// filter spec prescribes for feGaussianBlur — and therefore what canvas
// `ctx.filter = blur(Npx)` (the main-thread path) computes. Running sums make
// it O(1) per pixel regardless of sigma, unlike the ~25-tap separable kernel a
// direct Gaussian would need at sigma 4.

// Box sizes per the SVG spec's feGaussianBlur approximation, returned as
// inclusive [lo, hi] offsets around each output pixel.
function boxPasses(sigma: number): Array<[number, number]> {
  const d = Math.floor((sigma * 3 * Math.sqrt(2 * Math.PI)) / 4 + 0.5);
  if (d < 2) return [];
  if (d % 2 === 1) {
    const r = (d - 1) / 2;
    return [
      [-r, r],
      [-r, r],
      [-r, r],
    ];
  }
  // Even d: two boxes of size d offset half a pixel either way, then one of
  // size d+1 centered — the spec's trick for keeping the result centered.
  const half = d / 2;
  return [
    [-half, half - 1],
    [-half + 1, half],
    [-half, half],
  ];
}

function boxBlurH(src: Float32Array, dst: Float32Array, w: number, h: number, lo: number, hi: number) {
  const size = hi - lo + 1;
  const inv = 1 / size;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    // Clamp-to-edge: the tile's border pixels replicate outward, so the blur
    // has plausible neighbor data at tile seams. Without it every tile darkens
    // along its border and the mosaic shows a grid.
    let sum = 0;
    for (let k = lo; k <= hi; k++) {
      sum += src[row + (k < 0 ? 0 : k >= w ? w - 1 : k)];
    }
    dst[row] = sum * inv;
    for (let x = 1; x < w; x++) {
      const add = x + hi;
      const sub = x + lo - 1;
      sum += src[row + (add < 0 ? 0 : add >= w ? w - 1 : add)];
      sum -= src[row + (sub < 0 ? 0 : sub >= w ? w - 1 : sub)];
      dst[row + x] = sum * inv;
    }
  }
}

function boxBlurV(src: Float32Array, dst: Float32Array, w: number, h: number, lo: number, hi: number) {
  const size = hi - lo + 1;
  const inv = 1 / size;
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let k = lo; k <= hi; k++) {
      sum += src[(k < 0 ? 0 : k >= h ? h - 1 : k) * w + x];
    }
    dst[x] = sum * inv;
    for (let y = 1; y < h; y++) {
      const add = y + hi;
      const sub = y + lo - 1;
      sum += src[(add < 0 ? 0 : add >= h ? h - 1 : add) * w + x];
      sum -= src[(sub < 0 ? 0 : sub >= h ? h - 1 : sub) * w + x];
      dst[y * w + x] = sum * inv;
    }
  }
}

// Scratch buffers, reused across tiles (one worker processes one tile at a
// time, so a shared pair is safe and keeps the allocator quiet).
let scratch: { a: Float32Array; b: Float32Array } | null = null;
function scratchPair(n: number): { a: Float32Array; b: Float32Array } {
  if (!scratch || scratch.a.length < n) {
    scratch = { a: new Float32Array(n), b: new Float32Array(n) };
  }
  return scratch;
}

function blurPlane(plane: Uint8Array, w: number, h: number, passes: Array<[number, number]>) {
  const n = w * h;
  // Each pass runs horizontal into `b` then vertical back into `a`, so `a`
  // always carries the running result and the buffers never need swapping.
  const { a, b } = scratchPair(n);
  for (let i = 0; i < n; i++) a[i] = plane[i];
  for (const [lo, hi] of passes) {
    boxBlurH(a, b, w, h, lo, hi);
    boxBlurV(b, a, w, h, lo, hi);
  }
  for (let i = 0; i < n; i++) {
    const v = a[i] + 0.5;
    plane[i] = v < 0 ? 0 : v > 255 ? 255 : v;
  }
}

// Blur both planes in place. Blurring the presence-scaled magnitude and the
// presence with the SAME kernel is what makes the later division a normalized
// convolution.
export function blurField(field: RadarField, sigma: number): RadarField {
  const passes = boxPasses(sigma);
  if (passes.length === 0) return field;
  blurPlane(field.mag, field.width, field.height, passes);
  blurPlane(field.presence, field.width, field.height, passes);
  return field;
}

// Echo whose blurred coverage is below this is dropped: it is the outermost
// fringe of the feather, where the normalized division amplifies noise.
const MIN_PRESENCE = 10;

// Field → RGBA through a palette LUT.
//
// `flipY` writes rows bottom-up. WebGL ignores UNPACK_FLIP_Y_WEBGL for
// ImageBitmap sources, so Cesium pre-flips the bitmaps IT decodes
// (`imageOrientation: 'flipY'`) and a bitmap we hand back must match that
// convention or every tile renders mirrored — i.e. precipitation draws at the
// wrong latitude within its tile. Canvas sources are flipped at upload
// instead, so the main-thread fallback passes false.
export function colorizeField(
  field: RadarField,
  lut: RadarLut,
  out: Uint8ClampedArray,
  flipY: boolean
): void {
  const { width: w, height: h, mag, presence } = field;
  const rain = lut.rain;
  out.fill(0);
  for (let y = 0; y < h; y++) {
    const srcRow = y * w;
    const dstRow = (flipY ? h - 1 - y : y) * w;
    for (let x = 0; x < w; x++) {
      const p = presence[srcRow + x];
      if (p < MIN_PRESENCE) continue;
      // Normalized convolution: average magnitude over the echo-covered part
      // of the kernel, so edges feather in alpha without fading in intensity.
      let m = Math.round((mag[srcRow + x] * 255) / p) >> 1;
      if (m > 127) m = 127;
      const a = rain[m * 4 + 3];
      if (a === 0) continue;
      // Presence doubles as the edge ramp; a slight power curve tightens the
      // outer fringe so light rain doesn't grow a huge soft skirt.
      const edge = Math.pow(p / 255, 1.3);
      const o = (dstRow + x) * 4;
      out[o] = rain[m * 4];
      out[o + 1] = rain[m * 4 + 1];
      out[o + 2] = rain[m * 4 + 2];
      out[o + 3] = a * edge;
    }
  }
}
