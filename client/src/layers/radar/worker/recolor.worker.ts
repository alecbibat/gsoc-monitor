// Off-main-thread radar tile recoloring.
//
// The main thread fetches tile bytes (so Cesium's request throttling and
// cancellation still govern the network) and hands the blob here; this worker
// owns everything after that — decode, blur, palette LUT, and the ImageBitmap
// handed back for GPU upload. The decoded intensity field is cached, so a
// palette switch is a LUT pass over memory with no network and no decode.

import { getRadarLut } from '../palettes';
import { blurField, colorizeField, decodeField, radarBlurSigma } from '../radarField';
import { computeFlow } from '../flow/lk';
import { FieldCache } from './fieldCache';
import type {
  CompositeRequest,
  FlowRequest,
  MosaicRequest,
  RadarWorkerRequest,
  RadarWorkerResponse,
  TileRequest,
} from './protocol';

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

// RainViewer tiles are 512px square (see TILE_SIZE in RainViewerImagery).
const TILE_PX = 512;

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
// never settles wedges this worker for every tile queued behind it — one bad
// call takes out every tile routed to this worker, not just its own. Bounding
// each decode turns that into a single dropped tile.
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
type QueuedRequest = TileRequest | CompositeRequest | MosaicRequest | FlowRequest;
const queue: QueuedRequest[] = [];
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

  // Warming stops here: the field is cached, which is the whole point, and
  // whoever displays this tile later gets it as a pure LUT pass.
  if (req.warmOnly) {
    post({ type: 'warmed', id, key });
    return;
  }

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

// Stitch a rectangular block of cached fields into one magnitude/presence
// texture for the Stage B primitive. Tiles missing from the cache are left
// transparent rather than fetched: this runs on the render path, and the
// prefetcher is already warming exactly these keys.
async function composite(req: CompositeRequest): Promise<void> {
  const { id, framePath, level, x0, y0, nx, ny } = req;
  const w = nx * TILE_PX;
  const h = ny * TILE_PX;
  const out = new Uint8ClampedArray(new ArrayBuffer(w * h * 4));
  let present = 0;

  for (let ty = 0; ty < ny; ty++) {
    for (let tx = 0; tx < nx; tx++) {
      const field = cache.get(`${framePath}|${level}/${x0 + tx}/${y0 + ty}`);
      if (!field) continue;
      present++;
      const ox = tx * TILE_PX;
      const oy = ty * TILE_PX;
      for (let y = 0; y < field.height; y++) {
        let src = y * field.width;
        let dst = ((oy + y) * w + ox) * 4;
        for (let x = 0; x < field.width; x++, src++, dst += 4) {
          out[dst] = field.mag[src];
          out[dst + 1] = field.presence[src];
          out[dst + 3] = 255;
        }
      }
    }
  }

  if (present === 0) {
    // A composite with nothing in it means the planner and the cache disagree
    // about which tiles exist — worth saying out loud, because the symptom
    // downstream is just "the GPU path draws nothing".
    console.warn(
      `[radar] composite found no cached tiles: wanted ${framePath}|${level}/${x0}/${y0} ` +
        `(${nx}x${ny}); this worker holds ${cache.size} fields`
    );
  }

  // No imageOrientation: row 0 stays row 0, which is the NORTH edge of the tile
  // block. WebGL ignores UNPACK_FLIP_Y for ImageBitmap sources, so texture
  // coordinate t=0 lands on that same north edge — the shader's reprojection
  // assumes exactly that.
  const bitmap = await withTimeout(
    createImageBitmap(new ImageData(out, w, h), { premultiplyAlpha: 'none' }),
    'composite encode'
  );
  if (cancelled.has(id)) {
    bitmap.close();
    return;
  }
  post({ type: 'composited', id, bitmap, coverage: present / (nx * ny) }, [bitmap]);
}

// A downsampled magnitude mosaic of the tiles this worker happens to own.
// Absent tiles stay zero, which is also what empty sky decodes to, so a caller
// merging two workers' partials can simply take the per-pixel maximum.
function mosaic(req: MosaicRequest): void {
  const { id, framePath, level, x0, y0, nx, ny, maxSide } = req;
  // Integer power-of-two reduction, so tile boundaries stay aligned with the
  // output grid and downsampling-then-merging equals merging-then-downsampling.
  let step = 1;
  while (Math.max(nx, ny) * (TILE_PX / step) > maxSide && step < TILE_PX) step *= 2;
  const tilePx = TILE_PX / step;
  const w = nx * tilePx;
  const h = ny * tilePx;
  const plane = new Float32Array(w * h);
  let present = 0;

  for (let ty = 0; ty < ny; ty++) {
    for (let tx = 0; tx < nx; tx++) {
      const field = cache.get(`${framePath}|${level}/${x0 + tx}/${y0 + ty}`);
      if (!field) continue;
      present++;
      const ox = tx * tilePx;
      const oy = ty * tilePx;
      const inv = 1 / (step * step);
      for (let y = 0; y < tilePx; y++) {
        for (let x = 0; x < tilePx; x++) {
          // Box-average the step x step source patch.
          let sum = 0;
          const sy0 = y * step;
          const sx0 = x * step;
          for (let sy = 0; sy < step; sy++) {
            const row = (sy0 + sy) * field.width;
            for (let sx = 0; sx < step; sx++) sum += field.mag[row + sx0 + sx];
          }
          plane[(oy + y) * w + ox + x] = sum * inv;
        }
      }
    }
  }
  post(
    { type: 'mosaic', id, width: w, height: h, plane, coverage: present / (nx * ny) },
    [plane.buffer]
  );
}

function flow(req: FlowRequest): void {
  const started = performance.now();
  const result = computeFlow(
    { width: req.width, height: req.height, data: req.a },
    { width: req.width, height: req.height, data: req.b },
    { cols: req.cols, rows: req.rows }
  );
  post(
    {
      type: 'flow',
      id: req.id,
      cols: result.cols,
      rows: result.rows,
      u: result.u,
      v: result.v,
      confidence: result.confidence,
      ms: Math.round(performance.now() - started),
    },
    [result.u.buffer, result.v.buffer, result.confidence.buffer]
  );
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
        if (req.type === 'composite') await composite(req);
        else if (req.type === 'mosaic') mosaic(req);
        else if (req.type === 'flow') flow(req);
        else await handle(req);
      } catch (err) {
        // A failed recolor degrades to a transparent tile on the main thread —
        // never the raw tile. Scheme-0 bytes are dBZ-encoded grayscale and
        // read as white/gray garbage over the map.
        post({
          type: 'error',
          id: req.id,
          key:
            req.type === 'composite' || req.type === 'mosaic'
              ? req.framePath
              : req.type === 'flow'
                ? 'flow'
                : req.key,
          message: String(err),
        });
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
