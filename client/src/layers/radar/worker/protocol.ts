// Message contract between the main thread and the recolor workers.
//
// Tiles are keyed `${framePath}|${z}/${x}/${y}`. The key is what the worker's
// field cache is indexed by, and the part after the `|` is what the pool hashes
// to decide which worker owns the tile — so a tile always goes to the same
// worker and its decoded field is found there on every later request (palette
// switch, frame revisit, and Stage C's frame-pair flow).

import type { RadarPaletteId } from '../palettes';

// A flow grid as it crosses a postMessage.
//
// `confidence` is NOT optional, and is not decoration. The nowcast densifies the
// field before advecting — spreading measured vectors into the empty sky ahead,
// weighted by confidence — so a grid that arrives without it produces NaN for
// every vector, and NaN back-trajectories render an entirely EMPTY forecast.
// Nothing throws and nothing logs; the forecast simply is not there.
export interface FlowGrid {
  cols: number;
  rows: number;
  u: Float32Array;
  v: Float32Array;
  confidence: Float32Array;
  /**
   * Stable identity for this field — the flow cache's own key.
   *
   * The warp and the nowcast expand the coarse grid to full resolution and
   * cache the result, because that expansion is a bilinear sample per output
   * pixel and would otherwise run on every rendered frame. That cache used to
   * key on OBJECT IDENTITY, which can never hit here: postMessage structured-
   * clones, so every message deserializes a brand new object and the worker
   * re-expanded a million-pixel field for every single frame it drew.
   */
  key: string;
}

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
  flow: FlowGrid | null;
  /** Multiplier taking flow from its plane's pixels to composite pixels. */
  flowScale: number;
}

// Stage C PR 8: the advection nowcast. Stitches ONE observed frame over a tile
// block and carries it forward along the flow to a lead time, then colorizes.
//
// Structurally the warp's sibling — same block, same flow, same worker chosen by
// zoom level — but with one source frame instead of two, because there is no
// second frame to interpolate toward. That is the whole difference between
// showing what happened and guessing what will.
export interface NowcastRequest {
  type: 'nowcast';
  id: number;
  /** The observed frame to carry forward — always the newest one. */
  frame: string;
  level: number;
  x0: number;
  y0: number;
  nx: number;
  ny: number;
  /** Lead time as a multiple of the flow's own interval. */
  lead: number;
  /** Intensity multiplier for this lead — see forecastDecay. */
  decay: number;
  palette: RadarPaletteId;
  /**
   * Flow measured over the same region. Null produces persistence in place,
   * which is a legitimate (if dull) forecast: no measurable motion, no
   * predicted movement.
   */
  flow: FlowGrid | null;
  flowScale: number;
}

export type RadarWorkerRequest =
  | TileRequest
  | CompositeRequest
  | MosaicRequest
  | FlowRequest
  | WarpRequest
  | NowcastRequest
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
  // `coverage` is over the single source frame — a forecast needs only the
  // frame it is carrying forward, not a pair.
  | { type: 'nowcasted'; id: number; bitmap: ImageBitmap; coverage: number; ms: number }
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
