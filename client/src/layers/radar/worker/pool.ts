// Main-thread front end for the recolor workers.
//
// The pool deliberately does NOT own the network: the caller supplies a fetch
// thunk so tile bytes still travel through Cesium's RequestScheduler, keeping
// its per-server throttling and cancellation intact. The pool's job is
// routing, the cache hint, and cancelling work that has been superseded.

import type { RadarPaletteId } from '../palettes';
import type { RadarWorkerRequest, RadarWorkerResponse } from './protocol';

const WORKER_COUNT = 2;

// A job that never gets an answer is the worst failure this module has. Cesium
// leaves that tile's imagery in TRANSITIONING forever and never retries it, so
// radar is silently missing there for the rest of the session — and since a
// globe tile is only drawn once SOME imagery layer has data for it, a tile
// where radar is the only layer is not drawn at all. Worker replies do go
// missing in practice (a decode that never settles, a dropped `messageerror`, a
// worker killed under memory pressure), so every job is bounded. On expiry the
// job rejects and the caller degrades to a transparent tile, which Cesium
// treats as loaded, so the tile resolves and rendering continues.
const TILE_TIMEOUT_MS = 15_000;

// Fetches the tile's bytes. `throttled: true` must go through the Request
// Cesium handed us, and therefore returns undefined when the scheduler has no
// free slot for that server — the caller propagates that so Cesium retries the
// tile later. `throttled: false` must always start a request.
export type FetchTileBlob = (throttled: boolean) => Promise<Blob> | undefined;

// Everything the worker path needs. Safari shipped OffscreenCanvas 2D late and
// some embedded browsers still lack it; callers fall back to the synchronous
// main-thread pipeline when this is false.
export function workerPipelineSupported(): boolean {
  return (
    typeof Worker !== 'undefined' &&
    typeof OffscreenCanvas !== 'undefined' &&
    typeof createImageBitmap === 'function' &&
    typeof ImageData !== 'undefined'
  );
}

interface Pending {
  key: string;
  level: number;
  palette: RadarPaletteId;
  worker: number;
  fetchBlob: FetchTileBlob;
  warmOnly: boolean;
  resolve: (bitmap: ImageBitmap | null, coverage?: number) => void;
  /** Set instead of `resolve` for region-scoped replies. */
  resolveRegion?: (msg: RadarWorkerResponse) => void;
  reject: (err: unknown) => void;
  timer: number;
}

// Remove a job from the in-flight set, stopping its watchdog.
function settle(id: number): Pending | undefined {
  const job = pending.get(id);
  if (!job) return undefined;
  clearTimeout(job.timer);
  pending.delete(id);
  return job;
}

let workers: Worker[] | null = null;
const pending = new Map<number, Pending>();
// Optimistic record of which tiles each worker has decoded. Wrong only when
// that worker's LRU has evicted since — which the `miss` reply repairs.
const cached: Array<Set<string>> = [];
let nextId = 1;

function onMessage(e: MessageEvent<RadarWorkerResponse>) {
  const msg = e.data;
  const job = pending.get(msg.id);
  if (!job) {
    // Cancelled between request and reply — close the orphan so its backing
    // store is released now rather than whenever GC gets to it.
    if (msg.type === 'tile') msg.bitmap.close();
    return;
  }

  if (msg.type === 'tile') {
    settle(msg.id);
    cached[job.worker].add(msg.key);
    job.resolve(msg.bitmap);
    return;
  }

  if (msg.type === 'warmed') {
    settle(msg.id);
    cached[job.worker].add(msg.key);
    job.resolve(null);
    return;
  }

  if (msg.type === 'miss') {
    // The cache hint was stale: this worker evicted the field between the hint
    // and the request. Re-fetch UNTHROTTLED — Cesium's slot for this tile was
    // already spent on the request that produced the (wrong) hint, and a
    // second throttled attempt could come back undefined with nothing left to
    // return to a caller that is already holding our promise.
    cached[job.worker].delete(msg.key);
    const blobPromise = job.fetchBlob(false);
    if (!blobPromise) {
      settle(msg.id);
      job.reject(new Error(`radar tile fetch declined on retry: ${msg.key}`));
      return;
    }
    blobPromise.then(
      (blob) => {
        if (!pending.has(msg.id)) return;
        send(job.worker, {
          type: 'tile',
          id: msg.id,
          key: job.key,
          level: job.level,
          palette: job.palette,
          blob,
          warmOnly: job.warmOnly,
        });
      },
      (err) => {
        settle(msg.id);
        job.reject(err);
      }
    );
    return;
  }

  if (msg.type === 'error') {
    settle(msg.id);
    cached[job.worker].delete(msg.key);
    job.reject(new Error(msg.message));
    return;
  }

  // Region-scoped replies (composite, mosaic, flow) are not tiles, so nothing
  // is recorded in the cache hint. They carry a payload rather than a bitmap,
  // so they resolve through a separate channel.
  settle(msg.id);
  job.resolveRegion?.(msg);
}

function ensureWorkers(): Worker[] {
  if (workers) return workers;
  const created: Worker[] = [];
  for (let i = 0; i < WORKER_COUNT; i++) {
    // Options must stay a static literal — Vite parses them at build time to
    // decide how to emit the worker chunk, and rejects anything computed.
    const w = new Worker(new URL('./recolor.worker.ts', import.meta.url), {
      type: 'module',
      name: 'radar-recolor',
    });
    w.onmessage = onMessage;
    w.onerror = (event) => console.error('[radar] recolor worker error', event.message);
    // A reply that fails to deserialize is silently dropped by the platform —
    // the watchdog is what actually rescues those jobs, but log it so the cause
    // is visible rather than looking like a random blank tile.
    w.onmessageerror = () => console.error('[radar] recolor worker reply could not be deserialized');
    created.push(w);
    cached.push(new Set());
  }
  workers = created;
  return created;
}

function send(worker: number, msg: RadarWorkerRequest) {
  ensureWorkers()[worker].postMessage(msg);
}

// Route by tile coordinates ONLY, never by frame: every frame's copy of a
// given tile then lands in the same worker, so that worker holds the whole
// time series for the tile. That is what makes a palette switch a pure cache
// hit, and it is the locality Stage C's frame-pair optical flow needs.
function workerFor(key: string): number {
  const xyz = key.slice(key.lastIndexOf('|') + 1);
  let h = 2166136261;
  for (let i = 0; i < xyz.length; i++) {
    h ^= xyz.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % WORKER_COUNT;
}

export interface TileJob {
  id: number;
  bitmap: Promise<ImageBitmap>;
}

export interface WarmJob {
  id: number;
  done: Promise<void>;
}

// Whether a tile's decoded field is believed to be in a worker already. Only a
// hint (the LRU may have evicted since), which is all the prefetch planner
// needs — a wrong "yes" just means one tile gets fetched at display time.
export function isTileWarm(key: string): boolean {
  return cached[workerFor(key)]?.has(key) ?? false;
}

function submit(
  key: string,
  level: number,
  palette: RadarPaletteId,
  fetchBlob: FetchTileBlob,
  warmOnly: boolean
): { id: number; done: Promise<ImageBitmap | null> } | undefined {
  const worker = workerFor(key);
  ensureWorkers();
  const isCached = cached[worker].has(key);

  // Warming a tile the worker already holds is a no-op — don't even message it.
  if (isCached && warmOnly) return { id: 0, done: Promise.resolve(null) };

  // The fetch must start (or be declined) synchronously, before we hand back a
  // promise, so the declined case can be reported as undefined.
  let blobPromise: Promise<Blob> | undefined;
  if (!isCached) {
    blobPromise = fetchBlob(true);
    if (!blobPromise) return undefined;
  }

  const id = nextId++;
  const done = new Promise<ImageBitmap | null>((resolve, reject) => {
    const timer = setTimeout(() => {
      if (!pending.has(id)) return;
      settle(id);
      // The hint may be what stranded us; drop it so a retry re-sends bytes.
      cached[worker].delete(key);
      reject(new Error(`radar tile timed out after ${TILE_TIMEOUT_MS}ms: ${key}`));
    }, TILE_TIMEOUT_MS) as unknown as number;
    pending.set(id, { key, level, palette, worker, fetchBlob, warmOnly, resolve, reject, timer });
    if (!blobPromise) {
      // Believed cached: a re-LUT with no bytes, no network and no decode.
      send(worker, { type: 'tile', id, key, level, palette, warmOnly });
      return;
    }
    blobPromise.then(
      (blob) => {
        if (!pending.has(id)) return;
        send(worker, { type: 'tile', id, key, level, palette, blob, warmOnly });
      },
      (err) => {
        settle(id);
        reject(err);
      }
    );
  });
  return { id, done };
}

// Recolor one tile for display.
//
// Returns undefined when Cesium's scheduler declined to start the fetch, which
// the caller must propagate out of `requestImage` unchanged — that is how
// Cesium is told to retry the tile later. Rejection means the tile could not be
// produced; callers degrade that to a TRANSPARENT tile, never the raw one.
export function recolorTile(
  key: string,
  level: number,
  palette: RadarPaletteId,
  fetchBlob: FetchTileBlob
): TileJob | undefined {
  const job = submit(key, level, palette, fetchBlob, false);
  if (!job) return undefined;
  return { id: job.id, bitmap: job.done as Promise<ImageBitmap> };
}

// Stage B: stitch a block of already-cached fields into one texture for the
// draped primitive. Purely a cache read — nothing is fetched — so an uncovered
// region simply comes back partly transparent and the caller retries once the
// prefetcher has warmed it.
//
// Routed to the worker that owns the block's NORTH-WEST tile. That worker holds
// only the subset of the block its hash claimed, so coverage is partial by
// construction; both workers are asked and the caller merges. Keeping the whole
// composite in one worker would need the tile hash to be block-aware, which is
// a Stage C decision, not a spike one.
export function compositeRegion(
  worker: number,
  framePath: string,
  level: number,
  x0: number,
  y0: number,
  nx: number,
  ny: number
): { id: number; result: Promise<{ bitmap: ImageBitmap; coverage: number }> } {
  ensureWorkers();
  const id = nextId++;
  const result = new Promise<{ bitmap: ImageBitmap; coverage: number }>((resolve, reject) => {
    const timer = setTimeout(() => {
      if (!pending.has(id)) return;
      settle(id);
      reject(new Error(`radar composite timed out: ${framePath}`));
    }, TILE_TIMEOUT_MS) as unknown as number;
    pending.set(id, {
      key: framePath,
      level,
      palette: 'storm',
      worker,
      fetchBlob: () => undefined,
      warmOnly: false,
      resolve: () => {},
      resolveRegion: (msg) => {
        if (msg.type === 'composited') resolve({ bitmap: msg.bitmap, coverage: msg.coverage });
        else reject(new Error(`unexpected reply for composite: ${msg.type}`));
      },
      reject,
      timer,
    });
    send(worker, { type: 'composite', id, framePath, level, x0, y0, nx, ny });
  });
  return { id, result };
}

export const WORKER_SLOTS = WORKER_COUNT;

// Generic region request. Composite, mosaic and flow all follow the same
// shape — send, await one typed reply, no cache-hint bookkeeping.
function regionRequest<T>(
  worker: number,
  request: (id: number) => RadarWorkerRequest,
  transfer: Transferable[],
  accept: (msg: RadarWorkerResponse) => T | null,
  label: string
): Promise<T> {
  ensureWorkers();
  const id = nextId++;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      if (!pending.has(id)) return;
      settle(id);
      reject(new Error(`radar ${label} timed out`));
    }, TILE_TIMEOUT_MS) as unknown as number;
    pending.set(id, {
      key: label,
      level: 0,
      palette: 'storm',
      worker,
      fetchBlob: () => undefined,
      warmOnly: false,
      resolve: () => {},
      resolveRegion: (msg) => {
        const value = accept(msg);
        if (value === null) reject(new Error(`unexpected reply for ${label}: ${msg.type}`));
        else resolve(value);
      },
      reject,
      timer,
    });
    ensureWorkers()[worker].postMessage(request(id), transfer);
  });
}

export interface MosaicPart {
  width: number;
  height: number;
  plane: Float32Array;
  coverage: number;
}

// One worker's share of a region's magnitude field, downsampled for flow.
export function mosaicPart(
  worker: number,
  framePath: string,
  level: number,
  x0: number,
  y0: number,
  nx: number,
  ny: number,
  maxSide: number
): Promise<MosaicPart> {
  return regionRequest(
    worker,
    (id) => ({ type: 'mosaic', id, framePath, level, x0, y0, nx, ny, maxSide }),
    [],
    (msg) =>
      msg.type === 'mosaic'
        ? { width: msg.width, height: msg.height, plane: msg.plane, coverage: msg.coverage }
        : null,
    'mosaic'
  );
}

export interface FlowResult {
  cols: number;
  rows: number;
  u: Float32Array;
  v: Float32Array;
  confidence: Float32Array;
  ms: number;
}

// Lucas-Kanade over a merged pair of mosaics. The planes are TRANSFERRED, so
// this costs a pointer hand-off rather than a copy, and the caller's arrays are
// detached afterwards.
export function computeFlowInWorker(
  worker: number,
  width: number,
  height: number,
  a: Float32Array,
  b: Float32Array,
  cols: number,
  rows: number
): Promise<FlowResult> {
  return regionRequest(
    worker,
    (id) => ({ type: 'flow', id, width, height, a, b, cols, rows }),
    [a.buffer, b.buffer],
    (msg) =>
      msg.type === 'flow'
        ? {
            cols: msg.cols,
            rows: msg.rows,
            u: msg.u,
            v: msg.v,
            confidence: msg.confidence,
            ms: msg.ms,
          }
        : null,
    'flow'
  );
}

// Decode a tile into the field cache without producing an image. Used by
// prefetch, where nothing is waiting to draw the result.
export function warmTile(
  key: string,
  level: number,
  palette: RadarPaletteId,
  fetchBlob: FetchTileBlob
): WarmJob | undefined {
  const job = submit(key, level, palette, fetchBlob, true);
  if (!job) return undefined;
  return { id: job.id, done: job.done.then(() => undefined) };
}

// Abandon a job. The worker drops it if still queued; a reply that arrives
// anyway is closed by `onMessage`. The job's promise never settles, which is
// what Cesium's cancelled-request path already expects.
export function cancelTile(id: number): void {
  const job = settle(id);
  if (!job) return;
  send(job.worker, { type: 'cancel', id });
}

// Diagnostics: how many tiles each worker is believed to hold.
export function poolCacheHint(): number[] {
  return cached.map((s) => s.size);
}
