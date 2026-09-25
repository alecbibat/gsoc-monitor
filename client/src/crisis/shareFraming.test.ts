import { describe, expect, it } from 'vitest';
import { drawnExtentRect, MIN_DRAWN_SPAN_DEG, openingFrame, pinsView, REGIONAL_SPAN_DEG } from './shareFraming';
import type { DrawLayer } from './crisisStore';
import type { LocationGroup } from '../layers/locations/locations';
import { SHIP_GROUP_ID } from './incidentShips';

// Opening camera of the public share globe.

const layer = (positions: DrawLayer['positions'], visible = true): DrawLayer => ({
  id: `l-${positions.length}-${visible}`, name: 'Zone', type: 'exclusion-zone', geometry: 'polygon',
  color: '#ef4444', visible, positions, createdAt: '2026-01-01T00:00:00Z',
});
const group = (id: string, lat = 36.05, lon = -112.14): LocationGroup => ({
  id, name: id, color: '#fff', icon: '📍', locations: [{ name: `${id} lodge`, lat, lon }],
});
const ships = group(SHIP_GROUP_ID, 25, -80);

// A ~300 m exclusion zone.
const small = layer([{ lat: 36.05, lon: -112.14 }, { lat: 36.0527, lon: -112.14 }, { lat: 36.0527, lon: -112.1367 }]);

describe('drawnExtentRect', () => {
  it('opens property-scale drawings in a ~3 km frame, not a regional one', () => {
    const r = drawnExtentRect([small])!;
    expect(r.north - r.south).toBeCloseTo(MIN_DRAWN_SPAN_DEG, 6);
    expect(r.east - r.west).toBeCloseTo(MIN_DRAWN_SPAN_DEG, 6);
    // …centred on the drawing
    expect((r.north + r.south) / 2).toBeCloseTo(36.05135, 5);
  });

  it('gives large drawings a 25% margin', () => {
    const r = drawnExtentRect([layer([{ lat: 30, lon: -100 }, { lat: 32, lon: -96 }])])!;
    expect(r).toEqual({ west: -101, south: 29.5, east: -95, north: 32.5 });
  });

  it('frames a single marker, ignores hidden layers, and clamps to the globe', () => {
    expect(drawnExtentRect([layer([{ lat: 10, lon: 20 }])])).not.toBeNull();
    expect(drawnExtentRect([layer([{ lat: 10, lon: 20 }], false)])).toBeNull();
    expect(drawnExtentRect([])).toBeNull();
    const edge = drawnExtentRect([layer([{ lat: 89.999, lon: 179.999 }])])!;
    expect(edge.north).toBe(90);
    expect(edge.east).toBe(180);
  });

  it('honours a regional minimum', () => {
    const r = drawnExtentRect([small], REGIONAL_SPAN_DEG)!;
    expect(r.north - r.south).toBeCloseTo(REGIONAL_SPAN_DEG, 6);
  });
});

describe('pinsView', () => {
  it('gives a single property a labelled close-up, and honours a floor', () => {
    expect(pinsView([group('grand-canyon')])).toEqual({ lon: -112.14, lat: 36.05, height: 80_000 });
    expect(pinsView([group('grand-canyon')], 400_000)!.height).toBe(400_000);
    expect(pinsView([])).toBeNull();
  });
});

describe('openingFrame', () => {
  const base = { drawLayers: [] as DrawLayer[], pinGroups: [] as LocationGroup[], primaryGroupId: null, shipGroup: null };

  it('prefers the drawn incident area', () => {
    const f = openingFrame({ ...base, drawLayers: [small], pinGroups: [group('grand-canyon')], primaryGroupId: 'grand-canyon' });
    expect(f?.kind).toBe('drawn');
  });

  it('frames a pin-only incident on its own property, then all pins', () => {
    const gc = group('grand-canyon');
    const ys = group('yellowstone', 44.6, -110.5);
    expect(openingFrame({ ...base, pinGroups: [gc, ys], primaryGroupId: 'yellowstone' }))
      .toEqual({ kind: 'pins', groups: [ys] });
    expect(openingFrame({ ...base, pinGroups: [gc, ys], primaryGroupId: 'gone' }))
      .toEqual({ kind: 'pins', groups: [gc, ys] });
  });

  it('waits for a fleet incident’s first vessel position', () => {
    const extra = group('corporate', 39.6, -104.9);
    expect(openingFrame({ ...base, pinGroups: [extra], primaryGroupId: SHIP_GROUP_ID })).toBeNull();
    expect(openingFrame({ ...base, pinGroups: [extra], primaryGroupId: SHIP_GROUP_ID, shipGroup: ships }))
      .toEqual({ kind: 'pins', groups: [ships] });
  });

  it('falls back to vessels, and to nothing (keep waiting)', () => {
    expect(openingFrame({ ...base, shipGroup: ships })).toEqual({ kind: 'pins', groups: [ships] });
    expect(openingFrame(base)).toBeNull();
    expect(openingFrame({ ...base, drawLayers: [layer([{ lat: 1, lon: 1 }], false)] })).toBeNull();
  });
});
