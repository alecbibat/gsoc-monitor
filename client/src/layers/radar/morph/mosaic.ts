// Mosaic assembly for the morph renderer: composite the RainViewer tiles
// covering a geographic extent into one Web-Mercator canvas, then recolor the
// whole mosaic through the standard pipeline. The morph sheet samples these
// mosaics in mercator UV space (the shader converts geographic st → mercator
// v), so assembly stays a plain tile paste with no reprojection.

import * as Cesium from 'cesium';
import { getRadarLut, type RadarPaletteId } from '../palettes';
import { radarBlurPx, recolorRadarTile } from '../recolor';

// Mercator y in [0,1) from top for a latitude in radians.
export function mercY(latRad: number): number {
  const clamped = Math.max(-1.4844, Math.min(1.4844, latRad)); // ±85.05°
  return (1 - Math.log(Math.tan(clamped) + 1 / Math.cos(clamped)) / Math.PI) / 2;
}

export interface MosaicExtent {
  west: number; // radians
  south: number;
  east: number;
  north: number;
  level: number;
  // integer tile range at `level` (inclusive)
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  // pixels per tile in the assembled mosaic
  tilePx: number;
}

// Choose a tile level + range covering `rect`, padded, sized so the mosaic
// stays within a texture budget. maxLevel matches the radar product's native
// resolution cap.
export function planExtent(
  rect: Cesium.Rectangle,
  maxLevel: number,
  budgetPx = 2048
): MosaicExtent {
  // Pad 25% each side so small camera drifts don't force a rebuild.
  const padLon = (rect.east - rect.west) * 0.25;
  const padLat = (rect.north - rect.south) * 0.25;
  const west = Math.max(-Math.PI, rect.west - padLon);
  const east = Math.min(Math.PI, rect.east + padLon);
  const south = Math.max(-1.4844, rect.south - padLat);
  const north = Math.min(1.4844, rect.north + padLat);

  for (let level = maxLevel; level >= 0; level--) {
    const n = 2 ** level;
    const x0 = Math.floor(((west + Math.PI) / (2 * Math.PI)) * n);
    const x1 = Math.min(n - 1, Math.floor(((east + Math.PI) / (2 * Math.PI)) * n));
    const y0 = Math.floor(mercY(north) * n);
    const y1 = Math.min(n - 1, Math.floor(mercY(south) * n));
    const cols = x1 - x0 + 1;
    const rows = y1 - y0 + 1;
    // Shrink tilePx before dropping a whole level so resolution degrades
    // gradually.
    for (const tilePx of [512, 256, 128]) {
      if (cols * tilePx <= budgetPx && rows * tilePx <= budgetPx) {
        return snapToTileRange(level, x0, x1, y0, y1, tilePx);
      }
    }
  }
  // Whole world at level 0.
  return snapToTileRange(0, 0, 0, 0, 0, 512);
}

// The sheet's rectangle must coincide EXACTLY with the mosaic's tile-range
// bounds: the shader maps geometry st straight onto the mosaic (u linearly,
// v through the mercator conversion), so any mismatch between the rectangle
// and the canvas edges renders every echo shifted and stretched east-west.
function snapToTileRange(
  level: number,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  tilePx: number
): MosaicExtent {
  const n = 2 ** level;
  const invMercLat = (v: number) => Math.atan(Math.sinh(Math.PI * (1 - 2 * v)));
  return {
    west: (x0 / n) * 2 * Math.PI - Math.PI,
    east: ((x1 + 1) / n) * 2 * Math.PI - Math.PI,
    north: invMercLat(y0 / n),
    south: invMercLat((y1 + 1) / n),
    level,
    x0,
    x1,
    y0,
    y1,
    tilePx,
  };
}

// The mosaic's mercator-space window (fractions of the world, y from top).
export function mosaicWindow(e: MosaicExtent) {
  const n = 2 ** e.level;
  return {
    u0: e.x0 / n,
    u1: (e.x1 + 1) / n,
    v0: e.y0 / n,
    v1: (e.y1 + 1) / n,
  };
}

async function fetchTile(url: string): Promise<ImageBitmap | null> {
  try {
    const res = await fetch(url, { mode: 'cors' });
    if (!res.ok) return null;
    return await createImageBitmap(await res.blob());
  } catch {
    return null;
  }
}

// Assemble + recolor one frame's mosaic. Returns null if every tile failed.
export async function assembleRadarMosaic(
  host: string,
  framePath: string,
  extent: MosaicExtent,
  palette: RadarPaletteId
): Promise<HTMLCanvasElement | null> {
  const cols = extent.x1 - extent.x0 + 1;
  const rows = extent.y1 - extent.y0 + 1;
  const raw = document.createElement('canvas');
  raw.width = cols * extent.tilePx;
  raw.height = rows * extent.tilePx;
  const ctx = raw.getContext('2d');
  if (!ctx) return null;

  const jobs: Array<Promise<boolean>> = [];
  for (let ty = extent.y0; ty <= extent.y1; ty++) {
    for (let tx = extent.x0; tx <= extent.x1; tx++) {
      const url = `${host}${framePath}/512/${extent.level}/${tx}/${ty}/2/1_0.png`;
      jobs.push(
        fetchTile(url).then((bmp) => {
          if (!bmp) return false;
          ctx.drawImage(
            bmp,
            (tx - extent.x0) * extent.tilePx,
            (ty - extent.y0) * extent.tilePx,
            extent.tilePx,
            extent.tilePx
          );
          bmp.close();
          return true;
        })
      );
    }
  }
  const results = await Promise.all(jobs);
  if (!results.some(Boolean)) return null;

  // One recolor pass over the whole mosaic (self-fetched → not pre-flipped).
  // Blur matched to the mosaic's effective zoom: tiles drawn at tilePx behave
  // like `level` shifted by log2(tilePx/512).
  const effLevel = extent.level + Math.log2(extent.tilePx / 512);
  return recolorRadarTile(raw, getRadarLut(palette), radarBlurPx(effLevel), false);
}

// Assemble the place-label mosaic (transparent label tiles from the active
// basemap's overlay) so labels can be re-drawn ABOVE the morph sheet.
export async function assembleLabelMosaic(
  urlTemplate: string,
  extent: MosaicExtent
): Promise<HTMLCanvasElement | null> {
  const cols = extent.x1 - extent.x0 + 1;
  const rows = extent.y1 - extent.y0 + 1;
  const canvas = document.createElement('canvas');
  canvas.width = cols * extent.tilePx;
  canvas.height = rows * extent.tilePx;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const subs = ['a', 'b', 'c', 'd'];
  const jobs: Array<Promise<boolean>> = [];
  for (let ty = extent.y0; ty <= extent.y1; ty++) {
    for (let tx = extent.x0; tx <= extent.x1; tx++) {
      const url = urlTemplate
        .replace('{z}', String(extent.level))
        .replace('{x}', String(tx))
        .replace('{y}', String(ty))
        .replace('{s}', subs[(tx + ty) % subs.length]);
      jobs.push(
        fetchTile(url).then((bmp) => {
          if (!bmp) return false;
          ctx.drawImage(
            bmp,
            (tx - extent.x0) * extent.tilePx,
            (ty - extent.y0) * extent.tilePx,
            extent.tilePx,
            extent.tilePx
          );
          bmp.close();
          return true;
        })
      );
    }
  }
  const results = await Promise.all(jobs);
  return results.some(Boolean) ? canvas : null;
}
