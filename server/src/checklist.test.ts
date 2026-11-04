import { describe, expect, it } from 'vitest';
import { cleanActor, invalidToggleReason, requestedStatus, storedStatus } from './checklist';
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

  it('accepts a status, and only a known one', () => {
    for (const status of ['not-started', 'in-progress', 'completed']) {
      expect(invalidToggleReason('ic-imm-1', { status })).toBeNull();
    }
    expect(invalidToggleReason('ic-imm-1', { status: 'blocked' })).toMatch(/^status must be one of/);
    expect(invalidToggleReason('ic-imm-1', { status: null })).toMatch(/^status must be one of/);
    expect(invalidToggleReason('ic-imm-1', { status: 'in-progress', by: 42 })).toBe('by must be a string');
  });
});

describe('requestedStatus', () => {
  it('reads the status, or a page-from-before-statuses checked flag', () => {
    expect(requestedStatus({ status: 'in-progress' })).toBe('in-progress');
    expect(requestedStatus({ status: 'completed', checked: false })).toBe('completed');
    expect(requestedStatus({ checked: true })).toBe('completed');
    expect(requestedStatus({ checked: false })).toBe('not-started');
  });
});

describe('storedStatus', () => {
  it('reads entries with and without a status', () => {
    expect(storedStatus({ checked: false, status: 'in-progress', at: 'x' })).toBe('in-progress');
    expect(storedStatus({ checked: true, at: 'x' })).toBe('completed');
    expect(storedStatus({ checked: false, at: 'x' })).toBe('not-started');
    expect(storedStatus({ checked: true, status: 'unknown', at: 'x' })).toBe('completed');
    expect(storedStatus(null)).toBe('not-started');
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
