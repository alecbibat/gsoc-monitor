import { describe, expect, it } from 'vitest';
import {
  QMAX,
  decodeMarks,
  dqLat,
  dqLon,
  parseFrame,
  parseStrikeTime,
  qLat,
  qLon,
  strikeKey,
  tickOf,
} from './strikeKey';

// Golden vectors — server/src/lightning/quant.test.ts pins the same rows. If
// either side changes, both tests must change (live/history dedupe depends on it).
const RECV_MS = 1790210000500;
const GOLDEN = [
  { lat: 35.12345, lon: -97.54321, time: 1790210000123456789, tick: 179021000012, latQ: 728896, lonQ: 240173 },
  { lat: -90, lon: -180, time: 1790210000000000000, tick: 179021000000, latQ: 0, lonQ: 0 },
  { lat: 90, lon: 180, time: 1790210059999000000, tick: 179021005999, latQ: 1048575, lonQ: 1048575 },
  { lat: 0, lon: 0, time: 1790210012345000000, tick: 179021001234, latQ: 524288, lonQ: 524288 },
  { lat: -33.8688, lon: 151.2093, time: 1790209999000000000, tick: 179020999900, latQ: 326988, lonQ: 964716 },
];

describe('strike identity golden vectors', () => {
  it.each(GOLDEN)('($lat, $lon) → tick/latQ/lonQ', (g) => {
    const tMs = parseStrikeTime(g.time, RECV_MS);
    expect(tMs).not.toBeNull();
    expect(tickOf(tMs!)).toBe(g.tick);
    expect(qLat(g.lat)).toBe(g.latQ);
    expect(qLon(g.lon)).toBe(g.lonQ);
  });

  it('parseFrame derives the same key as the server would', () => {
    const g = GOLDEN[0];
    const s = parseFrame(JSON.stringify({ lat: g.lat, lon: g.lon, time: g.time }), RECV_MS)!;
    expect(s.networkTime).toBe(true);
    expect(s.key).toBe(strikeKey(g.tick, g.latQ, g.lonQ));
    expect(s.key).toBe('179021000012:728896:240173');
  });

  it('round-trips within half a step', () => {
    for (let i = 0; i <= 1000; i++) {
      const lat = -90 + i * 0.18;
      const lon = -180 + i * 0.36;
      expect(Math.abs(dqLat(qLat(lat)) - lat)).toBeLessThanOrEqual(180 / QMAX / 2 + 1e-12);
      expect(Math.abs(dqLon(qLon(lon)) - lon)).toBeLessThanOrEqual(360 / QMAX / 2 + 1e-12);
    }
  });
});

describe('parseStrikeTime', () => {
  it('detects units and rejects implausible values', () => {
    expect(parseStrikeTime(1790210000123, RECV_MS)).toBe(1790210000123);
    expect(parseStrikeTime(1790210000.123, RECV_MS)).toBeCloseTo(1790210000123, 3);
    expect(parseStrikeTime(1790210000123456, RECV_MS)).toBeCloseTo(1790210000123.456, 3);
    expect(parseStrikeTime(1790200000000000000, RECV_MS)).toBeNull();
    expect(parseStrikeTime(RECV_MS + 61_000, RECV_MS)).toBeNull();
    expect(parseStrikeTime(null, RECV_MS)).toBeNull();
  });
});

describe('parseFrame', () => {
  it('falls back to receive time and rejects bad coordinates', () => {
    const s = parseFrame(JSON.stringify({ lat: 1, lon: 2 }), RECV_MS)!;
    expect(s.tMs).toBe(RECV_MS);
    expect(s.networkTime).toBe(false);
    expect(parseFrame(JSON.stringify({ lat: 95, lon: 2 }), RECV_MS)).toBeNull();
    expect(parseFrame('{', RECV_MS)).toBeNull();
  });
});

describe('decodeMarks', () => {
  it('expands delta ticks into keyed marks', () => {
    const marks = decodeMarks({ tick0: 1000, dt: [0, 5, 0], la: [524288, 1, 2], lo: [524288, 3, 4] });
    expect(marks.map((m) => m.tick)).toEqual([1000, 1005, 1005]);
    expect(marks[0].key).toBe('1000:524288:524288');
    expect(marks[0].tMs).toBe(10_000);
    expect(marks[0].lat).toBeCloseTo(0, 3);
    expect(marks[2].key).toBe('1005:2:4');
  });

  it('tolerates empty or malformed input', () => {
    expect(decodeMarks({ tick0: 0, dt: [], la: [], lo: [] })).toEqual([]);
    expect(decodeMarks(null)).toEqual([]);
    // Ragged arrays: decode only the common prefix.
    expect(decodeMarks({ tick0: 1, dt: [0, 1], la: [1], lo: [1, 2] })).toHaveLength(1);
  });
});
