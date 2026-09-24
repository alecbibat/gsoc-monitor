import { describe, expect, it } from 'vitest';
import { hemisphereBox, lonSpan, viewBoxFor, type DegRect } from './viewBox';

const SUB = { lat: 0, lon: 0 };
const rect = (west: number, south: number, east: number, north: number): DegRect => ({
  west,
  south,
  east,
  north,
});

describe('view box: zoomed in', () => {
  it('snaps outward to a unit about a quarter of the larger span', () => {
    // 1.4° × 0.9° → quarter 0.35 → 0.5° unit.
    expect(viewBoxFor(rect(-97.3, 35.2, -95.9, 36.1), SUB).key).toBe('-97.5,35,-95.5,36.5');
    // 7° wide → 1.75 → 2° unit.
    expect(viewBoxFor(rect(-101, 30.5, -94, 33), SUB).key).toBe('-102,30,-94,34');
    // 40° wide → 10 → 10° unit.
    expect(viewBoxFor(rect(-115, 22, -75, 48), SUB).key).toBe('-120,20,-70,50');
    // 50° → 12.5 → 15° unit.
    expect(viewBoxFor(rect(-112, 20, -62, 44), SUB).key).toBe('-120,15,-60,45');
    // 140° → 35, past the ladder → 30° unit.
    expect(viewBoxFor(rect(-140, -20, 0, 40), SUB).key).toBe('-150,-30,0,60');
  });

  it('always contains the view', () => {
    const r = rect(12.34, -8.76, 19.01, -1.23);
    const [w, s, e, n] = viewBoxFor(r, SUB).bbox;
    expect(w).toBeLessThanOrEqual(r.west);
    expect(s).toBeLessThanOrEqual(r.south);
    expect(e).toBeGreaterThanOrEqual(r.east);
    expect(n).toBeGreaterThanOrEqual(r.north);
  });

  it('keeps the key through a small pan and zoom', () => {
    const a = viewBoxFor(rect(-97.3, 35.2, -95.9, 36.1), SUB);
    const panned = viewBoxFor(rect(-97.25, 35.26, -95.84, 36.17), SUB);
    const zoomed = viewBoxFor(rect(-97.2, 35.3, -95.95, 36.05), SUB);
    expect(panned.key).toBe(a.key);
    expect(zoomed.key).toBe(a.key);
    // A pan across a grid line does move it.
    expect(viewBoxFor(rect(-96.9, 35.2, -95.4, 36.1), SUB).key).not.toBe(a.key);
  });

  it('preserves w > e across the antimeridian', () => {
    const b = viewBoxFor(rect(170.3, -20.2, -175.4, -10.1), SUB);
    expect(lonSpan(170.3, -175.4)).toBeCloseTo(14.3, 9);
    expect(b.key).toBe('170,-25,-175,-10');
    expect(b.bbox[0]).toBeGreaterThan(b.bbox[2]);
    // A view that merely starts on the antimeridian is an ordinary box.
    expect(viewBoxFor(rect(180, 0, -170, 10), SUB).key).toBe('-180,0,-170,10');
    expect(viewBoxFor(rect(170, 0, -180, 10), SUB).key).toBe('170,0,180,10');
  });

  it('clamps at the poles', () => {
    expect(viewBoxFor(rect(-30, 80.3, 30, 90), SUB).key).toBe('-30,75,30,90');
    expect(viewBoxFor(rect(-30, -90, 30, -61), SUB).key).toBe('-30,-90,30,-60');
    // Out-of-range input still yields a valid box.
    const [, s, , n] = viewBoxFor(rect(-10, -95, 10, 95), SUB).bbox;
    expect(s).toBeGreaterThanOrEqual(-90);
    expect(n).toBeLessThanOrEqual(90);
  });

  it('never sends an empty box', () => {
    const [w, s, e, n] = viewBoxFor(rect(10, 20, 10, 20), SUB).bbox;
    expect(n).toBeGreaterThan(s);
    expect(e).toBeGreaterThan(w);
  });
});

describe('view box: a pole in frame', () => {
  // Cesium's rectangle for a view around a pole: every longitude, the pole's
  // latitude, and the real opposite edge.
  it('asks for the polar cap, snapped on the latitude span', () => {
    // Alaska / the Arctic from 3,500 km: 28° → a 10° unit.
    expect(viewBoxFor(rect(-180, 62, 180, 90), { lat: 78, lon: -150 }).key).toBe('-180,60,180,90');
    expect(viewBoxFor(rect(-180, 55, 180, 90), { lat: 68, lon: 20 }).key).toBe('-180,50,180,90');
    // Antarctica: 20° → a 5° unit.
    expect(viewBoxFor(rect(-180, -90, 180, -70.4), { lat: -80, lon: 0 }).key).toBe('-180,-90,180,-70');
  });

  it('tightens as the view zooms in on the pole', () => {
    const wide = viewBoxFor(rect(-180, 55, 180, 90), SUB);
    const close = viewBoxFor(rect(-180, 80.3, 180, 90), SUB);
    expect(close.key).toBe('-180,80,180,90');
    expect(close.bbox[1]).toBeGreaterThan(wide.bbox[1]);
    // A tiny cap still has height.
    expect(viewBoxFor(rect(-180, 90, 180, 90), SUB).key).toBe('-180,89.5,180,90');
    expect(viewBoxFor(rect(-180, -90, 180, -90), SUB).key).toBe('-180,-90,180,-89.5');
  });

  it('keeps the hemisphere box for a pole view whose latitude span is itself huge', () => {
    expect(viewBoxFor(rect(-180, -70, 180, 90), { lat: 40, lon: -100 }).key).toBe(
      hemisphereBox({ lat: 40, lon: -100 }).key
    );
  });
});

describe('view box: whole globe', () => {
  it('uses a hemisphere box when there is no view rectangle', () => {
    expect(viewBoxFor(null, { lat: 3, lon: 10 }).key).toBe('-90,-75,120,75');
    expect(viewBoxFor(undefined, { lat: 3, lon: 10 }).key).toBe('-90,-75,120,75');
  });

  it('uses a hemisphere box once either span passes 150°', () => {
    // Cesium's Rectangle.MAX_VALUE, which it returns for a whole-globe view.
    expect(viewBoxFor(rect(-180, -90, 180, 90), { lat: 3, lon: 10 }).key).toBe('-90,-75,120,75');
    expect(viewBoxFor(rect(-80, -10, 80, 10), { lat: 3, lon: 10 }).key).toBe('-90,-75,120,75');
    expect(viewBoxFor(rect(-10, -80, 10, 80), { lat: 3, lon: 10 }).key).toBe('-90,-75,120,75');
  });

  it('snaps the sub-point to 15° so orbiting a little keeps the key', () => {
    expect(hemisphereBox({ lat: 3, lon: 10 }).key).toBe(hemisphereBox({ lat: -6, lon: 21 }).key);
  });

  it('takes every longitude once the band reaches a pole', () => {
    expect(hemisphereBox({ lat: 40, lon: -100 }).key).toBe('-180,-30,180,90');
    expect(hemisphereBox({ lat: -89, lon: 60 }).key).toBe('-180,-90,180,-15');
    expect(hemisphereBox({ lat: 90, lon: 0 }).key).toBe('-180,15,180,90');
  });

  it('wraps across the antimeridian', () => {
    const b = hemisphereBox({ lat: 0, lon: 170 });
    expect(b.key).toBe('60,-75,-90,75');
    expect(b.bbox[0]).toBeGreaterThan(b.bbox[2]);
    // ±180 are the same sub-point and the same box.
    expect(hemisphereBox({ lat: 0, lon: 180 }).key).toBe(hemisphereBox({ lat: 0, lon: -180 }).key);
    expect(hemisphereBox({ lat: 0, lon: 180 }).key).toBe('75,-75,-75,75');
    // An edge that lands on the antimeridian doesn't fake a crossing.
    expect(hemisphereBox({ lat: 0, lon: 75 }).key).toBe('-30,-75,180,75');
    expect(hemisphereBox({ lat: 0, lon: -75 }).key).toBe('-180,-75,30,75');
  });
});
