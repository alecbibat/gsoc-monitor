import { describe, expect, it } from 'vitest';
import { alertRings, type RawAlert } from '../layers/alerts/alertsData';
import { ENDED_COLOR } from './notices';
import {
  ALL_PINS, SEEN_TTL_MS, detectNewAlertNotices, nwsCancelNotice, pinsNearRings, vanishedEarly, type PinRef, type SeenMap,
} from './pinAlertMatch';

const PIN_A: PinRef = { key: 'g::A', name: 'Lodge A', groupName: 'G', lat: 40, lon: -105 };
const PIN_B: PinRef = { key: 'g::B', name: 'Lodge B', groupName: 'G', lat: 41, lon: -100 };
const PINS = [PIN_A, PIN_B];

const box = (w: number, s: number, e: number, n: number) => [[w, s], [e, s], [e, n], [w, n], [w, s]];
// Covers pin A.
const OVER_A = box(-105.1, 39.9, -104.9, 40.1);
// ~10 mi east of pin A (0.19° of longitude at 40°N ≈ 16 km).
const NEAR_A = box(-104.81, 39.95, -104.7, 40.05);
// ~25 mi east of pin A.
const BEYOND_A = box(-104.53, 39.95, -104.4, 40.05);
// Covers pin B.
const OVER_B = box(-100.1, 40.9, -99.9, 41.1);

function alert(id: string, rings: number[][][], extra: Partial<RawAlert['properties']> = {}): RawAlert {
  return {
    geometry: rings.length === 1 ? { type: 'Polygon', coordinates: rings } : { type: 'MultiPolygon', coordinates: rings.map((r) => [r]) },
    properties: { id, event: 'Flash Flood Warning', status: 'Actual', messageType: 'Alert', ...extra },
  };
}

const ringsOf = (a: RawAlert) => alertRings(a, null);

/** Run polls in order; returns the notices of each. */
function run(polls: RawAlert[][], start = 1_000_000, stepMs = 60_000) {
  let seen: SeenMap = new Map();
  return polls.map((alerts, i) => {
    const out = detectNewAlertNotices({ alerts, ringsOf, seen, baseline: i === 0, now: start + i * stepMs, pins: PINS });
    seen = out.seen;
    return out.notices;
  });
}

describe('pinsNearRings', () => {
  it('counts a covered pin as 0 mi and a nearby one by its distance, nearest first', () => {
    const hits = pinsNearRings([NEAR_A, OVER_B], PINS);
    expect(hits.map((h) => h.pin.key)).toEqual(['g::B', 'g::A']);
    expect(hits[0].distanceMi).toBe(0);
    expect(hits[1].distanceMi).toBeGreaterThan(9);
    expect(hits[1].distanceMi).toBeLessThan(11);
  });

  it('ignores pins beyond the radius', () => {
    expect(pinsNearRings([BEYOND_A], PINS)).toEqual([]);
    expect(pinsNearRings([BEYOND_A], PINS, 30)).toHaveLength(1);
  });

  it('has no hits without geometry', () => {
    expect(pinsNearRings([], PINS)).toEqual([]);
  });
});

describe('detectNewAlertNotices', () => {
  it('stays quiet on the first poll: what is already in effect is the baseline', () => {
    const [first] = run([[alert('x', [OVER_A])]]);
    expect(first).toEqual([]);
  });

  it('announces a new alert that covers or comes within 15 mi of a pin, once', () => {
    const [, second, third] = run([
      [],
      [alert('cover', [OVER_A]), alert('near', [NEAR_A]), alert('far', [BEYOND_A])],
      [alert('cover', [OVER_A]), alert('near', [NEAR_A]), alert('far', [BEYOND_A])],
    ]);
    expect(second.map((n) => n.id)).toEqual(['cover', 'near']);
    expect(second[0].hits[0]).toMatchObject({ pin: PIN_A, distanceMi: 0 });
    expect(second[0].isUpdate).toBe(false);
    expect(third).toEqual([]);
  });

  it('frames both the alert and the pins it reaches', () => {
    const [, [notice]] = run([[], [alert('near', [NEAR_A])]]);
    const [w, s, e, n] = notice.bbox;
    expect(w).toBeLessThanOrEqual(PIN_A.lon);
    expect(e).toBeCloseTo(-104.7);
    expect(s).toBeCloseTo(39.95);
    expect(n).toBeCloseTo(40.05);
  });

  it('stays quiet on a routine re-issue: same pins, same hazard — new wording, expiry and restated onset', () => {
    const v1 = alert('v1', [OVER_A], {
      ends: '2026-11-07T02:00:00-07:00', onset: '2026-11-05T09:28:00-07:00', sent: '2026-11-05T09:28:00-07:00',
      expires: '2026-11-05T21:15:00-07:00', headline: 'Flood Warning issued November 5 at 9:28AM', description: 'Flooding is expected.',
    });
    const v2 = alert('v2', [OVER_A], {
      messageType: 'Update', references: [{ identifier: 'v1' }],
      ends: '2026-11-07T02:00:00-07:00', onset: '2026-11-05T15:02:00-07:00', sent: '2026-11-05T15:02:00-07:00',
      expires: '2026-11-06T03:15:00-07:00', headline: 'Flood Warning issued November 5 at 3:02PM', description: 'Flooding continues.',
    });
    const [, first, second] = run([[], [v1], [v2]]);
    expect(first).toHaveLength(1);
    expect(second).toEqual([]);
  });

  it('announces an update that moves the end at the pins it reaches, saying what changed', () => {
    const v1 = alert('v1', [OVER_A], { ends: '2026-11-06T00:00:00-07:00', sent: '2026-11-05T09:28:00-07:00' });
    const v2 = alert('v2', [OVER_A], {
      messageType: 'Update', references: [{ identifier: 'v1' }],
      ends: '2026-11-07T02:00:00-07:00', certainty: 'Observed', sent: '2026-11-05T10:26:00-07:00',
    });
    const [, , second] = run([[], [v1], [v2]]);
    expect(second).toHaveLength(1);
    expect(second[0]).toMatchObject({ id: 'v2', key: 'nws:v2', isUpdate: true, newPins: [], endedAt: [], cancelled: null });
    expect(second[0].changes.map((c) => c.label)).toEqual(['Certainty', 'Ends']);
    expect(second[0].color).not.toBe(ENDED_COLOR);
  });

  it('announces an upgrade from watch to warning', () => {
    const watch = alert('w', [OVER_A], { event: 'Winter Storm Watch', severity: 'Moderate' });
    const warning = alert('W', [OVER_A], {
      event: 'Winter Storm Warning', severity: 'Severe', messageType: 'Update', references: [{ identifier: 'w' }],
    });
    const [, , second] = run([[], [watch], [warning]]);
    expect(second.map((n) => n.changes.map((c) => `${c.label}: ${c.from} → ${c.to}`))).toEqual([
      ['Alert: Winter Storm Watch → Winter Storm Warning', 'Severity: Moderate → Severe'],
    ]);
  });

  it('announces a change to an alert already in effect when the dashboard opened', () => {
    const v1 = alert('v1', [OVER_A], { ends: '2026-11-06T00:00:00Z' });
    const v2 = alert('v2', [OVER_A], { messageType: 'Update', references: [{ identifier: 'v1' }], ends: '2026-11-06T12:00:00Z' });
    const [, second] = run([[v1], [v2]]);
    expect(second.map((n) => n.changes.map((c) => c.label))).toEqual([['Ends']]);
  });

  it('announces, in the calm colour, an update that no longer covers a pin — it ended there', () => {
    const v1 = alert('v1', [OVER_A, OVER_B]);
    const v2 = alert('v2', [OVER_B], { messageType: 'Update', references: [{ identifier: 'v1' }] });
    const [, , second] = run([[], [v1], [v2]]);
    expect(second).toHaveLength(1);
    expect(second[0].endedAt).toEqual([PIN_A]);
    expect(second[0].hits.map((h) => h.pin.key)).toEqual(['g::B']);
    expect(second[0]).toMatchObject({ color: ENDED_COLOR, rank: 3, changes: [], newPins: [] });
  });

  it('tells a pin the alert left even when it now reaches none, but not a pin it was only near', () => {
    const v1 = alert('v1', [OVER_A]);
    const gone = alert('v2', [OVER_B.map(([lon, lat]) => [lon + 20, lat])], { messageType: 'Update', references: [{ identifier: 'v1' }] });
    expect(run([[], [v1], [gone]])[2].map((n) => n.endedAt)).toEqual([[PIN_A]]);
    const n1 = alert('n1', [NEAR_A]);
    const away = alert('n2', [BEYOND_A], { messageType: 'Update', references: [{ identifier: 'n1' }], ends: '2026-11-09T00:00:00Z' });
    expect(run([[], [n1], [away]])[2]).toEqual([]);
  });

  it('announces an update once it reaches a pin the earlier version did not', () => {
    const v1 = alert('v1', [OVER_A]);
    const v2 = alert('v2', [OVER_A, OVER_B], { messageType: 'Update', references: [{ identifier: 'v1' }] });
    const [, , second] = run([[], [v1], [v2]]);
    expect(second).toHaveLength(1);
    expect(second[0].isUpdate).toBe(true);
    expect(second[0].hits.map((h) => h.pin.key)).toEqual(['g::A', 'g::B']);
  });

  it('treats an update of an alert from before the baseline as a continuation', () => {
    const v1 = alert('v1', [OVER_A]);
    const v2 = alert('v2', [OVER_A], { messageType: 'Update', references: [{ identifier: 'v1' }] });
    const [, second] = run([[v1], [v2]]);
    expect(second).toEqual([]);
  });

  it('announces an original and its update arriving in the same poll once', () => {
    const v1 = alert('v1', [OVER_A]);
    const v2 = alert('v2', [OVER_A], { messageType: 'Update', references: [{ identifier: 'v1' }] });
    const [, second] = run([[], [v2, v1]]);
    expect(second.map((n) => n.id)).toEqual(['v1']);
  });

  it('never announces tests, exercises or a cancel message itself', () => {
    const [, second] = run([
      [],
      [
        alert('t', [OVER_A], { status: 'Test' }),
        alert('e', [OVER_A], { status: 'Exercise' }),
        alert('c', [OVER_A], { messageType: 'Cancel' }),
      ],
    ]);
    expect(second).toEqual([]);
  });

  it('remembers an alert through a feed blip, but not forever', () => {
    const a = alert('a', [OVER_A]);
    // Seen at the baseline, missing for one poll, back the next: still old news.
    expect(run([[a], [], [a]])[2]).toEqual([]);
    // Gone for longer than the memory window: it counts as new again.
    const polls = run([[a], [], [a]], 1_000_000, SEEN_TTL_MS);
    expect(polls[2].map((n) => n.id)).toEqual(['a']);
  });
});

describe('cancellations', () => {
  const NOW = Date.parse('2026-11-05T19:00:00Z');
  const live = (id: string, extra: Partial<RawAlert['properties']> = {}) =>
    alert(id, [OVER_A], { ends: '2026-11-05T23:00:00Z', expires: '2026-11-05T21:00:00Z', ...extra });

  it('finds an alert that left the feed before its end, with nothing replacing it', () => {
    const gone = live('gone');
    const replaced = live('replaced');
    const update = live('upd', { messageType: 'Update', references: [{ identifier: 'replaced' }] });
    const ended = live('ended', { ends: '2026-11-05T18:59:00Z', expires: '2026-11-05T18:59:00Z' });
    const open = live('open', { ends: null, expires: '2026-11-05T20:00:00Z' });
    expect(vanishedEarly([gone, replaced, ended, open, live('stays')], [update, live('stays')], NOW).map((a) => a.properties.id)).toEqual([
      'gone',
      'open',
    ]);
  });

  it('makes a calm notice for a cancelled alert at the pins it reached, none for one far away', () => {
    const cancel = { id: 'cancel-1', sent: '2026-11-05T19:00:00Z', description: 'The Flood Warning has been cancelled.' };
    const n = nwsCancelNotice({ alert: live('gone'), cancel, rings: [OVER_A], pins: PINS });
    expect(n).toMatchObject({
      category: 'nws', key: 'nws:cancel-1', color: ENDED_COLOR, isUpdate: true, endedAt: [PIN_A],
      cancelled: { sent: '2026-11-05T19:00:00Z', text: 'The Flood Warning has been cancelled.' },
    });
    expect(nwsCancelNotice({ alert: live('far'), cancel, rings: [BEYOND_A.map(([lon, lat]) => [lon + 30, lat])], pins: PINS })).toBeNull();
  });
});

describe('ALL_PINS', () => {
  it('lists every location pin with a unique key', () => {
    expect(ALL_PINS.length).toBeGreaterThan(10);
    expect(new Set(ALL_PINS.map((p) => p.key)).size).toBe(ALL_PINS.length);
  });
});
