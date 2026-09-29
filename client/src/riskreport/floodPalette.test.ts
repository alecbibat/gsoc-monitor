import { describe, expect, it } from 'vitest';
import { FEMA_CLASS_ORDER, FEMA_CLASS_STYLE, femaZoneClass, isSfhaZoneCode, type FemaZoneClass } from './floodPalette';

// ── FEMA NFHL zone classification ───────────────────────────────────────────

describe('isSfhaZoneCode', () => {
  it.each([
    'A', 'AE', 'AH', 'AO', 'AR', 'A99',
    'A1', 'A5', 'A30', // the old numbered A zones
    'AR/AE', 'AR/AO', // dual AR zones
    'V', 'VE', 'V1', 'V30',
    'ae', ' AE ', 've', // case and whitespace tolerant
  ])('%j is an SFHA zone code', (zone) => {
    expect(isSfhaZoneCode(zone)).toBe(true);
  });

  it.each<string | null | undefined>([
    'AREA NOT INCLUDED', // starts with A but is an unstudied area — the reason for exact matching
    'X', 'X500', 'B', 'C', 'D', 'OPEN WATER',
    'A100', 'AX', 'AEX', 'VO', 'AR/',
    '', '   ', null, undefined,
  ])('%j is not an SFHA zone code', (zone) => {
    expect(isSfhaZoneCode(zone)).toBe(false);
  });
});

describe('femaZoneClass', () => {
  it.each<[string, string | null, boolean, FemaZoneClass]>([
    // SFHA codes: the code decides, whatever the flag says.
    ['A', null, true, 'sfha'],
    ['A', null, false, 'sfha'],
    ['AE', null, true, 'sfha'],
    ['AE', null, false, 'sfha'],
    ['AH', null, false, 'sfha'],
    ['AO', null, false, 'sfha'],
    ['AR', null, false, 'sfha'],
    ['A99', null, false, 'sfha'],
    ['A1', null, false, 'sfha'],
    ['A30', null, false, 'sfha'],
    ['AR/AE', null, false, 'sfha'],
    [' ae ', null, false, 'sfha'],
    ['AE', 'AREA OF SPECIAL CONSIDERATION', true, 'sfha'],
    // An unlisted A/V code counts only when FEMA flags it SFHA.
    ['A100', null, true, 'sfha'],
    ['A100', null, false, 'other'],
    // Coastal high-hazard.
    ['V', null, true, 'coastal'],
    ['VE', null, true, 'coastal'],
    ['VE', null, false, 'coastal'],
    ['V1', null, false, 'coastal'],
    ['V30', null, false, 'coastal'],
    // Floodway / encroachment subtypes inside an SFHA zone (before the coastal test).
    ['AE', 'FLOODWAY', true, 'floodway'],
    ['AE', 'FLOODWAY', false, 'floodway'],
    ['AE', 'floodway', true, 'floodway'],
    ['A', 'COLORADO RIVER FLOODWAY', true, 'floodway'],
    ['AO', 'ADMINISTRATIVE FLOODWAY', true, 'floodway'],
    ['AE', 'COMMUNITY ENCROACHMENT AREA', true, 'floodway'],
    ['AE', 'STATE ENCROACHMENT AREA', true, 'floodway'],
    ['VE', 'RIVERINE FLOODWAY SHOWN IN COASTAL ZONE', true, 'floodway'],
    // …but a floodway subtype outside the SFHA is not a floodway.
    ['X', 'FLOODWAY', false, 'minimal'],
    // Unstudied / unlabelled → other, never SFHA (even when flagged).
    ['AREA NOT INCLUDED', null, false, 'other'],
    ['AREA NOT INCLUDED', null, true, 'other'],
    ['Area Not Included', null, true, 'other'],
    ['', null, false, 'other'],
    ['   ', null, true, 'other'],
    ['ZZZ', null, false, 'other'],
    // Shaded X: the 0.2% floodplain and the 1% areas FEMA keeps outside the SFHA.
    ['X', '0.2 PCT ANNUAL CHANCE FLOOD HAZARD', false, 'moderate'],
    ['X', '0.2 pct annual chance flood hazard', false, 'moderate'],
    ['X', '0.2 PCT ANNUAL CHANCE FLOOD HAZARD CONTAINED IN CHANNEL', false, 'moderate'],
    ['X', '1 PCT DEPTH LESS THAN 1 FOOT', false, 'moderate'],
    ['X', '1 PCT DRAINAGE AREA LESS THAN 1 SQUARE MILE', false, 'moderate'],
    ['X', '1 PCT FUTURE CONDITIONS', false, 'moderate'],
    ['B', null, false, 'moderate'],
    ['X500', null, false, 'moderate'],
    // Levee-reduced.
    ['X', 'AREA WITH REDUCED FLOOD RISK DUE TO LEVEE', false, 'levee'],
    // Minimal (unshaded X / C); a stray SFHA flag on an X zone does not make it SFHA.
    ['X', 'AREA OF MINIMAL FLOOD HAZARD', false, 'minimal'],
    ['X', null, false, 'minimal'],
    ['X', 'AREA OF MINIMAL FLOOD HAZARD', true, 'minimal'],
    ['C', null, false, 'minimal'],
    // Undetermined / water.
    ['D', null, false, 'undetermined'],
    ['D', 'AREA OF UNDETERMINED FLOOD HAZARD', false, 'undetermined'],
    ['OPEN WATER', null, false, 'water'],
    ['open water', null, false, 'water'],
  ])('zone %j, subtype %j, SFHA flag %s → %s', (zone, subtype, sfha, cls) => {
    expect(femaZoneClass({ zone, subtype, sfha })).toBe(cls);
  });

  it('tolerates a missing zone or subtype from upstream', () => {
    expect(femaZoneClass({ zone: undefined as unknown as string, subtype: null, sfha: false })).toBe('other');
    expect(femaZoneClass({ zone: 'AE', subtype: undefined as unknown as null, sfha: true })).toBe('sfha');
  });
});

describe('FEMA_CLASS_STYLE / FEMA_CLASS_ORDER', () => {
  it('styles every class and draws each exactly once, the higher hazard on top', () => {
    const classes = Object.keys(FEMA_CLASS_STYLE).sort();
    expect(classes).toHaveLength(9);
    expect([...FEMA_CLASS_ORDER].sort()).toEqual(classes);
    const at = (c: FemaZoneClass) => FEMA_CLASS_ORDER.indexOf(c);
    expect(FEMA_CLASS_ORDER[FEMA_CLASS_ORDER.length - 1]).toBe('floodway');
    expect(at('sfha')).toBeGreaterThan(at('moderate'));
    expect(at('coastal')).toBeGreaterThan(at('sfha'));
    expect(at('moderate')).toBeGreaterThan(at('minimal'));
  });
});
