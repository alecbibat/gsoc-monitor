import { describe, expect, it } from 'vitest';
import { advancePortCall, portAt, type PortCallState, type PortRef, type ShipFix } from './portCalls';

const MIN = 60_000;
const T0 = Date.parse('2026-11-04T06:00:00Z');

// A port at (10, 20); everything within ~15 km of it is "at the port".
const HARBOUR: PortRef = { name: 'Testport', country: 'GR', locode: 'GRTST', distanceKm: 0 };
const namePort = (lat: number, lon: number) =>
  Math.abs(lat - 10) < 0.13 && Math.abs(lon - 20) < 0.13 ? HARBOUR : null;

function fix(minutes: number, lat: number, lon: number, speedKt: number | null, extra: Partial<ShipFix> = {}): ShipFix {
  return { lat, lon, t: T0 + minutes * MIN, speedKt, navStatus: null, destination: null, ...extra };
}

/** Feed fixes in order; return every emitted event. */
function run(fixes: ShipFix[], start?: PortCallState) {
  let state = start;
  const out = [];
  for (const f of fixes) {
    const r = advancePortCall(state, f, namePort);
    state = r.state;
    if (r.emit) out.push(r.emit);
  }
  return { events: out, state: state! };
}

describe('advancePortCall — the sparse (scrape) feed', () => {
  it('reads the first fix as the starting state, never an event', () => {
    expect(run([fix(0, 10, 20, 0)]).state.phase).toBe('in-port');
    expect(run([fix(0, 10, 20, 0)]).events).toEqual([]);
    expect(run([fix(0, 9, 19, 12)]).state.phase).toBe('at-sea');
  });

  it('arrives on the first stopped fix near a port, and departs when the ship has moved off', () => {
    const { events } = run([
      fix(0, 9.6, 19.7, 11),                                           // at sea
      fix(120, 10.01, 20.01, 0),                                       // in port
      fix(240, 10.012, 20.008, 0),                                     // still there
      fix(360, 9.8, 20.3, 10, { destination: 'NEXT PORT' }),           // ~40 km out
    ]);
    expect(events).toEqual([
      expect.objectContaining({ kind: 'arrival', port: HARBOUR, t: T0 + 120 * MIN }),
      expect.objectContaining({ kind: 'departure', port: HARBOUR, t: T0 + 360 * MIN, destination: 'NEXT PORT' }),
    ]);
  });

  it('ignores a ship swinging at anchor or shifting berth within the port', () => {
    const { events } = run([fix(0, 10, 20, 0), fix(120, 10.006, 20.004, 0), fix(240, 10.012, 20.0, 1.5)]);
    expect(events).toEqual([]);
  });

  it('does not call a stop at sea, far from any port, an arrival', () => {
    expect(run([fix(0, 9, 19, 10), fix(120, 9.01, 19.01, 0)]).events).toEqual([]);
  });

  it('reads AIS moored / at-anchor status as stopped even without a speed', () => {
    const { events } = run([fix(0, 9.6, 19.7, 11), fix(120, 10, 20, null, { navStatus: 5 })]);
    expect(events.map((e) => e.kind)).toEqual(['arrival']);
  });

  it('with no speed at all, reads a ship that has not moved across a long gap as stopped', () => {
    const { events } = run([fix(0, 9.6, 19.7, 11), fix(120, 10, 20, null), fix(240, 10.002, 20.001, null)]);
    expect(events).toEqual([expect.objectContaining({ kind: 'arrival', t: T0 + 240 * MIN })]);
  });

  it('ignores a fix older than the one it already has', () => {
    const { state } = run([fix(0, 9.6, 19.7, 11), fix(120, 10, 20, 0)]);
    expect(advancePortCall(state, fix(60, 9, 19, 12), namePort)).toEqual({ state, emit: null });
  });
});

describe('advancePortCall — the dense (live AIS) feed', () => {
  it('holds an arrival until the stop has lasted ten minutes, and dates it from the first stopped fix', () => {
    const { events } = run([
      fix(0, 9.95, 19.95, 9),
      fix(2, 10, 20, 0.3),
      fix(6, 10.001, 20, 0.1),
      fix(11, 10.001, 20.001, 0),
      fix(13, 10.002, 20.001, 0),
    ]);
    expect(events).toEqual([expect.objectContaining({ kind: 'arrival', t: T0 + 2 * MIN })]);
  });

  it('drops a brief stop, like slowing for the pilot', () => {
    const { events, state } = run([fix(0, 9.95, 19.95, 9), fix(2, 10, 20, 0.3), fix(6, 10.01, 20.01, 6)]);
    expect(events).toEqual([]);
    expect(state.pending).toBeNull();
  });

  it('departs on way made a kilometre from the stop', () => {
    const start = run([fix(0, 10, 20, 0)]).state; // in port at first sight
    const { events } = run([fix(5, 10.012, 20.0, 7)], start);
    expect(events.map((e) => e.kind)).toEqual(['departure']);
  });
});

describe('portAt', () => {
  it('names a Windstar anchorage from the gazetteer', () => {
    expect(portAt(-17.495, -149.822)).toMatchObject({ name: 'Moorea (Cook’s Bay)', country: 'PF' });
  });

  it('is null in open water', () => {
    expect(portAt(25, -40)).toBeNull();
  });
});
