import { readFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { decodePng } from './pngDecode';
import { decodeRadarRgba, NO_ECHO } from './radarDecode';
import { UB_MIN_DBZ, UB_RAIN_RGBA, UB_SNOW_RGBA } from './rainviewerTable';

// Two real free-tier tiles (z7/67/45 over Tirol, 2026-09-14 04:30Z and
// 06:30Z, 256 px, `/2/1_1`), as RainViewer served them.
const fixture = (name: string) =>
  new Uint8Array(readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url)));

// Encode an RGBA (colour type 6) or palette (type 3) PNG for decoder tests.
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
function encodePng(
  w: number,
  h: number,
  colorType: 6 | 3,
  rows: Uint8Array[],
  opts: { bitDepth?: number; plte?: Uint8Array; trns?: Uint8Array; filter?: number } = {}
): Uint8Array {
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w);
  dv.setUint32(4, h);
  ihdr[8] = opts.bitDepth ?? 8;
  ihdr[9] = colorType;
  const raw: number[] = [];
  const bpp = colorType === 6 ? 4 : 1;
  rows.forEach((row, y) => {
    const f = opts.filter ?? 0;
    raw.push(f);
    for (let x = 0; x < row.length; x++) {
      const a = x >= bpp ? row[x - bpp] : 0;
      const b = y > 0 ? rows[y - 1][x] : 0;
      const pred = f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : 0;
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
  const total = parts.reduce((s, p) => s + p.length, 0);
  const png = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    png.set(p, o);
    o += p.length;
  }
  return png;
}

function tableColor(table: Uint8Array, dbz: number): number[] {
  const k = (dbz - UB_MIN_DBZ) * 4;
  return Array.from(table.subarray(k, k + 4));
}

describe('decodePng', () => {
  it('decodes a real RainViewer tile exactly', async () => {
    const img = await decodePng(fixture('rainviewer-z7-67-45-0430Z.png'));
    expect(img.width).toBe(256);
    expect(img.height).toBe(256);
    expect(img.data.length).toBe(256 * 256 * 4);
  });

  it('round-trips RGBA through every filter type', async () => {
    const rows = [0, 1, 2].map((y) => new Uint8Array([10 * y, 20, 30, 255, 200, 100 + y, 50, 128]));
    for (const filter of [0, 1, 2, 3]) {
      const img = await decodePng(encodePng(2, 3, 6, rows, { filter }));
      expect(Array.from(img.data)).toEqual(rows.flatMap((r) => Array.from(r)));
    }
  });

  it('expands 4-bit palette images with transparency', async () => {
    const plte = new Uint8Array([160, 160, 160, 90, 90, 90]);
    const trns = new Uint8Array([255, 0]);
    // 3 pixels: 0, 1, 0 → packed nibbles 0x01, 0x00
    const img = await decodePng(encodePng(3, 1, 3, [new Uint8Array([0x01, 0x00])], { bitDepth: 4, plte, trns }));
    expect(Array.from(img.data)).toEqual([160, 160, 160, 255, 90, 90, 90, 0, 160, 160, 160, 255]);
  });

  it('rejects non-PNG and truncated input', async () => {
    await expect(decodePng(new Uint8Array([1, 2, 3]))).rejects.toThrow();
    const png = fixture('rainviewer-z7-67-45-0630Z.png');
    await expect(decodePng(png.subarray(0, 200))).rejects.toThrow();
  });
});

describe('decodeRadarRgba', () => {
  it('matches every echo pixel of real tiles to the table', async () => {
    for (const name of ['rainviewer-z7-67-45-0430Z.png', 'rainviewer-z7-67-45-0630Z.png']) {
      const img = await decodePng(fixture(name));
      const r = decodeRadarRgba(img.data, img.width, img.height);
      expect(r.unknown).toBe(0);
      expect(r.placeholder).toBe(false);
      expect(r.echo).toBeGreaterThan(1000);
      let max = -99;
      for (const v of r.dbz) if (v !== NO_ECHO) max = Math.max(max, v);
      expect(max).toBeGreaterThanOrEqual(25);
      expect(max).toBeLessThanOrEqual(43);
    }
  });

  it('decodes opaque rain, translucent rain, and snow by the table', () => {
    const px = [
      tableColor(UB_RAIN_RGBA, 20), // opaque rain
      tableColor(UB_RAIN_RGBA, 40),
      tableColor(UB_RAIN_RGBA, 3), // translucent tan
      tableColor(UB_SNOW_RGBA, 30), // opaque snow
      tableColor(UB_SNOW_RGBA, 2), // translucent snow
      [0, 0, 0, 0],
    ];
    const r = decodeRadarRgba(new Uint8Array(px.flat()), px.length, 1);
    expect(Array.from(r.dbz)).toEqual([20, 40, 3, 30, 2, NO_ECHO]);
    expect(Array.from(r.snow)).toEqual([0, 0, 0, 1, 1, 0]);
  });

  it('decodes translucent pixels by alpha even when RGB drifted', () => {
    const c = tableColor(UB_RAIN_RGBA, 8);
    const drifted = [c[0] + 2, c[1] - 1, c[2] + 1, c[3]]; // canvas premultiply rounding
    const r = decodeRadarRgba(new Uint8Array(drifted), 1, 1);
    expect(r.dbz[0]).toBe(8);
  });

  it('clamps the sentinel top colour and keeps white at its first dBZ', () => {
    const px = [tableColor(UB_RAIN_RGBA, 80), tableColor(UB_RAIN_RGBA, 70)];
    const r = decodeRadarRgba(new Uint8Array(px.flat()), 2, 1);
    expect(r.dbz[0]).toBe(75);
    expect(r.dbz[1]).toBe(65);
  });

  it("flags RainViewer's grey 'zoom level not supported' tile as a placeholder", () => {
    const n = 64 * 64;
    const rgba = new Uint8Array(n * 4);
    for (let i = 0; i < n; i++) rgba.set([160, 160, 160, 255], i * 4);
    const r = decodeRadarRgba(rgba, 64, 64);
    expect(r.placeholder).toBe(true);
    expect(r.echo).toBe(0);
    expect(r.dbz.every((v) => v === NO_ECHO)).toBe(true);
  });
});
