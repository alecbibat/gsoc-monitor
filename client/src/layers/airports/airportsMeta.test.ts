import { describe, expect, it } from 'vitest';
import type { FaaAirportStatus } from '../../types';
import { airportEvents, airportTier, airportsStatusText, closureInEffect, fmtMinutes, reasonText } from './airportsMeta';

const NOW = Date.parse('2026-11-18T18:00:00Z');

export const airport = (over: Partial<FaaAirportStatus> = {}): FaaAirportStatus => ({
  id: 'SFO', name: 'San Francisco International', lat: 37.6213, lon: -122.379,
  groundStop: null, groundDelay: null, arrivalDelay: null, departureDelay: null,
  closure: null, restriction: null, deicing: null, config: null,
  ...over,
});

const stop = { reason: 'wind', start: '2026-11-18T17:20:00Z', end: '2026-11-18T18:45:00Z', extension: 'MEDIUM', facilities: [], advisoryUrl: null };
const delay = { reason: 'WX:Thunderstorms', min: '16 minutes', max: '30 minutes', avgMin: 15, trend: 'increasing', updated: null };
const nightly = { text: 'DLY 0730-1415', notam: null, start: '2026-11-15T07:30:00Z', end: '2026-11-21T14:15:00Z', daily: { from: '0730', to: '1415' } };

describe('airport status', () => {
  it('words minutes and the FAA’s reason codes', () => {
    expect([fmtMinutes(15), fmtMinutes(60), fmtMinutes(92)]).toEqual(['15 min', '1 h', '1 h 32 min']);
    expect(reasonText('WX:Thunderstorms')).toBe('Weather: thunderstorms');
    expect(reasonText('VOL:Volume')).toBe('Volume');
    expect(reasonText('wind')).toBe('Wind');
    expect(reasonText(null)).toBeNull();
  });

  it('lists what is going on worst first, and colours the airport by the worst', () => {
    const a = airport({ departureDelay: delay, groundStop: stop, deicing: { since: null, until: null } });
    expect(airportEvents(a, NOW).map((e) => e.kind)).toEqual(['ground-stop', 'departure-delay', 'deicing']);
    expect(airportTier(a, NOW)).toBe('ground-stop');
    expect(airportEvents(a, NOW)[1].detail).toBe('16 minutes to 30 minutes · increasing · Weather: thunderstorms');
  });

  it('counts a closure at set hours as a closure only during them', () => {
    expect(closureInEffect(nightly, Date.parse('2026-11-18T08:00:00Z'))).toBe(true);
    expect(closureInEffect(nightly, NOW)).toBe(false);
    expect(closureInEffect({ ...nightly, daily: { from: '2200', to: '0600' } }, Date.parse('2026-11-18T23:30:00Z'))).toBe(true);
    expect(closureInEffect({ ...nightly, daily: null }, NOW)).toBe(true);
    expect(closureInEffect({ ...nightly, daily: null, start: '2026-11-19T00:00:00Z' }, NOW)).toBe(false);
    expect(airportTier(airport({ closure: nightly }), NOW)).toBe('notice');
    expect(airportTier(airport({ closure: nightly }), Date.parse('2026-11-18T08:00:00Z'))).toBe('closure');
  });

  it('sums the layer up in a line', () => {
    const tiers = { closure: 0, 'ground-stop': 1, 'ground-delay': 0, delay: 2, deicing: 1, notice: 4 };
    expect(airportsStatusText(tiers, 8)).toBe('1 ground stop · 2 with delays · 1 deicing · 8 airports reporting');
    expect(airportsStatusText({ ...tiers, 'ground-stop': 0, delay: 0, deicing: 0, notice: 0 }, 0)).toBe('No delays or closures reported · FAA');
  });
});
