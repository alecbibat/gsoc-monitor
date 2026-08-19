import { describe, expect, it } from 'vitest';
import {
  formatBearing,
  formatLatLon,
  initialBearing,
  circleAreaM2,
  circleCircumferenceM,
  circleRing,
  formatArea,
  formatDistance,
  formatNauticalMiles,
  radiusM,
  totalDistanceM,
} from './measureMath';

describe('distance', () => {
  it('measures a degree of latitude at the expected geodesic length', () => {
    // One degree of latitude is ~110.6 km near the equator on the WGS84 ellipsoid.
    const d = radiusM({ lon: 0, lat: 0 }, { lon: 0, lat: 1 });
    expect(d).toBeGreaterThan(110_000);
    expect(d).toBeLessThan(111_000);
  });

  it('sums a multi-point path', () => {
    const legs = totalDistanceM([
      { lon: 0, lat: 0 },
      { lon: 0, lat: 1 },
      { lon: 0, lat: 2 },
    ]);
    const single = radiusM({ lon: 0, lat: 0 }, { lon: 0, lat: 1 });
    expect(legs).toBeCloseTo(single * 2, -1);
  });
});

describe('circleRing', () => {
  const center = { lon: -61.82, lat: 17.535 }; // off Antigua
  const RADIUS = 50_000; // 50 km

  it('closes the ring and holds the radius all the way round', () => {
    const ring = circleRing(center, RADIUS, 64);
    expect(ring).toHaveLength(65); // segments + the closing point
    expect(ring[0].lat).toBeCloseTo(ring[ring.length - 1].lat, 6);
    expect(ring[0].lon).toBeCloseTo(ring[ring.length - 1].lon, 6);
    for (const p of ring) {
      // The drawn rim must match the number in the readout, not just be close:
      // sub-metre at 50 km, after the ellipsoid correction.
      expect(Math.abs(radiusM(center, p) - RADIUS)).toBeLessThan(1);
    }
  });

  it('keeps longitudes in range across the antimeridian', () => {
    const ring = circleRing({ lon: 179.9, lat: 0 }, 200_000, 32);
    for (const p of ring) {
      expect(p.lon).toBeGreaterThanOrEqual(-180);
      expect(p.lon).toBeLessThanOrEqual(180);
    }
    // The ring must actually cross into negative longitudes rather than
    // clamping at the seam.
    expect(ring.some((p) => p.lon < 0)).toBe(true);
  });

  it('is empty for a zero or negative radius', () => {
    expect(circleRing(center, 0)).toEqual([]);
    expect(circleRing(center, -5)).toEqual([]);
  });
});

describe('circle measurements', () => {
  it('derives area and circumference from the radius', () => {
    expect(circleAreaM2(1000)).toBeCloseTo(Math.PI * 1e6, 0);
    expect(circleCircumferenceM(1000)).toBeCloseTo(2 * Math.PI * 1000, 6);
  });
});

describe('bearing', () => {
  it('reads due east as 090 and due north as 000', () => {
    expect(initialBearing({ lon: 0, lat: 0 }, { lon: 1, lat: 0 })).toBeCloseTo(90, 5);
    expect(initialBearing({ lon: 0, lat: 0 }, { lon: 0, lat: 1 })).toBeCloseTo(0, 5);
    expect(initialBearing({ lon: 0, lat: 0 }, { lon: -1, lat: 0 })).toBeCloseTo(270, 5);
  });

  it('formats with a leading zero and a compass point', () => {
    expect(formatBearing(72)).toBe('072° ENE');
    expect(formatBearing(0)).toBe('000° N');
    expect(formatBearing(359.6)).toBe('360° N'); // rounds to the same point
  });
});

describe('positions', () => {
  it('formats a lat/lon anyone can read back', () => {
    expect(formatLatLon(20.8911, -156.47)).toBe('20.8911°N 156.4700°W');
    expect(formatLatLon(-17.535, 61.82)).toBe('17.5350°S 61.8200°E');
  });
});

describe('formatting', () => {
  it('switches units by magnitude and separates long numbers', () => {
    expect(formatDistance(840)).toBe('840 m · 2756 ft');
    expect(formatDistance(1234)).toBe('1.23 km · 0.77 mi');
    expect(formatDistance(4_911_170)).toBe('4,911 km · 3,052 mi');
  });

  it('reports nautical miles for maritime distances', () => {
    expect(formatNauticalMiles(1852)).toBe('1.00 nm');
    expect(formatNauticalMiles(185_200)).toBe('100.0 nm');
  });

  it('separates long areas too', () => {
    expect(formatArea(10_391_462_340_000)).toBe('10,391,462 km² · 4,012,166 mi²');
  });
});
