import { describe, expect, it } from 'vitest';
import { haversineMeters, metersToMiles, MILES_TO_M, pointInRing, pointInRings } from './geo';

describe('metersToMiles', () => {
  it('converts exactly one mile', () => {
    expect(metersToMiles(MILES_TO_M)).toBe(1);
  });
});

describe('haversineMeters', () => {
  it('returns zero for identical points', () => {
    expect(haversineMeters(44.46, -110.83, 44.46, -110.83)).toBe(0);
  });

  it('measures one degree of longitude at the equator as ~111.19 km', () => {
    const d = haversineMeters(0, 0, 0, 1);
    expect(d).toBeGreaterThan(111_100);
    expect(d).toBeLessThan(111_300);
  });

  it('is symmetric', () => {
    const a = haversineMeters(36.06, -112.14, 44.46, -110.83); // Grand Canyon → Yellowstone
    const b = haversineMeters(44.46, -110.83, 36.06, -112.14);
    expect(a).toBeCloseTo(b, 6);
  });

  it('matches a known city-pair distance within 1%', () => {
    // Denver → Colorado Springs is ~101 km great-circle.
    const d = haversineMeters(39.7392, -104.9903, 38.8339, -104.8214);
    expect(d).toBeGreaterThan(100_000);
    expect(d).toBeLessThan(103_000);
  });
});

describe('pointInRing', () => {
  // Unit square around the origin, GeoJSON [lon, lat] order.
  const square = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ];

  it('detects a point inside', () => {
    expect(pointInRing(0, 0, square)).toBe(true);
  });

  it('detects a point outside', () => {
    expect(pointInRing(2, 0, square)).toBe(false);
    expect(pointInRing(0, -3, square)).toBe(false);
  });

  it('handles a concave ring', () => {
    // A "C" shape open to the right: the notch is outside the polygon.
    const cShape = [
      [0, 0],
      [4, 0],
      [4, 1],
      [1, 1],
      [1, 3],
      [4, 3],
      [4, 4],
      [0, 4],
    ];
    expect(pointInRing(0.5, 2, cShape)).toBe(true); // inside the spine
    expect(pointInRing(3, 2, cShape)).toBe(false); // inside the notch
  });
});

describe('pointInRings', () => {
  const ringA = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ];
  const ringB = [
    [10, 10],
    [11, 10],
    [11, 11],
    [10, 11],
  ];

  it('is true when any ring contains the point', () => {
    expect(pointInRings(10.5, 10.5, [ringA, ringB])).toBe(true);
  });

  it('is false when no ring contains the point', () => {
    expect(pointInRings(5, 5, [ringA, ringB])).toBe(false);
  });

  it('is false for an empty ring list', () => {
    expect(pointInRings(0.5, 0.5, [])).toBe(false);
  });
});
