import { describe, expect, it } from 'vitest';
import {
  buildZoneShape,
  placeLabel,
  scanlineIntervals,
  wrappedLonDistance,
  type ZoneShape,
} from './zoneLabelPlacement';

function square(x0: number, y0: number, x1: number, y1: number): number[][] {
  return [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]];
}

function shape(geometry: GeoJSON.Geometry): ZoneShape {
  const s = buildZoneShape(geometry);
  if (!s) throw new Error('expected a shape');
  return s;
}

describe('buildZoneShape', () => {
  it('records extents, an interior point and a size for a polygon', () => {
    const s = shape({ type: 'Polygon', coordinates: [square(0, 0, 10, 10)] });
    expect(s.polygons).toHaveLength(1);
    expect([s.minLon, s.minLat, s.maxLon, s.maxLat]).toEqual([0, 0, 10, 10]);
    expect(s.polygons[0].interior).toEqual({ lon: 5, lat: 5 });
    expect(s.spanMeters).toBeCloseTo(10 * 111_320, -3);
  });

  it('keeps the interior point out of a hole', () => {
    const s = shape({ type: 'Polygon', coordinates: [square(0, 0, 10, 10), square(3, 3, 7, 7)] });
    // Middle parallel (lat 5) is cut by the hole into [0,3] and [7,10]: widest wins.
    expect(s.polygons[0].interior).toEqual({ lon: 1.5, lat: 5 });
  });

  it('returns null for point/line geometry and empty input', () => {
    expect(buildZoneShape({ type: 'Point', coordinates: [0, 0] })).toBeNull();
    expect(buildZoneShape(null)).toBeNull();
    expect(buildZoneShape({ type: 'MultiPolygon', coordinates: [] })).toBeNull();
  });
});

describe('scanlineIntervals', () => {
  it('finds the inside stretch of a square', () => {
    const s = shape({ type: 'Polygon', coordinates: [square(0, 0, 10, 10)] });
    expect(scanlineIntervals(s.polygons[0], 5)).toEqual([[0, 10]]);
  });

  it('cuts holes out with the even-odd rule', () => {
    const s = shape({ type: 'Polygon', coordinates: [square(0, 0, 10, 10), square(4, 4, 6, 6)] });
    expect(scanlineIntervals(s.polygons[0], 5)).toEqual([[0, 4], [6, 10]]);
    expect(scanlineIntervals(s.polygons[0], 8)).toEqual([[0, 10]]);
  });

  it('counts a vertex lying exactly on the parallel once', () => {
    const diamond = [[5, 0], [10, 5], [5, 10], [0, 5], [5, 0]];
    const s = shape({ type: 'Polygon', coordinates: [diamond] });
    expect(scanlineIntervals(s.polygons[0], 5)).toEqual([[0, 10]]);
    expect(scanlineIntervals(s.polygons[0], 2.5)).toEqual([[2.5, 7.5]]);
  });

  it('returns nothing outside the ring', () => {
    const s = shape({ type: 'Polygon', coordinates: [square(0, 0, 10, 10)] });
    expect(scanlineIntervals(s.polygons[0], 20)).toEqual([]);
  });
});

describe('wrappedLonDistance', () => {
  it('goes the short way round the antimeridian', () => {
    expect(wrappedLonDistance(179, -179)).toBe(2);
    expect(wrappedLonDistance(-170, 170)).toBe(20);
    expect(wrappedLonDistance(10, 20)).toBe(10);
    expect(wrappedLonDistance(0, 180)).toBe(180);
  });
});

describe('placeLabel', () => {
  const band = shape({ type: 'Polygon', coordinates: [square(-10, -60, 10, 60)] });

  it('sits at the camera latitude inside a tall band', () => {
    expect(placeLabel(band, 0, 38)).toEqual({ lon: 0, lat: 38 });
    expect(placeLabel(band, 0, -20)).toEqual({ lon: 0, lat: -20 });
  });

  it('drops to the band middle when the camera is beyond its latitude range', () => {
    expect(placeLabel(band, 0, 80)).toEqual({ lon: 0, lat: 0 });
    expect(placeLabel(band, 0, -75)).toEqual({ lon: 0, lat: 0 });
  });

  it('stays a little inside the band edges rather than on them', () => {
    expect(placeLabel(band, 0, 59.9)).toEqual({ lon: 0, lat: 0 });
    expect(placeLabel(band, 0, 59.7)).toEqual({ lon: 0, lat: 59.7 });
  });

  it('is unaffected by the camera longitude when the band is the only choice', () => {
    expect(placeLabel(band, 120, 10)).toEqual({ lon: 0, lat: 10 });
  });

  it('prefers the stretch under the camera, then the nearest one', () => {
    const holed = shape({
      type: 'Polygon',
      coordinates: [square(0, 0, 10, 10), square(4, 2, 6, 8)],
    });
    expect(placeLabel(holed, 2, 5)).toEqual({ lon: 2, lat: 5 });
    expect(placeLabel(holed, 9, 5)).toEqual({ lon: 8, lat: 5 });
    // Camera over the hole: [0,4] is 0.5° away, [6,10] is 1.5° away.
    expect(placeLabel(holed, 4.5, 5)).toEqual({ lon: 2, lat: 5 });
  });

  it('picks the part across the antimeridian when that is closer', () => {
    const split = shape({
      type: 'MultiPolygon',
      coordinates: [[square(150, -50, 160, 50)], [square(-180, -50, -172, 50)]],
    });
    expect(placeLabel(split, 178, 0)).toEqual({ lon: -176, lat: 0 });
    expect(placeLabel(split, 165, 0)).toEqual({ lon: 155, lat: 0 });
  });

  it('falls back to the nearest interior point when no part crosses that parallel', () => {
    const parts = shape({
      type: 'MultiPolygon',
      coordinates: [[square(0, 0, 10, 10)], [square(0, 40, 10, 50)]],
    });
    // Camera at lat 20 is inside the overall range but between the parts.
    expect(placeLabel(parts, 5, 20)).toEqual({ lon: 5, lat: 5 });
    expect(placeLabel(parts, 5, 32)).toEqual({ lon: 5, lat: 45 });
  });

  it('ignores hairline crossings when a real stretch exists', () => {
    // A sliver 0.001° wide next to a proper block, both on the parallel.
    const s = shape({
      type: 'MultiPolygon',
      coordinates: [[square(20, 0, 20.001, 10)], [square(0, 0, 10, 10)]],
    });
    expect(placeLabel(s, 19, 5)).toEqual({ lon: 5, lat: 5 });
  });
});

describe('placeLabel with a longitude margin', () => {
  const band = shape({ type: 'Polygon', coordinates: [square(-10, -60, 10, 60)] });

  it('slides toward the camera but stays the margin inside the edge', () => {
    expect(placeLabel(band, 4, 20, { lonMargin: 2 })).toEqual({ lon: 4, lat: 20 });
    expect(placeLabel(band, 30, 20, { lonMargin: 2 })).toEqual({ lon: 8, lat: 20 });
    expect(placeLabel(band, -30, 20, { lonMargin: 2 })).toEqual({ lon: -8, lat: 20 });
  });

  it('never leaves the middle of a stretch narrower than twice the margin', () => {
    expect(placeLabel(band, 30, 20, { lonMargin: 50 })).toEqual({ lon: 0, lat: 20 });
  });

  it('clamps to the near edge across the antimeridian', () => {
    const east = shape({ type: 'Polygon', coordinates: [square(-180, -50, -172, 50)] });
    expect(placeLabel(east, 178, 0, { lonMargin: 1 })).toEqual({ lon: -179, lat: 0 });
    const west = shape({ type: 'Polygon', coordinates: [square(172, -50, 180, 50)] });
    expect(placeLabel(west, -178, 0, { lonMargin: 1 })).toEqual({ lon: 179, lat: 0 });
  });
});
