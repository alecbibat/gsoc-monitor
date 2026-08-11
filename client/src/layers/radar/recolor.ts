// Pixel pipeline that turns RainViewer's raw data tiles into polished overlay
// imagery. Radar tiles arrive as scheme-0 encodings (R = (dBZ+32) & 127, bit 7
// = snow, alpha 0 where no echo) with server smoothing off; we decode to a
// data field, smooth it ourselves (normalized-convolution blur, so echo edges
// feather without the magnitude draining into a fake light-rain halo), then
// map through a palette LUT with per-pixel alpha. Doing the smoothing in data
// space — before colors exist — is what keeps gradients clean; blurring after
// palettization would smear unrelated hues together.

import type { RadarLut } from './palettes';

type SourceImage = HTMLImageElement | ImageBitmap | HTMLCanvasElement;

// Cesium fetches imagery as ImageBitmaps created with flipY (an upload-time
// optimization: pre-flipped bitmaps skip the UNPACK_FLIP_Y_WEBGL pass, while
// canvas/image sources are flipped during texture upload instead). Reading a
// pre-flipped bitmap with drawImage therefore yields upside-down rows — and
// returning a normal-orientation canvas is exactly right, because Cesium
// flips canvases at upload. Un-flip bitmaps here so both conventions align;
// without this every tile renders vertically mirrored, i.e. precipitation
// draws at the wrong latitude within its tile.
function drawSourceUpright(ctx: CanvasRenderingContext2D, img: SourceImage, h: number) {
  if (typeof ImageBitmap !== 'undefined' && img instanceof ImageBitmap) {
    ctx.save();
    ctx.scale(1, -1);
    ctx.drawImage(img, 0, -h);
    ctx.restore();
  } else {
    ctx.drawImage(img, 0, 0);
  }
}

interface Scratch {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
}

// Reused intermediates (sized on demand). The OUTPUT canvas is always freshly
// created per tile — Cesium holds onto it until the texture uploads, so a
// shared output would get overwritten mid-flight.
const scratchPool = new Map<string, Scratch>();
function scratch(role: string, w: number, h: number): Scratch {
  let s = scratchPool.get(role);
  if (!s) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('2d canvas unavailable');
    s = { canvas, ctx };
    scratchPool.set(role, s);
  }
  if (s.canvas.width !== w) s.canvas.width = w;
  if (s.canvas.height !== h) s.canvas.height = h;
  return s;
}

let filterSupport: boolean | null = null;
function canvasFilterSupported(): boolean {
  if (filterSupport === null) {
    const ctx = document.createElement('canvas').getContext('2d');
    filterSupport = !!ctx && 'filter' in ctx;
  }
  return filterSupport;
}

// Replicate the tile's edge pixels outward into a padding ring so the blur has
// plausible neighbor data at tile seams; without this every tile darkens along
// its border and the mosaic shows a grid.
function padWithEdgeExtend(src: HTMLCanvasElement, w: number, h: number, p: number): Scratch {
  const pad = scratch('pad', w + 2 * p, h + 2 * p);
  const c = pad.ctx;
  c.clearRect(0, 0, pad.canvas.width, pad.canvas.height);
  c.imageSmoothingEnabled = false;
  // center
  c.drawImage(src, p, p);
  // edges (1px strips stretched into the ring)
  c.drawImage(src, 0, 0, w, 1, p, 0, w, p); // top
  c.drawImage(src, 0, h - 1, w, 1, p, h + p, w, p); // bottom
  c.drawImage(src, 0, 0, 1, h, 0, p, p, h); // left
  c.drawImage(src, w - 1, 0, 1, h, w + p, p, p, h); // right
  // corners (1px pixels stretched)
  c.drawImage(src, 0, 0, 1, 1, 0, 0, p, p);
  c.drawImage(src, w - 1, 0, 1, 1, w + p, 0, p, p);
  c.drawImage(src, 0, h - 1, 1, 1, 0, h + p, p, p);
  c.drawImage(src, w - 1, h - 1, 1, 1, w + p, h + p, p, p);
  c.imageSmoothingEnabled = true;
  return pad;
}

// RainViewer's tile CDN ignores the {color} path segment and serves one fixed
// house palette for every scheme id (verified 2026-08 via the /api/radar/diag
// endpoint: scheme 0, 2 and 4 requests returned byte-identical tiles) — a
// blue ramp for light→moderate rain rising through yellow, orange and red,
// with alpha-feathered edges. So instead of decoding a raw data product that
// does not exist, we invert that served palette: each pixel's color is
// matched to the nearest anchor on the ramp below, giving back an intensity
// on this pipeline's internal magnitude scale (2·(dBZ+32)), which then flows
// through the same blur + custom-palette LUT as before. Anchors beyond the
// observed colors (orange → red → magenta) extend the ramp so extreme cores
// keep grading instead of clipping; colors that drift off the ramp entirely
// (if RainViewer ever changes palette) degrade to the nearest anchor's
// intensity — never to noise.
const PALETTE_ANCHORS: Array<[number, number, number, number]> = [
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
function getPaletteInversionLut(): Uint8Array {
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

// How much data-space smoothing a tile needs. RainViewer's radar mosaic is
// ~1 km resolution; past level ~6 the 512px tiles out-resolve the data and the
// raw field turns blocky, so smoothing scales up with zoom (capped — beyond
// the native level Cesium upsamples our smoothed texture bilinearly anyway,
// which is the same trick zoom.earth leans on).
export function radarBlurPx(level: number): number {
  if (!canvasFilterSupported()) return 0;
  // Floor of 1.5px at every level: real mosaics are speckled at national zoom
  // even where the data out-resolves the tile, and the served palette's hard
  // blue→yellow step needs a few pixels of data-space diffusion or the
  // moderate-to-heavy transition renders as an abrupt ring.
  return Math.min(4, Math.max(1.5, 0.7 * 2 ** Math.max(0, level - 6)));
}

export function recolorRadarTile(img: SourceImage, lut: RadarLut, blurPx: number): HTMLCanvasElement {
  const w = img.width;
  const h = img.height;

  const src = scratch('src', w, h);
  src.ctx.clearRect(0, 0, w, h);
  drawSourceUpright(src.ctx, img, h);
  const sd = src.ctx.getImageData(0, 0, w, h).data;

  // Decode into an opaque field image: R = magnitude (2·(dBZ+32)) scaled by
  // presence, G = presence (the tile's own alpha — RainViewer feathers echo
  // edges with semi-transparent pixels, which flows straight into the
  // normalized convolution below), B unused. Opaque alpha keeps the blur a
  // plain linear filter (no premultiplication distortion).
  const inv = getPaletteInversionLut();
  const field = scratch('field', w, h);
  const fd = field.ctx.createImageData(w, h);
  const f = fd.data;
  for (let i = 0; i < sd.length; i += 4) {
    const a = sd[i + 3];
    if (a >= 8) {
      const key =
        ((sd[i] >> 3) << 10) | ((sd[i + 1] >> 3) << 5) | (sd[i + 2] >> 3);
      f[i] = Math.round((inv[key] * a) / 255);
      f[i + 1] = a;
    }
    f[i + 3] = 255;
  }
  field.ctx.putImageData(fd, 0, 0);

  let bd: Uint8ClampedArray;
  if (blurPx > 0) {
    const p = Math.ceil(blurPx * 2) + 1;
    const pad = padWithEdgeExtend(field.canvas, w, h, p);
    const blur = scratch('blur', w + 2 * p, h + 2 * p);
    blur.ctx.clearRect(0, 0, blur.canvas.width, blur.canvas.height);
    blur.ctx.filter = `blur(${blurPx}px)`;
    blur.ctx.drawImage(pad.canvas, 0, 0);
    blur.ctx.filter = 'none';
    bd = blur.ctx.getImageData(p, p, w, h).data;
  } else {
    bd = fd.data;
  }

  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const outCtx = out.getContext('2d');
  if (!outCtx) throw new Error('2d canvas unavailable');
  const od = outCtx.createImageData(w, h);
  const o = od.data;
  const rain = lut.rain;
  const snow = lut.snow;
  for (let i = 0; i < bd.length; i += 4) {
    const presence = bd[i + 1];
    if (presence < 10) continue;
    // Normalized convolution: average magnitude over the echo-covered part of
    // the kernel, so edges feather in alpha without fading in intensity.
    let m = Math.round((bd[i] * 255) / presence) >> 1;
    if (m > 127) m = 127;
    // Snow channel is currently never set (see the encoding note above), but
    // the plumbing stays for when a reliable snow signal exists.
    const isSnow = bd[i + 2] * 2 > presence;
    const l = isSnow ? snow : rain;
    const a = l[m * 4 + 3];
    if (a === 0) continue;
    // Presence doubles as the edge ramp; a slight power curve tightens the
    // outer fringe so light rain doesn't grow a huge soft skirt.
    const edge = Math.pow(presence / 255, 1.3);
    o[i] = l[m * 4];
    o[i + 1] = l[m * 4 + 1];
    o[i + 2] = l[m * 4 + 2];
    o[i + 3] = a * edge;
  }
  outCtx.putImageData(od, 0, 0);
  return out;
}

// Infrared satellite tile → keyed cloud overlay via a 256-entry luminance LUT.
export function recolorCloudTile(img: SourceImage, cloudLut: Uint8ClampedArray): HTMLCanvasElement {
  const w = img.width;
  const h = img.height;
  const src = scratch('src', w, h);
  src.ctx.clearRect(0, 0, w, h);
  drawSourceUpright(src.ctx, img, h);
  const sd = src.ctx.getImageData(0, 0, w, h).data;

  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const outCtx = out.getContext('2d');
  if (!outCtx) throw new Error('2d canvas unavailable');
  const od = outCtx.createImageData(w, h);
  const o = od.data;
  for (let i = 0; i < sd.length; i += 4) {
    if (sd[i + 3] < 128) continue; // outside coverage
    const v = sd[i];
    o[i] = cloudLut[v * 4];
    o[i + 1] = cloudLut[v * 4 + 1];
    o[i + 2] = cloudLut[v * 4 + 2];
    o[i + 3] = cloudLut[v * 4 + 3];
  }
  outCtx.putImageData(od, 0, 0);
  return out;
}
