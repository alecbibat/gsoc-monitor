import { describe, expect, it } from 'vitest';
import { cleanActor, invalidToggleReason } from './checklist';
import { normalizeIncidentTypeId } from './incidentTaxonomy';

describe('invalidToggleReason', () => {
  it('accepts a well-formed toggle', () => {
    expect(invalidToggleReason('ic-imm-1', { checked: true })).toBeNull();
    expect(invalidToggleReason('finance-dem-2', { checked: false, by: 'A. Analyst' })).toBeNull();
  });

  it('rejects malformed item ids — the public route accepts well-formed ids, nothing else', () => {
    expect(invalidToggleReason('', { checked: true })).toBe('invalid item id');
    expect(invalidToggleReason('UPPER', { checked: true })).toBe('invalid item id');
    expect(invalidToggleReason('1-leading-digit', { checked: true })).toBe('invalid item id');
    expect(invalidToggleReason('has space', { checked: true })).toBe('invalid item id');
    expect(invalidToggleReason('x'.repeat(65), { checked: true })).toBe('invalid item id');
  });

  it('rejects malformed bodies', () => {
    expect(invalidToggleReason('ic-imm-1', null)).toBe('body must be a JSON object');
    expect(invalidToggleReason('ic-imm-1', { checked: 'yes' })).toBe('checked must be a boolean');
    expect(invalidToggleReason('ic-imm-1', { checked: true, by: 42 })).toBe('by must be a string');
  });
});

describe('cleanActor', () => {
  it('trims, bounds, and strips control characters from viewer-typed names', () => {
    expect(cleanActor('  A. Bibat  ')).toBe('A. Bibat');
    expect(cleanActor('bad\u0007name')).toBe('badname');
    expect(cleanActor('x'.repeat(100))!.length).toBe(60);
    expect(cleanActor('')).toBeUndefined();
    expect(cleanActor('   ')).toBeUndefined();
    expect(cleanActor(42)).toBeUndefined();
  });
});

describe('normalizeIncidentTypeId', () => {
  it('maps retired ids forward and unknowns to other — the IAP lookup key', () => {
    expect(normalizeIncidentTypeId('maritime')).toBe('maritime');
    expect(normalizeIncidentTypeId('chemical')).toBe('hazmat');
    expect(normalizeIncidentTypeId('security')).toBe('violence-threat');
    expect(normalizeIncidentTypeId('not-a-type')).toBe('other');
    expect(normalizeIncidentTypeId(null)).toBe('other');
  });
});
