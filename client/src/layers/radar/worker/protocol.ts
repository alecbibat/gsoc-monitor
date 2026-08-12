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

export type RadarWorkerRequest =
  | TileRequest
  | CompositeRequest
  | { type: 'cancel'; id: number };

export type RadarWorkerResponse =
  // `bitmap` is pre-flipped for WebGL — see colorizeField's flipY note.
  | { type: 'tile'; id: number; key: string; bitmap: ImageBitmap }
  | { type: 'warmed'; id: number; key: string }
  | { type: 'miss'; id: number; key: string }
  | { type: 'error'; id: number; key: string; message: string }
  // `coverage` is the fraction of requested tiles that were actually in cache;
  // the rest are transparent, so the caller can decide whether to wait.
  | { type: 'composited'; id: number; bitmap: ImageBitmap; coverage: number };
