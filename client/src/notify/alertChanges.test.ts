import { describe, expect, it } from 'vitest';
import { nwsChanges, weaChanges, type NwsFacts, type WeaFacts } from './alertChanges';

// Pairs taken from the live NWS feed (2026-11-05): a version and the update that replaced it.
const nws = (f: Partial<NwsFacts>): NwsFacts => ({
  event: 'Flood Warning', severity: 'Severe', certainty: 'Likely', onset: null, ends: null, sent: null, ...f,
});

describe('nwsChanges', () => {
  it('finds nothing in a routine re-issue (VTEC CON): onset restated as the issue time, same end', () => {
    // Coastal Flood Advisory, under way: NWS restates onset as each issue time.
    const prior = nws({ event: 'Coastal Flood Advisory', severity: 'Minor', onset: '2026-11-05T01:25:00-05:00', ends: '2026-11-06T04:00:00-05:00', sent: '2026-11-05T01:25:00-05:00' });
    const next = { ...prior, onset: '2026-11-05T13:48:00-05:00', sent: '2026-11-05T13:48:00-05:00' };
    expect(nwsChanges(prior, next)).toEqual([]);
  });

  it('reads the same moment written with another offset as unchanged', () => {
    const prior = nws({ ends: '2026-11-06T00:00:00-07:00' });
    expect(nwsChanges(prior, { ...prior, ends: '2026-11-06T07:00:00+00:00' })).toEqual([]);
  });

  it('finds an end moved later, and flooding now observed (VTEC EXT)', () => {
    const prior = nws({ onset: '2026-11-05T09:28:00-07:00', ends: '2026-11-06T00:00:00-07:00', sent: '2026-11-05T09:28:00-07:00' });
    const next = nws({ certainty: 'Observed', onset: '2026-11-05T10:26:00-07:00', ends: '2026-11-07T02:00:00-07:00', sent: '2026-11-05T10:26:00-07:00' });
    expect(nwsChanges(prior, next)).toEqual([
      { label: 'Certainty', from: 'Likely', to: 'Observed', kind: 'text' },
      { label: 'Ends', from: '2026-11-06T00:00:00-07:00', to: '2026-11-07T02:00:00-07:00', kind: 'time' },
    ]);
  });

  it('finds an end brought forward', () => {
    const prior = nws({ event: 'Flood Advisory', ends: '2026-11-06T02:00:00-07:00', sent: '2026-11-04T21:46:00-07:00', onset: '2026-11-04T21:46:00-07:00' });
    const next = { ...prior, ends: '2026-11-05T23:00:00-07:00', sent: '2026-11-05T09:52:00-07:00', onset: '2026-11-05T09:52:00-07:00' };
    expect(nwsChanges(prior, next).map((c) => c.label)).toEqual(['Ends']);
  });

  it('finds a start moved while the hazard had not begun — earlier or later', () => {
    // Gale Warning due at 1 PM, now in effect from 11:09 AM.
    const prior = nws({ event: 'Gale Warning', onset: '2026-11-05T13:00:00-05:00', sent: '2026-11-05T04:00:00-05:00', ends: '2026-11-06T06:00:00-05:00' });
    const early = { ...prior, onset: '2026-11-05T11:09:00-05:00', sent: '2026-11-05T11:09:00-05:00' };
    expect(nwsChanges(prior, early)).toEqual([
      { label: 'Starts', from: '2026-11-05T13:00:00-05:00', to: '2026-11-05T11:09:00-05:00', kind: 'time' },
    ]);
    const later = { ...prior, onset: '2026-11-06T14:00:00-05:00', sent: '2026-11-05T11:09:00-05:00' };
    expect(nwsChanges(prior, later).map((c) => c.label)).toEqual(['Starts']);
  });

  it('ignores a start restated after the hazard began on schedule', () => {
    const prior = nws({ onset: '2026-11-05T13:00:00-05:00', sent: '2026-11-05T04:00:00-05:00', ends: '2026-11-06T06:00:00-05:00' });
    const next = { ...prior, onset: '2026-11-05T15:30:00-05:00', sent: '2026-11-05T15:30:00-05:00' };
    expect(nwsChanges(prior, next)).toEqual([]);
  });

  it('finds an upgrade from watch to warning', () => {
    const prior = nws({ event: 'Winter Storm Watch', severity: 'Moderate', certainty: 'Possible', ends: '2026-11-07T17:00:00-07:00' });
    const next = nws({ event: 'Winter Storm Warning', severity: 'Severe', certainty: 'Likely', ends: '2026-11-07T17:00:00-07:00' });
    expect(nwsChanges(prior, next).map((c) => [c.label, c.from, c.to])).toEqual([
      ['Alert', 'Winter Storm Watch', 'Winter Storm Warning'],
      ['Severity', 'Moderate', 'Severe'],
      ['Certainty', 'Possible', 'Likely'],
    ]);
  });

  it('counts an end set or dropped as a change', () => {
    const open = nws({ ends: null });
    expect(nwsChanges(open, { ...open, ends: '2026-11-06T12:00:00Z' })).toEqual([
      { label: 'Ends', from: null, to: '2026-11-06T12:00:00Z', kind: 'time' },
    ]);
  });
});

const wea = (f: Partial<WeaFacts>): WeaFacts => ({
  event: 'Evacuation Immediate', severity: 'Extreme', certainty: 'Observed', urgency: 'Immediate', responseType: 'Evacuate',
  text: 'Evacuate now: zones 4 and 5.', longText: null, expires: '2026-11-05T22:00:00Z', ...f,
});

describe('weaChanges', () => {
  it('finds nothing in a WEA re-sent as it was, whatever its spacing or case', () => {
    expect(weaChanges(wea({}), wea({ text: ' EVACUATE now:  zones 4 and 5. ' }))).toEqual([]);
  });

  it('finds a new message, action and expiry', () => {
    const next = wea({ responseType: 'AllClear', text: 'All clear: zones 4 and 5 may return.', expires: '2026-11-05T23:30:00Z' });
    expect(weaChanges(wea({}), next)).toEqual([
      { label: 'Action', from: 'Evacuate', to: 'AllClear', kind: 'text' },
      { label: 'Message', from: 'Evacuate now: zones 4 and 5.', to: 'All clear: zones 4 and 5 may return.', kind: 'text' },
      { label: 'Expires', from: '2026-11-05T22:00:00Z', to: '2026-11-05T23:30:00Z', kind: 'time' },
    ]);
  });

  it('finds a change in the longer message when the short one held', () => {
    const prior = wea({ longText: 'Evacuate now: zones 4 and 5. Go north on Hwy 64.' });
    const next = wea({ longText: 'Evacuate now: zones 4 and 5. Hwy 64 is closed; go east on Hwy 180.' });
    expect(weaChanges(prior, next).map((c) => c.label)).toEqual(['Message']);
  });
});
