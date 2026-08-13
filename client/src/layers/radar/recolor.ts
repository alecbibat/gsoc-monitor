// Pixel pipeline that turns RainViewer's raw data tiles into polished overlay
// imagery. Radar tiles arrive as scheme-0 encodings (R = (dBZ+32) & 127, bit 7
// = snow, alpha 0 where no echo) with server smoothing off; we decode to a
// data field, smooth it ourselves (normalized-convolution blur, so echo edges
// feather without the magnitude draining into a fake light-rain halo), then
// map through a palette LUT with per-pixel alpha. Doing the smoothing in data
// space — before colors exist — is what keeps gradients clean; blurring after
// palettization would smear unrelated hues together.

import type { RadarLut } from './palettes';
import { getPaletteInversionLut, radarBlurSigma } from './radarField';

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

// The palette-inversion table and the blur schedule live in `radarField.ts`,
// which is DOM-free so the worker pipeline runs the same math. This module is
// the main-thread fallback for browsers without OffscreenCanvas.

// Data-space smoothing radius for a tile, or 0 where canvas filters are
// unavailable and the blur has to be skipped entirely.
export function radarBlurPx(level: number): number {
  if (!canvasFilterSupported()) return 0;
  return radarBlurSigma(level);
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
