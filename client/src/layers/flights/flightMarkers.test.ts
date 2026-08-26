import { describe, expect, it } from 'vitest';
import type { FlightTrackPoint } from '../../types';
import {
  FLIGHT_GROUND_COLOR,
  altitudeHue,
  flightAlpha,
  flightMarkerColor,
  lastSeenText,
  resolveTrailAltitudes,
  splitTrail,
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

describe('lastSeenText', () => {
  it('labels live and stale aircraft on the right timescales', () => {
    expect(lastSeenText(30)).toBe('live');
    expect(lastSeenText(600)).toBe('last seen 10m ago');
    expect(lastSeenText(7_200)).toBe('last seen 2h ago');
    expect(lastSeenText(3 * 24 * 3_600)).toBe('last seen 3d ago');
  });
});
