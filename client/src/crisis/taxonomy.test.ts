import { describe, expect, it } from 'vitest';
import {
  INCIDENT_CATEGORIES,
  INCIDENT_STATUSES,
  INCIDENT_TYPES,
  LEGACY_STATUS_ALIASES,
  LEGACY_TYPE_ALIASES,
  incidentStatusDef,
  incidentTypeDef,
  incidentTypesInCategory,
  normalizeIncidentFields,
  normalizeIncidentStatus,
  normalizeIncidentType,
} from './taxonomy';

describe('incident type taxonomy', () => {
  it('has unique ids', () => {
    const ids = INCIDENT_TYPES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('assigns every type to a declared category', () => {
    const cats = new Set(INCIDENT_CATEGORIES.map((c) => c.id));
    for (const t of INCIDENT_TYPES) expect(cats.has(t.category)).toBe(true);
  });

  it('keeps every original hardcoded id representable', () => {
    // The pre-taxonomy union — each must stay valid or map through an alias.
    const legacyUnion = [
      'wildfire', 'hurricane', 'earthquake', 'flood', 'chemical',
      'mass-casualty', 'cyber', 'security', 'severe-weather', 'other',
    ];
    for (const id of legacyUnion) {
      const def = incidentTypeDef(id);
      expect(def.id === 'other' && id !== 'other').toBe(false);
    }
  });

  it('maps legacy aliases to canonical successors', () => {
    expect(normalizeIncidentType('chemical')).toBe('hazmat');
    expect(normalizeIncidentType('security')).toBe('violence-threat');
    // Aliases must not shadow canonical ids.
    for (const alias of Object.keys(LEGACY_TYPE_ALIASES)) {
      expect(INCIDENT_TYPES.some((t) => t.id === alias)).toBe(false);
    }
  });

  it('falls back to Other for unknown or malformed input', () => {
    expect(normalizeIncidentType('volcano')).toBe('other');
    expect(normalizeIncidentType(undefined)).toBe('other');
    expect(normalizeIncidentType(42)).toBe('other');
    expect(incidentTypeDef('volcano').label).toBe('Other');
  });

  it('groups the full set by category with nothing dropped', () => {
    const grouped = INCIDENT_CATEGORIES.flatMap((c) => incidentTypesInCategory(c.id));
    expect(grouped.length).toBe(INCIDENT_TYPES.length);
  });
});

describe('incident status model', () => {
  it('declares the four lifecycle statuses in lifecycle order', () => {
    expect(INCIDENT_STATUSES.map((s) => s.id)).toEqual([
      'monitoring', 'active', 'recovery', 'closed',
    ]);
  });

  it('ranks Active first for list sorting', () => {
    const ranks = [...INCIDENT_STATUSES].sort((a, b) => a.listRank - b.listRank);
    expect(ranks[0].id).toBe('active');
    expect(new Set(INCIDENT_STATUSES.map((s) => s.listRank)).size).toBe(INCIDENT_STATUSES.length);
  });

  it('maps the retired three-state model forward', () => {
    expect(normalizeIncidentStatus('contained')).toBe('recovery');
    expect(normalizeIncidentStatus('resolved')).toBe('closed');
    for (const alias of Object.keys(LEGACY_STATUS_ALIASES)) {
      expect(INCIDENT_STATUSES.some((s) => s.id === alias)).toBe(false);
    }
  });

  it('falls back to Active for unknown input', () => {
    expect(normalizeIncidentStatus('escalated')).toBe('active');
    expect(normalizeIncidentStatus(null)).toBe('active');
    expect(incidentStatusDef('escalated').label).toBe('Active');
  });
});

describe('normalizeIncidentFields', () => {
  const base = { incidentType: 'wildfire', incidentStatus: 'active' };

  it('returns the same object when nothing needs normalizing', () => {
    const inc = { ...base };
    expect(normalizeIncidentFields(inc)).toBe(inc);
    const closed = { incidentType: 'hazmat', incidentStatus: 'closed', archivedAt: '2026-08-01T00:00:00Z' };
    expect(normalizeIncidentFields(closed)).toBe(closed);
  });

  it('rewrites legacy type and status ids', () => {
    const out = normalizeIncidentFields({ incidentType: 'chemical', incidentStatus: 'contained' });
    expect(out.incidentType).toBe('hazmat');
    expect(out.incidentStatus).toBe('recovery');
  });

  it('forces closed on archived incidents regardless of stored status', () => {
    const out = normalizeIncidentFields({
      ...base,
      archivedAt: '2026-08-01T00:00:00Z',
    });
    expect(out.incidentStatus).toBe('closed');
  });

  it('leaves un-archived incidents at their stored status', () => {
    const out = normalizeIncidentFields({ incidentType: 'flood', incidentStatus: 'recovery', archivedAt: null });
    expect(out.incidentStatus).toBe('recovery');
  });

  it('does not mutate its input', () => {
    const inc = { incidentType: 'chemical', incidentStatus: 'resolved' };
    normalizeIncidentFields(inc);
    expect(inc).toEqual({ incidentType: 'chemical', incidentStatus: 'resolved' });
  });
});
