import { describe, expect, it } from 'vitest';
import type { FemaZoneResponse, FloodCat, FloodDischargeResponse, FloodPrecipResponse } from '../types';
import type { RawAlert } from '../layers/alerts/alertsData';
import type { EroCategory, EroDay, FemaSiteZone, FloodAlertHit, FloodReportData, GaugeHit } from './floodTypes';
import type { RiskLevel, SectionResult } from './riskTypes';
import {
  FLOOD_SECTION_TITLES,
  buildAntecedentSection,
  buildBurnScarSection,
  buildDischargeSection,
  buildEroSection,
  buildFemaSection,
  buildFloodAlertsSection,
  buildGaugeSection,
  buildRainSection,
  classifyFloodAlert,
  computeFloodOverall,
  describeFemaZone,
  eroCategoryFromAttributes,
  floodRingCounts,
  gaugeTier,
  nearestBurnScar,
  parseNwsBullets,
  pickDetailGauges,
  rainSignalFrom,
  sortFloodAlerts,
  summarizePrecip,
  toFloodAlertHit,
  unavailableSection,
  type AntecedentSummary,
  type FloodSectionId,
} from './floodSections';

// ── Section ids + unavailable ────────────────────────────────────────────────

describe('FLOOD_SECTION_TITLES / unavailableSection', () => {
  it('titles every section id', () => {
    expect(FLOOD_SECTION_TITLES).toEqual({
      alerts: 'Flood alerts at site',
      gauges: 'River gauges (NWPS)',
      ero: 'Excessive Rainfall Outlook (WPC)',
      rain: 'Forecast rainfall (WPC)',
      antecedent: 'Recent rainfall (past 7 days)',
      fema: 'FEMA flood zone',
      'burn-scars': 'Burn scars (post-fire runoff)',
      discharge: 'River discharge forecast (GloFAS)',
    });
  });

  it('is Low with no drivers and the reason — never a silent Low', () => {
    expect(unavailableSection('gauges', 'NWPS snapshot warming')).toEqual({
      id: 'gauges',
      title: 'River gauges (NWPS)',
      level: 'low',
      drivers: [],
      unavailable: 'NWPS snapshot warming',
    });
  });
});

// ── Alerts ───────────────────────────────────────────────────────────────────

describe('classifyFloodAlert', () => {
  it.each<[string, RiskLevel]>([
    ['Flash Flood Warning', 'critical'],
    ['Storm Surge Warning', 'critical'],
    ['Tsunami Warning', 'critical'],
    ['Flood Warning', 'high'],
    ['Areal Flood Warning', 'high'],
    ['Coastal Flood Warning', 'high'],
    ['Lakeshore Flood Warning', 'high'],
    ['Hurricane Warning', 'high'],
    ['Typhoon Warning', 'high'],
    ['Flash Flood Watch', 'elevated'],
    ['Flood Watch', 'elevated'],
    ['Coastal Flood Watch', 'elevated'],
    ['Lakeshore Flood Watch', 'elevated'],
    ['Storm Surge Watch', 'elevated'],
    ['Tsunami Watch', 'elevated'],
    ['Tsunami Advisory', 'elevated'],
    ['Hurricane Watch', 'elevated'],
    ['Typhoon Watch', 'elevated'],
    ['Tropical Storm Warning', 'elevated'],
    ['Flood Advisory', 'guarded'],
    ['Coastal Flood Advisory', 'guarded'],
    ['Lakeshore Flood Advisory', 'guarded'],
    ['Flood Statement', 'guarded'],
    ['Flash Flood Statement', 'guarded'],
    ['Coastal Flood Statement', 'guarded'],
    ['Hydrologic Outlook', 'guarded'],
    ['Tropical Storm Watch', 'guarded'],
    ['Hurricane Local Statement', 'guarded'],
    ['Typhoon Local Statement', 'guarded'],
  ])('%s → %s', (event, level) => {
    expect(classifyFloodAlert({ event })).toEqual({ relevant: true, level, tags: [] });
  });

  it.each([
    'Hurricane Force Wind Warning',
    'Hurricane Force Wind Watch',
    'Red Flag Warning',
    'Severe Thunderstorm Warning',
    'Winter Storm Warning',
    'Special Marine Warning',
    'High Surf Advisory',
  ])('%s is not flood-relevant', (event) => {
    expect(classifyFloodAlert({ event }).relevant).toBe(false);
  });

  it('falls back to the headline when the event name is missing, and is irrelevant when both are', () => {
    expect(classifyFloodAlert({ headline: 'Flood Watch issued September 29 at 3:12AM CDT' }).level).toBe('elevated');
    expect(classifyFloodAlert({}).relevant).toBe(false);
  });

  it.each<[string, Record<string, unknown>]>([
    ['string array', { flashFloodDamageThreat: ['CATASTROPHIC'] }],
    ['lower case', { flashFloodDamageThreat: ['catastrophic'] }],
    ['bare string', { flashFloodDamageThreat: 'Catastrophic' }],
    ['key case differs', { FLASHFLOODDAMAGETHREAT: ['CATASTROPHIC'] }],
  ])('tags a Flash Flood Emergency from parameters (%s)', (_, parameters) => {
    const c = classifyFloodAlert({ event: 'Flash Flood Warning', parameters });
    expect(c.level).toBe('critical');
    expect(c.tags).toEqual(['Flash Flood Emergency']);
  });

  it('tags a Flash Flood Emergency from the text (headline or description)', () => {
    expect(
      classifyFloodAlert({
        event: 'Flash Flood Warning',
        description: 'FLASH FLOOD EMERGENCY FOR SOUTHEASTERN HARRIS COUNTY...\n\nThis is a PARTICULARLY DANGEROUS SITUATION.',
      }).tags
    ).toContain('Flash Flood Emergency');
    expect(
      classifyFloodAlert({ event: 'Flash Flood Warning', headline: 'Flash Flood Emergency for Houston' }).tags
    ).toContain('Flash Flood Emergency');
  });

  it('does not tag a downgraded emergency, or a non-warning that mentions one', () => {
    expect(
      classifyFloodAlert({
        event: 'Flash Flood Warning',
        description: 'The Flash Flood Emergency has been downgraded to a Flash Flood Warning.',
      }).tags
    ).toEqual([]);
    expect(
      classifyFloodAlert({
        event: 'Flash Flood Watch',
        description: 'Rainfall of this magnitude could lead to a flash flood emergency.',
        parameters: { flashFloodDamageThreat: ['CATASTROPHIC'] },
      }).tags
    ).toEqual([]);
  });

  it('frames considerable damage threat and observed flooding', () => {
    expect(
      classifyFloodAlert({
        event: 'Flash Flood Warning',
        parameters: { flashFloodDamageThreat: ['CONSIDERABLE'], flashFloodDetection: ['OBSERVED'] },
      }).tags
    ).toEqual(['Damage threat: Considerable', 'Observed']);
    expect(
      classifyFloodAlert({ event: 'Flash Flood Warning', parameters: { flashFloodDetection: ['RADAR INDICATED'] } }).tags
    ).toEqual([]);
    // Emergency supersedes the considerable tier; detection still reported.
    expect(
      classifyFloodAlert({
        event: 'Flash Flood Warning',
        parameters: { flashFloodDamageThreat: ['CATASTROPHIC'], flashFloodDetection: 'observed' },
      }).tags
    ).toEqual(['Flash Flood Emergency', 'Observed']);
  });

  it('never throws on odd parameter shapes', () => {
    for (const parameters of [{ flashFloodDamageThreat: null }, { flashFloodDamageThreat: [{}] }, { flashFloodDamageThreat: 3 }]) {
      expect(classifyFloodAlert({ event: 'Flash Flood Warning', parameters }).level).toBe('critical');
    }
  });
});

// A river Flood Warning as api.weather.gov sends it (segment for one forecast point).
const RIVER_FLW = `...The Flood Warning continues for the following rivers in Texas...

  Trinity River at Liberty affecting Liberty County.

For the Trinity River...including Liberty...Minor flooding is
forecast.

* WHAT...Minor flooding is forecast.

* WHERE...Trinity River at Liberty.

* WHEN...Until Friday evening.

* IMPACTS...At 26.0 feet, Expect minor lowland flooding of
  pastures and river access roads near the river.

* ADDITIONAL DETAILS...
  - At 8:15 PM CDT Tuesday the stage was 26.8 feet.
  - Forecast...The river is expected to fall below flood stage
    Friday afternoon and continue falling to 22.1 feet Tuesday.
  - Flood stage is 25.0 feet.
  - http://www.weather.gov/safety/flood`;

describe('parseNwsBullets', () => {
  it('parses a realistic NWS river Flood Warning', () => {
    expect(parseNwsBullets(RIVER_FLW)).toEqual([
      { label: 'What', text: 'Minor flooding is forecast.' },
      { label: 'Where', text: 'Trinity River at Liberty.' },
      { label: 'When', text: 'Until Friday evening.' },
      { label: 'Impacts', text: 'At 26.0 feet, Expect minor lowland flooding of pastures and river access roads near the river.' },
      {
        label: 'Additional details',
        text:
          'At 8:15 PM CDT Tuesday the stage was 26.8 feet. · Forecast...The river is expected to fall below flood stage ' +
          'Friday afternoon and continue falling to 22.1 feet Tuesday. · Flood stage is 25.0 feet.',
      },
    ]);
  });

  it('handles CRLF text and stops a bullet at the product tail', () => {
    const d = '* WHAT...Coastal flooding.\r\n\r\n* WHEN...Until 6 PM.\r\n\r\nTide table follows\r\nHigh 5.2 ft';
    expect(parseNwsBullets(d)).toEqual([
      { label: 'What', text: 'Coastal flooding.' },
      { label: 'When', text: 'Until 6 PM.' },
    ]);
  });

  it('caps each bullet at ~400 chars with an ellipsis', () => {
    const long = Array.from({ length: 120 }, (_, i) => `word${i}`).join(' ');
    const [b] = parseNwsBullets(`* IMPACTS...${long}`);
    expect(b.text.length).toBeLessThanOrEqual(400);
    expect(b.text.endsWith('…')).toBe(true);
    expect(b.text.startsWith('word0 word1')).toBe(true);
  });

  it('returns [] when the bullet format is absent', () => {
    expect(parseNwsBullets(undefined)).toEqual([]);
    expect(parseNwsBullets('')).toEqual([]);
    // Storm-based warning prose: "* " lines but no LABEL... bullets.
    expect(
      parseNwsBullets(
        'The National Weather Service in Houston has issued a\n\n* Flash Flood Warning for...\n  Central Harris County\n\n* Until 1015 PM CDT.\n\n* At 713 PM CDT, Doppler radar indicated heavy rain.'
      )
    ).toEqual([]);
  });
});

const rawAlert = (props: Partial<RawAlert['properties']>): RawAlert => ({ geometry: null, properties: { ...props } });

describe('toFloodAlertHit', () => {
  it('returns null for non-flood products', () => {
    expect(toFloodAlertHit(rawAlert({ event: 'Red Flag Warning' }))).toBeNull();
    expect(toFloodAlertHit(rawAlert({ event: 'Hurricane Force Wind Warning' }))).toBeNull();
  });

  it('builds the display-ready hit', () => {
    const hit = toFloodAlertHit(
      rawAlert({
        event: 'Flood Warning',
        severity: 'Severe',
        expires: '2026-10-02T19:00:00-05:00',
        headline: 'Flood Warning issued September 29',
        description: RIVER_FLW,
      })
    );
    expect(hit).toMatchObject({
      event: 'Flood Warning',
      severity: 'Severe',
      expires: '2026-10-02T19:00:00-05:00',
      headline: 'Flood Warning issued September 29',
      level: 'high',
      tags: [],
    });
    expect(hit!.bullets.map((b) => b.label)).toEqual(['What', 'Where', 'When', 'Impacts', 'Additional details']);
  });

  it('drops a null headline', () => {
    expect(toFloodAlertHit(rawAlert({ event: 'Flood Advisory', headline: null }))!.headline).toBeUndefined();
  });
});

const hit = (event: string, level: RiskLevel, o: Partial<FloodAlertHit> = {}): FloodAlertHit => ({
  event, level, tags: [], bullets: [], ...o,
});

describe('sortFloodAlerts / buildFloodAlertsSection', () => {
  it('sorts worst level first, then NWS severity, without mutating', () => {
    const input = [
      hit('Flood Advisory', 'guarded', { severity: 'Minor' }),
      hit('Flood Watch', 'elevated', { severity: 'Moderate' }),
      hit('Coastal Flood Advisory', 'guarded', { severity: 'Moderate' }),
      hit('Flash Flood Warning', 'critical', { severity: 'Severe' }),
    ];
    const copy = input.slice();
    expect(sortFloodAlerts(input).map((h) => h.event)).toEqual([
      'Flash Flood Warning', 'Flood Watch', 'Coastal Flood Advisory', 'Flood Advisory',
    ]);
    expect(input).toEqual(copy);
  });

  it('is count-framed "None active" at Low when nothing is in effect', () => {
    const s = buildFloodAlertsSection([], { countiesDown: false });
    expect(s).toMatchObject({ id: 'alerts', title: 'Flood alerts at site', level: 'low', drivers: [], countLabel: 'None active' });
    expect(s.unavailable).toBeUndefined();
  });

  it('takes the worst hit and lists one driver per alert, emergency called out', () => {
    const s = buildFloodAlertsSection(
      [
        hit('Flood Watch', 'elevated'),
        hit('Flash Flood Warning', 'critical', { tags: ['Flash Flood Emergency', 'Observed'] }),
      ],
      { countiesDown: false }
    );
    expect(s.level).toBe('critical');
    expect(s.countLabel).toBe('2 active');
    expect(s.drivers).toEqual([
      'Flash Flood Warning in effect at the property — Flash Flood Emergency',
      'Flood Watch in effect at the property',
    ]);
  });

  it('folds identical alerts (two river forecast points) into one line', () => {
    const s = buildFloodAlertsSection([hit('Flood Warning', 'high'), hit('Flood Warning', 'high')], { countiesDown: false });
    expect(s.countLabel).toBe('2 active');
    expect(s.drivers).toEqual(['Flood Warning in effect at the property (2 alerts)']);
  });

  it('county shapes down with no hit → unavailable, not a verified all-clear', () => {
    const s = buildFloodAlertsSection([], { countiesDown: true });
    expect(s.unavailable).toBe(
      'County geometry unavailable — county-based flood alerts (incl. Flood Watches and river Flood Warnings) could not be checked'
    );
  });

  it('county shapes down with a polygon hit → the hit stands, with a caveat', () => {
    const s = buildFloodAlertsSection([hit('Flood Advisory', 'guarded')], { countiesDown: true });
    expect(s.unavailable).toBeUndefined();
    expect(s.level).toBe('guarded');
    expect(s.drivers[s.drivers.length - 1]).toMatch(/^⚠ County geometry unavailable/);
  });
});

// ── Gauges ───────────────────────────────────────────────────────────────────

let lidSeq = 0;
const gauge = (distanceMi: number, cat: FloodCat, fcat: FloodCat | null = null, o: Partial<GaugeHit> = {}): GaugeHit => ({
  lid: `G${++lidSeq}`,
  name: `Gauge ${lidSeq}`,
  state: 'MO',
  lat: 38.6,
  lon: -90.2,
  distanceMi,
  cat,
  fcat,
  stage: 20,
  unit: 'ft',
  isFlow: false,
  ...o,
});

describe('gaugeTier', () => {
  it.each<[FloodCat, FloodCat | null, FloodCat]>([
    ['moderate', null, 'moderate'],
    ['action', 'minor', 'minor'],
    ['normal', 'major', 'major'],
    ['major', 'minor', 'major'],
    ['minor', 'minor', 'minor'],
    ['normal', 'low', 'normal'], // tie (both non-flood) keeps the observed value
    ['low', 'none', 'low'],
    ['none', 'action', 'action'],
  ])('observed %s, forecast %s → %s', (cat, fcat, tier) => {
    expect(gaugeTier({ cat, fcat })).toBe(tier);
  });
});

describe('buildGaugeSection — ring × tier table', () => {
  it.each<[number, FloodCat, FloodCat | null, RiskLevel]>([
    // ≤5 mi
    [0.5, 'major', null, 'critical'],
    [5, 'moderate', null, 'high'],
    [5, 'minor', null, 'elevated'],
    [5, 'action', null, 'guarded'],
    [5, 'normal', null, 'low'],
    // 5–25 mi
    [5.1, 'major', null, 'high'],
    [25, 'moderate', null, 'elevated'],
    [25, 'minor', null, 'guarded'],
    [25, 'action', null, 'low'],
    // 25–100 mi
    [25.1, 'major', null, 'guarded'],
    [100, 'moderate', null, 'guarded'],
    [100, 'minor', null, 'low'],
    // Forecast-only tiers count the same as observed ones.
    [3, 'normal', 'major', 'critical'],
    [3, 'action', 'minor', 'elevated'],
    [10, 'action', 'moderate', 'elevated'],
    [50, 'normal', 'major', 'guarded'],
    [50, 'normal', 'minor', 'low'],
  ])('%s mi, observed %s, forecast %s → %s', (d, cat, fcat, level) => {
    expect(buildGaugeSection([gauge(d, cat, fcat)], { inUs: true }).level).toBe(level);
  });

  it('ignores gauges beyond 100 mi', () => {
    const s = buildGaugeSection([gauge(100.5, 'major')], { inUs: true });
    expect(s.level).toBe('low');
    expect(s.drivers).toEqual(['No NWPS forecast points within 100 mi']);
  });

  it('names contributing gauges worst-first, max 3, then the rest at flood stage', () => {
    const s = buildGaugeSection(
      [
        gauge(12, 'minor', null, { name: 'Meramec River at Eureka' }),
        gauge(2.4, 'moderate', null, { name: 'Mississippi River at St. Louis' }),
        gauge(4, 'action', 'minor', { name: 'Missouri River at St. Charles' }),
        gauge(20, 'moderate', null, { name: 'Illinois River at Grafton' }),
        gauge(60, 'minor', null, { name: 'Far Creek' }),
        gauge(1, 'normal', null, { name: 'Quiet Creek' }),
      ],
      { inUs: true }
    );
    expect(s.level).toBe('high');
    expect(s.drivers).toEqual([
      'Mississippi River at St. Louis (2.4 mi): Moderate flood now',
      // Same contribution (Elevated) as St. Charles: the worse tier leads.
      'Illinois River at Grafton (20.0 mi): Moderate flood now',
      'Missouri River at St. Charles (4.0 mi): Action stage now, forecast Minor flood',
      '+2 more gauges at flood stage within 100 mi',
    ]);
    expect(s.countLabel).toBe('4 in flood ≤25 mi');
  });

  it('says "(observed or forecast)" when an unlisted flooding gauge is forecast-only, and notes a falling forecast', () => {
    const s = buildGaugeSection(
      [
        gauge(1, 'major', 'moderate', { name: 'A' }),
        gauge(2, 'major', null, { name: 'B' }),
        gauge(3, 'major', null, { name: 'C' }),
        gauge(4, 'normal', 'minor', { name: 'D' }),
      ],
      { inUs: true }
    );
    expect(s.drivers[0]).toBe('A (1.0 mi): Major flood now, forecast to fall to Moderate flood');
    expect(s.drivers[3]).toBe('+1 more gauge at flood stage (observed or forecast) within 100 mi');
  });

  it('at Low, names the nearest gauge within 25 mi and its state', () => {
    const s = buildGaugeSection([gauge(8, 'normal', null, { name: 'X' }), gauge(3.1, 'normal', null, { name: 'Y' })], { inUs: true });
    expect(s.level).toBe('low');
    expect(s.drivers).toEqual(['Nearest NWPS gauge: Y (3.1 mi) — Normal']);
    expect(s.countLabel).toBe('None in flood ≤25 mi');
  });

  it('at Low with no gauge within 25 mi, says so and lists distant floods', () => {
    const s = buildGaugeSection([gauge(40, 'minor', null, { name: 'Far River' }), gauge(30, 'normal', null, { name: 'Near-ish' })], { inUs: true });
    expect(s.level).toBe('low');
    expect(s.drivers).toEqual([
      '1 gauge at flood stage 25–100 mi away',
      'No NWPS gauge within 25 mi — nearest: Near-ish (30.0 mi), Normal',
    ]);
  });

  it('no gauges within 100 mi: Low inside the US, unavailable outside it', () => {
    expect(buildGaugeSection([], { inUs: true })).toMatchObject({ level: 'low', drivers: ['No NWPS forecast points within 100 mi'] });
    const out = buildGaugeSection([], { inUs: false });
    expect(out.unavailable).toBe('NWPS river forecasts cover the US only');
    // A border site with US gauges nearby is still assessed.
    expect(buildGaugeSection([gauge(4, 'minor')], { inUs: false }).level).toBe('elevated');
  });
});

describe('pickDetailGauges', () => {
  it('flooding first (worst, then nearest), then action, then nearest; ≤25 mi; max 3', () => {
    const near = gauge(0.5, 'normal', null, { lid: 'NEAR' });
    const act = gauge(6, 'action', null, { lid: 'ACT' });
    const minor = gauge(2, 'minor', null, { lid: 'MINOR' });
    const modFc = gauge(20, 'normal', 'moderate', { lid: 'MODFC' });
    const far = gauge(30, 'major', null, { lid: 'FAR' });
    const all = [near, act, minor, modFc, far];
    expect(pickDetailGauges(all).map((g) => g.lid)).toEqual(['MODFC', 'MINOR', 'ACT']);
    expect(pickDetailGauges(all, 5).map((g) => g.lid)).toEqual(['MODFC', 'MINOR', 'ACT', 'NEAR']);
    expect(pickDetailGauges([near, gauge(3, 'low', null, { lid: 'L' })]).map((g) => g.lid)).toEqual(['NEAR', 'L']);
    expect(pickDetailGauges([far])).toEqual([]);
  });

  it('de-duplicates a gauge listed twice', () => {
    const g = gauge(2, 'minor', null, { lid: 'DUP' });
    expect(pickDetailGauges([g, { ...g }]).map((x) => x.lid)).toEqual(['DUP']);
  });
});

describe('floodRingCounts', () => {
  it('counts gauges, action, observed and forecast flooding per fixed ring', () => {
    const counts = floodRingCounts([
      gauge(0.5, 'action'),
      gauge(3, 'minor', 'moderate'),
      gauge(10, 'normal', 'minor'),
      gauge(24.9, 'major'),
      gauge(80, 'action', 'minor'),
      gauge(150, 'major'),
    ]);
    expect(counts.map((c) => [c.ring.miles, c.gauges, c.action, c.flooding, c.forecastFlooding])).toEqual([
      [1, 1, 1, 0, 0],
      [5, 2, 1, 1, 1],
      [25, 4, 1, 2, 2],
      [100, 5, 2, 2, 3],
    ]);
  });
});

// ── Excessive Rainfall Outlook ───────────────────────────────────────────────

describe('eroCategoryFromAttributes', () => {
  it.each<[Record<string, unknown>, EroCategory | null]>([
    [{ outlook: 'Marginal (At Least 5%)' }, 1],
    [{ OUTLOOK: 'SLGT' }, 2],
    [{ Outlook: 'Slight (At Least 15%)' }, 2],
    [{ outlook: 'Moderate (At Least 40%)' }, 3],
    [{ outlook: 'MDT' }, 3],
    [{ outlook: 'HIGH' }, 4],
    [{ outlook: 'High (At Least 70%)' }, 4],
    [{ outlook: 'MRGL' }, 1],
    [{ outlook: '???', dn: 2 }, 2],
    [{ dn: '3' }, 3],
    [{ DN: 1 }, 1],
    [{ dn: 4 }, 4],
    [{ dn: 0.05 }, 1],
    [{ dn: 0.15 }, 2],
    [{ dn: '0.40' }, 3],
    [{ dn: 0.7 }, 4],
    [{ dn: 0 }, null],
    [{ dn: 7 }, null],
    [{ outlook: 'no idea' }, null],
    [{}, null],
  ])('%j → %s', (attrs, cat) => {
    expect(eroCategoryFromAttributes(attrs)).toBe(cat);
  });
});

const eroDays = (cats: EroCategory[], dates: (string | null)[] = []): EroDay[] =>
  cats.map((category, i) => ({ day: i + 1, date: dates[i] ?? null, category }));

describe('buildEroSection', () => {
  it.each<[EroCategory[], RiskLevel]>([
    // Day 1
    [[4, 0, 0, 0, 0], 'high'],
    [[3, 0, 0, 0, 0], 'high'],
    [[2, 0, 0, 0, 0], 'elevated'],
    [[1, 0, 0, 0, 0], 'guarded'],
    // Days 2–3
    [[0, 4, 0, 0, 0], 'elevated'],
    [[0, 0, 3, 0, 0], 'elevated'],
    [[0, 2, 0, 0, 0], 'guarded'],
    [[0, 0, 2, 0, 0], 'guarded'],
    [[0, 1, 1, 0, 0], 'low'],
    // Days 4–5
    [[0, 0, 0, 4, 0], 'guarded'],
    [[0, 0, 0, 0, 3], 'guarded'],
    [[0, 0, 0, 2, 2], 'low'],
    [[0, 0, 0, 1, 1], 'low'],
    // worst wins
    [[1, 3, 0, 4, 0], 'elevated'],
  ])('%j → %s', (cats, level) => {
    expect(buildEroSection(eroDays(cats)).level).toBe(level);
  });

  it('writes Day 1 and later-day drivers (incl. driver-only days)', () => {
    const s = buildEroSection(eroDays([2, 1, 3, 0, 0], ['2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03']));
    expect(s.drivers).toEqual([
      'WPC Day 1: Slight risk (≥15%) of excessive rainfall at the property',
      'Marginal risk flagged for Day 2 (Wed 9/30)',
      'Moderate risk flagged for Day 3 (Thu 10/1)',
    ]);
    expect(s.countLabel).toBe('Day 1: SLGT');
    expect(s.level).toBe('elevated');
  });

  it('all-zero → Low with the explicit none driver', () => {
    const s = buildEroSection(eroDays([0, 0, 0, 0, 0]));
    expect(s).toMatchObject({
      level: 'low',
      drivers: ['No excessive-rainfall risk area over the property, Days 1–5'],
      countLabel: 'None today',
    });
  });

  it('no days → unavailable, never an implied none', () => {
    expect(buildEroSection([]).unavailable).toBeTruthy();
  });

  it('omits the date when unknown', () => {
    expect(buildEroSection(eroDays([0, 0, 0, 4, 0])).drivers).toEqual(['High risk flagged for Day 4']);
  });
});

// ── Rain: summarizePrecip ────────────────────────────────────────────────────

/**
 * 10 local days, 2026-09-22 … 2026-10-01 (7 past, today 09-29, 2 ahead),
 * hourly local times. The property is on CDT (UTC-5).
 */
function precipFixture(): FloodPrecipResponse {
  const days: string[] = [];
  for (let d = 0; d < 10; d++) days.push(new Date(Date.UTC(2026, 8, 22 + d)).toISOString().slice(0, 10));
  const time: string[] = [];
  for (const day of days) for (let h = 0; h < 24; h++) time.push(`${day}T${String(h).padStart(2, '0')}:00`);
  const precipIn = time.map(() => 0);
  // Local now is 2026-09-29T12:30 → current hour index 7*24 + 12 = 180.
  precipIn[107] = 3; //    73 h back — outside both windows
  precipIn[108] = 0.25; // 72 h back — first hour of the 72 h window
  precipIn[155] = 1; //    25 h back — 72 h only
  precipIn[179] = 0.5; //  last complete hour — both windows
  precipIn[180] = 2; //    the current hour — still falling, in neither window
  precipIn[181] = 0.1;
  const probPct = time.map((_, i) => (i < 180 ? null : 40));
  return {
    timezone: 'America/Chicago',
    utcOffsetSeconds: -5 * 3600,
    daily: { time: days, precipIn: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1] },
    hourly: { time, precipIn, probPct },
    updated: 0,
  };
}

const NOW = Date.UTC(2026, 8, 29, 17, 30); // 12:30 CDT

describe('summarizePrecip', () => {
  it('places now in the property\'s local time and sums the complete hours before it', () => {
    const { antecedent, hourlyNext48 } = summarizePrecip(precipFixture(), NOW);
    expect(antecedent.past24In).toBe(0.5);
    expect(antecedent.past72In).toBe(1.75);
    expect(antecedent.past7dIn).toBe(2.8);
    expect(antecedent.days).toEqual([
      { date: '2026-09-22', precipIn: 0.1 },
      { date: '2026-09-23', precipIn: 0.2 },
      { date: '2026-09-24', precipIn: 0.3 },
      { date: '2026-09-25', precipIn: 0.4 },
      { date: '2026-09-26', precipIn: 0.5 },
      { date: '2026-09-27', precipIn: 0.6 },
      { date: '2026-09-28', precipIn: 0.7 },
      { date: '2026-09-29', precipIn: 0.8 },
    ]);
    expect(hourlyNext48!.times).toHaveLength(48);
    expect(hourlyNext48!.times[0]).toBe('2026-09-29T12:00');
    expect(hourlyNext48!.times[47]).toBe('2026-10-01T11:00');
    expect(hourlyNext48!.precipIn.slice(0, 2)).toEqual([2, 0.1]);
    expect(hourlyNext48!.probPct[0]).toBe(40);
  });

  it('a wrong (UTC) offset would read a different hour — the offset is honoured', () => {
    const utc = summarizePrecip({ ...precipFixture(), utcOffsetSeconds: 0 }, NOW);
    expect(utc.antecedent.past24In).not.toBe(0.5);
  });

  it('uses the LOCAL calendar day for "today" (UTC has already rolled over)', () => {
    // 03:00 UTC on 09-30 is 22:00 CDT on 09-29.
    const { antecedent, hourlyNext48 } = summarizePrecip(precipFixture(), Date.UTC(2026, 8, 30, 3, 0));
    expect(antecedent.past7dIn).toBe(2.8);
    expect(antecedent.days![antecedent.days!.length - 1].date).toBe('2026-09-29');
    expect(hourlyNext48!.times[0]).toBe('2026-09-29T22:00');
  });

  it('returns null timing when fewer than 6 hours remain', () => {
    // Local 2026-10-01T20:30 → 4 hours left.
    const { hourlyNext48 } = summarizePrecip(precipFixture(), Date.UTC(2026, 9, 2, 1, 30));
    expect(hourlyNext48).toBeNull();
  });

  it('omits windows that run off the start of the series or contain a hole', () => {
    // Local 2026-09-22T10:30: only 10 past hours, today is the first daily entry.
    const early = summarizePrecip(precipFixture(), Date.UTC(2026, 8, 22, 15, 30));
    expect(early.antecedent.past24In).toBeUndefined();
    expect(early.antecedent.past72In).toBeUndefined();
    expect(early.antecedent.past7dIn).toBeUndefined();
    expect(early.antecedent.days).toEqual([{ date: '2026-09-22', precipIn: 0.1 }]);

    const holed = precipFixture();
    (holed.hourly.precipIn as unknown[])[170] = null;
    const h = summarizePrecip(holed, NOW);
    expect(h.antecedent.past24In).toBeUndefined();
    expect(h.antecedent.past72In).toBeUndefined();
    expect(h.antecedent.past7dIn).toBe(2.8);
  });

  it('never throws on missing / short arrays or a stale series', () => {
    const empty = { timezone: 'UTC', utcOffsetSeconds: 0, daily: {}, hourly: {}, updated: 0 } as unknown as FloodPrecipResponse;
    expect(summarizePrecip(empty, NOW)).toEqual({ antecedent: {}, hourlyNext48: null });
    const stale = summarizePrecip(precipFixture(), Date.UTC(2026, 9, 10, 12));
    expect(stale).toEqual({ antecedent: {}, hourlyNext48: null });
    const short = precipFixture();
    short.hourly.precipIn = short.hourly.precipIn.slice(0, 100);
    const r = summarizePrecip(short, NOW);
    expect(r.antecedent.past24In).toBeUndefined();
    expect(r.hourlyNext48).toBeNull();
    expect(r.antecedent.past7dIn).toBe(2.8);
  });
});

// ── Rain: sections ───────────────────────────────────────────────────────────

describe('buildAntecedentSection', () => {
  it.each<[AntecedentSummary, RiskLevel, string]>([
    [{ past72In: 4, past7dIn: 4.5 }, 'elevated', '4.0 in over the past 72 h — soils saturated, new rain runs off fast'],
    // Rounded down: 3.99 never prints as "4.0" beside the lower level.
    [{ past72In: 3.99, past7dIn: 0 }, 'guarded', '3.9 in over the past 72 h — soils likely saturated'],
    [{ past72In: 2.8 }, 'guarded', '2.8 in over the past 72 h — soils likely saturated'],
    [{ past72In: 1.99, past7dIn: 3 }, 'guarded', '3.0 in over the past 7 days — ground already wet'],
    [{ past72In: 1.99, past7dIn: 2.99 }, 'low', '2.9 in over the past 7 days'],
    [{ past72In: 0.4, past7dIn: 0.43 }, 'low', '0.4 in over the past 7 days'],
    [{ past72In: 0 }, 'low', '0 in over the past 72 h'],
  ])('%j → %s', (a, level, firstDriver) => {
    const s = buildAntecedentSection(a);
    expect(s.level).toBe(level);
    expect(s.drivers[0]).toBe(firstDriver);
    expect(s.unavailable).toBeUndefined();
  });

  it('nothing computable → unavailable', () => {
    expect(buildAntecedentSection({}).unavailable).toBeTruthy();
  });
});

describe('buildRainSection', () => {
  const wpc = (o: Partial<FloodReportData['rain']>): FloodReportData['rain'] => ({ in24: 0, in48: 0, in72: 0, in120: 0, source: 'wpc', ...o });

  it.each<[Partial<FloodReportData['rain']>, RiskLevel]>([
    [{ in24: 4, in72: 4 }, 'high'],
    [{ in24: 0.5, in72: 6 }, 'high'],
    [{ in24: 3.99, in72: 5.99, in120: 8 }, 'elevated'],
    [{ in24: 2, in72: 2 }, 'elevated'],
    [{ in24: 0, in72: 4 }, 'elevated'],
    [{ in24: 1, in72: 1 }, 'guarded'],
    [{ in24: 0, in72: 2 }, 'guarded'],
    [{ in24: 0, in72: 0, in120: 3 }, 'guarded'],
    [{ in24: 0, in72: 0, in120: 30 }, 'guarded'], // the 5-day window alone never exceeds Guarded
    [{ in24: 0.99, in72: 1.99, in120: 2.99 }, 'low'],
  ])('%j → %s', (r, level) => {
    expect(buildRainSection(wpc(r), null).level).toBe(level);
  });

  it('names the window that tripped, with the source', () => {
    expect(buildRainSection(wpc({ in24: 4.3, in72: 4.5 }), null).drivers).toEqual(['4.3 in forecast in the next 24 h (WPC)']);
    expect(buildRainSection(wpc({ in24: 2.2, in72: 4.1 }), null).drivers).toEqual([
      '2.2 in forecast in the next 24 h (WPC)',
      '4.1 in forecast in the next 72 h (WPC)',
    ]);
    expect(buildRainSection({ in24: 1.2, in48: 1.5, in72: 1.6, source: 'daily' }, null).drivers).toEqual([
      '1.2 in forecast in the next 24 h (daily point forecast)',
    ]);
  });

  it('gives context at Low', () => {
    expect(buildRainSection(wpc({ in72: 0.3 }), null).drivers).toEqual(['0.3 in forecast in the next 72 h (WPC)']);
    expect(buildRainSection(wpc({}), null).drivers).toEqual(['No measurable rain forecast in the next 72 h (WPC)']);
  });

  it.each<[Partial<FloodReportData['rain']>, AntecedentSummary | null, RiskLevel]>([
    [{ in24: 1 }, { past72In: 2 }, 'elevated'], //    guarded → elevated (72 h wet)
    [{ in24: 1 }, { past72In: 1.99, past7dIn: 3 }, 'elevated'], // 7-day wet
    [{ in24: 4 }, { past7dIn: 3 }, 'critical'], //    high → critical
    [{ in24: 1 }, { past72In: 1.99, past7dIn: 2.99 }, 'guarded'], // just dry enough
    [{ in24: 1 }, null, 'guarded'],
    [{ in24: 0.5 }, { past72In: 5 }, 'low'], //       a Low rainfall level is never escalated
  ])('wet-ground escalator: %j with %j → %s', (r, a, level) => {
    const s = buildRainSection(wpc(r), a);
    expect(s.level).toBe(level);
  });

  it('says why it escalated', () => {
    const s = buildRainSection(wpc({ in24: 1.1 }), { past72In: 2.8 });
    expect(s.drivers).toEqual([
      '1.1 in forecast in the next 24 h (WPC)',
      'Ground already wet (2.8 in over the past 72 h) — rainfall level raised one step',
    ]);
  });

  it('passes an unavailable feed through, and treats no values as unavailable', () => {
    expect(buildRainSection({ unavailable: 'WPC identify HTTP 503' }, null)).toEqual(unavailableSection('rain', 'WPC identify HTTP 503'));
    expect(buildRainSection({}, null).unavailable).toBeTruthy();
  });
});

// ── FEMA ─────────────────────────────────────────────────────────────────────

type SiteIn = NonNullable<FemaZoneResponse['atSite']>;
const site = (zone: string, subtype: string | null = null, sfha = false, o: Partial<SiteIn> = {}): SiteIn => ({
  zone, subtype, sfha, bfeFt: null, depthFt: null, datum: null, ...o,
});
const femaResp = (atSite: SiteIn | null, o: Partial<FemaZoneResponse> = {}): FemaZoneResponse => ({
  covered: true, atSite, polygons: [], nearestSfhaMi: atSite?.sfha ? 0 : null, truncated: false, updated: 0, ...o,
});

describe('describeFemaZone', () => {
  it.each<[SiteIn, string, boolean, boolean, boolean]>([
    [site('AE', 'FLOODWAY', true), 'Regulatory floodway (Zone AE)', true, true, false],
    [site('VE', null, true), 'Coastal high-hazard area, wave action (Zone VE)', true, false, true],
    [site('V', null, true), 'Coastal high-hazard area, wave action (Zone V)', true, false, true],
    [site('AE', null, true), '1%-annual-chance floodplain (Zone AE)', true, false, false],
    [site('A', null, true), '1%-annual-chance floodplain (Zone A)', true, false, false],
    [site('AO', null, true), '1%-annual-chance shallow flooding, sheet flow (Zone AO)', true, false, false],
    [site('AH', null, true), '1%-annual-chance shallow flooding, ponding (Zone AH)', true, false, false],
    [site('AE', null, false), '1%-annual-chance floodplain (Zone AE)', true, false, false], // flag missing: the letter decides
    [site('X', '0.2 PCT ANNUAL CHANCE FLOOD HAZARD'), '0.2%-annual-chance floodplain (Zone X, shaded)', false, false, false],
    [site('X', 'AREA WITH REDUCED FLOOD RISK DUE TO LEVEE'), 'Levee-reduced risk (Zone X)', false, false, false],
    [site('X', 'AREA OF MINIMAL FLOOD HAZARD'), 'Minimal flood hazard (Zone X)', false, false, false],
    [site('D'), 'Undetermined flood hazard (Zone D)', false, false, false],
    [site('OPEN WATER'), 'Open water', false, false, false],
  ])('%j → %s', (z, label, sfha, floodway, coastal) => {
    const d = describeFemaZone(z);
    expect(d.label).toBe(label);
    expect(d.sfha).toBe(sfha);
    expect(d.floodway).toBe(floodway);
    expect(d.coastal).toBe(coastal);
  });

  it('keeps BFE, depth and datum; drops FEMA sentinels', () => {
    expect(describeFemaZone(site('AE', null, true, { bfeFt: 512, datum: 'NAVD88' }))).toMatchObject({ bfeFt: 512, depthFt: null, datum: 'NAVD88' });
    expect(describeFemaZone(site('AE', null, true, { bfeFt: -9999 })).bfeFt).toBeNull();
  });
});

describe('buildFemaSection', () => {
  it('SFHA → Guarded (never higher on its own), zone named, "Zone AE" chip', () => {
    const { section, fema } = buildFemaSection(femaResp(site('AE', null, true, { bfeFt: 512, datum: 'NAVD88' })));
    expect(section.level).toBe('guarded');
    expect(section.countLabel).toBe('Zone AE');
    expect(section.drivers).toEqual([
      'Property is in the 1%-annual-chance floodplain (Zone AE) — about a 1-in-4 chance of flooding over 30 years',
      'Base flood elevation 512 ft (NAVD88)',
    ]);
    expect(fema.atSite?.label).toBe('1%-annual-chance floodplain (Zone AE)');
    expect(fema.nearestSfhaMi).toBe(0);
    expect(fema.unavailable).toBeUndefined();
  });

  it('floodway and V/VE get their own, stronger wording', () => {
    const fw = buildFemaSection(femaResp(site('AE', 'FLOODWAY', true))).section;
    expect(fw.level).toBe('guarded');
    expect(fw.drivers[0]).toMatch(/^Property is in the regulatory floodway \(Zone AE\) — .*deepest, fastest floodwater/);
    const ve = buildFemaSection(femaResp(site('VE', null, true, { bfeFt: 14 }))).section;
    expect(ve.level).toBe('guarded');
    expect(ve.drivers[0]).toMatch(/^Property is in a coastal high-hazard area \(Zone VE\) — .*waves/);
    expect(ve.drivers).toContain('Base flood elevation 14 ft');
    expect(ve.countLabel).toBe('Zone VE');
  });

  it('AO: base flood depth as a driver', () => {
    const s = buildFemaSection(femaResp(site('AO', null, true, { depthFt: 2 }))).section;
    expect(s.drivers).toContain('Base flood depth 2 ft');
  });

  it.each<[SiteIn, string, string]>([
    [site('X', '0.2 PCT ANNUAL CHANCE FLOOD HAZARD'), '0.2%-annual-chance floodplain (Zone X, shaded)', 'Zone X (shaded)'],
    [site('X', 'AREA OF MINIMAL FLOOD HAZARD'), 'Minimal flood hazard (Zone X)', 'Zone X'],
    [site('X', 'AREA WITH REDUCED FLOOD RISK DUE TO LEVEE'), 'Levee-reduced risk (Zone X) — residual risk if the levee is overtopped or fails', 'Zone X'],
    [site('D'), 'Undetermined flood hazard (Zone D) — flood risk not studied, not ruled out', 'Zone D'],
    [site('OPEN WATER'), 'Open water', 'Open water'],
  ])('non-SFHA %j → Low with the zone as a driver', (z, driver, chip) => {
    const { section } = buildFemaSection(femaResp(z));
    expect(section.level).toBe('low');
    expect(section.drivers).toEqual([driver]);
    expect(section.countLabel).toBe(chip);
  });

  it.each<[number | null, boolean]>([
    [0.2, true],
    [0.25, true],
    [0.26, false],
    [0, false],
    [null, false],
  ])('nearest SFHA %s mi away → driver %s', (mi, shown) => {
    const { section } = buildFemaSection(femaResp(site('X', 'AREA OF MINIMAL FLOOD HAZARD'), { nearestSfhaMi: mi }));
    expect(section.drivers.includes(`Nearest 1%-annual-chance floodplain ${mi?.toFixed(1)} mi away`)).toBe(shown);
  });

  it('no digital map → unavailable with the plain reason', () => {
    const { section, fema } = buildFemaSection(femaResp(null, { covered: false }));
    expect(section.unavailable).toBe('No digital FEMA flood map (NFHL) at this location — the area may be unmapped or on a paper FIRM');
    expect(fema.unavailable).toBe(section.unavailable);
    expect(fema.atSite).toBeNull();
  });

  it('covered but no zone at the point → unavailable', () => {
    const { section } = buildFemaSection(femaResp(null, { nearestSfhaMi: 0.4 }));
    expect(section.unavailable).toBe('No mapped FEMA flood zone at the property point');
  });

  it('"Area not included" is unmapped, not safe — and never read as SFHA by its leading A', () => {
    const { section, fema } = buildFemaSection(femaResp(site('AREA NOT INCLUDED')));
    expect(section.unavailable).toMatch(/not included in the FEMA flood study/);
    expect(fema.atSite).toMatchObject({ label: 'Area not included in the FEMA flood study', sfha: false });
  });

  it('truncated query → a caveat driver', () => {
    const { section } = buildFemaSection(femaResp(site('AE', null, true), { truncated: true }));
    expect(section.drivers[section.drivers.length - 1]).toMatch(/^⚠ FEMA zone query hit its record cap/);
  });
});

// ── Burn scars ───────────────────────────────────────────────────────────────

const MI_LAT = 1 / 69.093; // degrees of latitude per mile
/** A square scar centred on (lat, lon) with a given half-width in miles (optionally with a hole). */
function squareScar(lat: number, lon: number, halfMi: number, name?: string, holeHalfMi?: number) {
  const kLon = MI_LAT / Math.cos((lat * Math.PI) / 180);
  const sq = (h: number) => [
    [lon - h * kLon, lat - h * MI_LAT],
    [lon + h * kLon, lat - h * MI_LAT],
    [lon + h * kLon, lat + h * MI_LAT],
    [lon - h * kLon, lat + h * MI_LAT],
    [lon - h * kLon, lat - h * MI_LAT],
  ];
  return { name, rings: holeHalfMi ? [sq(halfMi), sq(holeHalfMi)] : [sq(halfMi)] };
}

describe('nearestBurnScar', () => {
  const T = { lat: 34, lon: -118 };
  const kLon = MI_LAT / Math.cos((34 * Math.PI) / 180);

  it('is 0 inside a perimeter', () => {
    expect(nearestBurnScar(T, [squareScar(34, -118, 3, 'Canyon')])).toEqual({ within10: 1, nearestMi: 0, nearestName: 'Canyon' });
  });

  it('treats an unburned island (a hole) as outside, measured to its edge', () => {
    const r = nearestBurnScar(T, [squareScar(34, -118, 6, 'Ring', 2)]);
    expect(r.nearestMi).toBeCloseTo(2, 1);
    expect(r.within10).toBe(1);
  });

  it('measures to the nearest edge and counts scars within 10 mi', () => {
    const r = nearestBurnScar(T, [
      squareScar(34, -118 + 9 * kLon, 1, 'East'), //  edge 8 mi east
      squareScar(34 + 12 * MI_LAT, -118, 1, 'North'), // edge 11 mi north
      squareScar(34, -118 - 4 * kLon, 1, 'West'), //  edge 3 mi west
    ]);
    expect(r.nearestName).toBe('West');
    expect(r.nearestMi).toBeCloseTo(3, 1);
    expect(r.within10).toBe(2);
  });

  it('handles no scars and junk geometry', () => {
    expect(nearestBurnScar(T, [])).toEqual({ within10: 0 });
    expect(nearestBurnScar(T, [{ rings: [[[NaN, 1]]] }, { rings: [] }])).toEqual({ within10: 0 });
  });
});

describe('rainSignalFrom', () => {
  const noRain: FloodReportData['rain'] = { in24: 0, in72: 0, source: 'wpc' };
  it.each<[EroCategory[], FloodReportData['rain'], boolean, boolean]>([
    [[0, 0, 0, 0, 0], noRain, false, false],
    [[0, 0, 1, 0, 0], noRain, true, false], //     Day 3 Marginal → any
    [[0, 0, 0, 4, 0], noRain, false, false], //    Day 4 does not count
    [[0, 2, 0, 0, 0], noRain, true, true], //      Day 2 Slight → strong
    [[1, 0, 0, 0, 0], noRain, true, false], //     Day 1 Marginal is not strong
    [[0, 0, 2, 0, 0], noRain, true, false], //     Day 3 Slight is only "any"
    [[0, 0, 0, 0, 0], { in24: 0, in72: 0.5 }, true, false],
    [[0, 0, 0, 0, 0], { in24: 0, in72: 0.49 }, false, false],
    [[0, 0, 0, 0, 0], { in24: 1, in72: 1 }, true, true],
    [[0, 0, 0, 0, 0], { in24: 0.99, in72: 0.99 }, true, false],
    [[0, 0, 0, 0, 0], { unavailable: 'down', in24: 5 }, false, false],
  ])('ERO %j, rain %j → any %s strong %s', (cats, rain, any, strong) => {
    expect(rainSignalFrom(eroDays(cats), rain)).toEqual({ any, strong });
  });

  it('tolerates no ERO at all', () => {
    expect(rainSignalFrom(undefined, { in24: 0, in72: 0 })).toEqual({ any: false, strong: false });
  });
});

describe('buildBurnScarSection', () => {
  const scar = (nearestMi: number, within10 = 1) => ({ within10, nearestMi, nearestName: 'Canyon Fire' });
  const R = (any: boolean, strong: boolean) => ({ any, strong });

  it.each<[ReturnType<typeof scar>, ReturnType<typeof R>, RiskLevel]>([
    [scar(8), R(false, false), 'guarded'],
    [scar(10), R(false, false), 'guarded'],
    [scar(8), R(true, false), 'elevated'],
    [scar(8), R(true, true), 'elevated'], //   strong rain but not within 2 mi
    [scar(2.1), R(true, true), 'elevated'],
    [scar(2), R(true, true), 'high'],
    [scar(0), R(true, true), 'high'],
    [scar(1), R(true, false), 'elevated'],
    [scar(1), R(false, false), 'guarded'],
  ])('%j with rain %j → %s', (s, rain, level) => {
    expect(buildBurnScarSection(s, rain).level).toBe(level);
  });

  it('names the scar, its distance and why it matters', () => {
    const s = buildBurnScarSection(scar(1.4, 2), R(true, true));
    expect(s.drivers[0]).toBe('Canyon Fire burn scar 1.4 mi away: burned ground sheds rain fast — flash floods and debris flows follow far smaller storms');
    expect(s.drivers).toContain('2 current-season burn scars within 10 mi');
    expect(buildBurnScarSection(scar(0), R(false, false)).drivers[0]).toMatch(/^Property is inside the Canyon Fire burn scar/);
  });

  it('none within 10 mi → Low with the explicit none driver', () => {
    expect(buildBurnScarSection({ within10: 0 }, R(true, true))).toMatchObject({
      level: 'low',
      drivers: ['No current-season burn scar within 10 mi'],
    });
    expect(buildBurnScarSection({ within10: 0, nearestMi: 23.4, nearestName: 'Far' }, R(true, true)).drivers).toEqual([
      'No current-season burn scar within 10 mi',
      'Nearest: Far burn scar 23 mi away',
    ]);
  });
});

// ── River discharge (GloFAS) ─────────────────────────────────────────────────

const TODAY = '2026-09-29';
/** 14 past days, today, 30 forecast days; flat 50 m³/s unless overridden by forecast day (1 = tomorrow). */
function discharge(
  o: { median?: Record<number, number>; max?: Record<number, number>; thresholds?: FloodDischargeResponse['thresholds'] } = {}
): FloodDischargeResponse {
  const time: string[] = [];
  for (let i = -14; i <= 30; i++) time.push(new Date(Date.UTC(2026, 8, 29 + i)).toISOString().slice(0, 10));
  const fday = (i: number) => i - 14; // index → forecast day number (0 = today)
  const series = (over: Record<number, number> | undefined, base: number) =>
    time.map((_, i) => (fday(i) <= 0 ? null : over?.[fday(i)] ?? base));
  return {
    lat: 38.6,
    lon: -90.2,
    time,
    discharge: time.map(() => 50),
    median: series(o.median, 50),
    p25: series(undefined, 40),
    p75: series(undefined, 60),
    min: series(undefined, 30),
    max: series(o.max, 70),
    thresholds: o.thresholds === undefined ? { rp2: 100, rp5: 200, rp20: 400, years: 41, fromYear: 1984, toYear: 2025 } : o.thresholds,
    updated: 0,
  };
}
const dis = (d: FloodDischargeResponse, gaugeWithin25 = false) => buildDischargeSection(d, { todayIso: TODAY, gaugeWithin25 });

describe('buildDischargeSection', () => {
  it.each<[Record<number, number>, Record<number, number>, RiskLevel]>([
    [{ 4: 400 }, {}, 'high'],
    [{ 4: 399 }, {}, 'elevated'],
    [{ 4: 200 }, {}, 'elevated'],
    [{ 4: 199 }, {}, 'guarded'],
    [{ 4: 100 }, {}, 'guarded'],
    [{ 4: 99 }, { 5: 200 }, 'guarded'], // median below the 2-yr, some members above the 5-yr
    [{ 4: 99 }, { 5: 199 }, 'low'],
  ])('median %j, max %j → %s', (median, max, level) => {
    expect(dis(discharge({ median, max })).level).toBe(level);
  });

  it('quotes the peak with units, date and the threshold crossed', () => {
    const d = discharge({ median: { 4: 1240 }, max: { 4: 1500 }, thresholds: { rp2: 520, rp5: 980, rp20: 1400, years: 41, fromYear: 1984, toYear: 2025 } });
    expect(dis(d).drivers).toEqual(['Model peak 1,240 m³/s on Oct 3 — above the 5-year flow (980 m³/s)']);
    expect(dis(discharge({ max: { 6: 250 } })).drivers).toEqual([
      'Some ensemble members reach 250 m³/s on Oct 5 — above the 5-year flow (200 m³/s)',
    ]);
    expect(dis(discharge()).drivers).toEqual(['Model peak 50 m³/s on Sep 30 — below the 2-year flow (100 m³/s)']);
  });

  it('only reads the next 15 forecast days (not today, not day 16+)', () => {
    expect(dis(discharge({ median: { 16: 900 } })).level).toBe('low');
    expect(dis(discharge({ median: { 15: 900 } })).level).toBe('high');
    const d = discharge();
    d.median[14] = 900; // today's slot (null upstream) — not a forecast day
    expect(dis(d).level).toBe('low');
  });

  it('is capped at Guarded when an NWPS gauge within 25 mi carries the official forecast', () => {
    const s = dis(discharge({ median: { 3: 450 } }), true);
    expect(s.level).toBe('guarded');
    expect(s.drivers[s.drivers.length - 1]).toMatch(/^Capped at Guarded — an NWPS gauge within 25 mi/);
    // Already at or below Guarded: noted, not "capped".
    const g = dis(discharge({ median: { 3: 150 } }), true);
    expect(g.level).toBe('guarded');
    expect(g.drivers[g.drivers.length - 1]).toMatch(/^An NWPS gauge within 25 mi carries the official NWS river forecast/);
    expect(dis(discharge(), true).drivers).toHaveLength(1);
  });

  it('minor stream (2-yr flow < 5 m³/s) → Low, not assessed', () => {
    const s = dis(discharge({ median: { 2: 900 }, thresholds: { rp2: 3.2, rp5: 6, rp20: 9, years: 30, fromYear: 1984, toYear: 2025 } }));
    expect(s.level).toBe('low');
    expect(s.drivers).toEqual(['Nearest model river cell carries a minor stream (2-yr flow 3.2 m³/s) — not assessed']);
  });

  it('thresholds null → unavailable (chart still renders elsewhere)', () => {
    expect(dis(discharge({ thresholds: null }))).toEqual(
      unavailableSection('discharge', 'GloFAS return-period thresholds unavailable — discharge shown for trend only')
    );
  });

  it('no ensemble values in the window → unavailable', () => {
    const d = discharge();
    d.median = d.median.map(() => null);
    expect(dis(d).unavailable).toBeTruthy();
  });
});

// ── Overall ──────────────────────────────────────────────────────────────────

const sec = (id: FloodSectionId, level: RiskLevel, drivers: string[] = [`${id} driver`], unavailable?: string): SectionResult =>
  unavailable ? unavailableSection(id, unavailable) : { id, title: FLOOD_SECTION_TITLES[id], level, drivers };

const AE: FemaSiteZone = describeFemaZone(site('AE', null, true));
const FLOODWAY: FemaSiteZone = describeFemaZone(site('AE', 'FLOODWAY', true));
const X: FemaSiteZone = describeFemaZone(site('X', 'AREA OF MINIMAL FLOOD HAZARD'));

describe('computeFloodOverall', () => {
  it('worst available level; non-Low drivers in section order', () => {
    const r = computeFloodOverall(
      [sec('alerts', 'guarded'), sec('gauges', 'low'), sec('ero', 'elevated'), sec('rain', 'low'), sec('fema', 'guarded')],
      null
    );
    expect(r).toEqual({ level: 'elevated', drivers: ['alerts driver', 'ero driver', 'fema driver'] });
  });

  it('unavailable sections do not set the level, and the picture is flagged incomplete', () => {
    const r = computeFloodOverall(
      [sec('alerts', 'low'), sec('gauges', 'critical', [], 'down'), sec('discharge', 'high', [], 'down'), sec('ero', 'guarded')],
      null
    );
    expect(r.level).toBe('guarded');
    expect(r.drivers).toEqual(['ero driver', '⚠ 2 feeds unavailable — this picture is incomplete']);
    expect(computeFloodOverall([sec('ero', 'low'), sec('rain', 'low', [], 'x')], null).drivers).toEqual([
      '⚠ 1 feed unavailable — this picture is incomplete',
    ]);
  });

  it('SFHA escalator: in the SFHA and a live section at Elevated+ → one level up, zone named first', () => {
    const r = computeFloodOverall([sec('gauges', 'elevated'), sec('fema', 'guarded')], AE);
    expect(r.level).toBe('high');
    expect(r.drivers[0]).toBe(
      'Property sits in FEMA Zone AE (1%-annual-chance floodplain) — the live flood signals below apply directly; overall raised one level'
    );
    expect(r.drivers.slice(1)).toEqual(['gauges driver', 'fema driver']);
    expect(computeFloodOverall([sec('burn-scars', 'elevated')], FLOODWAY).drivers[0]).toMatch(/Zone AE \(regulatory floodway\)/);
  });

  it.each<[string, SectionResult[], FemaSiteZone | null, RiskLevel]>([
    ['live section only Guarded', [sec('alerts', 'guarded'), sec('fema', 'guarded')], AE, 'guarded'],
    ['antecedent is not a live section', [sec('antecedent', 'elevated'), sec('fema', 'guarded')], AE, 'elevated'],
    ['not in the SFHA', [sec('alerts', 'high')], X, 'high'],
    ['no zone known', [sec('alerts', 'high')], null, 'high'],
    ['the live section is unavailable', [sec('discharge', 'high', [], 'down'), sec('fema', 'guarded')], AE, 'guarded'],
    ['discharge counts as live', [sec('discharge', 'elevated')], AE, 'high'],
    ['rain counts as live', [sec('rain', 'high')], AE, 'critical'],
  ])('escalator: %s', (_, sections, sfha, level) => {
    expect(computeFloodOverall(sections, sfha).level).toBe(level);
  });

  it('critical stays critical and does not claim a raise', () => {
    const r = computeFloodOverall([sec('alerts', 'critical')], AE);
    expect(r.level).toBe('critical');
    expect(r.drivers[0]).toBe('Property sits in FEMA Zone AE (1%-annual-chance floodplain) — the live flood signals below apply directly');
  });

  it('does not throw when every section is unavailable', () => {
    expect(computeFloodOverall([sec('ero', 'low', [], 'a'), sec('rain', 'low', [], 'b')], AE)).toEqual({
      level: 'low',
      drivers: ['⚠ 2 feeds unavailable — this picture is incomplete'],
    });
  });
});
