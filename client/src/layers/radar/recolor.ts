// Pixel pipeline that turns pre-colored source tiles into the unified storm
// palette. Both sources serve tiles painted in documented house ramps, so the
// pipeline is: invert served color → dBZ magnitude (nearest-anchor lookup),
// smooth in DATA space (normalized-convolution blur, so echo edges feather
// without magnitude draining into a fake light-rain halo), then map through
// the storm LUT with per-pixel alpha. Smoothing before colors exist is what
// keeps gradients clean at high zoom — blurring after palettization would
// smear unrelated hues together. This is the same trick zoom.earth leans on:
// coarse (~1 km) data made street-zoom-smooth by interpolation, not more data.

import type { InversionAnchor } from './sources';
import { US_COVERAGE_BOXES } from './sources';

type SourceImage = HTMLImageElement | ImageBitmap | HTMLCanvasElement;

// Cesium fetches imagery as ImageBitmaps created with flipY (an upload-time
// optimization). Reading a pre-flipped bitmap with drawImage yields
// upside-down rows — and returning a normal-orientation canvas is exactly
// right, because Cesium flips canvases at upload. Un-flip bitmaps here so
// both conventions align.
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
  c.drawImage(src, p, p);
  c.drawImage(src, 0, 0, w, 1, p, 0, w, p);
  c.drawImage(src, 0, h - 1, w, 1, p, h + p, w, p);
  c.drawImage(src, 0, 0, 1, h, 0, p, p, h);
  c.drawImage(src, w - 1, 0, 1, h, w + p, p, p, h);
  c.drawImage(src, 0, 0, 1, 1, 0, 0, p, p);
  c.drawImage(src, w - 1, 0, 1, 1, w + p, 0, p, p);
  c.drawImage(src, 0, h - 1, 1, 1, 0, h + p, p, p);
  c.drawImage(src, w - 1, h - 1, 1, 1, w + p, h + p, p, p);
  c.imageSmoothingEnabled = true;
  return pad;
}

// Quantized RGB (5 bits/channel) → magnitude byte. 32 KB per anchor set,
// built once on first use and cached per anchor array.
const inversionLutCache = new WeakMap<InversionAnchor[], Uint8Array>();
export function getInversionLut(anchors: InversionAnchor[]): Uint8Array {
  let lut = inversionLutCache.get(anchors);
  if (lut) return lut;
  lut = new Uint8Array(32 * 32 * 32);
  for (let r = 0; r < 32; r++) {
    for (let g = 0; g < 32; g++) {
      for (let b = 0; b < 32; b++) {
        const pr = r * 8 + 4;
        const pg = g * 8 + 4;
        const pb = b * 8 + 4;
        let bestD = Infinity;
        let bestM = 0;
        for (const a of anchors) {
          const d = (pr - a.r) ** 2 + (pg - a.g) ** 2 + (pb - a.b) ** 2;
          if (d < bestD) {
            bestD = d;
            bestM = a.magnitude;
          }
        }
        lut[(r << 10) | (g << 5) | b] = bestM;
      }
    }
  }
  inversionLutCache.set(anchors, lut);
  return lut;
}

// Per-pixel geographic coordinates of a web-mercator tile, for the coverage
// mask below. Row latitudes and column longitudes are each 1-D, so compute
// them once per tile instead of per pixel.
function tileLonLatAxes(z: number, x: number, y: number, size: number) {
  const n = size * 2 ** z;
  const lons = new Float64Array(size);
  const lats = new Float64Array(size);
  for (let i = 0; i < size; i++) {
    lons[i] = ((x * size + i + 0.5) / n) * 360 - 180;
    const t = Math.PI - (2 * Math.PI * (y * size + i + 0.5)) / n;
    lats[i] = (Math.atan(Math.sinh(t)) * 180) / Math.PI;
  }
  return { lons, lats };
}

function inUsCoverage(lon: number, lat: number): boolean {
  for (const [w, s, e, nn] of US_COVERAGE_BOXES) {
    if (lon >= w && lon <= e && lat >= s && lat <= nn) return true;
  }
  return false;
}

// How much data-space smoothing a tile needs. Sources are ~1 km data; past
// the level where tiles out-resolve the data the raw field turns blocky, so
// smoothing scales up with zoom (capped — beyond maximumLevel Cesium
// magnifies our smoothed texture bilinearly, which does the rest).
export function blurPxForLevel(level: number, nativeLevel: number): number {
  if (!canvasFilterSupported()) return 0;
  return Math.min(4, Math.max(1.2, 0.7 * 2 ** Math.max(0, level - (nativeLevel - 3))));
}

export interface RecolorOptions {
  inversion: Uint8Array; // from getInversionLut
  lut: Uint8ClampedArray; // storm palette, indexed by magnitude byte
  blurPx: number;
  // When set, pixels inside the US HD coverage boxes are cleared — used on
  // the global source in `auto` mode so the two products never double-paint.
  maskUsCoverage?: { z: number; x: number; y: number };
}

export function recolorTile(img: SourceImage, opts: RecolorOptions): HTMLCanvasElement {
  const w = img.width;
  const h = img.height;

  const src = scratch('src', w, h);
  src.ctx.clearRect(0, 0, w, h);
  drawSourceUpright(src.ctx, img, h);
  const sd = src.ctx.getImageData(0, 0, w, h).data;

  let axes: { lons: Float64Array; lats: Float64Array } | null = null;
  if (opts.maskUsCoverage) {
    const m = opts.maskUsCoverage;
    axes = tileLonLatAxes(m.z, m.x, m.y, w);
  }

  // Decode into an opaque field image: R = magnitude scaled by presence,
  // G = presence (the tile's own alpha — both sources feather echo edges with
  // semi-transparent pixels, which flows straight into the normalized
  // convolution below). Opaque alpha keeps the blur a plain linear filter.
  const inv = opts.inversion;
  const field = scratch('field', w, h);
  const fd = field.ctx.createImageData(w, h);
  const f = fd.data;
  for (let py = 0; py < h; py++) {
    const rowMaskable = axes !== null;
    for (let px = 0; px < w; px++) {
      const i = (py * w + px) * 4;
      const a = sd[i + 3];
      f[i + 3] = 255;
      if (a < 8) continue;
      if (rowMaskable && inUsCoverage(axes!.lons[px], axes!.lats[py])) continue;
      const key = ((sd[i] >> 3) << 10) | ((sd[i + 1] >> 3) << 5) | (sd[i + 2] >> 3);
      f[i] = Math.round((inv[key] * a) / 255);
      f[i + 1] = a;
    }
  }
  field.ctx.putImageData(fd, 0, 0);

  let bd: Uint8ClampedArray;
  if (opts.blurPx > 0) {
    const p = Math.ceil(opts.blurPx * 2) + 1;
    const pad = padWithEdgeExtend(field.canvas, w, h, p);
    const blur = scratch('blur', w + 2 * p, h + 2 * p);
    blur.ctx.clearRect(0, 0, blur.canvas.width, blur.canvas.height);
    blur.ctx.filter = `blur(${opts.blurPx}px)`;
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
  const lut = opts.lut;
  for (let i = 0; i < bd.length; i += 4) {
    const presence = bd[i + 1];
    if (presence < 10) continue;
    // Normalized convolution: average magnitude over the echo-covered part of
    // the kernel, so edges feather in alpha without fading in intensity.
    let m = Math.round((bd[i] * 255) / presence);
    if (m > 255) m = 255;
    const a = lut[m * 4 + 3];
    if (a === 0) continue;
    // Presence doubles as the edge ramp; a slight power curve tightens the
    // outer fringe so light rain doesn't grow a huge soft skirt.
    const edge = Math.pow(presence / 255, 1.3);
    o[i] = lut[m * 4];
    o[i + 1] = lut[m * 4 + 1];
    o[i + 2] = lut[m * 4 + 2];
    o[i + 3] = a * edge;
  }
  outCtx.putImageData(od, 0, 0);
  return out;
}

// Agency style keeps the source's own colors, but the global source in `auto`
// mode still needs the coverage mask so it never double-paints under the HD
// layer — a clear-pixels-only pass.
export function maskTile(
  img: SourceImage,
  tile: { z: number; x: number; y: number }
): HTMLCanvasElement {
  const w = img.width;
  const h = img.height;
  const src = scratch('src', w, h);
  src.ctx.clearRect(0, 0, w, h);
  drawSourceUpright(src.ctx, img, h);
  const data = src.ctx.getImageData(0, 0, w, h);
  const d = data.data;
  const { lons, lats } = tileLonLatAxes(tile.z, tile.x, tile.y, w);
  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const i = (py * w + px) * 4;
      if (d[i + 3] !== 0 && inUsCoverage(lons[px], lats[py])) d[i + 3] = 0;
    }
  }
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const ctx = out.getContext('2d');
  if (!ctx) throw new Error('2d canvas unavailable');
  ctx.putImageData(data, 0, 0);
  return out;
}
