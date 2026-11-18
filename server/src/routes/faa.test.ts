import { describe, expect, it } from 'vitest';
import { normalizeFaaAirport, normalizeFaaFeed } from './faa';

const NOW = Date.parse('2026-11-18T18:00:00Z');

const sfo = {
  airportId: 'SFO',
  airportLongName: 'San Francisco International',
  latitude: '37.6213',
  longitude: '-122.3790',
  groundStop: {
    impactingCondition: 'wind',
    startTime: '2026-11-18T17:20:00Z',
    endTime: '2026-11-18T18:45:00Z',
    probabilityOfExtension: 'MEDIUM',
    includedFacilities: ['ZLA', 'ZOA', 42, 'not a center'],
    advisoryUrl: 'https://www.fly.faa.gov/adv/adv_otherdis.jsp?advn=51&title=ATCSCC ADVZY 051 SFO/ZOA',
  },
  groundDelay: {
    impactingCondition: 'wind',
    avgDelay: 92.0,
    maxDelay: 341,
    startTime: '2026-11-18T18:00:00Z',
    endTime: '2026-11-19T06:59:00Z',
    advisoryUrl: 'https://evil.example/adv',
  },
  departureDelay: {
    reason: 'WX:Wind',
    arrivalDeparture: { type: 'Departure', min: '16 minutes', max: '30 minutes', trend: 'Increasing' },
    updateTime: '2026-11-18T16:30:00Z',
    averageDelay: '15',
  },
  arrivalDelay: null,
  airportClosure: null,
  freeForm: null,
  deicing: null,
  airportConfig: { arrivalRunwayConfig: '19L/19R', departureRunwayConfig: '10L/10R', arrivalRate: 26 },
};

describe('normalizeFaaAirport', () => {
  it('flattens an airport with a ground stop, a delay program and departure delays', () => {
    const a = normalizeFaaAirport(sfo, NOW)!;
    expect(a).toMatchObject({ id: 'SFO', name: 'San Francisco International', lat: 37.6213, lon: -122.379 });
    expect(a.groundStop).toEqual({
      reason: 'wind',
      start: '2026-11-18T17:20:00.000Z',
      end: '2026-11-18T18:45:00.000Z',
      extension: 'MEDIUM',
      facilities: ['ZLA', 'ZOA'],
      advisoryUrl: 'https://www.fly.faa.gov/adv/adv_otherdis.jsp?advn=51&title=ATCSCC%20ADVZY%20051%20SFO/ZOA',
    });
    expect(a.groundDelay).toMatchObject({ avgMin: 92, maxMin: 341, advisoryUrl: null });
    expect(a.departureDelay).toEqual({
      reason: 'WX:Wind', min: '16 minutes', max: '30 minutes', avgMin: 15, trend: 'increasing', updated: '2026-11-18T16:30:00.000Z',
    });
    expect(a.arrivalDelay).toBeNull();
    expect(a.config).toEqual({ arrival: '19L/19R', departure: '10L/10R', arrivalRate: 26 });
  });

  it('drops a program whose end has passed', () => {
    const a = normalizeFaaAirport(sfo, Date.parse('2026-11-18T19:00:00Z'))!;
    expect(a.groundStop).toBeNull();
    expect(a.groundDelay).not.toBeNull();
  });

  it('reads a closure at set hours, and keeps a closure to some traffic apart from a full one', () => {
    const sna = normalizeFaaAirport({
      airportId: 'SNA', airportLongName: 'John Wayne', latitude: '33.6757', longitude: '-117.8682',
      airportClosure: {
        text: 'DLY 0730-1415', simpleText: '!SNA 11/020 SNA AD AP CLSD DLY 0730-1415 2611150730-2611211415',
        startTime: '2026-11-15T07:30:00Z', endTime: '2026-11-21T14:15:00Z',
      },
    }, NOW)!;
    expect(sna.closure).toMatchObject({ daily: { from: '0730', to: '1415' }, end: '2026-11-21T14:15:00.000Z' });
    expect(sna.restriction).toBeNull();

    const las = normalizeFaaAirport({
      airportId: 'LAS', latitude: '36.0840', longitude: '-115.1537',
      freeForm: { text: 'TO NON SKED TRANSIENT GA ACFT EXC 24HR PPR', startTime: '2026-10-28T19:26:00Z', endTime: '2027-01-27T23:00:00Z' },
    }, NOW)!;
    expect(las.name).toBe('LAS');
    expect(las.closure).toBeNull();
    expect(las.restriction).toMatchObject({ text: 'TO NON SKED TRANSIENT GA ACFT EXC 24HR PPR', daily: null });
  });

  it('skips an airport with nothing going on, no position, or no usable id', () => {
    const quiet = { airportId: 'DEN', latitude: '39.86', longitude: '-104.67', airportConfig: { arrivalRate: 96 } };
    expect(normalizeFaaAirport(quiet, NOW)).toBeNull();
    expect(normalizeFaaAirport({ ...sfo, latitude: null }, NOW)).toBeNull();
    expect(normalizeFaaAirport({ ...sfo, airportId: '<b>' }, NOW)).toBeNull();
    expect(normalizeFaaAirport('SFO', NOW)).toBeNull();
  });
});

describe('normalizeFaaFeed', () => {
  it('lists each airport once, by id, and refuses a body that is not a list', () => {
    const mia = { ...sfo, airportId: 'MIA', groundStop: null, groundDelay: null };
    expect(normalizeFaaFeed([sfo, mia, sfo, null], NOW).map((a) => a.id)).toEqual(['MIA', 'SFO']);
    expect(() => normalizeFaaFeed({ error: 'down' }, NOW)).toThrow();
  });
});
