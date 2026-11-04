import { describe, expect, it } from 'vitest';
import type { EarthquakeFeature, FlightEventWithModel, ShipPortEvent, WarnAlert } from '../types';
import {
  NOTICE_MAX_AGE_MS, detectFlightNotices, detectQuakeNotices, detectShipNotices, detectWarnNotices, warnHits,
  type SeenIds,
} from './detectors';
import type { PinRef, SeenMap } from './pinAlertMatch';

const PIN_A: PinRef = { key: 'g::A', name: 'Lodge A', groupName: 'G', lat: 40, lon: -105 };
const PIN_B: PinRef = { key: 'g::B', name: 'Lodge B', groupName: 'G', lat: 41, lon: -100 };
const PINS = [PIN_A, PIN_B];
const NOW = Date.parse('2026-11-04T18:00:00Z');
const MIN = 60_000;

// ~0.58° of longitude ≈ 30 mi at 40°N; ~1.16° ≈ 61 mi.
const box = (w: number, s: number, e: number, n: number) => [[w, s], [e, s], [e, n], [w, n], [w, s]];

function wea(id: string, extra: Partial<WarnAlert> = {}): WarnAlert {
  return {
    id, capId: `CAP-${id}`, event: 'Law Enforcement Warning', sender: 'County OEM', weaClass: 'public-safety',
    category: 'safety', severity: 'Severe', urgency: 'Immediate', certainty: 'Observed', responseType: null,
    msgType: 'alert', referencedId: null, sent: new Date(NOW - 10 * MIN).toISOString(),
    expires: new Date(NOW + 3 * 60 * MIN).toISOString(), weaText: 'Shelter in place.', weaLongText: null,
    headline: null, description: null, instruction: null, spanishText: null, areaDesc: null, counties: [],
    polygons: [], circles: [], nws: false, ...extra,
  };
}

/** Run polls in order (first one is the baseline); return each poll's notices. */
function runWarn(polls: WarnAlert[][]) {
  let seen: SeenMap = new Map();
  return polls.map((alerts, i) => {
    const out = detectWarnNotices({ alerts, seen, baseline: i === 0, now: NOW + i * MIN, pins: PINS });
    seen = out.seen;
    return out.notices;
  });
}

describe('WEA (PBS WARN) notices', () => {
  it('reaches pins within 50 mi of a polygon or a circle, at their distance', () => {
    const near = wea('p', { polygons: [box(-104.42, 39.9, -104.3, 40.1)] }); // ~30 mi east of A
    expect(warnHits(near, PINS, 50).map((h) => h.pin.key)).toEqual(['g::A']);
    expect(warnHits(near, PINS, 50)[0].distanceMi).toBeGreaterThan(28);
    // A 5 km circle centred 1.2° east of A (~63 mi): its edge is ~60 mi away.
    expect(warnHits(wea('c', { circles: [{ lon: -103.8, lat: 40, radiusKm: 5 }] }), PINS, 50)).toEqual([]);
    expect(warnHits(wea('c', { circles: [{ lon: -103.8, lat: 40, radiusKm: 30 }] }), PINS, 50)).toHaveLength(1);
    expect(warnHits(wea('in', { circles: [{ lon: -105, lat: 40, radiusKm: 2 }] }), PINS, 50)[0].distanceMi).toBe(0);
  });

  it('stays quiet on the baseline, announces a new nearby WEA once, and ignores far ones', () => {
    const near = wea('n1', { polygons: [box(-105.1, 39.9, -104.9, 40.1)] });
    const far = wea('f1', { polygons: [box(-90.1, 30, -90, 30.1)] });
    const [first, second, third] = runWarn([[], [near, far], [near, far]]);
    expect(first).toEqual([]);
    expect(second.map((n) => n.key)).toEqual(['warn:n1']);
    expect(second[0]).toMatchObject({ category: 'warn', color: expect.stringMatching(/^#/), isUpdate: false });
    expect(third).toEqual([]);
  });

  it('treats an update of a WEA already shown like a continuation', () => {
    const v1 = wea('v1', { polygons: [box(-105.1, 39.9, -104.9, 40.1)] });
    const v2 = wea('v2', { msgType: 'update', referencedId: 'v1', polygons: [box(-105.1, 39.9, -104.9, 40.1)] });
    const v3 = wea('v3', { msgType: 'update', referencedId: 'v2', polygons: [box(-105.1, 39.9, -104.9, 40.1), box(-100.1, 40.9, -99.9, 41.1)] });
    const [, , second, third] = runWarn([[], [v1], [v2], [v3]]);
    expect(second).toEqual([]);
    expect(third).toHaveLength(1);
    expect(third[0].isUpdate).toBe(true);
  });

  it('carries the NWS alert id as an alias for an NWS-issued WEA', () => {
    const n = wea('nws1', {
      nws: true,
      capId: 'urn:oid:2.49.0.1.840.0.abc.001.1.IPAWS',
      weaClass: 'imminent-threat',
      polygons: [box(-105.1, 39.9, -104.9, 40.1)],
    });
    const [, second] = runWarn([[], [n]]);
    expect(second[0].aliases).toEqual(['nws:urn:oid:2.49.0.1.840.0.abc.001.1']);
  });

  it('skips an expired WEA', () => {
    const old = wea('x', { expires: new Date(NOW - MIN).toISOString(), polygons: [box(-105.1, 39.9, -104.9, 40.1)] });
    expect(runWarn([[], [old]])[1]).toEqual([]);
  });
});

function quake(id: string, mag: number, lon: number, lat: number, ageMin = 5): EarthquakeFeature {
  return {
    id,
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [lon, lat, 8.2] },
    properties: { mag, place: `${id} place`, time: NOW - ageMin * MIN, updated: NOW, url: `https://usgs/${id}`, detail: '', felt: null, tsunami: 0 } as unknown as EarthquakeFeature['properties'],
  };
}

function runQuakes(polls: EarthquakeFeature[][]) {
  let seen: SeenMap = new Map();
  return polls.map((features, i) => {
    const out = detectQuakeNotices({ features, seen, baseline: i === 0, now: NOW + i * MIN, pins: PINS });
    seen = out.seen;
    return out.notices;
  });
}

describe('earthquake notices', () => {
  it('announces an M4.5+ quake within 50 mi of a pin, once', () => {
    const near = quake('q1', 5.1, -104.6, 40.2); // ~25 mi from A
    const [, second, third] = runQuakes([[], [near], [near]]);
    expect(second).toHaveLength(1);
    expect(second[0]).toMatchObject({ key: 'quake:q1', quake: { mag: 5.1, depthKm: 8.2 } });
    expect(second[0].hits[0].pin.key).toBe('g::A');
    expect(third).toEqual([]);
  });

  it('ignores quakes that are too small, too far or too old', () => {
    const [, second] = runQuakes([[], [
      quake('small', 4.4, -104.9, 40),
      quake('far', 6.0, -96, 35),
      quake('old', 5.0, -104.9, 40, NOTICE_MAX_AGE_MS / MIN + 30),
    ]]);
    expect(second).toEqual([]);
  });

  it('announces a quake revised up past M4.5', () => {
    const [, , third] = runQuakes([[], [quake('r', 4.3, -104.9, 40)], [quake('r', 4.7, -104.9, 40)]]);
    expect(third.map((n) => n.key)).toEqual(['quake:r']);
  });

  it('colours a major quake red', () => {
    const [, second] = runQuakes([[], [quake('big', 6.4, -104.9, 40)]]);
    expect(second[0].color).toBe('#ff5d5d');
  });
});

function flightEvent(id: string, extra: Partial<FlightEventWithModel> = {}): FlightEventWithModel {
  return { id, reg: 'N10AZ', group: 'company', kind: 'takeoff', lat: 39.57, lon: -104.85, t: NOW - 3 * MIN, model: 'Dassault Falcon 900 B', ...extra };
}

describe('company aircraft notices', () => {
  it('announces new takeoffs and landings of the company tails only, after the baseline', () => {
    let seen: SeenIds = new Map();
    const run = (events: FlightEventWithModel[], baseline: boolean) => {
      const out = detectFlightNotices({ events, seen, baseline, now: NOW });
      seen = out.seen;
      return out.notices;
    };
    expect(run([flightEvent('old')], true)).toEqual([]);
    const next = run([flightEvent('new', { kind: 'landing' }), flightEvent('old'), flightEvent('tanker', { group: 'fire-tankers' })], false);
    expect(next.map((n) => n.key)).toEqual(['flight:new']);
    expect(run([flightEvent('new', { kind: 'landing' })], false)).toEqual([]);
  });

  it('does not announce an event first seen hours after it happened', () => {
    const out = detectFlightNotices({ events: [flightEvent('stale', { t: NOW - NOTICE_MAX_AGE_MS - MIN })], seen: new Map(), baseline: false, now: NOW });
    expect(out.notices).toEqual([]);
  });
});

function portEvent(id: string, extra: Partial<ShipPortEvent> = {}): ShipPortEvent {
  return {
    id, mmsi: '311084000', name: 'Star Pride', kind: 'arrival',
    port: { name: "St. George's", country: 'GD', locode: 'GDSTG', distanceKm: 0.6 },
    lat: 12.05, lon: -61.75, t: NOW - 100 * MIN, detectedAt: NOW - MIN, destination: null, ...extra,
  };
}

describe('Windstar port notices', () => {
  it('judges freshness by when the server saw the call, not when it happened', () => {
    // Happened 100 min ago (two-hourly fixes), detected a minute ago: news.
    const out = detectShipNotices({ events: [portEvent('a')], seen: new Map(), baseline: false, now: NOW });
    expect(out.notices.map((n) => n.key)).toEqual(['ship:a']);
    const stale = detectShipNotices({ events: [portEvent('b', { detectedAt: NOW - NOTICE_MAX_AGE_MS - MIN })], seen: new Map(), baseline: false, now: NOW });
    expect(stale.notices).toEqual([]);
  });

  it('stays quiet on the baseline', () => {
    expect(detectShipNotices({ events: [portEvent('a')], seen: new Map(), baseline: true, now: NOW }).notices).toEqual([]);
  });
});
