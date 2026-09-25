import zlib from 'zlib';
import { describe, expect, it } from 'vitest';
import { CorruptRowError, decodeRow, encodeRow } from './codec';
import { SEG_CAP } from './constants';
import { packStrikes, unpackStrikes } from './legacyCodec';
import { QMAX } from './quant';
import { TOFF_LIMIT, packHi, packLo } from './store';
import { prng } from './testkit';

function words(n: number, seed = 1): Uint32Array {
  const rnd = prng(seed);
  const w = new Uint32Array(2 * n);
  for (let i = 0; i < n; i++) {
    const tOff = i === 0 ? TOFF_LIMIT - 1 : Math.floor(rnd() * TOFF_LIMIT);
    w[2 * i] = packLo(i === 1 ? QMAX : Math.floor(rnd() * QMAX), tOff);
    w[2 * i + 1] = packHi(Math.floor(rnd() * QMAX), tOff);
  }
  return w;
}

describe('row codec', () => {
  it.each([0, 1, 7, SEG_CAP])('round-trips n = %i', (n) => {
    const w = words(n);
    const data = encodeRow(w, 0, n);
    expect(zlib.gunzipSync(data)[0]).toBe(1); // header: fmt 1
    expect(Array.from(decodeRow(data, n))).toEqual(Array.from(w));
  });

  it('encodes a sub-range [from, to) of a segment', () => {
    const w = words(100, 3);
    expect(Array.from(decodeRow(encodeRow(w, 40, 75), 35))).toEqual(Array.from(w.subarray(80, 150)));
  });

  it('byte shuffling pays: a storm-like row compresses well below 8 bytes a record', () => {
    const n = 6000;
    const w = new Uint32Array(2 * n);
    const rnd = prng(9);
    for (let i = 0; i < n; i++) {
      const tOff = 10_800_000 + i * 1; // ~one strike every 10 ms
      w[2 * i] = packLo(700_000 + Math.floor(rnd() * 3000), tOff);
      w[2 * i + 1] = packHi(250_000 + Math.floor(rnd() * 3000), tOff);
    }
    expect(encodeRow(w, 0, n).length / n).toBeLessThan(5);
  });

  it('detects corruption instead of loading garbage', () => {
    const w = words(50, 5);
    const good = encodeRow(w, 0, 50);
    expect(() => decodeRow(good, 49)).toThrow(CorruptRowError); // wrong n → wrong length
    expect(() => decodeRow(good, 51)).toThrow(CorruptRowError);
    expect(() => decodeRow(good.subarray(0, good.length - 8), 50)).toThrow(CorruptRowError); // truncated gzip
    expect(() => decodeRow(Buffer.from('not gzip at all'), 50)).toThrow(CorruptRowError);
    const raw = zlib.gunzipSync(good);
    raw[0] = 2; // unknown format
    expect(() => decodeRow(zlib.gzipSync(raw), 50)).toThrow(CorruptRowError);
    expect(() => decodeRow(good, -1)).toThrow(CorruptRowError);
    expect(() => decodeRow(good, 1.5)).toThrow(CorruptRowError);
  });
});

describe('legacy chunk codec', () => {
  it('round-trips (float32 coordinates, whole seconds)', () => {
    const lat = [35.12345, -33.8688, 0];
    const lon = [-97.54321, 151.2093, 179.99];
    const tMs = [1_790_210_000_123, 1_790_210_001_600, 1_790_210_002_000];
    const out = unpackStrikes(packStrikes(lat, lon, tMs), 3);
    expect(Array.from(out.lat)).toEqual(lat.map(Math.fround));
    expect(Array.from(out.lon)).toEqual(lon.map(Math.fround));
    expect(Array.from(out.tMs)).toEqual([1_790_210_000_000, 1_790_210_002_000, 1_790_210_002_000]);
    expect(() => unpackStrikes(packStrikes(lat, lon, tMs), 4)).toThrow(/too short/);
  });
});
