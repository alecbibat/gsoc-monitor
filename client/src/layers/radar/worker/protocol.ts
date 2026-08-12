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
}

export type RadarWorkerRequest = TileRequest | { type: 'cancel'; id: number };

export type RadarWorkerResponse =
  // `bitmap` is pre-flipped for WebGL — see colorizeField's flipY note.
  | { type: 'tile'; id: number; key: string; bitmap: ImageBitmap }
  | { type: 'miss'; id: number; key: string }
  | { type: 'error'; id: number; key: string; message: string };
