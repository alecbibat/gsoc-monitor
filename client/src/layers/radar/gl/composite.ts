// Stage B: turning the worker field cache into one texture for the draped
// primitive.
//
// The imagery path hands Cesium one recolored tile at a time. The GPU path
// needs the opposite: a single texture covering the view, carrying RAW
// magnitude/presence so the shader can blend two frames in data space and only
// then apply the palette. That is what makes the Stage C warp possible — you
// cannot warp colors, you warp the field and colorize the result.

import * as Cesium from 'cesium';
import { recentTiles, type TileCoord } from '../visibleTiles';
import { compositeRegion, isTileWarm, WORKER_SLOTS } from '../worker/pool';

// 8 tiles of 512px = 4096, the width the plan's spike criterion names. Bigger
// composites are possible but two 4096-square RGBA textures is already 134 MB
// of GPU memory, which is the interesting end of the measurement.
const MAX_TILES_PER_AXIS = 8;
const TILE_PX = 512;

export interface CompositeRegion {
  level: number;
  x0: number;
  y0: number;
  nx: number;
  ny: number;
  /** Geodetic bounds of the whole tile block — the primitive's rectangle. */
  rectangle: Cesium.Rectangle;
  /** Web Mercator y of the block's south and north edges. */
  mercSouth: number;
  mercNorth: number;
  widthPx: number;
  heightPx: number;
}

const tilingScheme = new Cesium.WebMercatorTilingScheme();

// Web Mercator y for a geodetic latitude, in the same units the tiling scheme
// uses. The shader reverses this to turn a linear-in-latitude texture
// coordinate into a row of the mercator composite.
export function mercatorY(latitude: number): number {
  return Math.log(Math.tan(Math.PI / 4 + latitude / 2));
}

export function planRegion(_viewer: Cesium.Viewer, maxLevel: number): CompositeRegion | null {
  // Derive the block from the tiles the imagery path ACTUALLY REQUESTED, not
  // from the camera. Recomputing it from `computeViewRectangle` looks
  // equivalent and is not: during any camera motion it names tiles Cesium has
  // not asked for yet, so the field cache has nothing to stitch and the
  // composite comes back empty. Observed coordinates are cached or on their way.
  const observed = recentTiles();
  if (observed.length === 0) return null;

  // The MOST RECENT request tells us the level currently on screen. The
  // deepest level ever observed is a different thing entirely: a zoom that
  // passed through level 7 on its way somewhere leaves stale level-7
  // coordinates behind, and compositing those stitches tiles the layer has
  // already moved on from.
  return regionAtLevel(observed, Math.min(maxLevel, observed[0].level));
}

// The bounding block of every observed tile at one level.
function regionAtLevel(observed: TileCoord[], level: number): CompositeRegion | null {
  const atLevel = observed.filter((t) => t.level === level);
  if (atLevel.length === 0) return null;

  const xs = atLevel.map((t) => t.x);
  const ys = atLevel.map((t) => t.y);
  const x0 = Math.min(...xs);
  const y0 = Math.min(...ys);
  const nx = Math.max(...xs) - x0 + 1;
  const ny = Math.max(...ys) - y0 + 1;
  // A trail of stale coordinates from a long pan can span more than the cap;
  // decline rather than stitching a block most of which is off screen anyway.
  if (nx > MAX_TILES_PER_AXIS || ny > MAX_TILES_PER_AXIS) return null;

  const block = Cesium.Rectangle.union(
    tilingScheme.tileXYToRectangle(x0, y0, level),
    tilingScheme.tileXYToRectangle(x0 + nx - 1, y0 + ny - 1, level),
    new Cesium.Rectangle()
  );
  if (block.north <= block.south) return null;

  return {
    level,
    x0,
    y0,
    nx,
    ny,
    rectangle: block,
    mercSouth: mercatorY(block.south),
    mercNorth: mercatorY(block.north),
    widthPx: nx * TILE_PX,
    heightPx: ny * TILE_PX,
  };
}

// Pick a region whose tiles are actually DECODED for every frame named.
//
// `planRegion` answers "what is on screen", which is not the same question as
// "what can be measured". The level Cesium most recently requested may have
// nothing in the field cache yet, and stitching that produces an empty mosaic —
// from which optical flow would measure nothing, or worse, invent motion out of
// holes. Walking the observed levels from finest to coarsest finds the deepest
// one that is genuinely ready.
export function planWarmRegion(
  maxLevel: number,
  framePaths: string[],
  minCoverage = 0.6
): CompositeRegion | null {
  const observed = recentTiles();
  if (observed.length === 0 || framePaths.length === 0) return null;

  const levels = [...new Set(observed.map((t) => t.level))]
    .filter((l) => l <= maxLevel)
    .sort((a, b) => b - a);

  for (const level of levels) {
    const region = regionAtLevel(observed, level);
    if (!region) continue;
    let warm = 0;
    let total = 0;
    for (let ty = 0; ty < region.ny; ty++) {
      for (let tx = 0; tx < region.nx; tx++) {
        const suffix = `|${level}/${region.x0 + tx}/${region.y0 + ty}`;
        for (const frame of framePaths) {
          total++;
          if (isTileWarm(frame + suffix)) warm++;
        }
      }
    }
    if (total > 0 && warm / total >= minCoverage) return region;
  }
  return null;
}

export function regionKey(region: CompositeRegion): string {
  return `${region.level}/${region.x0}/${region.y0}/${region.nx}/${region.ny}`;
}

// What fraction of a specific region's tiles are decoded for every frame named.
//
// `planWarmRegion` answers "what is the best region right now", which is the
// wrong question for anything that has already built state around one. It picks
// the DEEPEST warm level, and which level qualifies differs from frame pair to
// frame pair, so asking it afresh each pair makes the answer flip back and
// forth between levels while the camera sits perfectly still. A caller holding
// a region can ask this instead and keep what it has while it still works.
export function regionWarmth(region: CompositeRegion, framePaths: string[]): number {
  if (framePaths.length === 0) return 0;
  let warm = 0;
  let total = 0;
  for (let ty = 0; ty < region.ny; ty++) {
    for (let tx = 0; tx < region.nx; tx++) {
      const suffix = `|${region.level}/${region.x0 + tx}/${region.y0 + ty}`;
      for (const frame of framePaths) {
        total++;
        if (isTileWarm(frame + suffix)) warm++;
      }
    }
  }
  return total > 0 ? warm / total : 0;
}

// Ask every worker for its share of the block and flatten them into one bitmap.
//
// Tiles are hashed across workers by coordinate (so a tile's whole time series
// stays in one worker, which is what Stage C's frame-pair flow needs), which
// means no single worker holds a whole view block. Each returns its own tiles
// with the rest transparent, so plain source-over compositing merges them —
// two GPU blits rather than a per-pixel merge. If this shows up in a profile,
// the fix is a block-aware tile hash, which is a Stage C decision.
export async function buildComposite(
  region: CompositeRegion,
  framePath: string
): Promise<{ bitmap: ImageBitmap; coverage: number }> {
  const parts = await Promise.all(
    Array.from({ length: WORKER_SLOTS }, (_, w) =>
      compositeRegion(w, framePath, region.level, region.x0, region.y0, region.nx, region.ny)
        .result
    )
  );

  const canvas = new OffscreenCanvas(region.widthPx, region.heightPx);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    parts.forEach((p) => p.bitmap.close());
    throw new Error('OffscreenCanvas 2d context unavailable');
  }
  ctx.clearRect(0, 0, region.widthPx, region.heightPx);
  let coverage = 0;
  for (const part of parts) {
    ctx.drawImage(part.bitmap, 0, 0);
    part.bitmap.close();
    // Each worker holds a disjoint subset of the block, so its share of the
    // tiles adds rather than overlaps.
    coverage += part.coverage;
  }
  // transferToImageBitmap keeps row 0 as row 0 — the block's north edge — which
  // is the orientation WeatherMaterial's reprojection expects.
  return { bitmap: canvas.transferToImageBitmap(), coverage: Math.min(1, coverage) };
}
