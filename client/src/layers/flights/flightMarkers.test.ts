import { describe, expect, it } from 'vitest';
import type { FlightTrackPoint } from '../../types';
import {
  FLIGHT_GROUND_COLOR,
  aircraftTypeText,
  altitudeHue,
  chevronPlacements,
  flightAlpha,
  flightMarkerColor,
  lastSeenText,
  resolveTrailAltitudes,
  splitTrail,
  trailBearing,
} from './flightMarkers';

function pt(partial: Partial<FlightTrackPoint>): FlightTrackPoint {
  return { lat: 0, lon: 0, altFt: 10_000, ground: false, t: 0, ...partial };
}

describe('altitudeHue', () => {
  it('clamps at the ends of the scale', () => {
    expect(altitudeHue(0)).toBe(20);
    expect(altitudeHue(2_000)).toBe(20);
    expect(altitudeHue(40_000)).toBe(300);
    expect(altitudeHue(60_000)).toBe(300);
  });

  it('hits the stop hues exactly and interpolates between them', () => {
    expect(altitudeHue(10_000)).toBe(140);
    // Halfway between the 2,000→10,000 ft stops: hue halfway from 20 to 140.
    expect(altitudeHue(6_000)).toBeCloseTo(80);
    // Halfway between the 10,000→40,000 ft stops: hue halfway from 140 to 300.
    expect(altitudeHue(25_000)).toBeCloseTo(220);
  });
});

describe('flightMarkerColor', () => {
  it('uses the slate ground colour for grounded or altitude-less aircraft', () => {
    expect(flightMarkerColor(0, true)).toBe(FLIGHT_GROUND_COLOR);
    expect(flightMarkerColor(null, false)).toBe(FLIGHT_GROUND_COLOR);
  });

  it('quantises altitude so nearby altitudes share one cached texture', () => {
    expect(flightMarkerColor(34_700, false)).toBe(flightMarkerColor(35_200, false));
    expect(flightMarkerColor(5_000, false)).not.toBe(flightMarkerColor(35_000, false));
  });
});

describe('flightAlpha', () => {
  it('draws live aircraft at full strength, grounded slightly dimmed', () => {
    expect(flightAlpha(5, false)).toBe(1);
    expect(flightAlpha(5, true)).toBe(0.85);
  });

  it('fades stale aircraft, hardest after a day', () => {
    expect(flightAlpha(600, false)).toBe(0.55);
    expect(flightAlpha(3 * 24 * 3_600, false)).toBe(0.4);
  });
});

describe('splitTrail', () => {
  it('keeps a continuous trail as one segment', () => {
    const segs = splitTrail([pt({ t: 0 }), pt({ lat: 1, t: 10_000 }), pt({ lat: 2, t: 20_000 })]);
    expect(segs).toHaveLength(1);
    expect(segs[0]).toHaveLength(3);
  });

  it('splits on a reporting gap instead of drawing a chord across it', () => {
    const segs = splitTrail([
      pt({ t: 0 }),
      pt({ lat: 1, t: 60_000 }),
      pt({ lat: 5, t: 60_000 + 16 * 60_000 }),
      pt({ lat: 6, t: 60_000 + 17 * 60_000 }),
    ]);
    expect(segs).toHaveLength(2);
    expect(segs[0].map((p) => p.lat)).toEqual([0, 1]);
    expect(segs[1].map((p) => p.lat)).toEqual([5, 6]);
  });

  it('drops zero-length runs and consecutive duplicate fixes', () => {
    expect(splitTrail([pt({ t: 0 })])).toEqual([]);
    const segs = splitTrail([pt({ t: 0 }), pt({ t: 10_000 }), pt({ lat: 1, t: 20_000 })]);
    expect(segs).toHaveLength(1);
    expect(segs[0]).toHaveLength(2);
  });
});

describe('aircraftTypeText', () => {
  const info = (partial: Record<string, string | null>) => ({
    manufacturer: null,
    model: null,
    icaoType: null,
    ...partial,
  });

  it('joins manufacturer and model', () => {
    expect(aircraftTypeText(info({ manufacturer: 'Cessna', model: 'Citation Excel' }), 'C56X')).toBe(
      'Cessna Citation Excel'
    );
  });

  it('does not repeat a manufacturer already baked into the model name', () => {
    expect(aircraftTypeText(info({ manufacturer: 'Pilatus', model: 'Pilatus PC-12/47E' }), null)).toBe(
      'Pilatus PC-12/47E'
    );
  });

  it("degrades to the registry's ICAO code, then the feed's, then null", () => {
    expect(aircraftTypeText(info({ icaoType: 'C56X' }), 'XXXX')).toBe('C56X');
    expect(aircraftTypeText(info({}), 'PC12')).toBe('PC12');
    expect(aircraftTypeText(null, 'PC12')).toBe('PC12');
    expect(aircraftTypeText(undefined, null)).toBeNull();
  });
});

describe('resolveTrailAltitudes', () => {
  it('carries the last known altitude across an airborne altitude dropout', () => {
    const out = resolveTrailAltitudes([
      pt({ altFt: 30_000, t: 0 }),
      pt({ lat: 1, altFt: null, t: 10_000 }),
      pt({ lat: 2, altFt: 31_000, t: 20_000 }),
    ]);
    expect(out.map((p) => p.altFt)).toEqual([30_000, 30_000, 31_000]);
  });

  it('resets the reference to the surface at a ground fix', () => {
    const out = resolveTrailAltitudes([
      pt({ altFt: 5_000, t: 0 }),
      pt({ lat: 1, altFt: 0, ground: true, t: 10_000 }),
      pt({ lat: 2, altFt: null, t: 20_000 }),
    ]);
    expect(out[2].altFt).toBe(0);
  });

  it('drops airborne fixes seen before any altitude reference exists', () => {
    const out = resolveTrailAltitudes([
      pt({ altFt: null, t: 0 }),
      pt({ lat: 1, altFt: 20_000, t: 10_000 }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].altFt).toBe(20_000);
  });
});

describe('trailBearing', () => {
  it('returns compass bearings for the cardinal directions', () => {
    expect(trailBearing(0, 0, 1, 0)).toBeCloseTo(0);
    expect(trailBearing(0, 0, 0, 1)).toBeCloseTo(90);
    expect(trailBearing(1, 0, 0, 0)).toBeCloseTo(180);
    expect(trailBearing(0, 1, 0, 0)).toBeCloseTo(270);
  });
});

describe('chevronPlacements', () => {
  // A straight northbound run: each 0.05° of latitude is ~5.56 km.
  const northbound = (n: number) =>
    Array.from({ length: n }, (_, i) => pt({ lat: i * 0.05, t: i * 10_000 }));

  it('spaces chevrons by travelled distance, pointing along the track', () => {
    const placements = chevronPlacements(northbound(100), 10_000, 5);
    expect(placements.length).toBeGreaterThan(2);
    expect(placements.length).toBeLessThanOrEqual(5);
    for (const c of placements) {
      expect(c.bearingDeg).toBeCloseTo(0);
      // Never on the segment endpoints — the plane icon marks the head.
      expect(c.lat).toBeGreaterThan(0);
      expect(c.lat).toBeLessThan(99 * 0.05);
    }
  });

  it('widens the spacing instead of exceeding the chevron budget', () => {
    const many = chevronPlacements(northbound(200), 1_000, 8);
    expect(many.length).toBeLessThanOrEqual(8);
  });

  it('skips segments too short to carry a chevron', () => {
    expect(chevronPlacements(northbound(2))).toEqual([]);
    expect(chevronPlacements([])).toEqual([]);
  });
});

describe('lastSeenText', () => {
  it('labels live and stale aircraft on the right timescales', () => {
    expect(lastSeenText(30)).toBe('live');
    expect(lastSeenText(600)).toBe('last seen 10m ago');
    expect(lastSeenText(7_200)).toBe('last seen 2h ago');
    expect(lastSeenText(3 * 24 * 3_600)).toBe('last seen 3d ago');
  });
});
