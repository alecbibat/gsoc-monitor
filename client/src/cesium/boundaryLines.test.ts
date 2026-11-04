import { describe, expect, it } from 'vitest';
import { decodeLines, densifyLine, stateLineFade } from './boundaryLines';

describe('decodeLines', () => {
  it('decodes one running delta stream into per-line lon/lat arrays', () => {
    // Line A: (1, 2) → (1.5, 2); line B: (-120, 49) → (-95.153, 49).
    const lines = decodeLines(
      {
        n: [2, 2],
        d: [1000, 2000, 500, 0, -121500, 47000, 24847, 0],
      },
      1000
    );
    expect(lines).toEqual([
      [1, 2, 1.5, 2],
      [-120, 49, -95.153, 49],
    ]);
  });

  it('returns nothing for an empty class', () => {
    expect(decodeLines({ n: [], d: [] }, 1000)).toEqual([]);
  });
});

describe('densifyLine', () => {
  it('leaves segments no longer than the step alone', () => {
    expect(densifyLine([10, 10, 10.5, 10.2, 10.6, 10.6], 0.5)).toEqual([10, 10, 10.5, 10.2, 10.6, 10.6]);
  });

  it('keeps a long run along a parallel on that parallel', () => {
    // The US–Canada border is one 25° segment along 49°N in Natural Earth.
    const out = densifyLine([-120, 49, -95, 49], 0.5);
    expect(out.length / 2).toBe(51);
    expect(out.slice(0, 2)).toEqual([-120, 49]);
    expect(out.slice(-2)).toEqual([-95, 49]);
    for (let i = 0; i < out.length; i += 2) expect(out[i + 1]).toBe(49);
    for (let i = 2; i < out.length; i += 2) expect(out[i] - out[i - 2]).toBeCloseTo(0.5, 9);
  });

  it('uses the larger of the lon and lat spans to count steps', () => {
    const out = densifyLine([0, 0, 0.4, 2], 0.5);
    expect(out.length / 2).toBe(5);
    expect(out[2]).toBeCloseTo(0.1, 9);
    expect(out[3]).toBeCloseTo(0.5, 9);
  });

  it('crosses the antimeridian the short way', () => {
    const out = densifyLine([179.5, 65, -179.5, 66], 0.5);
    expect(out.length / 2).toBe(3);
    expect(Math.abs(out[2])).toBeCloseTo(180, 9);
    expect(out[3]).toBeCloseTo(65.5, 9);
    expect(out.slice(-2)).toEqual([-179.5, 66]);
    for (let i = 0; i < out.length; i += 2) expect(Math.abs(out[i])).toBeGreaterThanOrEqual(179.5);
  });

  it('handles empty and single-point input', () => {
    expect(densifyLine([], 0.5)).toEqual([]);
    expect(densifyLine([3, 4], 0.5)).toEqual([3, 4]);
  });
});

describe('stateLineFade', () => {
  it('keeps province lines off at whole-globe scale and full regionally', () => {
    expect(stateLineFade(20_000_000)).toBe(0);
    expect(stateLineFade(7_000_000)).toBe(0);
    expect(stateLineFade(2_500_000)).toBe(1);
    expect(stateLineFade(150)).toBe(1);
    expect(stateLineFade(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it('ramps smoothly in between', () => {
    const mid = stateLineFade(4_750_000);
    expect(mid).toBeGreaterThan(0.45);
    expect(mid).toBeLessThan(0.55);
    expect(stateLineFade(3_000_000)).toBeGreaterThan(stateLineFade(6_000_000));
  });
});
