import { describe, expect, it } from 'vitest';
import { contourLevels, contourLines, type ScalarGrid } from './marchingSquares';

const grid = (nx: number, ny: number, values: (number | null)[]): ScalarGrid => ({
  nx, ny, lon0: 0, lat0: 0, dLon: 1, dLat: 1, values,
});

describe('contourLines', () => {
  it('draws a straight line through a half-plane gradient', () => {
    // Values increase east: columns 0,1,2 → 0,10,20. Level 5 crosses between
    // col 0 and 1 at lon 0.5, all rows.
    const g = grid(3, 3, [0, 10, 20, 0, 10, 20, 0, 10, 20]);
    const lines = contourLines(g, 5);
    expect(lines).toHaveLength(1);
    const line = lines[0];
    expect(line.length).toBeGreaterThanOrEqual(3);
    for (const [lon] of line) expect(lon).toBeCloseTo(0.5, 6);
    const lats = line.map(([, lat]) => lat);
    expect(Math.min(...lats)).toBe(0);
    expect(Math.max(...lats)).toBe(2);
  });

  it('closes a loop around a single peak', () => {
    const g = grid(3, 3, [0, 0, 0, 0, 10, 0, 0, 0, 0]);
    const lines = contourLines(g, 5);
    expect(lines).toHaveLength(1);
    const line = lines[0];
    // Closed: first and last points coincide.
    expect(line[0][0]).toBeCloseTo(line[line.length - 1][0], 9);
    expect(line[0][1]).toBeCloseTo(line[line.length - 1][1], 9);
    // Ring surrounds the center (1,1).
    expect(line.length).toBeGreaterThanOrEqual(5);
  });

  it('skips cells touching null values instead of inventing data', () => {
    const g = grid(3, 3, [0, 10, 20, 0, null, 20, 0, 10, 20]);
    const lines = contourLines(g, 5);
    // Cells (0,0) and (0,1) both touch the null center — no contour there.
    expect(lines.flat().length).toBe(0);
  });

  it('emits nothing outside the data range', () => {
    const g = grid(2, 2, [1, 1, 1, 1]);
    expect(contourLines(g, 5)).toHaveLength(0);
  });
});

describe('contourLevels', () => {
  it('aligns to multiples of the interval', () => {
    expect(contourLevels([1009.3, 1023.9], 4)).toEqual([1012, 1016, 1020]);
  });
  it('ignores nulls and empty fields', () => {
    expect(contourLevels([null, null], 4)).toEqual([]);
  });
});
