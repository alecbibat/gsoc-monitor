import { describe, expect, it } from 'vitest';
import {
  advanceTransition,
  eventAirport,
  decimateTrail,
  iconExpired,
  recordTrackPoint,
  settleSilence,
  type FlightTrackPoint,
  type LastFix,
  type TransitionTracker,
} from './flights';

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

  it('honours a per-group trail window when given one', () => {
    const TWO_H = 2 * 3_600_000;
    const pts: FlightTrackPoint[] = [pt({ lat: 0, t: 0 }), pt({ lat: 0.01, t: TWO_H / 2 })];
    recordTrackPoint(pts, pt({ lat: 0.02, t: TWO_H + 60_000 }), TWO_H);
    expect(pts.map((p) => p.t)).toEqual([TWO_H / 2, TWO_H + 60_000]);
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

describe('advanceTransition', () => {
  const MIN = 2 * 60_000;

  // Run a sequence of (onGround, fixAt) fixes through the machine.
  function run(fixes: Array<[boolean, number]>) {
    let state: TransitionTracker | undefined;
    const emitted: Array<{ kind: string; t: number }> = [];
    for (const [onGround, t] of fixes) {
      const r = advanceTransition(state, onGround, 10, 20, t);
      state = r.state;
      if (r.emit) emitted.push({ kind: r.emit.kind, t: r.emit.sinceT });
    }
    return { state: state!, emitted };
  }

  it('emits a takeoff only after the airborne state persists, stamped at the flip', () => {
    const { emitted } = run([
      [true, 0],
      [true, 10_000],
      [false, 20_000], // wheels up
      [false, 20_000 + MIN], // still airborne two minutes later
    ]);
    expect(emitted).toEqual([{ kind: 'takeoff', t: 20_000 }]);
  });

  it('drops a single glitched fix without ever emitting', () => {
    const { emitted, state } = run([
      [false, 0],
      [true, 10_000], // one bogus ground fix at cruise
      [false, 20_000],
      [false, 20_000 + MIN],
    ]);
    expect(emitted).toEqual([]);
    expect(state.confirmedOnGround).toBe(false);
  });

  it('a touch-and-go bounce produces no phantom events either way', () => {
    const { emitted } = run([
      [false, 0],
      [true, 10_000],
      [true, 40_000],
      [false, 60_000], // climbing again before the landing confirms
      [false, 60_000 + MIN],
    ]);
    expect(emitted).toEqual([]);
  });

  it('never emits for the first sighting, whatever the state', () => {
    expect(advanceTransition(undefined, false, 0, 0, 5_000_000).emit).toBeNull();
    expect(advanceTransition(undefined, true, 0, 0, 5_000_000).emit).toBeNull();
  });

  it('emits a landing once the ground state holds', () => {
    const { emitted, state } = run([
      [false, 0],
      [true, 30_000],
      [true, 30_000 + MIN + 1],
    ]);
    expect(emitted).toEqual([{ kind: 'landing', t: 30_000 }]);
    expect(state.confirmedOnGround).toBe(true);
  });
});

describe('settleSilence', () => {
  const MIN = 60_000;
  const fix = (partial: Partial<LastFix>): LastFix => ({
    onGround: false, latitude: 25.9, longitude: -80.28, groundSpeedKt: 130, verticalRateFpm: -700, updatedAt: 0, ...partial,
  });
  const landingPending = { kind: 'landing' as const, lat: 25.9, lon: -80.28, sinceT: 0 };

  it('confirms a landing when the jet goes quiet after touching down', () => {
    const s: TransitionTracker = { confirmedOnGround: false, pending: landingPending };
    const last = fix({ onGround: true, groundSpeedKt: 20 });
    expect(settleSilence(s, last, MIN, false).emit).toBeNull();
    const out = settleSilence(s, last, 2 * MIN, false);
    expect(out.emit).toEqual(landingPending);
    expect(out.state).toEqual({ confirmedOnGround: true, pending: null });
  });

  it('does not take a glitched ground fix at cruise speed for a landing', () => {
    const s: TransitionTracker = { confirmedOnGround: false, pending: landingPending };
    expect(settleSilence(s, fix({ onGround: true, groundSpeedKt: 450 }), 30 * MIN, false).emit).toBeNull();
  });

  it('leaves a pending takeoff to a second airborne fix', () => {
    const s: TransitionTracker = { confirmedOnGround: true, pending: { ...landingPending, kind: 'takeoff' } };
    const out = settleSilence(s, fix({ verticalRateFpm: 2000 }), 30 * MIN, true);
    expect(out).toEqual({ state: s, emit: null });
  });

  it('infers a landing from a last fix on approach beside an airport, stamped at that fix', () => {
    const s: TransitionTracker = { confirmedOnGround: false, pending: null };
    const last = fix({ updatedAt: 5 * MIN });
    expect(settleSilence(s, last, 14 * MIN, true).emit).toBeNull();
    const out = settleSilence(s, last, 15 * MIN, true);
    expect(out.emit).toEqual({ kind: 'landing', lat: 25.9, lon: -80.28, sinceT: 5 * MIN });
    expect(out.state.confirmedOnGround).toBe(true);
  });

  it('does not infer one away from an airport, at cruise speed, or while climbing out', () => {
    const s: TransitionTracker = { confirmedOnGround: false, pending: null };
    expect(settleSilence(s, fix({}), 60 * MIN, false).state).toBe(s);
    expect(settleSilence(s, fix({ groundSpeedKt: 420 }), 60 * MIN, true).state).toBe(s);
    expect(settleSilence(s, fix({ verticalRateFpm: 1800 }), 60 * MIN, true).state).toBe(s);
  });

  it('adopts a long-past landing without announcing it', () => {
    const s: TransitionTracker = { confirmedOnGround: false, pending: null };
    const out = settleSilence(s, fix({}), 7 * 60 * MIN, true);
    expect(out.emit).toBeNull();
    expect(out.state.confirmedOnGround).toBe(true);
  });

  it('does nothing for an aircraft already known to be on the ground', () => {
    const s: TransitionTracker = { confirmedOnGround: true, pending: null };
    expect(settleSilence(s, fix({ onGround: true, groundSpeedKt: 0 }), 60 * MIN, false).state).toBe(s);
  });
});

describe('iconExpired', () => {
  const TWO_H = 2 * 3_600_000;

  it('never expires company tails, however stale', () => {
    expect(iconExpired('N10AZ', 0, 365 * 24 * 3_600_000)).toBe(false);
  });

  it('hides special-roster aircraft past their 2h TTL and shows them within it', () => {
    expect(iconExpired('N42RF', 1_000_000, 1_000_000 + TWO_H + 1)).toBe(true);
    expect(iconExpired('N42RF', 1_000_000, 1_000_000 + TWO_H - 60_000)).toBe(false);
    expect(iconExpired('N612AX', 1_000_000, 1_000_000 + TWO_H + 1)).toBe(true);
  });
});

describe('decimateTrail', () => {
  it('passes short trails through untouched', () => {
    const pts = Array.from({ length: 500 }, (_, i) => pt({ lat: i * 0.001, t: i * 10_000 }));
    expect(decimateTrail(pts)).toBe(pts);
  });

  it('bounds long trails while always keeping the newest fix', () => {
    const pts = Array.from({ length: 2_500 }, (_, i) => pt({ lat: i * 0.001, t: i * 10_000 }));
    const out = decimateTrail(pts);
    expect(out.length).toBeLessThanOrEqual(700);
    expect(out.length).toBeGreaterThan(500);
    expect(out[out.length - 1]).toBe(pts[pts.length - 1]);
    // Still time-ordered after the stride.
    for (let i = 1; i < out.length; i++) expect(out[i].t).toBeGreaterThan(out[i - 1].t);
  });
});

describe('eventAirport', () => {
  it('names the airport a takeoff or landing used', () => {
    // First airborne fix ~2 km past Centennial's runway end.
    expect(eventAirport(39.585, -104.835)).toMatchObject({
      ident: 'KAPA',
      iata: 'APA',
      name: 'Centennial Airport',
      region: 'CO',
    });
  });

  it('is null away from any listed airport', () => {
    expect(eventAirport(40, -150)).toBeNull();
  });
});
