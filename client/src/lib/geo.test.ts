import { describe, expect, it } from 'vitest';
import {
  circleRing, distanceToRingsMeters, haversineMeters, metersToMiles, MILES_TO_M, pointInRing, pointInRings,
} from './geo';

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

describe('distanceToRingsMeters', () => {
  // A 1°×1° box around (−105.5, 39.5).
  const box = [[-106, 39], [-105, 39], [-105, 40], [-106, 40], [-106, 39]];

  it('measures to the nearest edge from outside', () => {
    // Half a degree of latitude north of the top edge ≈ 55.6 km.
    const d = distanceToRingsMeters(-105.5, 40.5, [box]);
    expect(d).toBeGreaterThan(55_000);
    expect(d).toBeLessThan(56_200);
  });

  it('agrees with the great-circle distance to a corner', () => {
    const d = distanceToRingsMeters(-104.8, 40.2, [box]);
    const gc = haversineMeters(40.2, -104.8, 40, -105);
    expect(Math.abs(d - gc) / gc).toBeLessThan(0.01);
  });

  it('measures from inside to the nearest edge too', () => {
    expect(distanceToRingsMeters(-105.9, 39.5, [box])).toBeLessThan(9_000);
  });

  it('closes an unclosed ring', () => {
    const open = box.slice(0, 4); // no repeat of the first vertex
    expect(distanceToRingsMeters(-106.1, 39.5, [open])).toBeLessThan(9_000);
  });

  it('wraps across the antimeridian', () => {
    const aleutian = [[179.5, 51], [179.9, 51], [179.9, 52], [179.5, 52], [179.5, 51]];
    // 0.2° of longitude east of the box's east edge, on the other side of 180.
    const d = distanceToRingsMeters(-179.9, 51.5, [aleutian]);
    expect(d).toBeLessThan(15_000);
  });

  it('is infinite with nothing to measure to', () => {
    expect(distanceToRingsMeters(0, 0, [])).toBe(Infinity);
  });
});

describe('circleRing', () => {
  it('puts every point the radius away from the centre, and closes the ring', () => {
    const ring = circleRing(-87.6222, 33.2461, 1_901, 32);
    expect(ring).toHaveLength(33);
    expect(ring[32]).toEqual(ring[0]);
    for (const [lon, lat] of ring) {
      expect(haversineMeters(33.2461, -87.6222, lat, lon)).toBeCloseTo(1_901, 0);
    }
    expect(pointInRing(-87.6222, 33.2461, ring)).toBe(true);
  });

  it('stays in range across the antimeridian', () => {
    const ring = circleRing(179.99, 52, 5_000);
    expect(ring.every(([lon]) => lon >= -180 && lon <= 180)).toBe(true);
  });
});
