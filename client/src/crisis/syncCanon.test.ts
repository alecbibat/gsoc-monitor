import { describe, expect, it } from 'vitest';
import { serverCanon, stableStringify } from './syncCanon';
import { normalizeIncidentFields } from './taxonomy';

describe('stableStringify', () => {
  it('is key-order independent (JSONB round-trip semantics)', () => {
    expect(stableStringify({ a: 1, b: [{ x: 1, y: 2 }] })).toBe(
      stableStringify({ b: [{ y: 2, x: 1 }], a: 1 })
    );
  });

  it('drops undefined-valued keys like JSON does', () => {
    expect(stableStringify({ a: 1, b: undefined })).toBe(stableStringify({ a: 1 }));
  });
});

describe('serverCanon', () => {
  const legacy = {
    id: 'c-1',
    incidentType: 'chemical',
    incidentStatus: 'contained',
    actionLog: [{ id: 'e1', description: 'note' }],
  };

  it('gives a legacy blob and its normalized form the same canonical string', () => {
    // THE invariant that prevents phantom migration write-backs: the sync
    // baseline (computed from the raw server blob) must equal the canon of the
    // normalized copy the store holds, so normalization alone never schedules
    // a PUT. A regression here re-opens a lost-update window in which a
    // freshly loaded tab could overwrite another responder's concurrent edit.
    expect(serverCanon(legacy)).toBe(serverCanon(normalizeIncidentFields(legacy)));
  });

  it('treats archived-but-not-closed the same as its closed form', () => {
    const archivedLegacy = { ...legacy, incidentStatus: 'active', archivedAt: '2026-08-01T00:00:00Z' };
    expect(serverCanon(archivedLegacy)).toBe(serverCanon(normalizeIncidentFields(archivedLegacy)));
  });

  it('still distinguishes real content changes', () => {
    const edited = { ...legacy, actionLog: [...legacy.actionLog, { id: 'e2', description: 'new' }] };
    expect(serverCanon(edited)).not.toBe(serverCanon(legacy));
  });

  it('is idempotent across repeated normalization', () => {
    const once = normalizeIncidentFields(legacy);
    expect(serverCanon(once)).toBe(serverCanon(normalizeIncidentFields(once)));
  });
});
