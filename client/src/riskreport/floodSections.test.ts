import { describe, expect, it } from 'vitest';
import type { FemaZoneResponse, FloodCat, FloodDischargeResponse, FloodPrecipResponse } from '../types';
import type { RawAlert } from '../layers/alerts/alertsData';
import type { EroCategory, EroDay, FemaSiteZone, FloodAlertHit, FloodReportData, GaugeHit } from './floodTypes';
import type { RiskLevel, SectionResult } from './riskTypes';
import {
  FLOOD_LIVE_SECTIONS,
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
  countyResolvedHit,
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
  it('titles every section id (rainfall title is source-neutral)', () => {
    expect(FLOOD_SECTION_TITLES).toEqual({
      alerts: 'Flood alerts at site',
      gauges: 'River gauges (NWPS)',
      ero: 'Excessive Rainfall Outlook (WPC)',
      rain: 'Forecast rainfall',
      antecedent: 'Recent rainfall (past 7 days)',
      fema: 'FEMA flood zone',
      'burn-scars': 'Burn scars (post-fire runoff)',
      discharge: 'River discharge forecast (GloFAS)',
    });
  });

  it('live sections are the six signals the SFHA escalator multiplies (not FEMA, not antecedent)', () => {
    expect([...FLOOD_LIVE_SECTIONS]).toEqual(['alerts', 'gauges', 'ero', 'rain', 'burn-scars', 'discharge']);
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

  it('builds the display-ready hit (not county-resolved)', () => {
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
    expect(hit!.countyResolved).toBeUndefined();
    expect(hit!.bullets.map((b) => b.label)).toEqual(['What', 'Where', 'When', 'Impacts', 'Additional details']);
  });

  it('drops a null headline', () => {
    expect(toFloodAlertHit(rawAlert({ event: 'Flood Advisory', headline: null }))!.headline).toBeUndefined();
  });
});

const hit = (event: string, level: RiskLevel, o: Partial<FloodAlertHit> = {}): FloodAlertHit => ({
  event, level, tags: [], bullets: [], ...o,
});
/** A hit at the level the matrix gives its event. */
const classified = (event: string): FloodAlertHit => hit(event, classifyFloodAlert({ event }).level);

describe('countyResolvedHit', () => {
  it.each<[string, RiskLevel, RiskLevel]>([
    // Coastal-only products: capped at Elevated — the county matched, the warned coastal zone may not.
    ['Storm Surge Warning', 'critical', 'elevated'],
    ['Tsunami Warning', 'critical', 'elevated'],
    ['Coastal Flood Warning', 'high', 'elevated'],
    ['Lakeshore Flood Warning', 'high', 'elevated'],
    // Already at or below the cap: unchanged.
    ['Coastal Flood Watch', 'elevated', 'elevated'],
    ['Storm Surge Watch', 'elevated', 'elevated'],
    ['Tsunami Advisory', 'elevated', 'elevated'],
    ['Coastal Flood Advisory', 'guarded', 'guarded'],
    // Not coastal-only: keeps its full level.
    ['Flash Flood Warning', 'critical', 'critical'],
    ['Flood Warning', 'high', 'high'],
    ['Hurricane Warning', 'high', 'high'],
    ['Flood Watch', 'elevated', 'elevated'],
  ])('%s (%s) → %s, marked county-resolved', (event, matrixLevel, level) => {
    const h = classified(event);
    expect(h.level).toBe(matrixLevel);
    const r = countyResolvedHit(h);
    expect(r.level).toBe(level);
    expect(r.countyResolved).toBe(true);
  });

  it('returns a copy, keeping every other field', () => {
    const h = hit('Storm Surge Warning', 'critical', { severity: 'Extreme', tags: ['Observed'], bullets: [{ label: 'What', text: 'Surge' }] });
    const r = countyResolvedHit(h);
    expect(r).toEqual({ ...h, level: 'elevated', countyResolved: true });
    expect(h.level).toBe('critical');
    expect(h.countyResolved).toBeUndefined();
  });
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

describe('buildFloodAlertsSection — point lookup down (county-outline fallback)', () => {
  const POINT_DOWN = /^⚠ NWS point lookup unavailable — alerts matched by polygon and county outline/;

  it('a county-resolved hit asks the reader to confirm the site is in the warned area', () => {
    const s = buildFloodAlertsSection([countyResolvedHit(classified('Flood Watch'))], { countiesDown: false, pointLookupDown: true });
    expect(s.level).toBe('elevated');
    expect(s.drivers[0]).toBe("Flood Watch issued for the property's county — confirm the site is in the warned area");
    expect(s.drivers[0]).not.toMatch(/in effect at the property/);
  });

  it('a county-resolved coastal-only product says "coastal zones" and carries the capped level', () => {
    const s = buildFloodAlertsSection([countyResolvedHit(classified('Storm Surge Warning'))], { countiesDown: false, pointLookupDown: true });
    expect(s.level).toBe('elevated');
    expect(s.drivers[0]).toBe(
      "Storm Surge Warning issued for coastal zones of the property's county — confirm the site is in the warned zone"
    );
  });

  it('a polygon hit keeps "in effect at the property"; county-resolved and polygon hits are not folded together', () => {
    const s = buildFloodAlertsSection(
      [classified('Flash Flood Warning'), countyResolvedHit(classified('Flood Watch')), countyResolvedHit(classified('Flood Watch'))],
      { countiesDown: false, pointLookupDown: true }
    );
    expect(s.level).toBe('critical');
    expect(s.countLabel).toBe('3 active');
    expect(s.drivers).toEqual([
      'Flash Flood Warning in effect at the property',
      "Flood Watch issued for the property's county — confirm the site is in the warned area (2 alerts)",
      expect.stringMatching(POINT_DOWN),
    ]);
  });

  it('adds the point-lookup caveat after the hits, and before a county-geometry caveat', () => {
    const s = buildFloodAlertsSection([hit('Flood Advisory', 'guarded')], { countiesDown: true, pointLookupDown: true });
    expect(s.unavailable).toBeUndefined();
    expect(s.drivers).toHaveLength(3);
    expect(s.drivers[0]).toBe('Flood Advisory in effect at the property');
    expect(s.drivers[1]).toBe(
      '⚠ NWS point lookup unavailable — alerts matched by polygon and county outline, so a zone-based alert may not cover the site itself'
    );
    expect(s.drivers[2]).toMatch(/^⚠ County geometry unavailable/);
  });

  it('no hits: still Low and "None active", but the caveat stands (not a silent all-clear)', () => {
    const s = buildFloodAlertsSection([], { countiesDown: false, pointLookupDown: true });
    expect(s).toMatchObject({ level: 'low', countLabel: 'None active' });
    expect(s.unavailable).toBeUndefined();
    expect(s.drivers).toEqual([expect.stringMatching(POINT_DOWN)]);
  });

  it('no hits where zone alerts cannot be placed at all (unplaceable) → unavailable', () => {
    const s = buildFloodAlertsSection([], { countiesDown: false, pointLookupDown: true, unplaceable: true });
    expect(s.unavailable).toBe(
      "NWS point lookup unavailable, and this area's zone-based alerts can't be placed from county outlines — flood alerts could not be checked"
    );
    expect(s.level).toBe('low');
  });

  it('unplaceable with a hit → the hit stands (with the caveat); unplaceable alone changes nothing', () => {
    const s = buildFloodAlertsSection([hit('Flood Advisory', 'guarded')], { countiesDown: false, pointLookupDown: true, unplaceable: true });
    expect(s.unavailable).toBeUndefined();
    expect(s.level).toBe('guarded');
    expect(s.drivers[0]).toBe('Flood Advisory in effect at the property');
    expect(s.drivers).toContainEqual(expect.stringMatching(POINT_DOWN));
    // A hit must not read as the whole story where zone alerts can't be placed.
    expect(s.drivers).toContain(
      "⚠ This area's zone-based alerts (Flood Watches, Typhoon / Tropical Storm Warnings) can't be placed without the point lookup — more may be in effect"
    );

    const ok = buildFloodAlertsSection([], { countiesDown: false, unplaceable: true });
    expect(ok.unavailable).toBeUndefined();
    expect(ok.drivers).toEqual([]);
  });

  it('county shapes also down with no hits → unavailable', () => {
    const s = buildFloodAlertsSection([], { countiesDown: true, pointLookupDown: true });
    expect(s.unavailable).toMatch(/^County geometry unavailable/);
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
/** A gauge that has gone dark: no current reading (cat 'none'), maybe still an NWS forecast. */
const dark = (
  distanceMi: number,
  name: string,
  o: { fcat?: FloodCat | null; offline?: GaugeHit['offline']; obsTime?: string | null; lid?: string } = {}
): GaugeHit =>
  gauge(distanceMi, 'none', o.fcat ?? null, {
    name,
    offline: o.offline ?? 'stale',
    stage: null,
    ...(o.obsTime !== undefined ? { obsTime: o.obsTime } : {}),
    ...(o.lid ? { lid: o.lid } : {}),
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
      'No reporting NWPS gauge within 25 mi — nearest: Near-ish (30.0 mi), Normal',
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

describe('buildGaugeSection — gauges gone dark (out of service / not reporting)', () => {
  it('a dark gauge within 25 mi is a ⚠ caveat with its last report time; the Low context names the nearest REPORTING gauge', () => {
    const s = buildGaugeSection(
      [dark(3, 'Dark Creek', { obsTime: '2026-09-29T14:05:00Z' }), gauge(8, 'normal', null, { name: 'Quiet River' })],
      { inUs: true }
    );
    expect(s.level).toBe('low');
    expect(s.drivers).toEqual([
      '⚠ Dark Creek (3.0 mi) not reporting since 14:05 UTC Sep 29 — river state there unknown',
      'Nearest reporting NWPS gauge: Quiet River (8.0 mi) — Normal',
    ]);
    expect(s.countLabel).toBe('None in flood ≤25 mi');
  });

  it('says "out of service" for an NWPS out-of-service point, and plain "Nearest" when the closest gauge is reporting', () => {
    const s = buildGaugeSection(
      [gauge(2, 'normal', null, { name: 'Up River' }), dark(12, 'Broken Bridge', { offline: 'out_of_service' })],
      { inUs: true }
    );
    expect(s.drivers).toEqual([
      '⚠ Broken Bridge (12.0 mi) out of service — river state there unknown',
      'Nearest NWPS gauge: Up River (2.0 mi) — Normal',
    ]);
  });

  it.each<[string | null | undefined, string]>([
    ['2026-09-29T09:05:00-05:00', ' since 14:05 UTC Sep 29'], // printed in UTC whatever the source offset
    ['2026-10-01T00:00:00Z', ' since 00:00 UTC Oct 1'],
    ['0001-01-01T00:00:00Z', ''], // a sentinel, not a time
    ['not a date', ''],
    [null, ''],
    [undefined, ''],
  ])('last report %j → "%s"', (obsTime, since) => {
    const s = buildGaugeSection([dark(3, 'Dark Creek', { obsTime })], { inUs: true });
    expect(s.drivers[0]).toBe(`⚠ Dark Creek (3.0 mi) not reporting${since} — river state there unknown`);
  });

  it.each<[number, FloodCat | null, boolean]>([
    [25, null, true], //       25 mi is inside the caveat radius…
    [25.1, null, false], //    …25.1 mi is not
    [10, 'normal', true],
    [10, 'action', true], //   a forecast below flood stage still leaves the river state unknown
    [10, 'minor', false], //   a flooding forecast speaks through the table instead
    [30, 'major', false],
  ])('dark gauge at %s mi with NWS forecast %s → ⚠ caveat %s', (d, fcat, caveat) => {
    const s = buildGaugeSection([dark(d, 'Dark Creek', { fcat })], { inUs: true });
    expect(s.drivers.some((x) => x.startsWith('⚠ Dark Creek'))).toBe(caveat);
  });

  it('a dark gauge with a flooding NWS forecast contributes through the distance × tier table', () => {
    const minor = buildGaugeSection([dark(3, 'Dark Creek', { fcat: 'minor' }), gauge(8, 'normal')], { inUs: true });
    expect(minor.level).toBe('elevated');
    expect(minor.drivers).toEqual(['Dark Creek (3.0 mi): not reporting, NWS forecast Minor flood']);
    expect(minor.countLabel).toBe('1 in flood ≤25 mi');

    const major = buildGaugeSection([dark(10, 'Broken Bridge', { fcat: 'major', offline: 'out_of_service' })], { inUs: true });
    expect(major.level).toBe('high');
    expect(major.drivers).toEqual(['Broken Bridge (10.0 mi): out of service, NWS forecast Major flood']);
  });

  it('a dark gauge ≤5 mi with an action-stage forecast is Guarded from the table and named once — no duplicate ⚠ line', () => {
    const s = buildGaugeSection([dark(3, 'Dark Creek', { fcat: 'action' })], { inUs: true });
    expect(s.level).toBe('guarded');
    expect(s.drivers).toEqual(['Dark Creek (3.0 mi): not reporting, NWS forecast Action stage']);
    // 5–25 mi an action forecast contributes nothing, so the caveat carries it.
    const far = buildGaugeSection([dark(12, 'Dark Creek', { fcat: 'action' })], { inUs: true });
    expect(far.drivers).toContain('⚠ Dark Creek (12.0 mi) not reporting — river state there unknown');
  });

  it('a distant dark gauge with a flooding forecast counts as "(observed or forecast)" regional context', () => {
    const s = buildGaugeSection([dark(60, 'Far Dark', { fcat: 'minor' }), gauge(40, 'normal', null, { name: 'Far Quiet' })], { inUs: true });
    expect(s.level).toBe('low');
    expect(s.drivers).toEqual([
      '1 gauge at flood stage (observed or forecast) 25–100 mi away',
      'No reporting NWPS gauge within 25 mi — nearest: Far Quiet (40.0 mi), Normal',
    ]);
  });

  it('keeps the ⚠ caveat when the section is above Low (and then gives no Low context line)', () => {
    const s = buildGaugeSection([gauge(2, 'minor', null, { name: 'Flooding Run' }), dark(6, 'Dark Creek')], { inUs: true });
    expect(s.level).toBe('elevated');
    expect(s.drivers).toEqual([
      'Flooding Run (2.0 mi): Minor flood now',
      '⚠ Dark Creek (6.0 mi) not reporting — river state there unknown',
    ]);
  });

  it('names at most 3 dark gauges (nearest first), then a "+N more" line', () => {
    const s = buildGaugeSection(
      [dark(5, 'E'), dark(1, 'A'), dark(4, 'D'), dark(2, 'B'), dark(3, 'C'), gauge(30, 'normal', null, { name: 'Far Quiet' })],
      { inUs: true }
    );
    expect(s.level).toBe('low');
    expect(s.drivers).toEqual([
      '⚠ A (1.0 mi) not reporting — river state there unknown',
      '⚠ B (2.0 mi) not reporting — river state there unknown',
      '⚠ C (3.0 mi) not reporting — river state there unknown',
      '⚠ +2 more NWPS gauges within 25 mi not reporting',
      'No reporting NWPS gauge within 25 mi — nearest: Far Quiet (30.0 mi), Normal',
    ]);
  });

  it('exactly 4 dark gauges → "+1 more"', () => {
    const s = buildGaugeSection([dark(1, 'A'), dark(2, 'B'), dark(3, 'C'), dark(4, 'D'), gauge(9, 'normal')], { inUs: true });
    expect(s.drivers.filter((d) => d.startsWith('⚠ ') && d.includes('river state there unknown'))).toHaveLength(3);
    expect(s.drivers[3]).toMatch(/^⚠ \+1 more NWPS gauges? within 25 mi not reporting$/);
    expect(s.drivers).not.toContainEqual(expect.stringContaining('D (4.0 mi)'));
  });

  it('every gauge within 100 mi dark → says so (never names a dark gauge as the nearest)', () => {
    const s = buildGaugeSection([dark(4, 'Near Dark'), dark(40, 'Far Dark', { offline: 'out_of_service' })], { inUs: true });
    expect(s.level).toBe('low');
    expect(s.drivers).toEqual([
      '⚠ Near Dark (4.0 mi) not reporting — river state there unknown',
      '⚠ Every NWPS gauge within 100 mi is out of service or not reporting',
    ]);

    const farOnly = buildGaugeSection([dark(60, 'Far Dark')], { inUs: true });
    expect(farOnly.drivers).toEqual(['⚠ Every NWPS gauge within 100 mi is out of service or not reporting']);
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

  it('skips a dark gauge unless it still carries an NWS forecast at action stage or worse', () => {
    const picks = pickDetailGauges(
      [
        dark(0.5, 'n', { lid: 'DARK_NONE' }),
        dark(1, 'n', { lid: 'DARK_NORMAL', fcat: 'normal' }),
        dark(1.5, 'n', { lid: 'DARK_FNONE', fcat: 'none' }),
        dark(2, 'n', { lid: 'DARK_ACTION', fcat: 'action' }),
        dark(9, 'n', { lid: 'DARK_MINOR', fcat: 'minor', offline: 'out_of_service' }),
        gauge(4, 'normal', null, { lid: 'LIVE' }),
      ],
      5
    );
    expect(picks.map((g) => g.lid)).toEqual(['DARK_MINOR', 'DARK_ACTION', 'LIVE']);
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

  it('observed columns count reporting gauges only; forecast flooding and the dark count include dark gauges', () => {
    const counts = floodRingCounts([
      gauge(0.5, 'action'),
      dark(0.8, 'x'),
      dark(3, 'y', { fcat: 'major' }),
      dark(20, 'z', { fcat: 'action', offline: 'out_of_service' }),
    ]);
    expect(counts.map((c) => [c.ring.miles, c.gauges, c.action, c.flooding, c.forecastFlooding, c.offline])).toEqual([
      [1, 1, 1, 0, 0, 1],
      [5, 1, 1, 0, 1, 2],
      [25, 1, 1, 0, 1, 3],
      [100, 1, 1, 0, 1, 3],
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

const HOUR = 3600_000;
/** Mid-afternoon UTC: no later day is within 12 h of starting. */
const ERO_NOW = Date.UTC(2026, 8, 29, 15);

const eroDays = (cats: EroCategory[], dates: (string | null)[] = [], starts: (number | null | undefined)[] = []): EroDay[] =>
  cats.map((category, i) => ({
    day: i + 1,
    date: dates[i] ?? null,
    category,
    ...(starts[i] !== undefined ? { startMs: starts[i] } : {}),
  }));

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
    expect(buildEroSection(eroDays(cats), ERO_NOW).level).toBe(level);
  });

  it('writes Day 1 and later-day drivers (incl. driver-only days)', () => {
    const s = buildEroSection(eroDays([2, 1, 3, 0, 0], ['2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03']), ERO_NOW);
    expect(s.drivers).toEqual([
      'WPC Day 1: Slight risk (≥15%) of excessive rainfall at the property',
      'Marginal risk flagged for Day 2 (Wed 9/30)',
      'Moderate risk flagged for Day 3 (Thu 10/1)',
    ]);
    expect(s.countLabel).toBe('Day 1: SLGT');
    expect(s.level).toBe('elevated');
  });

  it('all-zero → Low with the explicit none driver', () => {
    const s = buildEroSection(eroDays([0, 0, 0, 0, 0]), ERO_NOW);
    expect(s).toMatchObject({
      level: 'low',
      drivers: ['No excessive-rainfall risk area over the property, Days 1–5'],
      countLabel: 'None today',
    });
  });

  it('no days → unavailable, never an implied none', () => {
    expect(buildEroSection([], ERO_NOW).unavailable).toBeTruthy();
  });

  it('omits the date when unknown', () => {
    expect(buildEroSection(eroDays([0, 0, 0, 4, 0]), ERO_NOW).drivers).toEqual(['High risk flagged for Day 4']);
  });
});

describe('buildEroSection — a day starting within 12 h is weighed as Day 1', () => {
  // 03Z: after WPC's 01Z Day 1 update, before the ~09Z roll. Day 1 is the
  // rest of the night (started 12Z yesterday); "Day 2" is the coming daytime.
  const NIGHT = Date.UTC(2026, 8, 29, 3);
  const D1 = Date.UTC(2026, 8, 28, 12);
  const STARTS = [D1, D1 + 24 * HOUR, D1 + 48 * HOUR, D1 + 72 * HOUR, D1 + 96 * HOUR]; // Day 2 starts 9 h after NIGHT
  const DATES = ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02'];

  it.each<[EroCategory, RiskLevel, RiskLevel]>([
    // category on Day 2, level overnight (Day 1 rule), level with no start time (Day 2 rule)
    [1, 'guarded', 'low'],
    [2, 'elevated', 'guarded'],
    [3, 'high', 'elevated'],
    [4, 'high', 'elevated'],
  ])('Day 2 category %s: %s when it starts within 12 h, %s by its own rule', (cat, imminentLevel, ownLevel) => {
    expect(buildEroSection(eroDays([0, cat, 0, 0, 0], DATES, STARTS), NIGHT).level).toBe(imminentLevel);
    expect(buildEroSection(eroDays([0, cat, 0, 0, 0], DATES), NIGHT).level).toBe(ownLevel);
    expect(buildEroSection(eroDays([0, cat, 0, 0, 0], DATES, [null, null, null, null, null]), NIGHT).level).toBe(ownLevel);
  });

  it('says the day is starting within 12 h (no date chip), and later days keep their own rule and wording', () => {
    const s = buildEroSection(eroDays([0, 2, 3, 0, 0], DATES, STARTS), NIGHT);
    expect(s.level).toBe('elevated');
    // The chip names the imminent day instead of "None today" beside Elevated.
    expect(s.countLabel).toBe('Day 2 (<12 h): SLGT');
    expect(buildEroSection(eroDays([0, 2, 0, 0, 0], DATES), NIGHT).countLabel).toBe('None today');
    expect(s.drivers).toEqual([
      'WPC Day 2, starting within 12 h: Slight risk (≥15%) of excessive rainfall at the property',
      'Moderate risk flagged for Day 3 (Wed 9/30)', // starts in 33 h: Days 2–3 rule → Elevated, not High
    ]);
  });

  it('boundary: exactly 12 h ahead counts, 12 h + 1 ms does not', () => {
    const at = buildEroSection(eroDays([0, 2], DATES, [null, NIGHT + 12 * HOUR]), NIGHT);
    expect(at.level).toBe('elevated');
    expect(at.drivers[0]).toMatch(/^WPC Day 2, starting within 12 h: Slight risk/);

    const after = buildEroSection(eroDays([0, 2], DATES, [null, NIGHT + 12 * HOUR + 1]), NIGHT);
    expect(after.level).toBe('guarded');
    expect(after.drivers).toEqual(['Slight risk flagged for Day 2 (Tue 9/29)']);
  });

  it('in the daytime the next Day 2 is 21 h out — its own rule applies', () => {
    const day1 = Date.UTC(2026, 8, 29, 12);
    const s = buildEroSection(eroDays([0, 2, 0, 0, 0], [], [day1, day1 + 24 * HOUR]), ERO_NOW);
    expect(s.level).toBe('guarded');
    expect(s.drivers).toEqual(['Slight risk flagged for Day 2']);
  });

  it('an imminent day with no risk area adds no driver', () => {
    const s = buildEroSection(eroDays([0, 0, 0, 0, 0], DATES, STARTS), NIGHT);
    expect(s).toMatchObject({ level: 'low', drivers: ['No excessive-rainfall risk area over the property, Days 1–5'] });
  });
});

// ── Rain: summarizePrecip ────────────────────────────────────────────────────

/**
 * Open-Meteo's past_days=7 shape: 13 local days, 2026-09-22 … 2026-10-04 (7
 * past, today 09-29, 5 ahead). Each hourly value is the PRECEDING hour's sum,
 * stamped at the hour's end. Property-local now is 12:30 on 09-29, so the
 * entry stamped 12:00 (index CUR) closes the last complete hour and CUR + 1
 * (stamped 13:00, covering 12–13) is the first hour still to come.
 *
 * Every non-zero hour sits at a window edge with a distinct value, so a sum
 * pins exactly which indices a window read.
 */
const P_DAYS = 13;
const CUR = 7 * 24 + 12; // 180 → '2026-09-29T12:00'
const MARKS: Record<number, number> = {
  [CUR - 72]: 5, //       just before the past-72 h window
  [CUR - 71]: 0.01, //    first hour of the past-72 h window
  [CUR - 24]: 0.1, //     past 72 h only (just before the past-24 h window)
  [CUR - 23]: 0.02, //    first hour of the past-24 h window
  [CUR]: 0.04, //         stamped with the current hour: the last complete hour — past, not forecast
  [CUR + 1]: 0.2, //      first hour still to come (now falling)
  [CUR + 24]: 0.4, //     last hour of the next 24 h
  [CUR + 25]: 0.8, //     first hour after it (48 h only)
  [CUR + 48]: 1.6, //     last hour of the next 48 h
  [CUR + 49]: 3.2,
  [CUR + 72]: 6.4, //     last hour of the next 72 h
  [CUR + 73]: 12.8,
  [CUR + 120]: 25.6, //   last hour of the next 5 days
  [CUR + 121]: 51.2, //   just past the 5-day window
};
const EXPECT_FORECAST = { in24: 0.6, in48: 3, in72: 12.6, in120: 51 };
const EXPECT_DAYS = [
  { date: '2026-09-22', precipIn: 0.1 },
  { date: '2026-09-23', precipIn: 0.2 },
  { date: '2026-09-24', precipIn: 0.3 },
  { date: '2026-09-25', precipIn: 0.4 },
  { date: '2026-09-26', precipIn: 0.5 },
  { date: '2026-09-27', precipIn: 0.6 },
  { date: '2026-09-28', precipIn: 0.7 },
  { date: '2026-09-29', precipIn: 0.8 },
];
const EXPECT_ANTECEDENT: AntecedentSummary = { past24In: 0.06, past72In: 0.17, past7dIn: 2.8, days: EXPECT_DAYS };

function precipFixture(utcOffsetSeconds = -5 * 3600): FloodPrecipResponse {
  const days: string[] = [];
  for (let d = 0; d < P_DAYS; d++) days.push(new Date(Date.UTC(2026, 8, 22 + d)).toISOString().slice(0, 10));
  const time: string[] = [];
  for (const day of days) for (let h = 0; h < 24; h++) time.push(`${day}T${String(h).padStart(2, '0')}:00`);
  const precipIn: (number | null)[] = time.map((_, i) => MARKS[i] ?? 0);
  // Past hours carry no probability; the first hour to come reads 1, the next 2, …
  const probPct: (number | null)[] = time.map((_, i) => (i <= CUR ? null : i - CUR));
  return {
    timezone: 'America/Chicago',
    utcOffsetSeconds,
    daily: { time: days, precipIn: days.map((_, i) => Math.round((i + 1) * 10) / 100) },
    hourly: { time, precipIn, probPct },
    updated: 0,
  };
}

/** Epoch ms of a property-local wall-clock time (2026) under a UTC offset. */
const localMs = (off: number, month0: number, day: number, h: number, min = 0, s = 0, ms = 0) =>
  Date.UTC(2026, month0, day, h, min, s, ms) - off * 1000;

const CDT = -5 * 3600;
const NOW = localMs(CDT, 8, 29, 12, 30); // 17:30 UTC

/** Cut the hourly series (all three arrays) to its first n entries. */
function truncHourly(r: FloodPrecipResponse, n: number): FloodPrecipResponse {
  return {
    ...r,
    hourly: { time: r.hourly.time.slice(0, n), precipIn: r.hourly.precipIn.slice(0, n), probPct: r.hourly.probPct.slice(0, n) },
  };
}

describe('summarizePrecip', () => {
  it('splits at the entry stamped with the current hour: past windows end at and include it, the forecast starts after it', () => {
    const r = summarizePrecip(precipFixture(), NOW);
    expect(r.antecedent).toEqual(EXPECT_ANTECEDENT);
    expect(r.forecast).toEqual(EXPECT_FORECAST);
  });

  it('labels the next-48 h bars by the hour each one covers (stamp − 1 h), starting with the hour now falling', () => {
    const { hourlyNext48: h } = summarizePrecip(precipFixture(), NOW);
    expect(h!.times).toHaveLength(48);
    expect(h!.precipIn).toHaveLength(48);
    expect(h!.probPct).toHaveLength(48);
    expect(h!.times[0]).toBe('2026-09-29T12:00'); // entry stamped 13:00
    expect(h!.times[1]).toBe('2026-09-29T13:00');
    expect(h!.times[47]).toBe('2026-10-01T11:00');
    expect([h!.precipIn[0], h!.precipIn[23], h!.precipIn[24], h!.precipIn[47]]).toEqual([0.2, 0.4, 0.8, 1.6]);
    expect(h!.precipIn.reduce((a, b) => a + b, 0)).toBeCloseTo(EXPECT_FORECAST.in48, 9);
    expect([h!.probPct[0], h!.probPct[47]]).toEqual([1, 48]);
  });

  it.each<[string, number, number]>([
    ['UTC−5 (CDT)', CDT, NOW],
    ['UTC', 0, localMs(0, 8, 29, 12, 30)],
    ['UTC+5:30 (half-hour offset)', 5.5 * 3600, localMs(5.5 * 3600, 8, 29, 12, 30)],
    ['UTC+10', 10 * 3600, localMs(10 * 3600, 8, 29, 12, 30)],
    ['UTC−10', -10 * 3600, localMs(-10 * 3600, 8, 29, 12, 30)],
  ])('places now in the property\'s local time: %s', (_, off, nowMs) => {
    const r = summarizePrecip(precipFixture(off), nowMs);
    expect(r.antecedent).toEqual(EXPECT_ANTECEDENT);
    expect(r.forecast).toEqual(EXPECT_FORECAST);
    expect(r.hourlyNext48!.times[0]).toBe('2026-09-29T12:00');
  });

  it('a wrong (UTC) offset would read a different hour — the offset is honoured', () => {
    const utc = summarizePrecip(precipFixture(0), NOW); // 17:30 read as local
    expect(utc.antecedent.past24In).not.toBe(EXPECT_ANTECEDENT.past24In);
    expect(utc.forecast).not.toEqual(EXPECT_FORECAST);
  });

  it('boundary: the whole current hour splits the same way, the last instant of the hour before splits one earlier', () => {
    for (const nowMs of [localMs(CDT, 8, 29, 12, 0, 0, 0), localMs(CDT, 8, 29, 12, 59, 59, 999)]) {
      const r = summarizePrecip(precipFixture(), nowMs);
      expect(r.antecedent.past24In).toBe(0.06);
      expect(r.forecast.in24).toBe(0.6);
    }
    // 11:59:59.999: the entry stamped 12:00 (11–12) is still falling → forecast.
    const r = summarizePrecip(precipFixture(), localMs(CDT, 8, 29, 11, 59, 59, 999));
    expect(r.antecedent.past24In).toBe(0.12); //  indices CUR−24 … CUR−1
    expect(r.antecedent.past72In).toBe(5.13); //  indices CUR−72 … CUR−1
    expect(r.forecast.in24).toBe(0.24); //        indices CUR … CUR+23
    expect(r.hourlyNext48!.times[0]).toBe('2026-09-29T11:00');
  });

  it('uses the LOCAL calendar day for "today" (UTC has already rolled over)', () => {
    // 03:00 UTC on 09-30 is 22:00 CDT on 09-29.
    const { antecedent, hourlyNext48 } = summarizePrecip(precipFixture(), Date.UTC(2026, 8, 30, 3, 0));
    expect(antecedent.past7dIn).toBe(2.8);
    expect(antecedent.days![antecedent.days!.length - 1].date).toBe('2026-09-29');
    expect(hourlyNext48!.times[0]).toBe('2026-09-29T22:00');
  });

  it('uses the LOCAL calendar day for "today" (UTC has not rolled over yet)', () => {
    // 20:30 UTC on 09-28 is 06:30 on 09-29 at UTC+10.
    const { antecedent } = summarizePrecip(precipFixture(10 * 3600), Date.UTC(2026, 8, 28, 20, 30));
    expect(antecedent.past7dIn).toBe(2.8);
    expect(antecedent.days).toEqual(EXPECT_DAYS);
  });

  it('shifts a midnight stamp back into the previous day', () => {
    // 23:30 local: the first hour to come is stamped 00:00 on the 30th and covers 23–24 on the 29th.
    const { hourlyNext48 } = summarizePrecip(precipFixture(), localMs(CDT, 8, 29, 23, 30));
    expect(hourlyNext48!.times.slice(0, 2)).toEqual(['2026-09-29T23:00', '2026-09-30T00:00']);
  });

  it.each<[string, number, Partial<AntecedentSummary>, Partial<typeof EXPECT_FORECAST>]>([
    ['in the past 24 h', CUR - 10, {}, EXPECT_FORECAST],
    ['in the last complete hour', CUR, {}, EXPECT_FORECAST],
    ['in the past 72 h only', CUR - 40, { past24In: 0.06 }, EXPECT_FORECAST],
    ['just before the past-72 h window', CUR - 72, { past24In: 0.06, past72In: 0.17 }, EXPECT_FORECAST],
    ['in the first hour to come', CUR + 1, { past24In: 0.06, past72In: 0.17 }, {}],
    ['in hour 30 to come', CUR + 30, { past24In: 0.06, past72In: 0.17 }, { in24: 0.6 }],
    ['in hour 60 to come', CUR + 60, { past24In: 0.06, past72In: 0.17 }, { in24: 0.6, in48: 3 }],
    ['in hour 100 to come', CUR + 100, { past24In: 0.06, past72In: 0.17 }, { in24: 0.6, in48: 3, in72: 12.6 }],
    ['just past the 5-day window', CUR + 121, { past24In: 0.06, past72In: 0.17 }, EXPECT_FORECAST],
  ])('a hole (null) %s omits exactly the totals whose window holds it — never read as 0', (_, idx, past, forecast) => {
    const f = precipFixture();
    f.hourly.precipIn[idx] = null;
    const r = summarizePrecip(f, NOW);
    expect(r.forecast).toEqual(forecast);
    expect(r.antecedent.past24In).toBe(past.past24In);
    expect(r.antecedent.past72In).toBe(past.past72In);
    expect(r.antecedent.past7dIn).toBe(2.8); // the daily series is separate
  });

  it('a hole in the timing window draws as no bar (chart only)', () => {
    const f = precipFixture();
    f.hourly.precipIn[CUR + 30] = null;
    f.hourly.probPct[CUR + 30] = null;
    const { hourlyNext48: h } = summarizePrecip(f, NOW);
    expect(h!.precipIn[29]).toBe(0);
    expect(h!.probPct[29]).toBeNull();
    expect(h!.probPct[28]).toBe(29);
  });

  it.each<[number, Partial<typeof EXPECT_FORECAST>, number]>([
    // hourly series length → forecast totals kept, timing-chart bars
    [CUR + 121, EXPECT_FORECAST, 48], //                    the 5-day window ends exactly at the series end
    [CUR + 120, { in24: 0.6, in48: 3, in72: 12.6 }, 48], // one hour short of it
    [CUR + 73, { in24: 0.6, in48: 3, in72: 12.6 }, 48],
    [CUR + 72, { in24: 0.6, in48: 3 }, 48],
    [CUR + 48, { in24: 0.6 }, 47],
    [CUR + 25, { in24: 0.6 }, 24],
    [CUR + 24, {}, 23],
  ])('a series ending at index %s → forecast %j, %s bars', (len, forecast, bars) => {
    const r = summarizePrecip(truncHourly(precipFixture(), len), NOW);
    expect(r.forecast).toEqual(forecast);
    expect(r.hourlyNext48!.times).toHaveLength(bars);
    expect(r.antecedent.past72In).toBe(0.17);
  });

  it('returns null timing when fewer than 6 hours remain (6 is enough)', () => {
    const six = summarizePrecip(precipFixture(), localMs(CDT, 9, 4, 17, 30)); // entries stamped 18:00 … 23:00 remain
    expect(six.hourlyNext48!.times).toEqual([
      '2026-10-04T17:00', '2026-10-04T18:00', '2026-10-04T19:00', '2026-10-04T20:00', '2026-10-04T21:00', '2026-10-04T22:00',
    ]);
    expect(six.forecast).toEqual({}); // not even 24 h left
    expect(summarizePrecip(precipFixture(), localMs(CDT, 9, 4, 18, 30)).hourlyNext48).toBeNull();
  });

  it('omits windows that run off the start of the series', () => {
    // Local 2026-09-22T10:30: only 11 complete past hours, today is the first daily entry.
    const early = summarizePrecip(precipFixture(), localMs(CDT, 8, 22, 10, 30));
    expect(early.antecedent.past24In).toBeUndefined();
    expect(early.antecedent.past72In).toBeUndefined();
    expect(early.antecedent.past7dIn).toBeUndefined();
    expect(early.antecedent.days).toEqual([{ date: '2026-09-22', precipIn: 0.1 }]);
    expect(early.forecast.in24).toBe(0);
  });

  it('a hole in the daily series drops the 7-day total and that day, not the hourly totals', () => {
    const f = precipFixture();
    f.daily.precipIn[3] = null;
    const r = summarizePrecip(f, NOW);
    expect(r.antecedent.past7dIn).toBeUndefined();
    expect(r.antecedent.days!.map((d) => d.date)).not.toContain('2026-09-25');
    expect(r.antecedent.days).toHaveLength(7);
    expect(r.antecedent.past72In).toBe(0.17);
  });

  it('never throws on missing / short arrays, a stale series or a bad clock', () => {
    const none = { antecedent: {}, forecast: {}, hourlyNext48: null };
    const empty = { timezone: 'UTC', utcOffsetSeconds: 0, daily: {}, hourly: {}, updated: 0 } as unknown as FloodPrecipResponse;
    expect(summarizePrecip(empty, NOW)).toEqual(none);
    expect(summarizePrecip(precipFixture(), Date.UTC(2026, 9, 10, 12))).toEqual(none);
    expect(summarizePrecip(precipFixture(), NaN)).toEqual(none);
    const short = precipFixture();
    short.hourly.precipIn = short.hourly.precipIn.slice(0, 100);
    const r = summarizePrecip(short, NOW);
    expect(r.antecedent.past24In).toBeUndefined();
    expect(r.forecast).toEqual({});
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
  const DRY: AntecedentSummary = { past72In: 0.2, past7dIn: 0.5 };
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
    expect(buildRainSection(wpc(r), DRY).level).toBe(level);
  });

  it('names the window that tripped, with the source', () => {
    expect(buildRainSection(wpc({ in24: 4.3, in72: 4.5 }), DRY).drivers).toEqual(['4.3 in forecast in the next 24 h (WPC)']);
    expect(buildRainSection(wpc({ in24: 2.2, in72: 4.1 }), DRY).drivers).toEqual([
      '2.2 in forecast in the next 24 h (WPC)',
      '4.1 in forecast in the next 72 h (WPC)',
    ]);
    expect(buildRainSection({ in24: 1.2, in48: 1.5, in72: 1.6, in120: 1.7, source: 'hourly' }, DRY).drivers).toEqual([
      '1.2 in forecast in the next 24 h (Open-Meteo hourly forecast)',
    ]);
    expect(buildRainSection({ in24: 0, in48: 0, in72: 0, in120: 3.2, source: 'hourly' }, DRY).drivers).toEqual([
      '3.2 in forecast in the next 5 days (Open-Meteo hourly forecast)',
    ]);
    // No source → no suffix.
    expect(buildRainSection({ in24: 1.2 }, DRY).drivers).toEqual(['1.2 in forecast in the next 24 h']);
  });

  it('the daily fallback counts whole days from TOMORROW and never claims "next 24 h"', () => {
    const s = buildRainSection({ in24: 2.3, in48: 3, in72: 4.2, in120: 5, source: 'daily' }, DRY);
    expect(s.level).toBe('elevated');
    expect(s.drivers).toHaveLength(2);
    expect(s.drivers[0]).toBe('2.3 in forecast for tomorrow (daily forecast)');
    expect(s.drivers[1]).toBe('4.2 in forecast for the 3 days from tomorrow (daily forecast)');
    expect(buildRainSection({ in24: 0, in48: 0, in72: 0, in120: 3.1, source: 'daily' }, DRY).drivers).toEqual([
      '3.1 in forecast for the 5 days from tomorrow (daily forecast)',
    ]);
  });

  it('gives context at Low: the longest window it has, worded for its source', () => {
    expect(buildRainSection(wpc({ in72: 0.3 }), DRY).drivers).toEqual(['0.3 in forecast in the next 72 h (WPC)']);
    expect(buildRainSection(wpc({}), DRY).drivers).toEqual(['No measurable rain forecast in the next 72 h (WPC)']);
    expect(buildRainSection({ in48: 0.3, source: 'hourly' }, DRY)).toMatchObject({
      level: 'low',
      drivers: ['0.3 in forecast in the next 48 h (Open-Meteo hourly forecast)'],
    });
    expect(buildRainSection({ in24: 0.1, in48: 0.2, in72: 0.3, source: 'daily' }, DRY).drivers).toEqual([
      '0.3 in forecast for the 3 days from tomorrow (daily forecast)',
    ]);
    expect(buildRainSection({ in24: 0, in48: 0, source: 'daily' }, DRY).drivers).toEqual([
      'No measurable rain forecast for the 2 days from tomorrow (daily forecast)',
    ]);
    expect(buildRainSection({ in24: 0.2, source: 'daily' }, DRY).drivers).toEqual([
      '0.2 in forecast for tomorrow (daily forecast)',
    ]);
  });

  it('recent rainfall known to be holed is unknown ground, not dry ground', () => {
    // The feed answered but no past total could be computed → caveat, no bump.
    const s = buildRainSection(wpc({ in24: 2.5 }), {});
    expect(s.level).toBe('elevated');
    expect(s.drivers).toContain('⚠ Recent rainfall unavailable — if the ground is already wet this level would be one step higher');
    // One total missing leaves the other window's wetness unknown: still a caveat…
    expect(buildRainSection(wpc({ in24: 2.5 }), { past7dIn: 0.4 }).drivers.some((d) => d.startsWith('⚠'))).toBe(true);
    expect(buildRainSection(wpc({ in24: 2.5 }), { past72In: 1 }).drivers.some((d) => d.startsWith('⚠'))).toBe(true);
    // …unless the one we have is already wet (then it bumps), or both are in and dry.
    expect(buildRainSection(wpc({ in24: 2.5 }), { past72In: 2.2 }).level).toBe('high');
    expect(buildRainSection(wpc({ in24: 2.5 }), { past72In: 1, past7dIn: 0.4 }).drivers.some((d) => d.startsWith('⚠'))).toBe(false);
  });

  it.each<[Partial<FloodReportData['rain']>, AntecedentSummary | null, RiskLevel]>([
    [{ in24: 1 }, { past72In: 2 }, 'elevated'], //    guarded → elevated (72 h wet)
    [{ in24: 1 }, { past72In: 1.99, past7dIn: 3 }, 'elevated'], // 7-day wet
    [{ in24: 4 }, { past7dIn: 3 }, 'critical'], //    high → critical
    [{ in24: 1 }, { past72In: 1.99, past7dIn: 2.99 }, 'guarded'], // just dry enough
    [{ in24: 1 }, null, 'guarded'], //                unknown ground: no bump
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

  it('recent rainfall unavailable (null) above Low → a ⚠ caveat instead of a bump', () => {
    const s = buildRainSection(wpc({ in24: 2.1 }), null);
    expect(s.level).toBe('elevated');
    expect(s.drivers).toEqual([
      '2.1 in forecast in the next 24 h (WPC)',
      '⚠ Recent rainfall unavailable — if the ground is already wet this level would be one step higher',
    ]);
    // At Low there is nothing to escalate, so nothing to caveat.
    expect(buildRainSection(wpc({ in72: 0.3 }), null).drivers).toEqual(['0.3 in forecast in the next 72 h (WPC)']);
    // Known dry ground: neither the bump nor the caveat.
    expect(buildRainSection(wpc({ in24: 2.1 }), DRY).drivers).toEqual(['2.1 in forecast in the next 24 h (WPC)']);
  });

  it('reads summarizePrecip\'s forecast as an hourly source end to end', () => {
    const { antecedent, forecast } = summarizePrecip(precipFixture(), NOW);
    const s = buildRainSection({ ...forecast, source: 'hourly' }, antecedent);
    expect(s.level).toBe('high'); // 12.6 in / 72 h; 0.17 in over 72 h is not wet ground
    expect(s.drivers).toEqual(['12.6 in forecast in the next 72 h (Open-Meteo hourly forecast)']);
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
    [site('AE', 'COMMUNITY ENCROACHMENT AREA', true), 'Regulatory floodway (Zone AE)', true, true, false],
    [site('VE', 'RIVERINE FLOODWAY SHOWN IN COASTAL ZONE', true), 'Regulatory floodway (Zone VE)', true, true, true],
    [site('VE', null, true), 'Coastal high-hazard area, wave action (Zone VE)', true, false, true],
    [site('V', null, true), 'Coastal high-hazard area, wave action (Zone V)', true, false, true],
    [site('AE', null, true), '1%-annual-chance floodplain (Zone AE)', true, false, false],
    [site('A', null, true), '1%-annual-chance floodplain (Zone A)', true, false, false],
    [site('A5', null, true), '1%-annual-chance floodplain (Zone A5)', true, false, false],
    [site('AO', null, true), '1%-annual-chance shallow flooding, sheet flow (Zone AO)', true, false, false],
    [site('AH', null, true), '1%-annual-chance shallow flooding, ponding (Zone AH)', true, false, false],
    [site('AR', null, true), '1%-annual-chance floodplain, levee being restored (Zone AR)', true, false, false],
    [site('A99', null, true), '1%-annual-chance floodplain, levee under construction (Zone A99)', true, false, false],
    [site('AE', null, false), '1%-annual-chance floodplain (Zone AE)', true, false, false], // flag missing: the code decides
    [site('X', '0.2 PCT ANNUAL CHANCE FLOOD HAZARD'), '0.2%-annual-chance floodplain (Zone X, shaded)', false, false, false],
    [site('X', '1 PCT DEPTH LESS THAN 1 FOOT'), '1%-annual-chance flooding under 1 ft deep (Zone X, shaded)', false, false, false],
    [
      site('X', '1 PCT DRAINAGE AREA LESS THAN 1 SQUARE MILE'),
      '1%-annual-chance flooding, drainage under 1 sq mi (Zone X, shaded)', false, false, false,
    ],
    [site('X', '1 PCT FUTURE CONDITIONS'), '1%-annual-chance floodplain under future conditions (Zone X, shaded)', false, false, false],
    [site('B'), '0.2%-annual-chance floodplain (Zone B)', false, false, false],
    [site('X500'), '0.2%-annual-chance floodplain (Zone X500)', false, false, false],
    [site('X', 'AREA WITH REDUCED FLOOD RISK DUE TO LEVEE'), 'Levee-reduced risk (Zone X)', false, false, false],
    [site('X', 'AREA OF MINIMAL FLOOD HAZARD'), 'Minimal flood hazard (Zone X)', false, false, false],
    [site('C'), 'Minimal flood hazard (Zone C)', false, false, false],
    [site('D'), 'Undetermined flood hazard (Zone D)', false, false, false],
    [site('OPEN WATER'), 'Open water', false, false, false],
    [site('AREA NOT INCLUDED'), 'Area not included in the FEMA flood study', false, false, false],
    [site('AREA NOT INCLUDED', null, true), 'Area not included in the FEMA flood study', false, false, false], // never SFHA
    [site(''), 'Unlabelled FEMA zone', false, false, false],
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
    [site('X', '1 PCT DEPTH LESS THAN 1 FOOT'), '1%-annual-chance flooding under 1 ft deep (Zone X, shaded)', 'Zone X (shaded)'],
    [
      site('X', '1 PCT DRAINAGE AREA LESS THAN 1 SQUARE MILE'),
      '1%-annual-chance flooding, drainage under 1 sq mi (Zone X, shaded)', 'Zone X (shaded)',
    ],
    [site('X', '1 PCT FUTURE CONDITIONS'), '1%-annual-chance floodplain under future conditions (Zone X, shaded)', 'Zone X (shaded)'],
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

  it('covered but no zone at the point → unavailable (saying so when the query was capped)', () => {
    expect(buildFemaSection(femaResp(null, { nearestSfhaMi: 0.4 })).section.unavailable).toBe('No mapped FEMA flood zone at the property point');
    expect(buildFemaSection(femaResp(null, { truncated: true })).section.unavailable).toBe(
      'No mapped FEMA flood zone at the property point (the zone query hit its record cap — zones may be missing)'
    );
  });

  it('"Area not included" is unmapped, not safe — and never read as SFHA by its leading A', () => {
    const { section, fema } = buildFemaSection(femaResp(site('AREA NOT INCLUDED', null, true)));
    expect(section.unavailable).toBe('Property is in an area not included in the FEMA flood study — no flood zone assigned');
    expect(fema.atSite).toMatchObject({ label: 'Area not included in the FEMA flood study', sfha: false });
  });

  const CAPPED = "⚠ FEMA's zone query hit its record cap — zones near the property (and the nearest-floodplain distance) may be missing";
  const NO_ENVELOPE = '⚠ Zone map around the property unavailable — distance to the nearest floodplain not checked';

  it('truncated query → a ⚠ caveat driver (SFHA or not); the level is unchanged', () => {
    const sfha = buildFemaSection(femaResp(site('AE', null, true), { truncated: true })).section;
    expect(sfha.level).toBe('guarded');
    expect(sfha.drivers[sfha.drivers.length - 1]).toBe(CAPPED);
    const x = buildFemaSection(femaResp(site('X', 'AREA OF MINIMAL FLOOD HAZARD'), { truncated: true })).section;
    expect(x).toMatchObject({ level: 'low', drivers: ['Minimal flood hazard (Zone X)', CAPPED] });
  });

  it('zone map (envelope) unavailable → a ⚠ caveat that the nearest-floodplain distance was not checked', () => {
    const x = buildFemaSection(femaResp(site('X', 'AREA OF MINIMAL FLOOD HAZARD'), { envelopeUnavailable: true })).section;
    expect(x).toMatchObject({ level: 'low', drivers: ['Minimal flood hazard (Zone X)', NO_ENVELOPE] });
    const both = buildFemaSection(femaResp(site('AE', null, true), { truncated: true, envelopeUnavailable: true })).section;
    expect(both.drivers.slice(-2)).toEqual([CAPPED, NO_ENVELOPE]);
    expect(buildFemaSection(femaResp(site('AE', null, true), { envelopeUnavailable: false })).section.drivers).not.toContain(NO_ENVELOPE);
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
    [[0, 0, 0, 0, 0], { unavailable: 'down', in24: 5 }, false, false], // an unavailable feed's numbers are not read
  ])('ERO %j, rain %j → any %s strong %s (known)', (cats, rain, any, strong) => {
    expect(rainSignalFrom(eroDays(cats), rain)).toEqual({ any, strong, unknown: false });
  });

  it('tolerates no ERO at all when a rainfall forecast is known', () => {
    expect(rainSignalFrom(undefined, { in24: 0, in72: 0 })).toEqual({ any: false, strong: false, unknown: false });
    expect(rainSignalFrom(undefined, { in24: 0 })).toEqual({ any: false, strong: false, unknown: false });
    expect(rainSignalFrom([], { in72: 0.6 })).toEqual({ any: true, strong: false, unknown: false });
  });

  it.each<[string, EroDay[] | undefined, FloodReportData['rain']]>([
    ['no outlook, rainfall unavailable', undefined, { unavailable: 'WPC down' }],
    ['empty outlook, no values', [], {}],
    ['no outlook, an unavailable feed that still carries numbers', undefined, { unavailable: 'down', in24: 5, in72: 5 }],
    ['no outlook, only the 48 h / 5-day totals', undefined, { in48: 2, in120: 4 }],
  ])('unknown when neither the outlook nor a 24 / 72 h forecast is available: %s', (_, ero, rain) => {
    expect(rainSignalFrom(ero, rain)).toEqual({ any: false, strong: false, unknown: true });
  });
});

describe('buildBurnScarSection', () => {
  const scar = (nearestMi: number, within10 = 1) => ({ within10, nearestMi, nearestName: 'Canyon Fire' });
  const R = (any: boolean, strong: boolean, unknown = false) => ({ any, strong, unknown });
  const WHY = 'burned ground sheds rain fast — flash floods and debris flows follow far smaller storms';
  const RAIN_UNKNOWN = '⚠ Rain signal unknown (outlook and rainfall forecast unavailable) — with rain coming this would be Elevated or higher';
  const CAPPED = '⚠ Fire-perimeter list hit its record cap — other scars nearby may be missing';
  const YEAR = "⚠ The fire-perimeter archive restarts each January — last year's burn scars are not included";

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
    [scar(1), R(false, false, true), 'guarded'], // unknown rain: stays Guarded (with a caveat)
  ])('%j with rain %j → %s', (s, rain, level) => {
    expect(buildBurnScarSection(s, rain).level).toBe(level);
  });

  it('names the scar, its distance and why it matters', () => {
    const s = buildBurnScarSection(scar(1.4, 2), R(true, true));
    expect(s.drivers).toEqual([
      `Canyon Fire burn scar 1.4 mi away: ${WHY}`,
      'Heavy rain signal in the next 48 h (WPC outlook Slight or higher, or ≥1 in forecast in 24 h)',
      "2 burn scars from this year's fires within 10 mi",
    ]);
    expect(buildBurnScarSection(scar(0), R(false, false)).drivers).toEqual([`Property is inside the Canyon Fire burn scar: ${WHY}`]);
  });

  it('none within 10 mi → Low with the explicit none driver', () => {
    expect(buildBurnScarSection({ within10: 0 }, R(true, true))).toMatchObject({
      level: 'low',
      drivers: ["No burn scar from this year's fires within 10 mi"],
    });
    expect(buildBurnScarSection({ within10: 0, nearestMi: 23.4, nearestName: 'Far' }, R(true, true)).drivers).toEqual([
      "No burn scar from this year's fires within 10 mi",
      'Nearest: Far burn scar 23 mi away',
    ]);
    expect(buildBurnScarSection({ within10: 0, nearestMi: 140 }, R(false, false)).drivers).toEqual([
      "No burn scar from this year's fires within 10 mi",
    ]);
  });

  it('rain signal unknown near a scar → ⚠ caveat, level stays Guarded; never with a known signal or with no scar near', () => {
    const s = buildBurnScarSection(scar(1), R(false, false, true));
    expect(s).toMatchObject({ level: 'guarded', drivers: [`Canyon Fire burn scar 1.0 mi away: ${WHY}`, RAIN_UNKNOWN] });
    expect(buildBurnScarSection(scar(1), R(false, false)).drivers).not.toContain(RAIN_UNKNOWN);
    expect(buildBurnScarSection(scar(1), R(true, false, true)).drivers).not.toContain(RAIN_UNKNOWN);
    expect(buildBurnScarSection({ within10: 0 }, R(false, false, true)).drivers).toEqual(["No burn scar from this year's fires within 10 mi"]);
    // End to end: no outlook and the rainfall feed down.
    expect(buildBurnScarSection(scar(1), rainSignalFrom(undefined, { unavailable: 'down' })).drivers).toContain(RAIN_UNKNOWN);
  });

  it('record cap with no scar within 10 mi → unavailable (a near scar may be missing)', () => {
    const want = unavailableSection('burn-scars', 'Fire-perimeter list hit its record cap — a burn scar near the property may be missing');
    expect(buildBurnScarSection({ within10: 0 }, R(false, false), { truncated: true })).toEqual(want);
    expect(buildBurnScarSection({ within10: 0, nearestMi: 23, nearestName: 'Far' }, R(false, false), { truncated: true, yearStart: true })).toEqual(want);
  });

  it('record cap with a scar within 10 mi → the scar stands, with a ⚠ caveat', () => {
    const s = buildBurnScarSection(scar(4, 2), R(true, false), { truncated: true });
    expect(s.level).toBe('elevated');
    expect(s.unavailable).toBeUndefined();
    expect(s.drivers.slice(-2)).toEqual(["2 burn scars from this year's fires within 10 mi", CAPPED]);
  });

  it('early in the year → the archive-restart ⚠ caveat is appended last, scar or not', () => {
    expect(buildBurnScarSection({ within10: 0 }, R(false, false), { yearStart: true }).drivers).toEqual([
      "No burn scar from this year's fires within 10 mi",
      YEAR,
    ]);
    const s = buildBurnScarSection(scar(1), R(false, false, true), { truncated: true, yearStart: true });
    expect(s.drivers).toEqual([`Canyon Fire burn scar 1.0 mi away: ${WHY}`, RAIN_UNKNOWN, CAPPED, YEAR]);
    expect(buildBurnScarSection({ within10: 0 }, R(false, false), { yearStart: false }).drivers).not.toContain(YEAR);
  });
});

// ── River discharge (GloFAS) ─────────────────────────────────────────────────

const TODAY = '2026-09-29';
/**
 * 14 past days, today, 30 ahead. Ensemble values from today on (forecast
 * day 0 = today, 1 = tomorrow), null before; flat unless overridden by
 * forecast day.
 */
function discharge(
  o: { median?: Record<number, number>; max?: Record<number, number>; thresholds?: FloodDischargeResponse['thresholds'] } = {}
): FloodDischargeResponse {
  const time: string[] = [];
  for (let i = -14; i <= 30; i++) time.push(new Date(Date.UTC(2026, 8, 29 + i)).toISOString().slice(0, 10));
  const fday = (i: number) => i - 14; // index → forecast day number (0 = today)
  const series = (over: Record<number, number> | undefined, base: number) =>
    time.map((_, i) => (fday(i) < 0 ? null : over?.[fday(i)] ?? base));
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
type ForecastGauge = { name: string; distanceMi: number } | null;
const dis = (d: FloodDischargeResponse, forecastGauge: ForecastGauge = null) => buildDischargeSection(d, { todayIso: TODAY, forecastGauge });
const EUREKA = { name: 'Meramec River at Eureka', distanceMi: 12 };
const MODEL_ONLY = 'Model only — no official NWS river forecast within 25 mi';

describe('buildDischargeSection', () => {
  it.each<[Record<number, number>, Record<number, number>, RiskLevel]>([
    [{ 4: 400 }, {}, 'high'],
    [{ 4: 399 }, {}, 'elevated'],
    [{ 4: 200 }, {}, 'elevated'],
    [{ 4: 199 }, {}, 'guarded'],
    [{ 4: 100 }, {}, 'guarded'],
    [{ 4: 99 }, { 5: 200 }, 'guarded'], // median below the 2-yr, some members above the 5-yr
    [{ 4: 99 }, { 5: 199 }, 'low'],
  ])('median %j, max %j → %s (no official forecast: never capped)', (median, max, level) => {
    expect(dis(discharge({ median, max })).level).toBe(level);
  });

  it('quotes the peak with units, date and the threshold crossed; above Low with no NWS forecast it says "model only"', () => {
    const d = discharge({ median: { 4: 1240 }, max: { 4: 1500 }, thresholds: { rp2: 520, rp5: 980, rp20: 1400, years: 41, fromYear: 1984, toYear: 2025 } });
    expect(dis(d).drivers).toEqual(['Model peak 1,240 m³/s on Oct 3 — above the 5-year flow (980 m³/s)', MODEL_ONLY]);
    expect(dis(discharge({ max: { 6: 250 } })).drivers).toEqual([
      'Some ensemble members reach 250 m³/s on Oct 5 — above the 5-year flow (200 m³/s)',
      MODEL_ONLY,
    ]);
    // Low: no model-only line. A flat series peaks on its first day — today.
    expect(dis(discharge()).drivers).toEqual(['Model peak 50 m³/s on Sep 29 — below the 2-year flow (100 m³/s)']);
  });

  it('reads today plus the next 10 days (11 entries) — not yesterday, not day 11+', () => {
    expect(dis(discharge({ median: { 0: 900 } })).level).toBe('high'); //  today
    expect(dis(discharge({ median: { 10: 900 } })).level).toBe('high'); // the 11th entry
    expect(dis(discharge({ median: { 11: 900 } })).level).toBe('low'); //  the 12th
    expect(dis(discharge({ max: { 11: 900 } })).level).toBe('low');
    const d = discharge();
    d.median[13] = 900; // yesterday — not in the window even with a value
    expect(dis(d).level).toBe('low');
    expect(dis(discharge({ median: { 10: 450 } })).drivers[0]).toBe('Model peak 450 m³/s on Oct 9 — above the 20-year flow (400 m³/s)');
  });

  it('a series that starts today (no past days) uses the same 11-day window', () => {
    const d = discharge({ median: { 10: 900 } });
    const cut = <T,>(a: T[]) => a.slice(14);
    const fromToday = { ...d, time: cut(d.time), median: cut(d.median), max: cut(d.max) };
    expect(dis(fromToday).level).toBe('high');
    const d11 = discharge({ median: { 11: 900 } });
    expect(dis({ ...d11, time: cut(d11.time), median: cut(d11.median), max: cut(d11.max) }).level).toBe('low');
  });

  it('is capped at Guarded when the official NWS river forecast is issued nearby, naming the forecast point', () => {
    const s = dis(discharge({ median: { 3: 450 } }), EUREKA);
    expect(s.level).toBe('guarded');
    expect(s.drivers).toEqual([
      'Model peak 450 m³/s on Oct 2 — above the 20-year flow (400 m³/s)',
      'Capped at Guarded — the official NWS river forecast at Meramec River at Eureka (12.0 mi) leads',
    ]);
    expect(dis(discharge({ median: { 3: 250 } }), EUREKA).level).toBe('guarded');
    // Already at Guarded: noted, not "capped".
    const g = dis(discharge({ median: { 3: 150 } }), EUREKA);
    expect(g.level).toBe('guarded');
    expect(g.drivers[g.drivers.length - 1]).toBe('The official NWS river forecast at Meramec River at Eureka (12.0 mi) leads');
    const members = dis(discharge({ max: { 6: 250 } }), { name: 'Big Creek', distanceMi: 0.05 });
    expect(members.drivers[members.drivers.length - 1]).toBe('The official NWS river forecast at Big Creek (<0.1 mi) leads');
    // At Low there is nothing to cap or qualify.
    expect(dis(discharge(), EUREKA).drivers).toHaveLength(1);
  });

  it('with no official forecast nearby the model is not capped', () => {
    const s = dis(discharge({ median: { 3: 450 } }), null);
    expect(s.level).toBe('high');
    expect(s.drivers[s.drivers.length - 1]).toBe(MODEL_ONLY);
    expect(s.drivers.some((x) => /Capped/.test(x))).toBe(false);
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
    expect(dis(d).unavailable).toBe('GloFAS ensemble forecast missing for the coming days');
    // A series that ended before today.
    expect(buildDischargeSection(discharge(), { todayIso: '2026-11-15', forecastGauge: null }).unavailable).toBeTruthy();
  });
});

// ── Overall ──────────────────────────────────────────────────────────────────

const sec = (id: FloodSectionId, level: RiskLevel, drivers: string[] = [`${id} driver`], unavailable?: string): SectionResult =>
  unavailable ? unavailableSection(id, unavailable) : { id, title: FLOOD_SECTION_TITLES[id], level, drivers };

const AE: FemaSiteZone = describeFemaZone(site('AE', null, true));
const FLOODWAY: FemaSiteZone = describeFemaZone(site('AE', 'FLOODWAY', true));
const VE: FemaSiteZone = describeFemaZone(site('VE', null, true));
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

  it('a Low LIVE section still brings its ⚠ caveats (only those) to the bottom line, in section order', () => {
    const r = computeFloodOverall(
      [
        sec('alerts', 'low', ['⚠ alerts caveat']),
        sec('gauges', 'low', ['⚠ gauge dark', 'Nearest reporting NWPS gauge: Y (8.0 mi) — Normal']),
        sec('ero', 'elevated', ['ero driver']),
        sec('rain', 'low', ['0.3 in forecast in the next 72 h (WPC)', '⚠ rain caveat']),
        sec('burn-scars', 'low', ["No burn scar from this year's fires within 10 mi", '⚠ archive caveat']),
        sec('discharge', 'low', ['Model peak ⚠ not a caveat', '⚠ discharge caveat']),
      ],
      null
    );
    expect(r.level).toBe('elevated');
    expect(r.drivers).toEqual([
      '⚠ alerts caveat',
      '⚠ gauge dark',
      'ero driver',
      '⚠ rain caveat',
      '⚠ archive caveat',
      '⚠ discharge caveat',
    ]);
  });

  it('a Low FEMA or antecedent section contributes nothing — not even its ⚠ caveats', () => {
    const r = computeFloodOverall(
      [sec('fema', 'low', ['Minimal flood hazard (Zone X)', '⚠ fema caveat']), sec('antecedent', 'low', ['⚠ antecedent caveat'])],
      null
    );
    expect(r).toEqual({ level: 'low', drivers: [] });
    // Above Low they contribute every driver, caveats included.
    expect(computeFloodOverall([sec('fema', 'guarded', ['Zone AE', '⚠ fema caveat'])], null).drivers).toEqual(['Zone AE', '⚠ fema caveat']);
  });

  it('an unavailable section contributes no drivers, even ⚠ ones', () => {
    const down: SectionResult = { ...unavailableSection('alerts', 'county geometry down'), drivers: ['⚠ lookup caveat'] };
    expect(computeFloodOverall([down, sec('gauges', 'low', ['⚠ gauge dark'])], null).drivers).toEqual([
      '⚠ gauge dark',
      '⚠ 1 feed unavailable — this picture is incomplete',
    ]);
  });

  it('end to end: a calm day with a dark gauge and a failed point lookup is not reported as all-clear', () => {
    const alerts = buildFloodAlertsSection([], { countiesDown: false, pointLookupDown: true });
    const gauges = buildGaugeSection([dark(3, 'Dark Creek'), gauge(8, 'normal', null, { name: 'Quiet River' })], { inUs: true });
    const fema = buildFemaSection(femaResp(site('X', 'AREA OF MINIMAL FLOOD HAZARD'), { truncated: true })).section;
    const r = computeFloodOverall([alerts, gauges, fema], X);
    expect(r.level).toBe('low');
    expect(r.drivers).toEqual([
      '⚠ NWS point lookup unavailable — alerts matched by polygon and county outline, so a zone-based alert may not cover the site itself',
      '⚠ Dark Creek (3.0 mi) not reporting — river state there unknown',
    ]);
  });

  it('SFHA escalator: in the SFHA and a live section at Elevated+ → one level up, zone named first', () => {
    const r = computeFloodOverall([sec('gauges', 'elevated'), sec('fema', 'guarded')], AE);
    expect(r.level).toBe('high');
    expect(r.drivers[0]).toBe(
      'Property sits in FEMA Zone AE (1%-annual-chance floodplain) with live flood signals at Elevated or above — overall raised one level'
    );
    expect(r.drivers.slice(1)).toEqual(['gauges driver', 'fema driver']);
    expect(computeFloodOverall([sec('burn-scars', 'elevated')], FLOODWAY).drivers[0]).toBe(
      'Property sits in FEMA Zone AE (regulatory floodway) with live flood signals at Elevated or above — overall raised one level'
    );
    expect(computeFloodOverall([sec('rain', 'elevated')], VE).drivers[0]).toMatch(/^Property sits in FEMA Zone VE \(coastal high-hazard area\) with/);
  });

  it('SFHA escalator goes first, ahead of Low sections\' caveats, and the incomplete-picture line stays last', () => {
    const r = computeFloodOverall([sec('gauges', 'low', ['⚠ gauge dark']), sec('ero', 'elevated'), sec('rain', 'low', [], 'down')], AE);
    expect(r.level).toBe('high');
    expect(r.drivers).toEqual([
      expect.stringMatching(/^Property sits in FEMA Zone AE .* — overall raised one level$/),
      '⚠ gauge dark',
      'ero driver',
      '⚠ 1 feed unavailable — this picture is incomplete',
    ]);
  });

  it.each<[string, SectionResult[], FemaSiteZone | null, RiskLevel]>([
    ['live section only Guarded', [sec('alerts', 'guarded'), sec('fema', 'guarded')], AE, 'guarded'],
    ['antecedent is not a live section', [sec('antecedent', 'elevated'), sec('fema', 'guarded')], AE, 'elevated'],
    ['not in the SFHA', [sec('alerts', 'high')], X, 'high'],
    ['no zone known', [sec('alerts', 'high')], null, 'high'],
    ['the live section is unavailable', [sec('discharge', 'high', [], 'down'), sec('fema', 'guarded')], AE, 'guarded'],
    ['a Low live section\'s caveat is not a signal', [sec('gauges', 'low', ['⚠ gauge dark']), sec('fema', 'guarded')], AE, 'guarded'],
    ['discharge counts as live', [sec('discharge', 'elevated')], AE, 'high'],
    ['rain counts as live', [sec('rain', 'high')], AE, 'critical'],
  ])('escalator: %s', (_, sections, sfha, level) => {
    expect(computeFloodOverall(sections, sfha).level).toBe(level);
  });

  it('critical stays critical and does not claim a raise', () => {
    const r = computeFloodOverall([sec('alerts', 'critical')], AE);
    expect(r.level).toBe('critical');
    expect(r.drivers[0]).toBe('Property sits in FEMA Zone AE (1%-annual-chance floodplain) with live flood signals at Elevated or above');
  });

  it('does not throw when every section is unavailable', () => {
    expect(computeFloodOverall([sec('ero', 'low', [], 'a'), sec('rain', 'low', [], 'b')], AE)).toEqual({
      level: 'low',
      drivers: ['⚠ 2 feeds unavailable — this picture is incomplete'],
    });
  });
});

describe('second-review follow-ups', () => {
  it('discharge: with the NWPS list down it never claims "no official forecast"', () => {
    const d: FloodDischargeResponse = {
      lat: 38.6, lon: -90.2,
      time: ['2026-09-29', '2026-09-30'],
      discharge: [100, null], median: [100, 1500], p25: [90, 1200], p75: [110, 1600], min: [80, 900], max: [120, 1800],
      thresholds: { rp2: 900, rp5: 1400, rp20: 2200, years: 20, fromYear: 2006, toYear: 2025 },
      updated: 0,
    };
    const down = buildDischargeSection(d, { todayIso: '2026-09-29', forecastGauge: null, gaugesKnown: false });
    expect(down.level).toBe('elevated');
    expect(down.drivers).toContain('NWPS gauges unavailable — could not check for an official NWS river forecast nearby');
    expect(down.drivers.join(' ')).not.toMatch(/Model only/);
  });

  it('FEMA: a server-trimmed map gets a map-only note', () => {
    const { section } = buildFemaSection({
      covered: true,
      atSite: { zone: 'X', subtype: 'AREA OF MINIMAL FLOOD HAZARD', sfha: false, bfeFt: null, depthFt: null, datum: null },
      polygons: [], nearestSfhaMi: null, truncated: false, mapTrimmed: true, updated: 0,
    });
    expect(section.drivers).toContain("Zone map trimmed for size — the farthest zones aren't drawn (distances use FEMA's full shapes)");
  });

  it('antecedent: a window lost to a model gap is said, not implied dry', () => {
    expect(buildAntecedentSection({ past7dIn: 0.4 }).drivers).toContain('Past-72 h total unavailable (gap in the model series)');
    expect(buildAntecedentSection({ past72In: 0.4 }).drivers).toContain('Past-7-day total unavailable (gap in the model series)');
    expect(buildAntecedentSection({ past72In: 0.4, past7dIn: 0.9 }).drivers.join(' ')).not.toMatch(/unavailable/);
  });
});

