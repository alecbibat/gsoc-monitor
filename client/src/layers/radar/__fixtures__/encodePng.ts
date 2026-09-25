import { deflateSync } from 'node:zlib';

// Tiny PNG encoder for decoder and pipeline tests. Rows are raw scanlines
// (already packed for sub-byte depths); every row uses the same filter.

function crc32(buf: Uint8Array): number {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return ~c >>> 0;
}

function chunk(type: string, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + body.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, body.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(body, 8);
  dv.setUint32(8 + body.length, crc32(out.subarray(4, 8 + body.length)));
  return out;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

export interface EncodeOptions {
  bitDepth?: number;
  plte?: Uint8Array;
  trns?: Uint8Array;
  filter?: 0 | 1 | 2 | 3 | 4;
  interlace?: boolean; // only flags IHDR: the data stays sequential
}

export function encodePng(
  w: number,
  h: number,
  colorType: 0 | 2 | 3 | 4 | 6,
  rows: Uint8Array[],
  opts: EncodeOptions = {}
): Uint8Array {
  const bitDepth = opts.bitDepth ?? 8;
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w);
  dv.setUint32(4, h);
  ihdr[8] = bitDepth;
  ihdr[9] = colorType;
  ihdr[12] = opts.interlace ? 1 : 0;
  const bpp = Math.max(1, (CHANNELS[colorType] * bitDepth) >> 3);
  const f = opts.filter ?? 0;
  const raw: number[] = [];
  rows.forEach((row, y) => {
    raw.push(f);
    for (let x = 0; x < row.length; x++) {
      const a = x >= bpp ? row[x - bpp] : 0;
      const b = y > 0 ? rows[y - 1][x] : 0;
      const c = x >= bpp && y > 0 ? rows[y - 1][x - bpp] : 0;
      const pred = f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : f === 4 ? paeth(a, b, c) : 0;
      raw.push((row[x] - pred) & 0xff);
    }
  });
  const parts = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    ...(opts.plte ? [chunk('PLTE', opts.plte)] : []),
    ...(opts.trns ? [chunk('tRNS', opts.trns)] : []),
    chunk('IDAT', new Uint8Array(deflateSync(new Uint8Array(raw)))),
    chunk('IEND', new Uint8Array(0)),
  ];
  const png = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) {
    png.set(p, o);
    o += p.length;
  }
  return png;
}

// A w×h RGBA image filled with one colour.
export function solidRgbaPng(w: number, h: number, rgba: [number, number, number, number]): Uint8Array {
  const row = new Uint8Array(w * 4);
  for (let x = 0; x < w; x++) row.set(rgba, x * 4);
  return encodePng(w, h, 6, Array.from({ length: h }, () => row));
}
