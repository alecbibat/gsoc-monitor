// Message contract between the main thread and the recolor workers.
//
// Tiles are keyed `${framePath}|${z}/${x}/${y}`. The key is what the worker's
// field cache is indexed by, and the part after the `|` is what the pool hashes
// to decide which worker owns the tile — so a tile always goes to the same
// worker and its decoded field is found there on every later request (palette
// switch, frame revisit, and Stage C's frame-pair flow).

import type { RadarPaletteId } from '../palettes';

export interface TileRequest {
  type: 'tile';
  id: number;
  key: string;
  level: number;
  palette: RadarPaletteId;
  // Omitted when the caller believes the worker already holds this tile's
  // decoded field. The worker answers `miss` if that guess was wrong (the LRU
  // evicted it), and the caller then re-sends with the bytes.
  blob?: Blob;
  // Warming only: decode and cache the field, but skip the palette pass and the
  // ImageBitmap. Prefetch has nothing to draw, and the colorize + encode +
  // transfer is the expensive half.
  warmOnly?: boolean;
}

// Stage B (GPU spike): stitch a rectangular block of cached fields into one
// texture for the draped primitive. Nothing is palettized here — the shader
// does the LUT — so this hands back the raw magnitude/presence pair.
export interface CompositeRequest {
  type: 'composite';
  id: number;
  framePath: string;
  level: number;
  x0: number;
  y0: number;
  nx: number;
  ny: number;
}

// Stage C: a downsampled magnitude mosaic of a tile block, for optical flow.
// Only the magnitude plane — flow tracks where the echo went, and presence is
// the decode pipeline's edge feathering rather than signal.
export interface MosaicRequest {
  type: 'mosaic';
  id: number;
  framePath: string;
  level: number;
  x0: number;
  y0: number;
  nx: number;
  ny: number;
  /** Longest side of the returned plane; LK runs on a few hundred px. */
  maxSide: number;
}

// Stage C: Lucas-Kanade over a pair of mosaics. The planes arrive transferred
// rather than re-derived here, because tiles are hashed across workers and no
// single worker holds a whole region — see `workerFor`.
export interface FlowRequest {
  type: 'flow';
  id: number;
  width: number;
  height: number;
  a: Float32Array;
  b: Float32Array;
  cols: number;
  rows: number;
}

// Stage C: the warp-dissolve. Stitches BOTH frames of a pair over one tile
// block, carries the field along the measured flow to time `t`, and colorizes
// the result — a finished RGBA image for an imagery provider.
//
// This is a region request rather than a per-tile one because the warp pulls
// pixels from where the echo was, which is routinely across a tile boundary.
// A per-tile warp would seam at every edge.
//
// Tiles are hashed to a worker by ZOOM LEVEL, so one worker holds every tile of
// a region for every frame — the stitch, the flow and the warp are all local to
// it and nothing crosses a postMessage but the finished bitmap.
export interface WarpRequest {
  type: 'warp';
  id: number;
  frameA: string;
  frameB: string;
  level: number;
  x0: number;
  y0: number;
  nx: number;
  ny: number;
  /** Position between the frames, 0 = A, 1 = B. */
  t: number;
  palette: RadarPaletteId;
  /** Flow measured A→B on the same region. Null renders the plain dissolve. */
  flow: { cols: number; rows: number; u: Float32Array; v: Float32Array } | null;
  /** Multiplier taking flow from its plane's pixels to composite pixels. */
  flowScale: number;
}

export type RadarWorkerRequest =
  | TileRequest
  | CompositeRequest
  | MosaicRequest
  | FlowRequest
  | WarpRequest
  | { type: 'cancel'; id: number };

export type RadarWorkerResponse =
  // `bitmap` is pre-flipped for WebGL — see colorizeField's flipY note.
  | { type: 'tile'; id: number; key: string; bitmap: ImageBitmap }
  | { type: 'warmed'; id: number; key: string }
  | { type: 'miss'; id: number; key: string }
  | { type: 'error'; id: number; key: string; message: string }
  // `coverage` is the fraction of requested tiles that were actually in cache;
  // the rest are transparent, so the caller can decide whether to wait.
  | { type: 'composited'; id: number; bitmap: ImageBitmap; coverage: number }
  // `coverage` here is over both frames of the pair: a block warm for A but not
  // B cannot be warped, and the caller needs to know that before drawing it.
  | { type: 'warped'; id: number; bitmap: ImageBitmap; coverage: number; ms: number }
  | {
      type: 'mosaic';
      id: number;
      width: number;
      height: number;
      plane: Float32Array;
      coverage: number;
    }
  | {
      type: 'flow';
      id: number;
      cols: number;
      rows: number;
      u: Float32Array;
      v: Float32Array;
      confidence: Float32Array;
      ms: number;
    };
