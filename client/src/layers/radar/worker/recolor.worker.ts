// Off-main-thread radar tile recoloring.
//
// The main thread fetches tile bytes (so Cesium's request throttling and
// cancellation still govern the network) and hands the blob here; this worker
// owns everything after that — decode, blur, palette LUT, and the ImageBitmap
// handed back for GPU upload. The decoded intensity field is cached, so a
// palette switch is a LUT pass over memory with no network and no decode.

import { getRadarLut } from '../palettes';
import { blurField, colorizeField, decodeField, radarBlurSigma } from '../radarField';
import { FieldCache } from './fieldCache';
import type { RadarWorkerRequest, RadarWorkerResponse, TileRequest } from './protocol';

// The client tsconfig loads the DOM lib, not WebWorker (one program, one
// config), so the worker global is declared here with just the surface this
// file uses. A module-scoped declaration shadows DOM's `self`.
declare const self: {
  onmessage: ((e: MessageEvent<RadarWorkerRequest>) => void) | null;
  postMessage(message: RadarWorkerResponse, transfer: Transferable[]): void;
};

// Field cache budget. Each 512² field is 2 planes × 256 KB = 512 KB, so the
// default holds ~120 tiles per worker. Low-memory devices get half — the
// budget is per worker and the pool spawns two, so the totals are 120 MB and
// 60 MB respectively.
const deviceMemory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
const BUDGET_BYTES = (deviceMemory && deviceMemory <= 4 ? 30 : 60) * 1024 * 1024;
const cache = new FieldCache(BUDGET_BYTES);

// One canvas, resized on demand, reused for every decode. The worker handles
// one tile at a time (see the queue below), so sharing it is safe.
let decodeCanvas: OffscreenCanvas | null = null;
let decodeCtx: OffscreenCanvasRenderingContext2D | null = null;
function decodeContext(w: number, h: number): OffscreenCanvasRenderingContext2D {
  if (!decodeCanvas || decodeCanvas.width !== w || decodeCanvas.height !== h) {
    decodeCanvas = new OffscreenCanvas(w, h);
    decodeCtx = decodeCanvas.getContext('2d', { willReadFrequently: true });
  }
  if (!decodeCtx) throw new Error('OffscreenCanvas 2d context unavailable');
  return decodeCtx;
}

// Backed by an explicit ArrayBuffer so the type is the non-shared one
// `ImageData` requires.
let outBuffer: Uint8ClampedArray<ArrayBuffer> | null = null;
function outputBuffer(n: number): Uint8ClampedArray<ArrayBuffer> {
  // Safe to reuse: `createImageBitmap` is awaited before the next tile starts,
  // and the resolved bitmap owns its own copy of the pixels.
  if (!outBuffer || outBuffer.length !== n) outBuffer = new Uint8ClampedArray(new ArrayBuffer(n));
  return outBuffer;
}

function post(msg: RadarWorkerResponse, transfer?: Transferable[]) {
  self.postMessage(msg, transfer ?? []);
}

// Tiles are processed one at a time (see the queue below), so a decode that
// never settles would wedge this worker for every tile behind it — and since
// Cesium will not render a globe tile until every layer's imagery for it is
// ready, that shows up as a permanently blank globe rather than one missing
// tile. Bounding each decode turns that into a single dropped tile.
const DECODE_TIMEOUT_MS = 8_000;

function withTimeout(work: Promise<ImageBitmap>, what: string): Promise<ImageBitmap> {
  return new Promise<ImageBitmap>((resolve, reject) => {
    const timer = setTimeout(() => {
      // If the decode does finish later, release it rather than leak it.
      work.then((b) => b.close()).catch(() => {});
      reject(new Error(`${what} timed out after ${DECODE_TIMEOUT_MS}ms`));
    }, DECODE_TIMEOUT_MS);
    work.then(
      (b) => {
        clearTimeout(timer);
        resolve(b);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

// Requests queue and run one at a time. Serializing keeps peak memory to a
// single tile's intermediates and makes cancellation meaningful: a superseded
// frame's queued tiles are dropped before they ever cost anything.
const queue: TileRequest[] = [];
// Ids accepted and not yet answered, and the subset of those the caller has
// since given up on. Tracking `pending` keeps `cancelled` from accumulating
// cancels that arrive after their tile already finished.
const pending = new Set<number>();
const cancelled = new Set<number>();
let draining = false;

async function handle(req: TileRequest): Promise<void> {
  const { id, key, level, palette } = req;

  let field = cache.get(key);
  if (!field) {
    if (!req.blob) {
      // The caller thought we had this field; the LRU says otherwise. It will
      // re-send with bytes.
      post({ type: 'miss', id, key });
      return;
    }
    const bitmap = await withTimeout(
      createImageBitmap(req.blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' }),
      'tile decode'
    );
    if (cancelled.has(id)) {
      bitmap.close();
      return;
    }
    const w = bitmap.width;
    const h = bitmap.height;
    const ctx = decodeContext(w, h);
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    field = blurField(decodeField(ctx.getImageData(0, 0, w, h).data, w, h), radarBlurSigma(level));
    cache.set(key, field);
  }

  if (cancelled.has(id)) return;

  const { width: w, height: h } = field;
  const out = outputBuffer(w * h * 4);
  colorizeField(field, getRadarLut(palette), out, true);
  // premultiplyAlpha 'none' and no imageOrientation, matching how Cesium
  // decodes the imagery it fetches itself. The flip is already baked into
  // `out` by colorizeField.
  const tile = await withTimeout(
    createImageBitmap(new ImageData(out, w, h), { premultiplyAlpha: 'none' }),
    'tile encode'
  );
  if (cancelled.has(id)) {
    tile.close();
    return;
  }
  post({ type: 'tile', id, key, bitmap: tile }, [tile]);
}

async function drain(): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    while (queue.length > 0) {
      const req = queue.shift()!;
      if (cancelled.has(req.id)) {
        cancelled.delete(req.id);
        pending.delete(req.id);
        continue;
      }
      try {
        await handle(req);
      } catch (err) {
        // A failed recolor degrades to a transparent tile on the main thread —
        // never the raw tile. Scheme-0 bytes are dBZ-encoded grayscale and
        // read as white/gray garbage over the map.
        post({ type: 'error', id: req.id, key: req.key, message: String(err) });
      } finally {
        cancelled.delete(req.id);
        pending.delete(req.id);
      }
    }
  } finally {
    draining = false;
  }
}

self.onmessage = (e: MessageEvent<RadarWorkerRequest>) => {
  const msg = e.data;
  if (msg.type === 'cancel') {
    if (pending.has(msg.id)) cancelled.add(msg.id);
    return;
  }
  pending.add(msg.id);
  queue.push(msg);
  void drain();
};
