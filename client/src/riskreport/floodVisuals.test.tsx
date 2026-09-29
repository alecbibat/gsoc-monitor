import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { FloodReportBody } from './FloodReportBody';
import { DischargeChart, HydrographChart, RainLedger, RainTimingChart } from './floodVisuals';
import { RISK_RINGS } from './riskTypes';
import type { FloodReportData, GaugeDetailView } from './floodTypes';
import type { FloodDischargeResponse } from '../types';

// Render smoke tests for the flood report: the first frame a reader sees for
// a busy report and for a badly degraded one, plus the chart edge cases. The
// cross-cutting assertion is that no NaN ever reaches an SVG attribute — a
// NaN path silently blanks a chart instead of failing loudly.

const NOW_S = Math.round(Date.parse('2026-09-29T15:00:00Z') / 1000);
const hours = (n: number, from: string) =>
  Array.from({ length: n }, (_, i) => new Date(Date.parse(from) + i * 3_600_000).toISOString().slice(0, 16));

function stageDetail(o: Partial<GaugeDetailView> = {}): GaugeDetailView {
  return {
    lid: 'STLM7', name: 'Mississippi River at St. Louis', distanceMi: 2.4, primaryName: 'Stage', unit: 'ft',
    observed: { value: 31.2, cat: 'minor', time: '2026-09-29T14:00:00Z' },
    crest: { value: 36.1, cat: 'moderate', time: '2026-10-01T12:00:00Z' },
    trend: 'rising',
    thresholds: [
      { cat: 'action', stage: 28, flow: null },
      { cat: 'minor', stage: 30, flow: null },
      { cat: 'moderate', stage: 35, flow: null },
      { cat: 'major', stage: 40, flow: null },
    ],
    observedSeries: Array.from({ length: 40 }, (_, i) => ({ t: NOW_S - (40 - i) * 3600 * 6, v: 25 + i * 0.15 })),
    forecastSeries: Array.from({ length: 12 }, (_, i) => ({ t: NOW_S + (i + 1) * 3600 * 6, v: 31.2 + i * 0.4 })),
    impacts: [
      { stage: 30, statement: 'Riverfront trail closes.' },
      { stage: 35, statement: 'Water reaches Leonor K. Sullivan Blvd.' },
      { stage: 38, statement: 'Floodgates close along the levee.' },
    ],
    recordCrest: { time: '1993-08-01T00:00:00Z', stage: 49.58 },
    forecastReliability: 'Forecasts are reliable within 1 ft.',
    inServiceMsg: null,
    ...o,
  };
}

function flowDetail(): GaugeDetailView {
  return stageDetail({
    lid: 'FLOW1', name: 'Big Creek near Town', unit: 'kcfs', primaryName: 'Flow',
    observed: { value: 12.5, cat: 'action', time: '2026-09-29T14:00:00Z' },
    crest: { value: 18.2, cat: 'minor', time: '2026-09-30T18:00:00Z' },
    thresholds: [
      { cat: 'action', stage: 9, flow: 11 },
      { cat: 'minor', stage: 11, flow: 15 },
    ],
    observedSeries: [{ t: NOW_S - 7200, v: 11 }, { t: NOW_S - 3600, v: 12.5 }],
    forecastSeries: [{ t: NOW_S + 3600 * 12, v: 18.2 }],
  });
}

function discharge(o: Partial<FloodDischargeResponse> = {}): FloodDischargeResponse {
  const time = Array.from({ length: 44 }, (_, i) => new Date(Date.parse('2026-09-15') + i * 86_400_000).toISOString().slice(0, 10));
  const fc = (v: number, i: number) => (i < 15 ? null : v);
  const q = time.map((_, i) => 400 + (i === 20 ? 900 : 0));
  return {
    lat: 38.6, lon: -90.2, time, discharge: q,
    median: q.map(fc), p25: q.map((v, i) => fc(v * 0.8, i)), p75: q.map((v, i) => fc(v * 1.2, i)),
    min: q.map((v, i) => fc(v * 0.5, i)), max: q.map((v, i) => fc(v * 1.6, i)),
    thresholds: { rp2: 900, rp5: 1400, rp20: 2200, years: 20, fromYear: 2006, toYear: 2025 },
    updated: 0,
    ...o,
  };
}

const rich: FloodReportData = {
  hazard: 'flood',
  target: { key: 'k', name: 'River Lodge', lat: 38.6, lon: -90.2, groupName: 'Lodges', groupIcon: '🏨' },
  generatedAt: '2026-09-29T15:00:00Z',
  overall: { level: 'critical', drivers: ['Flash Flood Warning in effect at the property — Flash Flood Emergency'] },
  sections: [
    { id: 'alerts', title: 'Flood alerts at site', level: 'critical', drivers: ['Flash Flood Warning in effect at the property'], countLabel: '1 active' },
    { id: 'gauges', title: 'River gauges (NWPS)', level: 'high', drivers: ['Mississippi River at St. Louis (2.4 mi): Minor flood now, forecast Moderate flood'], countLabel: '1 in flood ≤25 mi' },
    { id: 'ero', title: 'Excessive Rainfall Outlook (WPC)', level: 'elevated', drivers: ['WPC Day 1: Slight risk (≥15%) of excessive rainfall at the property'], countLabel: 'Day 1: SLGT' },
    { id: 'rain', title: 'Forecast rainfall (WPC)', level: 'elevated', drivers: ['2.30 in forecast in the next 24 h (WPC)'] },
    { id: 'antecedent', title: 'Recent rainfall (past 7 days)', level: 'guarded', drivers: ['3.10 in over the past 7 days — ground already wet'] },
    { id: 'fema', title: 'FEMA flood zone', level: 'guarded', drivers: ['Property is in the 1%-annual-chance floodplain (Zone AE)'], countLabel: 'Zone AE' },
    { id: 'burn-scars', title: 'Burn scars (post-fire runoff)', level: 'low', drivers: ['No current-season burn scar within 10 mi'] },
    { id: 'discharge', title: 'River discharge forecast (GloFAS)', level: 'guarded', drivers: ['Model peak 1,300 m³/s on Oct 5 — above the 2-year flow (900 m³/s)'] },
  ],
  ringCounts: RISK_RINGS.map((ring, i) => ({ ring, gauges: i + 1, action: 0, flooding: i > 0 ? 1 : 0, forecastFlooding: i > 0 ? 1 : 0 })),
  alerts: [{
    event: 'Flash Flood Warning', severity: 'Severe', expires: '2026-09-29T21:00:00Z',
    headline: 'Flash Flood Warning issued September 29 at 2:00PM CDT',
    level: 'critical', tags: ['Flash Flood Emergency', 'Observed'],
    bullets: [{ label: 'What', text: 'Life-threatening flash flooding.' }, { label: 'Where', text: 'St. Louis County.' }],
  }],
  gauges: [
    { lid: 'STLM7', name: 'Mississippi River at St. Louis', state: 'MO', lat: 38.63, lon: -90.18, distanceMi: 2.4, cat: 'minor', fcat: 'moderate', stage: 31.2, unit: 'ft', isFlow: false },
    { lid: 'FLOW1', name: 'Big Creek near Town', state: 'MO', lat: 38.8, lon: -90.2, distanceMi: 13.8, cat: 'action', fcat: null, stage: 12.5, unit: 'kcfs', isFlow: true },
  ],
  gaugeDetails: [stageDetail(), flowDetail()],
  ero: { days: [1, 2, 3, 4, 5].map((day) => ({ day, date: `2026-10-0${day}`, category: (day === 1 ? 2 : day === 2 ? 1 : 0) as 0 | 1 | 2 })) },
  rain: { in24: 2.3, in48: 3.1, in72: 3.4, in120: 3.9, source: 'wpc' },
  antecedent: {
    past24In: 0.4, past72In: 1.2, past7dIn: 3.1,
    days: Array.from({ length: 8 }, (_, i) => ({ date: `2026-09-${String(22 + i).padStart(2, '0')}`, precipIn: i === 7 ? 0.2 : 0.44 })),
  },
  hourlyRain: {
    times: hours(48, '2026-09-29T10:00:00Z'),
    precipIn: Array.from({ length: 48 }, (_, i) => (i > 3 && i < 10 ? 0.35 : 0)),
    probPct: Array.from({ length: 48 }, (_, i) => (i % 2 ? 80 : null)),
  },
  fema: {
    atSite: {
      zone: 'AE', subtype: null, sfha: true, label: '1%-annual-chance floodplain (Zone AE)',
      floodway: false, coastal: false, bfeFt: 432, depthFt: null, datum: 'NAVD88',
    },
    nearestSfhaMi: 0,
  },
  burnScars: { within10: 0, nearestMi: 48, nearestName: 'Creek Fire' },
  discharge: discharge(),
  forecastDaily: {
    days: Array.from({ length: 10 }, (_, i) => ({
      date: new Date(Date.parse('2026-09-29') + i * 86_400_000).toISOString().slice(0, 10), code: 61,
      tMaxF: 70, tMinF: 55, precipIn: 0.4, precipProbPct: 60, windMaxMph: 10, gustMaxMph: 20,
    })),
  },
  sources: [{ name: 'NWS api.weather.gov', detail: 'alerts' }],
  gaps: ['snowpack and snowmelt'],
  maps: { exposure: 'data:image/png;base64,AA', alerts: 'data:image/png;base64,AA', fema: 'data:image/png;base64,AA', ero: 'data:image/png;base64,AA', qpf: 'data:image/png;base64,AA' },
};

const degraded: FloodReportData = {
  ...rich,
  overall: { level: 'guarded', drivers: ['⚠ 6 feeds unavailable — this picture is incomplete'] },
  sections: [
    { id: 'alerts', title: 'Flood alerts at site', level: 'low', drivers: [], unavailable: 'NWS alerts cover the US and its territories only' },
    { id: 'gauges', title: 'River gauges (NWPS)', level: 'low', drivers: [], unavailable: 'NWPS river forecasts cover the US only' },
    { id: 'ero', title: 'Excessive Rainfall Outlook (WPC)', level: 'low', drivers: [], unavailable: "WPC's Excessive Rainfall Outlook covers the contiguous US only" },
    { id: 'rain', title: 'Forecast rainfall (WPC)', level: 'guarded', drivers: ['1.20 in forecast in the next 24 h (daily point forecast)'] },
    { id: 'antecedent', title: 'Recent rainfall (past 7 days)', level: 'low', drivers: [], unavailable: 'Rainfall history unavailable (HTTP 502)' },
    { id: 'fema', title: 'FEMA flood zone', level: 'low', drivers: [], unavailable: 'FEMA flood maps cover the US and its territories only' },
    { id: 'burn-scars', title: 'Burn scars (post-fire runoff)', level: 'low', drivers: [], unavailable: 'WFIGS fire perimeters cover the US only' },
    { id: 'discharge', title: 'River discharge forecast (GloFAS)', level: 'low', drivers: [], unavailable: 'GloFAS return-period thresholds unavailable — discharge shown for trend only' },
  ],
  ringCounts: RISK_RINGS.map((ring) => ({ ring, gauges: 0, action: 0, flooding: 0, forecastFlooding: 0 })),
  alerts: [],
  gauges: [],
  gaugeDetails: [],
  ero: { unavailable: "WPC's Excessive Rainfall Outlook covers the contiguous US only" },
  rain: { in24: 1.2, in48: 1.5, in72: 1.6, in120: 2, source: 'daily' },
  antecedent: { unavailable: 'Rainfall history unavailable (HTTP 502)' },
  hourlyRain: null,
  fema: { unavailable: 'FEMA flood maps cover the US and its territories only' },
  burnScars: { unavailable: 'WFIGS fire perimeters cover the US only' },
  discharge: discharge({ thresholds: null }),
  forecastDaily: { unavailable: 'Daily forecast unavailable (HTTP 503)' },
  maps: { exposure: null, alerts: null, fema: null, ero: null, qpf: null },
};

const noNaN = (html: string) => expect(html).not.toMatch(/NaN|Infinity|undefined/);

describe('FloodReportBody', () => {
  it('renders a busy report with every section, card and chart', () => {
    const html = renderToStaticMarkup(<FloodReportBody data={rich} />);
    for (const s of [
      'Flood risk — River Lodge', 'Flash Flood Emergency', 'Life-threatening flash flooding.',
      'Mississippi River at St. Louis', 'Gauge forecasts &amp; flood impacts', 'Floodgates close along the levee.',
      'Zone AE', 'Slight', 'Next 5 days', 'Rain timing — next 48 h, hourly', '20-yr', 'Gumbel fit to 20 annual maxima',
      '10-day forecast', 'Exposure by analysis ring',
    ]) {
      expect(html, s).toContain(s);
    }
    noNaN(html);
  });

  it('a degraded report prints every unavailable reason and no false zeros', () => {
    const html = renderToStaticMarkup(<FloodReportBody data={degraded} />);
    for (const s of [
      'NWS alerts cover the US and its territories only',
      'NWPS river forecasts cover the US only',
      'FEMA flood maps cover the US and its territories only',
      'Daily forecast unavailable (HTTP 503)',
      'Gauge counts unknown',
      'shown for trend only',
    ]) {
      expect(html, s).toContain(s);
    }
    // A down gauge feed never prints its ring counts as zeros.
    expect(html).not.toMatch(/<td class="px-3 py-1\.5 text-right">0<\/td>/);
    noNaN(html);
  });
});

describe('flood charts', () => {
  it('the hydrograph needs two points', () => {
    expect(renderToStaticMarkup(<HydrographChart detail={stageDetail({ observedSeries: [{ t: NOW_S, v: 3 }], forecastSeries: [] })} />)).toBe('');
  });

  it('a flow gauge draws its flow thresholds, labeled in kcfs', () => {
    const html = renderToStaticMarkup(<HydrographChart detail={flowDetail()} />);
    expect(html).toContain('Minor 15 kcfs');
    expect(html).not.toContain('Minor 11 kcfs');
    noNaN(html);
  });

  it('discharge with no finite values draws nothing; with no thresholds it still draws the series', () => {
    const empty = discharge();
    const blank = { ...empty, discharge: empty.time.map(() => null), median: [], p25: [], p75: [], min: [], max: [] };
    expect(renderToStaticMarkup(<DischargeChart discharge={blank} todayIso="2026-09-29" />)).toBe('');
    const html = renderToStaticMarkup(<DischargeChart discharge={discharge({ thresholds: null })} todayIso="2026-09-29" />);
    expect(html).toContain('<path');
    expect(html).not.toContain('20-yr');
    noNaN(html);
  });

  it('a dry 48 h and a single-day ledger render without NaN', () => {
    const dry = { times: hours(48, '2026-09-29T00:00:00Z'), precipIn: Array(48).fill(0), probPct: Array(48).fill(null) };
    noNaN(renderToStaticMarkup(<RainTimingChart hourly={dry} />));
    noNaN(renderToStaticMarkup(<RainLedger days={[{ date: '2026-09-29', precipIn: 0 }]} />));
    expect(renderToStaticMarkup(<RainLedger days={[]} />)).toBe('');
  });
});
