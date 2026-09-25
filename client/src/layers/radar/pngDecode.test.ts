import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { encodePng } from './__fixtures__/encodePng';
import { decodePng } from './pngDecode';

const fixture = (name: string) =>
  new Uint8Array(readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url)));

const rgba = async (png: Uint8Array) => Array.from((await decodePng(png)).data);

describe('decodePng', () => {
  it('decodes a real RainViewer tile', async () => {
    const img = await decodePng(fixture('rainviewer-z7-67-45-0430Z.png'));
    expect(img.width).toBe(256);
    expect(img.height).toBe(256);
    expect(img.data.length).toBe(256 * 256 * 4);
  });

  it('round-trips RGBA through every filter type', async () => {
    // Neighbours chosen so Paeth picks left, up and up-left at least once each;
    // with smoother rows it degenerates to Sub/Up and a broken predictor passes.
    const rows = [
      [50, 20, 30, 255, 10, 20, 50, 128],
      [100, 200, 30, 255, 200, 101, 50, 128],
      [20, 20, 30, 255, 200, 102, 50, 128],
    ].map((r) => new Uint8Array(r));
    for (const filter of [0, 1, 2, 3, 4] as const) {
      expect(await rgba(encodePng(2, 3, 6, rows, { filter }))).toEqual(rows.flatMap((r) => Array.from(r)));
    }
  });

  it('expands 4-bit palette images with transparency', async () => {
    const plte = new Uint8Array([160, 160, 160, 90, 90, 90]);
    const trns = new Uint8Array([255, 0]);
    // 3 pixels: 0, 1, 0 → packed nibbles 0x01, 0x00
    const png = encodePng(3, 1, 3, [new Uint8Array([0x01, 0x00])], { bitDepth: 4, plte, trns });
    expect(await rgba(png)).toEqual([160, 160, 160, 255, 90, 90, 90, 0, 160, 160, 160, 255]);
  });

  it('makes the tRNS key colour of a greyscale image transparent', async () => {
    const png = encodePng(3, 1, 0, [new Uint8Array([7, 200, 7])], { trns: new Uint8Array([0, 7]) });
    expect(await rgba(png)).toEqual([7, 7, 7, 0, 200, 200, 200, 255, 7, 7, 7, 0]);
  });

  it('scales sub-byte greyscale to 8 bits and keys tRNS on the raw sample', async () => {
    // 2-bit samples 0, 1, 2, 3 → one byte 0b00_01_10_11; sample 2 is the key.
    const png = encodePng(4, 1, 0, [new Uint8Array([0x1b])], { bitDepth: 2, trns: new Uint8Array([0, 2]) });
    expect(await rgba(png)).toEqual([0, 0, 0, 255, 85, 85, 85, 255, 170, 170, 170, 0, 255, 255, 255, 255]);
  });

  it('makes only the exact tRNS key colour of an RGB image transparent', async () => {
    // The key is three 16-bit samples; an 8-bit image uses their low bytes.
    const trns = new Uint8Array([0, 10, 0, 20, 0, 30]);
    const png = encodePng(3, 1, 2, [new Uint8Array([10, 20, 30, 10, 20, 31, 10, 20, 30])], { trns });
    expect(await rgba(png)).toEqual([10, 20, 30, 0, 10, 20, 31, 255, 10, 20, 30, 0]);
  });

  it('keeps RGB and greyscale opaque without tRNS, and expands grey + alpha', async () => {
    expect(await rgba(encodePng(1, 1, 2, [new Uint8Array([1, 2, 3])]))).toEqual([1, 2, 3, 255]);
    expect(await rgba(encodePng(1, 1, 0, [new Uint8Array([0])]))).toEqual([0, 0, 0, 255]);
    expect(await rgba(encodePng(1, 1, 4, [new Uint8Array([50, 128])]))).toEqual([50, 50, 50, 128]);
  });

  it('rejects non-PNG and truncated input', async () => {
    await expect(decodePng(new Uint8Array([1, 2, 3]))).rejects.toThrow();
    const png = fixture('rainviewer-z7-67-45-0630Z.png');
    await expect(decodePng(png.subarray(0, 200))).rejects.toThrow();
  });

  it('refuses what it cannot decode exactly, so the caller falls back to the browser', async () => {
    const row = new Uint8Array([1, 2, 3, 4]);
    await expect(decodePng(encodePng(1, 1, 6, [row], { interlace: true }))).rejects.toThrow(/interlaced/);
    await expect(decodePng(encodePng(1, 1, 6, [new Uint8Array(8)], { bitDepth: 16 }))).rejects.toThrow(/bit depth/);
    await expect(decodePng(encodePng(1, 1, 3, [new Uint8Array([0])]))).rejects.toThrow(/PLTE/);
  });
});
