import { describe, expect, it } from 'vitest';
import {
  QMAX,
  dqLat,
  dqLon,
  haversineMi,
  inflate,
  parseFrame,
  parseStrikeTime,
  qLat,
  qLon,
  strikeHash,
  tickOf,
} from './quant';

// Golden vectors — the client's strikeKey.test.ts pins the same lat/lon/time →
// (tick, latQ, lonQ) rows. If either side changes, both tests must change.
const RECV_MS = 1790210000500;
const GOLDEN: { lat: number; lon: number; time: number; tick: number; latQ: number; lonQ: number; hash: number }[] = [
  { lat: 35.12345, lon: -97.54321, time: 1790210000123456789, tick: 179021000012, latQ: 728896, lonQ: 240173, hash: 714158408 },
  { lat: -90, lon: -180, time: 1790210000000000000, tick: 179021000000, latQ: 0, lonQ: 0, hash: 1517306301 },
  { lat: 90, lon: 180, time: 1790210059999000000, tick: 179021005999, latQ: 1048575, lonQ: 1048575, hash: 4211866364 },
  { lat: 0, lon: 0, time: 1790210012345000000, tick: 179021001234, latQ: 524288, lonQ: 524288, hash: 3461726205 },
  { lat: -33.8688, lon: 151.2093, time: 1790209999000000000, tick: 179020999900, latQ: 326988, lonQ: 964716, hash: 1896547966 },
];

describe('quantization golden vectors', () => {
  it.each(GOLDEN)('($lat, $lon) → tick/latQ/lonQ/hash', (g) => {
    const tMs = parseStrikeTime(g.time, RECV_MS);
    expect(tMs).not.toBeNull();
    const tick = tickOf(tMs!);
    expect(tick).toBe(g.tick);
    expect(qLat(g.lat)).toBe(g.latQ);
    expect(qLon(g.lon)).toBe(g.lonQ);
    expect(strikeHash(tick, g.latQ, g.lonQ)).toBe(g.hash);
  });

  it('round-trips within half a quantization step', () => {
    const halfLat = 180 / QMAX / 2 + 1e-12;
    const halfLon = 360 / QMAX / 2 + 1e-12;
    for (let i = 0; i < 20_000; i++) {
      const lat = -90 + (i * 180) / 20_000;
      const lon = -180 + ((i * 7919) % 20_000) * (360 / 20_000);
      expect(Math.abs(dqLat(qLat(lat)) - lat)).toBeLessThanOrEqual(halfLat);
      expect(Math.abs(dqLon(qLon(lon)) - lon)).toBeLessThanOrEqual(halfLon);
    }
    expect(qLat(-90)).toBe(0);
    expect(qLat(90)).toBe(QMAX);
    expect(qLon(180)).toBe(QMAX);
    expect(qLat(123)).toBe(QMAX); // clamped
  });

  it('hash is stable and spreads adjacent identities', () => {
    const a = strikeHash(179021000012, 728896, 240173);
    expect(strikeHash(179021000012, 728896, 240173)).toBe(a);
    expect(strikeHash(179021000013, 728896, 240173)).not.toBe(a);
    expect(strikeHash(179021000012, 728897, 240173)).not.toBe(a);
    expect(strikeHash(179021000012, 728896, 240174)).not.toBe(a);
    // Roughly uniform: mean of 50k hashes of sequential ticks ≈ 2^31.
    let sum = 0;
    for (let i = 0; i < 50_000; i++) sum += strikeHash(179021000000 + i, 500_000, 500_000);
    expect(sum / 50_000 / 2 ** 32).toBeGreaterThan(0.48);
    expect(sum / 50_000 / 2 ** 32).toBeLessThan(0.52);
  });
});

describe('parseStrikeTime', () => {
  it('detects the unit by magnitude', () => {
    expect(parseStrikeTime(1790210000123, RECV_MS)).toBe(1790210000123); // ms
    expect(parseStrikeTime(1790210000.123, RECV_MS)).toBeCloseTo(1790210000123, 3); // s
    expect(parseStrikeTime(1790210000123456, RECV_MS)).toBeCloseTo(1790210000123.456, 3); // µs
    expect(parseStrikeTime('1790210000123456789', RECV_MS)).toBeCloseTo(1790210000123.4568, 3); // ns string
  });

  it('rejects implausible times so the caller uses receive time', () => {
    expect(parseStrikeTime(1790200000000000000, RECV_MS)).toBeNull(); // ~2.8 h old
    expect(parseStrikeTime(RECV_MS + 61_000, RECV_MS)).toBeNull(); // > 60 s ahead
    expect(parseStrikeTime(RECV_MS - 599_000, RECV_MS)).toBe(RECV_MS - 599_000);
    expect(parseStrikeTime(undefined, RECV_MS)).toBeNull();
    expect(parseStrikeTime('', RECV_MS)).toBeNull();
    expect(parseStrikeTime(-5, RECV_MS)).toBeNull();
    expect(parseStrikeTime(Number.NaN, RECV_MS)).toBeNull();
  });
});

// Test-local LZW encoder: the inverse of `inflate`, so we can build frames that
// look like what the relays send.
function deflate(s: string): string {
  const dict = new Map<string, number>();
  let code = 256;
  let phrase = s.charAt(0);
  const out: string[] = [];
  for (let i = 1; i < s.length; i++) {
    const c = s.charAt(i);
    if (dict.has(phrase + c)) {
      phrase += c;
    } else {
      out.push(phrase.length > 1 ? String.fromCharCode(dict.get(phrase)!) : phrase);
      dict.set(phrase + c, code++);
      phrase = c;
    }
  }
  out.push(phrase.length > 1 ? String.fromCharCode(dict.get(phrase)!) : phrase);
  return out.join('');
}

describe('parseFrame', () => {
  const frame = {
    time: 1790210000123456789,
    lat: 35.12345,
    lon: -97.54321,
    alt: 0,
    pol: 0,
    mds: 9123,
    mcg: 208,
    status: 2,
    region: 3,
    sig: Array.from({ length: 12 }, (_, i) => ({ sta: 1000 + i, time: 123456 + i, lat: 35 + i / 10, lon: -97 - i / 10, alt: 300, status: 13 })),
    delay: 3.1,
  };

  it('round-trips an LZW frame and uses network time', () => {
    const raw = deflate(JSON.stringify(frame));
    expect(inflate(raw)).toBe(JSON.stringify(frame));
    const s = parseFrame(raw, RECV_MS)!;
    expect(s.lat).toBe(35.12345);
    expect(s.lon).toBe(-97.54321);
    expect(s.networkTime).toBe(true);
    expect(tickOf(s.tMs)).toBe(179021000012);
  });

  it('accepts plain JSON and falls back to receive time', () => {
    const s = parseFrame(JSON.stringify({ lat: 1, lon: 2 }), RECV_MS)!;
    expect(s.tMs).toBe(RECV_MS);
    expect(s.networkTime).toBe(false);
  });

  it('rejects non-strikes and out-of-range coordinates', () => {
    expect(parseFrame('not json at all {', RECV_MS)).toBeNull();
    expect(parseFrame(JSON.stringify({ lat: 91, lon: 0 }), RECV_MS)).toBeNull();
    expect(parseFrame(JSON.stringify({ lat: 0, lon: -181 }), RECV_MS)).toBeNull();
    expect(parseFrame(JSON.stringify({ lat: '1', lon: 2 }), RECV_MS)).toBeNull();
    expect(parseFrame(JSON.stringify(null), RECV_MS)).toBeNull();
  });
});

describe('haversineMi', () => {
  it('matches known distances', () => {
    expect(haversineMi(0, 0, 0, 1)).toBeCloseTo(69.09, 1);
    expect(haversineMi(40, -105, 40, -105)).toBe(0);
    // Across the antimeridian is short, not ~360°.
    expect(haversineMi(0, 179.9, 0, -179.9)).toBeLessThan(14);
  });
});
