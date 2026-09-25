import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodePng } from './pngDecode';
import { decodeRadarRgba, NO_ECHO } from './radarDecode';
import { UB_MIN_DBZ, UB_RAIN_RGBA, UB_SNOW_RGBA } from './rainviewerTable';

// Two real free-tier tiles (z7/67/45: about 45.1–47.0°N, 8.4–11.25°E, over
// Lombardy, Ticino and Graubünden; 2026-09-14 04:30Z and 06:30Z, 256 px,
// `/2/1_1`), as RainViewer served them.
const fixture = (name: string) =>
  new Uint8Array(readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url)));

function tableColor(table: Uint8Array, dbz: number): number[] {
  const k = (dbz - UB_MIN_DBZ) * 4;
  return Array.from(table.subarray(k, k + 4));
}

// An image of `n` pixels: the given ones first, transparent after.
function pixels(px: number[][], n = px.length): Uint8Array {
  const out = new Uint8Array(n * 4);
  px.forEach((p, i) => out.set(p, i * 4));
  return out;
}

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

  it('accepts an off-table opaque colour within 10 per channel (squared distance 300), no further', () => {
    const [r, g, b] = tableColor(UB_RAIN_RGBA, 20);
    const near = decodeRadarRgba(pixels([[r + 10, g + 10, b + 10, 255]]), 1, 1);
    expect(near.dbz[0]).toBe(20);
    expect(near.unknown).toBe(0);
    const far = decodeRadarRgba(pixels([[r + 10, g + 10, b + 11, 255]]), 1, 1); // squared distance 321
    expect(far.unknown).toBe(1);
    expect(far.dbz[0]).toBe(NO_ECHO);
  });

  it('requires a translucent pixel to carry an exact table alpha and a colour near its ramp', () => {
    const tan = tableColor(UB_RAIN_RGBA, 3);
    const alphas = new Set<number>();
    for (const t of [UB_RAIN_RGBA, UB_SNOW_RGBA]) for (let k = 3; k < t.length; k += 4) alphas.add(t[k]);
    let offAlpha = tan[3] + 1;
    while (alphas.has(offAlpha)) offAlpha++;
    const offTable = decodeRadarRgba(pixels([[tan[0], tan[1], tan[2], offAlpha]]), 1, 1);
    expect(offTable.unknown).toBe(1);
    expect(offTable.dbz[0]).toBe(NO_ECHO);
    const foreign = decodeRadarRgba(pixels([[255, 0, 0, tan[3]]]), 1, 1); // red at a rain alpha
    expect(foreign.unknown).toBe(1);
  });

  it("flags RainViewer's grey 'zoom level not supported' tile as a placeholder", () => {
    for (const grey of [160, 240]) {
      const r = decodeRadarRgba(pixels(Array.from({ length: 64 * 64 }, () => [grey, grey, grey, 255])), 64, 64);
      expect(r.placeholder).toBe(true);
      expect(r.echo).toBe(0);
      expect(r.dbz.every((v) => v === NO_ECHO)).toBe(true);
    }
  });

  it('flags a tile whose visible pixels are over 20% off-table, and drops its echo', () => {
    const rain = tableColor(UB_RAIN_RGBA, 30);
    const purple = [128, 0, 128, 255];
    // 10 visible of 10: 2 unknown is within the margin, 3 is not.
    const two = decodeRadarRgba(pixels([...Array(8).fill(rain), purple, purple]), 10, 1);
    expect(two.placeholder).toBe(false);
    expect(two.unknown).toBe(2);
    expect(two.echo).toBe(8);
    expect(two.dbz[0]).toBe(30);
    const three = decodeRadarRgba(pixels([...Array(7).fill(rain), purple, purple, purple]), 10, 1);
    expect(three.placeholder).toBe(true);
    expect(three.echo).toBe(0);
    expect(three.dbz.every((v) => v === NO_ECHO)).toBe(true);
    expect(three.snow.every((v) => v === 0)).toBe(true);
  });

  it('ignores off-table specks covering no more than 5% of the tile', () => {
    const purple = [128, 0, 128, 255];
    expect(decodeRadarRgba(pixels(Array(5).fill(purple), 100), 10, 10).placeholder).toBe(false);
    expect(decodeRadarRgba(pixels(Array(6).fill(purple), 100), 10, 10).placeholder).toBe(true);
  });
});
