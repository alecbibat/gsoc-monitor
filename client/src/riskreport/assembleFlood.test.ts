import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SnapshotOptions } from './mapSnapshot';
import type { FemaZoneResponse, FloodDischargeResponse, FloodPrecipResponse, RiverDetail, RiverGauge, RiversResponse } from '../types';
import type { RawAlert } from '../layers/alerts/alertsData';
import type { WildfiresResult } from '../layers/wildfires/wildfiresData';
import type { EroPolygon } from './floodTypes';

// The flood assembly end to end with the network mocked and the REAL section
// builders: feeds reach their sections, coverage is checked before fetching
// (outside the US nothing reads as a verified all-clear), a down feed is
// unavailable and reported DOWN, and every snapshot's draw pass runs against
// a fake canvas so a drawing bug fails here instead of blanking a map.

const snapshots: SnapshotOptions[] = [];
const calls: string[] = [];

// ── Mutable feed fixtures, reset per test ────────────────────────────────────
type Feed<T> = () => Promise<T>;
const feeds: {
  alerts: Feed<RawAlert[]>;
  rivers: Feed<RiversResponse>;
  riverDetail: (lid: string) => Promise<RiverDetail>;
  zone: Feed<FemaZoneResponse>;
  precip: Feed<FloodPrecipResponse>;
  discharge: Feed<FloodDischargeResponse>;
  wildfires: Feed<WildfiresResult>;
  eroDays: Feed<{ day: number; category: 0 | 1 | 2 | 3 | 4 }[]>;
  eroPolys: Feed<EroPolygon[]>;
  qpf: Feed<{ in24: number; in48: number; in72: number; in120: number }>;
  daily: Feed<import('../types').DailyForecast>;
} = {} as never;

const down = (what: string) => async () => {
  throw new Error(`${what} down`);
};

vi.mock('../api/client', () => ({
  api: {
    rivers: () => { calls.push('rivers'); return feeds.rivers(); },
    riverDetail: (lid: string) => { calls.push(`riverDetail:${lid}`); return feeds.riverDetail(lid); },
    floodZone: () => { calls.push('floodZone'); return feeds.zone(); },
    floodPrecip: () => { calls.push('floodPrecip'); return feeds.precip(); },
    floodDischarge: () => { calls.push('floodDischarge'); return feeds.discharge(); },
    weatherDaily: () => { calls.push('weatherDaily'); return feeds.daily(); },
  },
}));
vi.mock('../layers/alerts/alertsData', () => ({
  fetchActiveAlerts: () => { calls.push('alerts'); return feeds.alerts(); },
  loadCounties: async () => { calls.push('counties'); return new Map(); },
  // Alerts in these fixtures always carry their own polygon.
  alertRings: (a: RawAlert) =>
    a.geometry && a.geometry.type === 'Polygon' ? [a.geometry.coordinates[0] as number[][]] : [],
  alertColorHex: () => '#1769ff',
}));
vi.mock('../layers/wildfires/wildfiresData', () => ({
  fetchWildfires: () => { calls.push('wildfires'); return feeds.wildfires(); },
}));
vi.mock('./wpcQpf', () => ({
  fetchWpcSiteQpf: () => { calls.push('qpf'); return feeds.qpf(); },
  renderQpfSnapshot: async () => 'data:qpf',
}));
vi.mock('./wpcEro', () => ({
  fetchEroSiteDays: () => { calls.push('eroDays'); return feeds.eroDays(); },
  fetchEroPolygons: () => { calls.push('eroPolys'); return feeds.eroPolys(); },
}));
vi.mock('./mapSnapshot', () => ({
  renderMapSnapshot: async (opts: SnapshotOptions) => {
    snapshots.push(opts);
    return `data:${opts.attribution ?? 'map'}`;
  },
  drawHatchedPolygon: () => {},
  drawPin: () => {},
  drawPolygon: () => {},
  drawRing: () => {},
}));

const { assembleFloodReport, inUsCoverage } = await import('./assembleFlood');

// Riverside lodge on a mid-size river in the lower 48.
const TARGET = { key: 'k', name: 'River Lodge', lat: 38.6, lon: -90.2 };
// Paris — outside every US-only flood product.
const ABROAD = { key: 'p', name: 'Paris Office', lat: 48.85, lon: 2.35 };

const box = (lat: number, lon: number, d: number): number[][] => [
  [lon - d, lat - d], [lon + d, lat - d], [lon + d, lat + d], [lon - d, lat + d], [lon - d, lat - d],
];

function gauge(o: Partial<RiverGauge> & Pick<RiverGauge, 'lid' | 'lat' | 'lon'>): RiverGauge {
  return {
    name: `Gauge ${o.lid}`, state: 'MO', cat: 'normal', fcat: null, stage: 10, unit: 'ft',
    flow: null, flowUnit: '', isFlow: false, ...o,
  };
}

function detail(lid: string): RiverDetail {
  return {
    lid, name: `Gauge ${lid}`, state: 'MO', county: 'St. Louis', usgsId: null,
    primaryName: 'Stage', unit: 'ft', flowUnit: 'kcfs', isFlow: false,
    observed: { value: 31.2, flow: null, cat: 'moderate', time: new Date().toISOString() },
    forecastCrest: { value: 33.5, cat: 'moderate', time: new Date(Date.now() + 86_400_000).toISOString() },
    trend: 'rising',
    thresholds: [
      { cat: 'action', stage: 28, flow: null },
      { cat: 'minor', stage: 30, flow: null },
      { cat: 'moderate', stage: 35, flow: null },
      { cat: 'major', stage: 40, flow: null },
    ],
    observedSeries: [{ t: 1, v: 29 }, { t: 2, v: 31.2 }],
    forecastSeries: [{ t: 3, v: 33.5 }],
    impacts: [{ stage: 32, statement: 'Water reaches River Road.' }],
    recentCrest: null, recordCrest: { time: '1993-08-01', stage: 49.6 },
    forecastReliability: null, inServiceMsg: null, updated: Date.now(),
  };
}

function precip(): FloodPrecipResponse {
  // 7 past days + today + 2 forecast days, hourly, UTC-5.
  const offset = -5 * 3600;
  const localNow = new Date(Date.now() + offset * 1000);
  const today = localNow.toISOString().slice(0, 10);
  const start = Date.parse(`${today}T00:00:00Z`) - 7 * 86_400_000;
  const daily = { time: [] as string[], precipIn: [] as number[] };
  const hourly = { time: [] as string[], precipIn: [] as number[], probPct: [] as Array<number | null> };
  for (let d = 0; d < 10; d++) {
    const date = new Date(start + d * 86_400_000).toISOString().slice(0, 10);
    daily.time.push(date);
    daily.precipIn.push(d < 7 ? 0.6 : 0.2);
    for (let h = 0; h < 24; h++) {
      hourly.time.push(`${date}T${String(h).padStart(2, '0')}:00`);
      hourly.precipIn.push(d < 7 ? 0.025 : 0.01);
      hourly.probPct.push(d < 7 ? null : 40);
    }
  }
  return { timezone: 'America/Chicago', utcOffsetSeconds: offset, daily, hourly, updated: Date.now() };
}

function discharge(peak: number): FloodDischargeResponse {
  const today = Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
  const time: string[] = [];
  const q: number[] = [];
  for (let i = -14; i < 30; i++) {
    time.push(new Date(today + i * 86_400_000).toISOString().slice(0, 10));
    q.push(i === 4 ? peak : 400);
  }
  const fc = (v: number, i: number) => (i < 15 ? null : v);
  return {
    lat: 38.6, lon: -90.2, time, discharge: q,
    median: q.map(fc), p25: q.map((v, i) => fc(v * 0.8, i)), p75: q.map((v, i) => fc(v * 1.2, i)),
    min: q.map((v, i) => fc(v * 0.5, i)), max: q.map((v, i) => fc(v * 1.5, i)),
    thresholds: { rp2: 900, rp5: 1400, rp20: 2200, years: 41, fromYear: 1984, toYear: 2025 },
    updated: Date.now(),
  };
}

function daily(): import('../types').DailyForecast {
  const today = new Date().toISOString().slice(0, 10);
  const time = Array.from({ length: 10 }, (_, i) =>
    new Date(Date.parse(`${today}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10));
  return {
    latitude: 0, longitude: 0, timezone: 'UTC',
    daily: {
      time, weatherCode: time.map(() => 61), tMaxF: time.map(() => 70), tMinF: time.map(() => 55),
      precipIn: time.map(() => 0.4), precipProbPct: time.map(() => 60),
      windMaxMph: time.map(() => 10), gustMaxMph: time.map(() => 20),
    },
    updated: Date.now(),
  };
}

const zoneAE: FemaZoneResponse = {
  covered: true,
  atSite: { zone: 'AE', subtype: null, sfha: true, bfeFt: 432, depthFt: null, datum: 'NAVD88' },
  polygons: [
    { zone: 'AE', subtype: null, sfha: true, rings: [box(TARGET.lat, TARGET.lon, 0.01)] },
    { zone: 'AE', subtype: 'FLOODWAY', sfha: true, rings: [box(TARGET.lat, TARGET.lon + 0.004, 0.002)] },
    { zone: 'X', subtype: 'AREA OF MINIMAL FLOOD HAZARD', sfha: false, rings: [box(TARGET.lat, TARGET.lon, 0.03), box(TARGET.lat, TARGET.lon, 0.012)] },
  ],
  nearestSfhaMi: 0,
  truncated: false,
  updated: Date.now(),
};

function flashFloodWarning(): RawAlert {
  return {
    geometry: { type: 'Polygon', coordinates: [box(TARGET.lat, TARGET.lon, 0.2)] },
    properties: {
      event: 'Flash Flood Warning',
      severity: 'Severe',
      expires: new Date(Date.now() + 3 * 3_600_000).toISOString(),
      headline: 'Flash Flood Warning issued for St. Louis County',
      description: '* WHAT...Flash flooding caused by excessive rainfall.\n\n* WHERE...St. Louis County.\n\n* WHEN...Until 9 PM CDT.',
      parameters: { flashFloodDamageThreat: ['CONSIDERABLE'] },
    },
  };
}

function healthyFeeds() {
  feeds.alerts = async () => [
    flashFloodWarning(),
    // A river Flood Warning upstream — not at the site, but on the hero map.
    { geometry: { type: 'Polygon', coordinates: [box(TARGET.lat + 0.6, TARGET.lon, 0.1)] }, properties: { event: 'Flood Warning', severity: 'Moderate' } },
    // Not flood-family — ignored entirely.
    { geometry: { type: 'Polygon', coordinates: [box(TARGET.lat, TARGET.lon, 0.3)] }, properties: { event: 'Heat Advisory', severity: 'Moderate' } },
  ];
  feeds.rivers = async () => ({
    gauges: [
      gauge({ lid: 'NEAR1', lat: TARGET.lat + 0.03, lon: TARGET.lon, cat: 'moderate', fcat: 'moderate' }),
      gauge({ lid: 'MID1', lat: TARGET.lat + 0.2, lon: TARGET.lon, cat: 'normal', fcat: 'minor' }),
      gauge({ lid: 'FAR1', lat: TARGET.lat + 1.0, lon: TARGET.lon, cat: 'major', fcat: null }),
      gauge({ lid: 'WAYOUT', lat: TARGET.lat + 5, lon: TARGET.lon, cat: 'major', fcat: null }),
    ],
    counts: { major: 2, moderate: 1, minor: 0, action: 0, normal: 1, low: 0, none: 0 },
    updated: Date.now(),
  });
  feeds.riverDetail = async (lid) => detail(lid);
  feeds.zone = async () => zoneAE;
  feeds.precip = async () => precip();
  feeds.discharge = async () => discharge(1500);
  feeds.wildfires = async () => ({
    fires: [], error: null, perimeterError: null,
    perimeters: [{ name: 'Creek Fire', acres: 4200, rings: [box(TARGET.lat + 0.05, TARGET.lon, 0.01)] }],
  });
  feeds.eroDays = async () => [
    { day: 1, category: 2 }, { day: 2, category: 1 }, { day: 3, category: 0 }, { day: 4, category: 0 }, { day: 5, category: 0 },
  ];
  feeds.eroPolys = async () => [{ category: 1, rings: [box(TARGET.lat, TARGET.lon, 1)] }, { category: 2, rings: [box(TARGET.lat, TARGET.lon, 0.5)] }];
  feeds.qpf = async () => ({ in24: 2.3, in48: 3.1, in72: 3.4, in120: 3.9 });
  feeds.daily = async () => daily();
}

/** A canvas context that accepts every call and property write. */
function fakeCtx(): CanvasRenderingContext2D {
  return new Proxy({}, {
    get: (_t, prop) => (prop === 'measureText' ? () => ({ width: 40 }) : () => {}),
    set: () => true,
  }) as unknown as CanvasRenderingContext2D;
}
const fakeProj = {
  toXY: (lon: number, lat: number) => [lon * 10, -lat * 10],
  width: 1320, height: 840, bbox3857: [0, 0, 1, 1],
} as unknown as Parameters<NonNullable<SnapshotOptions['draw']>>[1];

beforeEach(() => {
  snapshots.length = 0;
  calls.length = 0;
  healthyFeeds();
});

const run = async (target = TARGET) => {
  const events: Array<[string, string]> = [];
  const report = await assembleFloodReport(target, (id, r) => events.push([id, r]));
  return { report, events };
};

describe('assembleFloodReport — US property with an active flood', () => {
  it('assembles every section, in order, with nothing unavailable', async () => {
    const { report } = await run();
    expect(report.hazard).toBe('flood');
    expect(report.sections.map((s) => s.id)).toEqual([
      'alerts', 'gauges', 'ero', 'rain', 'antecedent', 'fema', 'burn-scars', 'discharge',
    ]);
    expect(report.sections.filter((s) => s.unavailable)).toEqual([]);
  });

  it('rates a Flash Flood Warning at an SFHA property critical, naming the warning first', async () => {
    const { report } = await run();
    expect(report.sections.find((s) => s.id === 'alerts')!.level).toBe('critical');
    expect(report.overall.level).toBe('critical');
    expect(report.overall.drivers.some((d) => d.includes('Flash Flood Warning'))).toBe(true);
    expect(report.alerts).toHaveLength(1);
    expect(report.alerts[0].tags).toContain('Damage threat: Considerable');
    expect(report.alerts[0].bullets.map((b) => b.label)).toEqual(['What', 'Where', 'When']);
    expect(report.fema.atSite?.sfha).toBe(true);
  });

  it('opens forecast detail for nearby gauges only, flooding first', async () => {
    const { report } = await run();
    const detailCalls = calls.filter((c) => c.startsWith('riverDetail:'));
    expect(detailCalls[0]).toBe('riverDetail:NEAR1');
    expect(detailCalls).not.toContain('riverDetail:FAR1'); // > 25 mi
    expect(report.gaugeDetails[0].lid).toBe('NEAR1');
    expect(report.gaugeDetails[0].distanceMi).toBeLessThan(5);
    // The 69 mi major gauge is listed (flooding beyond 25 mi), the 345 mi one is not.
    expect(report.gauges.map((g) => g.lid)).toEqual(['NEAR1', 'MID1', 'FAR1']);
    expect(report.sections.find((s) => s.id === 'gauges')!.level).toBe('high');
  });

  it('counts gauges per ring from the full nearby list', async () => {
    const { report } = await run();
    const byRing = Object.fromEntries(report.ringCounts.map((r) => [r.ring.id, r]));
    expect(byRing.local.gauges).toBe(1);
    expect(byRing.local.flooding).toBe(1);
    expect(byRing.area.gauges).toBe(2);
    expect(byRing.area.forecastFlooding).toBe(2);
    expect(byRing.regional.gauges).toBe(3);
  });

  it('dates the ERO days from the property local day and keeps WPC rain values', async () => {
    const { report } = await run();
    expect(report.ero.days).toHaveLength(5);
    expect(report.ero.days![0].category).toBe(2);
    expect(report.ero.days![1].date! > report.ero.days![0].date!).toBe(true);
    expect(report.rain).toMatchObject({ in24: 2.3, in120: 3.9, source: 'wpc' });
    expect(report.antecedent.past7dIn).toBeCloseTo(4.2, 5);
    expect(report.hourlyRain?.times.length).toBeGreaterThan(0);
  });

  it('reports every feed exactly once and renders maps last', async () => {
    const { events } = await run();
    const ids = events.map(([id]) => id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.at(-1)).toBe('maps');
    expect(events.every(([, r]) => r === 'ok')).toBe(true);
    expect(ids.sort()).toEqual([
      'alerts', 'burn-scars', 'counties', 'daily', 'discharge', 'ero', 'fema', 'gauge-detail',
      'gauges', 'maps', 'precip', 'qpf',
    ]);
  });

  it('renders every map and each draw pass runs cleanly', async () => {
    const { report } = await run();
    expect(report.maps.exposure).not.toBeNull();
    expect(report.maps.alerts).not.toBeNull();
    expect(report.maps.fema).not.toBeNull();
    expect(report.maps.ero).not.toBeNull();
    expect(report.maps.qpf).toBe('data:qpf');
    expect(snapshots).toHaveLength(4);
    for (const s of snapshots) expect(() => s.draw!(fakeCtx(), fakeProj)).not.toThrow();
  });
});

describe('assembleFloodReport — honesty when feeds are down or out of coverage', () => {
  it('outside the US never fetches US-only feeds and never reads them as all-clear', async () => {
    feeds.rivers = async () => ({ gauges: [], counts: {} as never, updated: Date.now() });
    const { report, events } = await run(ABROAD);
    expect(inUsCoverage(ABROAD.lat, ABROAD.lon)).toBe(false);
    for (const c of ['alerts', 'counties', 'floodZone', 'wildfires', 'eroDays', 'eroPolys', 'qpf']) {
      expect(calls).not.toContain(c);
    }
    const byId = Object.fromEntries(report.sections.map((s) => [s.id, s]));
    for (const id of ['alerts', 'gauges', 'ero', 'fema', 'burn-scars']) {
      expect(byId[id].unavailable, id).toBeTruthy();
    }
    expect(byId.alerts.countLabel).toBeUndefined();
    // Rain falls back to the global daily forecast, labeled as such.
    expect(report.rain.source).toBe('daily');
    expect(byId.rain.unavailable).toBeUndefined();
    expect(byId.discharge.unavailable).toBeUndefined();
    expect(report.maps.qpf).toBeNull();
    const skippedIds = events.filter(([, r]) => r === 'skipped').map(([id]) => id).sort();
    expect(skippedIds).toEqual(['alerts', 'burn-scars', 'counties', 'ero', 'fema', 'gauge-detail', 'qpf']);
    expect(report.overall.drivers.at(-1)).toMatch(/^⚠ \d+ feeds? unavailable/);
  });

  it('a warming NWPS snapshot is unavailable, not "no gauges", and skips the detail stage', async () => {
    feeds.rivers = async () => ({ gauges: [], counts: {} as never, updated: Date.now(), warming: true });
    const { report, events } = await run();
    const sec = report.sections.find((s) => s.id === 'gauges')!;
    expect(sec.unavailable).toMatch(/still loading/);
    expect(events).toContainEqual(['gauges', 'failed']);
    expect(events).toContainEqual(['gauge-detail', 'skipped']);
    expect(calls.some((c) => c.startsWith('riverDetail:'))).toBe(false);
  });

  it('a failed perimeter query makes burn scars unavailable and DOWN', async () => {
    feeds.wildfires = async () => ({ fires: [], perimeters: [], error: null, perimeterError: 'HTTP 500' });
    const { report, events } = await run();
    expect(report.sections.find((s) => s.id === 'burn-scars')!.unavailable).toMatch(/HTTP 500/);
    expect(events).toContainEqual(['burn-scars', 'failed']);
  });

  it('WPC down falls back to the daily forecast for rain and marks the outlook unavailable', async () => {
    feeds.qpf = down('WPC');
    feeds.eroDays = down('ERO');
    feeds.eroPolys = down('ERO map');
    const { report, events } = await run();
    expect(report.rain.source).toBe('daily');
    expect(report.sections.find((s) => s.id === 'ero')!.unavailable).toMatch(/ERO down/);
    expect(report.maps.ero).toBeNull();
    expect(events).toContainEqual(['qpf', 'failed']);
    expect(events).toContainEqual(['ero', 'failed']);
  });

  it('gauge detail failures degrade to no cards, reported DOWN', async () => {
    feeds.riverDetail = down('detail');
    const { report, events } = await run();
    expect(report.gaugeDetails).toEqual([]);
    expect(events).toContainEqual(['gauge-detail', 'failed']);
    expect(report.sections.find((s) => s.id === 'gauges')!.unavailable).toBeUndefined();
  });

  it('throws when every feed is down', async () => {
    for (const k of Object.keys(feeds) as (keyof typeof feeds)[]) (feeds as Record<string, unknown>)[k] = down(k);
    await expect(run()).rejects.toThrow(/All flood feeds are unavailable/);
  });
});
