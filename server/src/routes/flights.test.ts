import { describe, expect, it } from 'vitest';
import { recordTrackPoint, type FlightTrackPoint } from './flights';

const HOUR = 3_600_000;

function pt(partial: Partial<FlightTrackPoint>): FlightTrackPoint {
  return { lat: 0, lon: 0, altFt: 10_000, ground: false, t: 0, ...partial };
}

describe('recordTrackPoint', () => {
  it('appends a fix that moved past the jitter threshold', () => {
    const pts: FlightTrackPoint[] = [pt({ t: 1_000 })];
    // 0.001° of latitude ≈ 111 m — well past the 30 m threshold.
    recordTrackPoint(pts, pt({ lat: 0.001, t: 2_000 }));
    expect(pts).toHaveLength(2);
    expect(pts[1].lat).toBe(0.001);
  });

  it('ignores transponder jitter while parked', () => {
    const pts: FlightTrackPoint[] = [pt({ t: 1_000 })];
    // 0.0001° of latitude ≈ 11 m — inside the 30 m threshold.
    recordTrackPoint(pts, pt({ lat: 0.0001, t: 60_000 }));
    expect(pts).toHaveLength(1);
  });

  it('seeds an empty trail with its first fix', () => {
    const pts: FlightTrackPoint[] = [];
    recordTrackPoint(pts, pt({ t: 1_000 }));
    expect(pts).toHaveLength(1);
  });

  it('drops points older than the 24h window as new fixes arrive', () => {
    const pts: FlightTrackPoint[] = [pt({ lat: 0, t: 0 }), pt({ lat: 0.01, t: 12 * HOUR })];
    recordTrackPoint(pts, pt({ lat: 0.02, t: 25 * HOUR }));
    expect(pts.map((p) => p.t)).toEqual([12 * HOUR, 25 * HOUR]);
  });

  it('caps the trail length', () => {
    const pts: FlightTrackPoint[] = [];
    for (let i = 0; i < 2_600; i++) {
      // Each step ≈ 111 m so every fix clears the movement threshold.
      recordTrackPoint(pts, pt({ lat: i * 0.001, t: i * 10_000 }));
    }
    expect(pts.length).toBe(2_500);
    // Oldest points were shifted off, newest kept.
    expect(pts[pts.length - 1].lat).toBeCloseTo(2.599);
  });
});
