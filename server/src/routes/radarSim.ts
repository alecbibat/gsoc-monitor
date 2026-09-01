// Synthetic-tile radar simulator (dev only — not mounted in production).
//
// Serves a manifest and tiles in EXACTLY the URL shapes and palettes of the
// real providers, so the client's full radar pipeline — URL construction,
// palette inversion, smoothing, zoom caps, coverage masking, playback —
// exercises unchanged against a deterministic moving storm field. This is how
// the radar can be developed, tested, and screenshotted in sandboxes with no
// egress to the real weather hosts: load the app with `?radarsim=1`.
//
// Faithful behaviors reproduced:
// · IEM-shaped tiles (256px) paint only inside the US coverage boxes and use
//   the real composite_n0q color ramp (dBZ = (index − 65) / 2).
// · RainViewer-shaped tiles (512px) use the served Universal Blue stepped
//   ramp on a coarsened grid, cover the whole world (US included — which is
//   what the client's auto-mode masking must suppress), and above z7 return
//   an unmistakable error tile, mirroring the free tier's "Zoom level is not
//   supported" images.

import { Router } from 'express';
import zlib from 'zlib';

const router = Router();

// ---------------------------------------------------------------------------
// Minimal PNG encoder (RGBA8, no interlace, filter 0).

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crcBuf]);
}

function encodePng(w: number, h: number, rgba: Uint8Array): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0; // filter: none
    raw.set(rgba.subarray(y * w * 4, (y + 1) * w * 4), y * (w * 4 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 6 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// Palettes (mirrors of the client's tables).

// pyIEM composite_n0q ramp: 255 RGB triples, index i+1 ⇒ dBZ = (i − 64) / 2.
const N0Q_RAMP_B64 =
  'hXGPhXKPhnONh3WLh3aLiHeJiXmHiXqHinuFi32Ei36EjH+CjYGAjYKAjoN+j4R8j4V8kId7kYh5kYl5kot3k411lpFTmJRXm5dbnZpgoJ1ko6BopaNtqKZxqql2rax6sK9+srKDt7iMuruQvb6Uv8GZwsSdxMeix8qmys2qzNCv0tS0z9K0ycy0xsm0w8e0wMS0vcG0ub60tru0s7m0sLa0rbO0qrC0pKu0oKi0naW0mqK0l6C0lJ20kZq0lJu1kJi0jJWziJKygIywfImveIaudIOscICrbH2qZ3mpY3aoX3OnW3CmV22kT2eiS2ShR2GgQ16fQVueQ2GiRWimSG+qSnauTX2yT4S2UYu7VpnDWZ/HW6bLXq3PYLTUYrvYZcLcZ8ngatDkb9boaNbXWdazUtaiS9aQQ9Z+PNZtNdZbEdUYEdEXEM0XEMgWEMQWD7wVD7cUDrMUDq8TDqsTDaYSDaISDZ4RDJkRDJUQDJEQC4gPC4QOCoAOCnwNCncNCXMMCW8MCWsLCGYLCGIKCV4JMnMIRn0IW4gHb5IHhJ0GmKgGrbIFwb0F1scE6tIE/+IA/9gA/9MA/84A/8kA/8QA/8AA/7sA/7YA/7EA/6wA/6cA/6IA/5kA/5QA/48A/4oA/4UA/4AA/wAA+AAA8QAA6gAA4wAA1QAAzQAAxgAAvwAAuAAAsQAAqgAAowAAmwAAlAAAjQAAfwAAeAAAcQAA//////X//+r//9///9T//8n//77//7P//53//5L//3X//Gv9+WD69lb380v08EDx7Tbv6ivs5yDp4QvjsgD/rAD8pAD3mwD0kwDviADqgwDoeQDicgDdaQDbBezwBevwBerwBd3gBdzgBdvgBc3QBczQBL3ABLzABLvABK6wBK2wBJ6gBJ2gBJygA46QA42QA4yQA36AA32AA29wA25wA21wAl9gAl5gAk9QAk5QAk1QAj9AAj5AAj1AATAwAS8wASAgAR8gAR4gOme1Oma1OmW1OmS1OmO1OmK1';
const N0Q_RAMP = Buffer.from(N0Q_RAMP_B64, 'base64');

// RainViewer's served Universal Blue steps (color → the dBZ band it paints).
const RV_STEPS: Array<[number, number, number, number]> = [
  // [minDbz, r, g, b]
  [2, 0, 60, 92],
  [7, 0, 71, 104],
  [12, 0, 78, 120],
  [17, 0, 85, 136],
  [22, 0, 98, 149],
  [27, 0, 112, 163],
  [31, 0, 127, 180],
  [35, 255, 238, 0],
  [40, 255, 210, 0],
  [45, 255, 180, 0],
  [49, 255, 150, 0],
  [53, 255, 110, 0],
  [57, 255, 60, 0],
  [61, 230, 0, 0],
  [65, 180, 0, 40],
  [68, 255, 0, 255],
  [70, 255, 255, 255],
];

// Same boxes the client masks with — sim HD tiles paint only inside them.
const US_BOXES: Array<[number, number, number, number]> = [
  [-127.5, 21.5, -66.0, 50.5],
  [-171.5, 52.0, -129.5, 71.5],
  [-160.8, 18.4, -154.5, 22.6],
  [-67.5, 17.5, -64.2, 18.9],
  [144.0, 12.9, 145.3, 14.1],
];

function inUs(lon: number, lat: number): boolean {
  for (const [w, s, e, n] of US_BOXES) if (lon >= w && lon <= e && lat >= s && lat <= n) return true;
  return false;
}

// ---------------------------------------------------------------------------
// The synthetic storm field: a squall line marching across the central US,
// plus clusters in Europe / Japan / Brazil so global coverage reads, all
// drifting deterministically with frame time.

function dbzAt(lon: number, lat: number, tSec: number): number {
  const drift = ((tSec % 43200) / 3600) * 0.9; // ~0.9°/h eastward
  let dbz = 0;
  const cell = (clon: number, clat: number, r: number, peak: number) => {
    const dx = (lon - clon) * Math.cos((lat * Math.PI) / 180);
    const dy = lat - clat;
    const d2 = dx * dx + dy * dy;
    const v = peak * Math.exp(-d2 / (2 * r * r));
    if (v > dbz) dbz = v;
  };

  // Squall line: 7 cells along a SW→NE line over the central US.
  for (let i = 0; i < 7; i++) {
    const s = i / 6;
    cell(
      -103 + drift + s * 6 + Math.sin(s * 9 + tSec / 1200) * 0.5,
      27.5 + s * 13,
      0.45 + 0.35 * Math.abs(Math.sin(s * 7 + 1)),
      50 + 16 * Math.sin(s * 5 + tSec / 1800)
    );
  }
  // Trailing stratiform shield.
  {
    const dx = (lon - (-105.5 + drift)) / 4.5;
    const dy = (lat - 34) / 6.5;
    const v = 24 * Math.exp(-(dx * dx + dy * dy));
    if (v > dbz) dbz = v;
  }
  // Pacific-Northwest light rain.
  cell(-123 + drift * 0.5, 46, 2.2, 22);
  // Europe / Japan / Brazil clusters for the global layer.
  cell(6 + drift, 48.5, 1.1, 42);
  cell(9 + drift, 47, 0.7, 50);
  cell(137 + drift, 35.5, 1.0, 46);
  cell(-54 + drift, -14, 1.3, 44);
  // Fine-scale ripple so smoothing/upsampling quality is visible.
  if (dbz > 4) dbz += 3.5 * Math.sin(lon * 40 + tSec / 700) * Math.sin(lat * 40);
  return dbz;
}

// Web-mercator pixel → lon/lat.
function pixelLonLat(z: number, x: number, y: number, px: number, py: number, size: number) {
  const n = size * 2 ** z;
  const lon = ((x * size + px + 0.5) / n) * 360 - 180;
  const t = Math.PI - (2 * Math.PI * (y * size + py + 0.5)) / n;
  const lat = (Math.atan(Math.sinh(t)) * 180) / Math.PI;
  return { lon, lat };
}

// The animated stack loads tiles for a dozen-plus frame layers at once; a
// naive per-pixel render through one Node process stalls the whole client
// (real providers are parallel CDNs). Two mitigations: dBZ is evaluated on a
// coarse grid and bilinearly interpolated (the field is smooth), and encoded
// tiles are cached — they're deterministic in (kind, frame, z, x, y).
const GRID_STEP = 4;

function sampleGrid(
  z: number,
  x: number,
  y: number,
  size: number,
  t: number
): { grid: Float32Array; gw: number } {
  const gw = size / GRID_STEP + 1;
  const grid = new Float32Array(gw * gw);
  for (let gy = 0; gy < gw; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      const { lon, lat } = pixelLonLat(z, x, y, gx * GRID_STEP, gy * GRID_STEP, size);
      grid[gy * gw + gx] = dbzAt(lon, lat, t);
    }
  }
  return { grid, gw };
}

function gridSample(grid: Float32Array, gw: number, px: number, py: number): number {
  const fx = px / GRID_STEP;
  const fy = py / GRID_STEP;
  const x0 = Math.min(gw - 2, Math.floor(fx));
  const y0 = Math.min(gw - 2, Math.floor(fy));
  const tx = fx - x0;
  const ty = fy - y0;
  const a = grid[y0 * gw + x0];
  const b = grid[y0 * gw + x0 + 1];
  const c = grid[(y0 + 1) * gw + x0];
  const d = grid[(y0 + 1) * gw + x0 + 1];
  return a * (1 - tx) * (1 - ty) + b * tx * (1 - ty) + c * (1 - tx) * ty + d * tx * ty;
}

const tileCache = new Map<string, Buffer>();
const TILE_CACHE_MAX = 600;
function cached(key: string, render: () => Buffer): Buffer {
  const hit = tileCache.get(key);
  if (hit) return hit;
  const buf = render();
  tileCache.set(key, buf);
  if (tileCache.size > TILE_CACHE_MAX) {
    const oldest = tileCache.keys().next().value;
    if (oldest !== undefined) tileCache.delete(oldest);
  }
  return buf;
}

function sendPng(res: import('express').Response, buf: Buffer) {
  res.set('Content-Type', 'image/png');
  res.set('Cache-Control', 'public, max-age=300');
  res.send(buf);
}

// ---------------------------------------------------------------------------
// Manifest — same shape as /api/radar, pointing at the sim tile routes.

const US_INTERVAL = 300;
const GLOBAL_INTERVAL = 600;

router.get('/manifest', (_req, res) => {
  const nowSec = Math.floor(Date.now() / 1000);
  const usLatest = Math.floor((nowSec - 420) / US_INTERVAL) * US_INTERVAL;
  const usFrames: number[] = [];
  for (let i = 23; i >= 0; i--) usFrames.push(usLatest - i * US_INTERVAL);
  const rvLatest = Math.floor((nowSec - 600) / GLOBAL_INTERVAL) * GLOBAL_INTERVAL;
  const rvFrames = [];
  for (let i = 11; i >= 0; i--) {
    const t = rvLatest - i * GLOBAL_INTERVAL;
    rvFrames.push({ time: t, path: `/api/radar-sim/rv/v2/radar/sim-${t}` });
  }
  res.json({
    global: { host: '', frames: rvFrames },
    us: { frames: usFrames, intervalSec: US_INTERVAL, available: true },
    generated: nowSec,
  });
});

// ---------------------------------------------------------------------------
// IEM-shaped tiles: /iem/:stamp/{z}/{x}/{y}.png  (256px, XYZ)

function stampToEpoch(stamp: string): number {
  // YYYYMMDDHHMI, UTC.
  const y = +stamp.slice(0, 4);
  const mo = +stamp.slice(4, 6);
  const d = +stamp.slice(6, 8);
  const h = +stamp.slice(8, 10);
  const mi = +stamp.slice(10, 12);
  return Date.UTC(y, mo - 1, d, h, mi) / 1000;
}

router.get('/iem/:stamp/:z/:x/:y', (req, res) => {
  const z = parseInt(req.params.z, 10);
  const x = parseInt(req.params.x, 10);
  const y = parseInt(req.params.y, 10); // trailing ".png" ignored by parseInt
  const t = stampToEpoch(req.params.stamp);
  if (!Number.isFinite(z) || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(t)) {
    res.status(400).send('bad tile');
    return;
  }
  const SIZE = 256;
  const png = cached(`iem|${req.params.stamp}|${z}/${x}/${y}`, () => {
    const rgba = new Uint8Array(SIZE * SIZE * 4);
    const { grid, gw } = sampleGrid(z, x, y, SIZE, t);
    for (let py = 0; py < SIZE; py++) {
      for (let px = 0; px < SIZE; px++) {
        const { lon, lat } = pixelLonLat(z, x, y, px, py, SIZE);
        if (!inUs(lon, lat)) continue;
        const dbz = gridSample(grid, gw, px, py);
        if (dbz < 1) continue;
        const idx = Math.max(1, Math.min(255, Math.round(2 * dbz + 65)));
        const o = (py * SIZE + px) * 4;
        rgba[o] = N0Q_RAMP[(idx - 1) * 3];
        rgba[o + 1] = N0Q_RAMP[(idx - 1) * 3 + 1];
        rgba[o + 2] = N0Q_RAMP[(idx - 1) * 3 + 2];
        rgba[o + 3] = 255;
      }
    }
    return encodePng(SIZE, SIZE, rgba);
  });
  sendPng(res, png);
});

// ---------------------------------------------------------------------------
// RainViewer-shaped tiles: /rv/v2/radar/:frame/512/{z}/{x}/{y}/{color}/{opts}.png

router.get('/rv/v2/radar/:frame/512/:z/:x/:y/:color/:opts', (req, res) => {
  const z = parseInt(req.params.z, 10);
  const x = parseInt(req.params.x, 10);
  const y = parseInt(req.params.y, 10);
  const t = parseInt(req.params.frame.replace(/^sim-/, ''), 10);
  if (!Number.isFinite(z) || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(t)) {
    res.status(400).send('bad tile');
    return;
  }
  const SIZE = 512;
  const png = cached(`rv|${t}|${z}/${x}/${y}`, () => {
    const rgba = new Uint8Array(SIZE * SIZE * 4);

    if (z > 7) {
      // The real free tier serves "Zoom level is not supported" imagery here.
      // Reproduce as an unmissable striped error tile: if this ever shows up
      // on the globe, the client's zoom cap has regressed.
      for (let py = 0; py < SIZE; py++) {
        for (let px = 0; px < SIZE; px++) {
          const o = (py * SIZE + px) * 4;
          const stripe = ((px + py) >> 5) % 2 === 0;
          rgba[o] = stripe ? 255 : 40;
          rgba[o + 1] = 0;
          rgba[o + 2] = stripe ? 90 : 40;
          rgba[o + 3] = 255;
        }
      }
      return encodePng(SIZE, SIZE, rgba);
    }

    // The real product is a coarse composite — quantize sampling so the
    // source looks blocky and the client's smoothing has real work to do.
    const COARSE = 0.06; // degrees
    const { grid, gw } = sampleGrid(z, x, y, SIZE, t);
    for (let py = 0; py < SIZE; py++) {
      for (let px = 0; px < SIZE; px++) {
        const { lon, lat } = pixelLonLat(z, x, y, px, py, SIZE);
        // Snap the *sample position* to the coarse grid for blockiness.
        const n = SIZE * 2 ** z;
        const qpx = px - ((lon - Math.round(lon / COARSE) * COARSE) / 360) * n;
        const dbz = gridSample(grid, gw, Math.max(0, Math.min(SIZE - 1, qpx)), py);
        if (dbz < 2) continue;
        let step = RV_STEPS[0];
        for (const s of RV_STEPS) if (dbz >= s[0]) step = s;
        const o = (py * SIZE + px) * 4;
        rgba[o] = step[1];
        rgba[o + 1] = step[2];
        rgba[o + 2] = step[3];
        // Feathered edges like the real tiles.
        rgba[o + 3] = Math.max(0, Math.min(255, Math.round((dbz - 2) * 80)));
      }
    }
    return encodePng(SIZE, SIZE, rgba);
  });
  sendPng(res, png);
});

export default router;
