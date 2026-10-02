import { describe, expect, it } from 'vitest';
import { haversineMeters } from '../../lib/geo';
import { IR_PIXEL_RAD, latLonToScan, pixelFootprint, scanToLatLon, SLOT_LON0 } from './abiFootprint';

describe('ABI fixed-grid projection', () => {
  // The worked example in the GOES-R PUG (Vol. 3 §5.1.2.8), GOES-East.
  it('reproduces the PUG worked example forwards', () => {
    const s = latLonToScan(33.846162, -84.690932, -75)!;
    expect(s.x).toBeCloseTo(-0.024052, 6);
    expect(s.y).toBeCloseTo(0.09534, 6);
  });

  it('reproduces the PUG worked example backwards', () => {
    const p = scanToLatLon(-0.024052, 0.09534, -75)!;
    expect(p.lat).toBeCloseTo(33.846162, 4);
    expect(p.lon).toBeCloseTo(-84.690932, 4);
  });

  it('round-trips points across the West slot', () => {
    for (const [lat, lon] of [
      [37.65861, -119.61361],
      [61.2, -149.9],
      [19.7, -155.1],
      [-10, -100],
    ]) {
      const s = latLonToScan(lat, lon, SLOT_LON0.west)!;
      const p = scanToLatLon(s.x, s.y, SLOT_LON0.west)!;
      expect(p.lat).toBeCloseTo(lat, 7);
      expect(p.lon).toBeCloseTo(lon, 7);
    }
  });

  it('treats the far side of the Earth as off the disk', () => {
    expect(latLonToScan(0, 105, SLOT_LON0.east)).toBeNull();
    expect(scanToLatLon(0.2, 0, SLOT_LON0.east)).toBeNull(); // past the limb (~0.151 rad)
  });

  // A real GOES-19 NGFS detection (Henry County, AL, 2026-10-01) sits on the
  // 2 km full-disk grid: x_offset −0.151844, scale 56 µrad.
  it('puts a real GOES-East detection on the 2 km grid', () => {
    const s = latLonToScan(31.50722, -85.15278, SLOT_LON0.east)!;
    const col = (s.x + 0.151844) / IR_PIXEL_RAD;
    const row = (0.151844 - s.y) / IR_PIXEL_RAD;
    expect(Math.abs(col - Math.round(col))).toBeLessThan(0.05);
    expect(Math.abs(row - Math.round(row))).toBeLessThan(0.05);
  });
});

describe('pixelFootprint', () => {
  it('is ~2 km square at the sub-satellite point', () => {
    const c = pixelFootprint(0, -75, SLOT_LON0.east)!;
    const [nw, sw, se] = c;
    const ns = haversineMeters(nw[1], nw[0], sw[1], sw[0]);
    const ew = haversineMeters(sw[1], sw[0], se[1], se[0]);
    // 56 µrad × 35 786 km ≈ 2.004 km.
    expect(ns).toBeGreaterThan(1_950);
    expect(ns).toBeLessThan(2_050);
    expect(ew).toBeGreaterThan(1_950);
    expect(ew).toBeLessThan(2_050);
  });

  it('stretches with viewing angle (California from GOES-East is several km)', () => {
    const c = pixelFootprint(37.65861, -119.61361, SLOT_LON0.east)!;
    const [nw, sw, se] = c;
    const ns = haversineMeters(nw[1], nw[0], sw[1], sw[0]);
    const ew = haversineMeters(sw[1], sw[0], se[1], se[0]);
    expect(ns).toBeGreaterThan(3_500);
    expect(ew).toBeGreaterThan(3_000);
    expect(ns).toBeLessThan(8_000);
    expect(ew).toBeLessThan(8_000);
  });

  it('surrounds its centre with corners in NW, SW, SE, NE order', () => {
    const lat = 45.5;
    const lon = -122.6;
    const [nw, sw, se, ne] = pixelFootprint(lat, lon, SLOT_LON0.west)!;
    expect(nw[1]).toBeGreaterThan(lat);
    expect(ne[1]).toBeGreaterThan(lat);
    expect(sw[1]).toBeLessThan(lat);
    expect(se[1]).toBeLessThan(lat);
    expect(nw[0]).toBeLessThan(lon);
    expect(sw[0]).toBeLessThan(lon);
    expect(ne[0]).toBeGreaterThan(lon);
    expect(se[0]).toBeGreaterThan(lon);
  });

  it('returns null off the disk', () => {
    expect(pixelFootprint(0, 105, SLOT_LON0.east)).toBeNull();
  });
});
