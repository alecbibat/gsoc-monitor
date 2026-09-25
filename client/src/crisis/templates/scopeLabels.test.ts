import { describe, expect, it } from 'vitest';
import { GENERAL_SCOPE } from './model';
import {
  TEMPLATE_PROPERTIES, propertyDef, scopeAudience, scopeChipLabel, scopeLabel, scopePropertyLabel, scopeTypeLabel,
} from './scopeLabels';

describe('template properties', () => {
  it('lists every location group plus the Windstar fleet, with unique ids', () => {
    const ids = TEMPLATE_PROPERTIES.map((p) => p.id);
    expect(ids).toContain('grand-canyon');
    expect(ids).toContain('windstar-ships');
    expect(ids[ids.length - 1]).toBe('windstar-ships');
    expect(new Set(ids).size).toBe(ids.length);
    expect(propertyDef('glacier')?.name).toBeTruthy();
    expect(propertyDef(null)).toBeNull();
    expect(propertyDef('nowhere')).toBeNull();
  });
});

describe('scope labels', () => {
  it('names each kind of scope', () => {
    expect(scopeLabel(GENERAL_SCOPE)).toBe('General (all incidents)');
    expect(scopeLabel({ incidentType: 'wildfire', propertyId: null }, false)).toBe('Wildfire');
    expect(scopeLabel({ incidentType: 'wildfire', propertyId: null })).toMatch(/^\S+ Wildfire$/);
    expect(scopeLabel({ incidentType: null, propertyId: 'grand-canyon' }, false)).toBe(propertyDef('grand-canyon')!.name);
    expect(scopeLabel({ incidentType: 'wildfire', propertyId: 'grand-canyon' }, false))
      .toBe(`Wildfire · ${propertyDef('grand-canyon')!.name}`);
  });

  it('falls back to the raw id for types and properties this build does not know', () => {
    expect(scopeTypeLabel('not-a-type')).toBe('not-a-type');
    expect(scopePropertyLabel('not-a-place')).toBe('not-a-place');
  });

  it('uses a short chip label for General', () => {
    expect(scopeChipLabel(GENERAL_SCOPE)).toBe('General');
    expect(scopeChipLabel({ incidentType: 'flood', propertyId: null }, false)).toBe('Flood');
  });

  it('explains who sees a scope', () => {
    expect(scopeAudience(GENERAL_SCOPE)).toMatch(/^Every incident/);
    expect(scopeAudience({ incidentType: 'flood', propertyId: null })).toBe('Every Flood incident, at any property');
    expect(scopeAudience({ incidentType: null, propertyId: 'glacier' })).toMatch(/^Every incident at .+, whatever its type$/);
    expect(scopeAudience({ incidentType: 'flood', propertyId: 'glacier' })).toMatch(/^Only Flood incidents at /);
  });
});
