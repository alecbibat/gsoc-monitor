import { describe, expect, it } from 'vitest';
import {
  CHECKLIST_PHASES, CHECKLIST_TEMPLATES, checklistTemplateFor,
  foldChecklistResponse, isChecklistStateMap, roleProgress,
} from './checklistTemplate';

const tpl = CHECKLIST_TEMPLATES.default;

describe('checklist template', () => {
  it('covers the full command & general staff, section chiefs included', () => {
    expect(tpl.roles.map((r) => r.id)).toEqual([
      'ic', 'safety', 'pio', 'liaison', 'ops', 'planning', 'logistics', 'finance',
    ]);
  });

  it('gives every role all three phases, each with items', () => {
    for (const role of tpl.roles) {
      expect(role.phases.map((p) => p.id)).toEqual(CHECKLIST_PHASES.map((p) => p.id));
      for (const ph of role.phases) expect(ph.items.length).toBeGreaterThan(0);
    }
  });

  it('mints globally-unique, server-acceptable item ids', () => {
    const ids = tpl.roles.flatMap((r) => r.phases.flatMap((p) => p.items.map((i) => i.id)));
    expect(new Set(ids).size).toBe(ids.length);
    // Must satisfy the server's toggle-route id pattern (checklist.ts).
    for (const id of ids) expect(id).toMatch(/^[a-z][a-z0-9-]{0,63}$/);
  });

  it('falls back to the default template for unmapped incident types', () => {
    expect(checklistTemplateFor('wildfire')).toBe(tpl);
    expect(checklistTemplateFor('not-a-type')).toBe(tpl);
  });
});

describe('roleProgress', () => {
  it('counts only checked items, ignoring unchecked-state entries', () => {
    const role = tpl.roles[0];
    const first = role.phases[0].items[0].id;
    const second = role.phases[0].items[1].id;
    const total = role.phases.reduce((n, p) => n + p.items.length, 0);
    expect(roleProgress(role, {})).toEqual({ done: 0, total });
    expect(roleProgress(role, {
      [first]: { checked: true, at: '2026-08-19T00:00:00.000Z' },
      [second]: { checked: false, at: '2026-08-19T00:01:00.000Z' },
    })).toEqual({ done: 1, total });
  });
});

describe('isChecklistStateMap', () => {
  it('accepts sparse maps and rejects malformed snapshot payloads', () => {
    expect(isChecklistStateMap({})).toBe(true);
    expect(isChecklistStateMap({ 'ic-imm-1': { checked: true, at: 'x' } })).toBe(true);
    expect(isChecklistStateMap(null)).toBe(false);
    expect(isChecklistStateMap([])).toBe(false);
    expect(isChecklistStateMap({ a: { checked: 'yes', at: 'x' } })).toBe(false);
    expect(isChecklistStateMap({ a: 'checked' })).toBe(false);
  });
});

describe('foldChecklistResponse', () => {
  const T1 = '2026-08-19T00:00:00.000Z';
  const T2 = '2026-08-19T00:01:00.000Z';

  it("keeps a teammate's newer entry that landed before an older response", () => {
    const remote = { a: { checked: true, at: T1 }, b: { checked: false, at: T1 } };
    const local = { a: { checked: true, at: T1 }, b: { checked: true, at: T2, by: 'Sam' } };
    expect(foldChecklistResponse(remote, local)).toEqual(local);
  });

  it('replaces an older local entry with a newer remote one', () => {
    const remote = { b: { checked: false, at: T2 } };
    const local = { b: { checked: true, at: T1 } };
    expect(foldChecklistResponse(remote, local)).toEqual(remote);
  });

  it('always takes the server entry for the item the response answers', () => {
    // The local entry is the optimistic flip, stamped by a client clock that
    // may run ahead of the server's.
    const remote = { a: { checked: true, at: T1, by: 'Alex' } };
    const local = { a: { checked: true, at: T2 } };
    expect(foldChecklistResponse(remote, local, new Set(), 'a')).toEqual(remote);
  });

  it('keeps the local entry for an item whose toggle is still in flight', () => {
    const remote = { a: { checked: true, at: T2 } };
    const local = { a: { checked: false, at: T1 } };
    expect(foldChecklistResponse(remote, local, new Set(['a']), 'a')).toEqual(local);
  });

  it('keeps local-only entries', () => {
    const remote = { a: { checked: true, at: T1 } };
    const local = { b: { checked: true, at: T2 } };
    expect(foldChecklistResponse(remote, local)).toEqual({ a: remote.a, b: local.b });
  });

  it('falls back to the remote entry when a stamp is unparsable', () => {
    const remote = { a: { checked: false, at: 'not-a-date' } };
    const local = { a: { checked: true, at: T2 } };
    expect(foldChecklistResponse(remote, local)).toEqual(remote);
  });
});
