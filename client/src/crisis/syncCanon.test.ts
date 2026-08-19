import { describe, expect, it } from 'vitest';
import { mergeActionLogs, serverCanon, stableStringify } from './syncCanon';
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

  it('still distinguishes real blob changes', () => {
    const edited = { ...legacy, incidentName: 'Ridge Fire' } as typeof legacy & { incidentName: string };
    expect(serverCanon(edited)).not.toBe(serverCanon(legacy));
  });

  it('ignores action-log differences — the log never syncs via blob writes', () => {
    // If a log change made the blob look edited, the log-only difference would
    // schedule a blob PUT that cannot carry it (the server keeps its own log).
    const moreLog = { ...legacy, actionLog: [{ id: 'e9', description: 'x' }, ...legacy.actionLog] };
    expect(serverCanon(moreLog)).toBe(serverCanon(legacy));
  });

  it('is idempotent across repeated normalization', () => {
    const once = normalizeIncidentFields(legacy);
    expect(serverCanon(once)).toBe(serverCanon(normalizeIncidentFields(once)));
  });
});

describe('mergeActionLogs', () => {
  type E = { id: string; description: string };
  const remote: E[] = [
    { id: 'b', description: 'remote-b' },
    { id: 'a', description: 'remote-a' },
  ];

  it('takes the remote log verbatim when nothing local is in flight', () => {
    const local: E[] = [{ id: 'a', description: 'local-a' }];
    expect(mergeActionLogs(remote, local, new Set())).toEqual(remote);
  });

  it('keeps the local version of entries whose push is in flight', () => {
    const local: E[] = [
      { id: 'b', description: 'local-edit-b' },
      { id: 'a', description: 'remote-a' },
    ];
    const merged = mergeActionLogs(remote, local, new Set(['b']));
    expect(merged.find((e) => e.id === 'b')?.description).toBe('local-edit-b');
    expect(merged.find((e) => e.id === 'a')?.description).toBe('remote-a');
  });

  it('prepends local-only in-flight entries missing from the server log', () => {
    const local: E[] = [{ id: 'new', description: 'appending' }, ...remote];
    const merged = mergeActionLogs(remote, local, new Set(['new']));
    expect(merged[0]).toEqual({ id: 'new', description: 'appending' });
    expect(merged).toHaveLength(3);
  });

  it('drops local-only entries that are NOT in flight (deleted by a peer)', () => {
    const local: E[] = [{ id: 'gone', description: 'peer deleted me' }, ...remote];
    expect(mergeActionLogs(remote, local, new Set())).toEqual(remote);
  });
});

describe('serverCanon - checklist exclusion', () => {
  it('does not register checklist toggles as blob edits', () => {
    // Toggles sync through their per-item endpoints (checklistSync.ts); if
    // they changed the canon, every check would also schedule a whole-blob
    // PUT that could clobber a concurrent responder's toggle.
    const base = { id: 'c-1', incidentType: 'maritime', incidentStatus: 'active' };
    const toggled = {
      ...base,
      checklists: { 'ic-imm-1': { checked: true, at: '2026-08-19T10:00:00.000Z' } },
    };
    expect(serverCanon(toggled)).toBe(serverCanon(base));
  });
});
