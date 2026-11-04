import { describe, expect, it } from 'vitest';
import {
  CHECKLIST_PHASES, checklistEntry, checklistProgress, foldChecklistResponse, isChecklistStateMap,
  itemStatus, nextClickStatus, preferredChecklistRole, roleProgress,
  type ChecklistRoleDef, type ChecklistTemplate,
} from './checklistTemplate';

// Content lives server-side now (admin-edited templates); these tests run on a
// small hand-built template of the shape resolveChecklist produces.
const role = (id: string, items: Record<'immediate' | 'ongoing' | 'demob', string[]>): ChecklistRoleDef => ({
  id, code: id.toUpperCase(), title: id, color: '#ffffff', reportsTo: 'IC', directs: '—',
  phases: CHECKLIST_PHASES
    .map((p) => ({ id: p.id, items: items[p.id].map((id) => ({ id, text: `do ${id}` })) }))
    .filter((p) => p.items.length > 0),
});

const tpl: ChecklistTemplate = {
  id: 'resolved:wildfire|*',
  title: 'ICS Role Checklists',
  source: 'test',
  roles: [
    role('ic', { immediate: ['ic-1', 'ic-2'], ongoing: ['ic-3'], demob: [] }),
    role('gsoc-support', { immediate: ['g-1'], ongoing: [], demob: ['g-2'] }),
    role('safety', { immediate: [], ongoing: ['s-1'], demob: [] }),
  ],
};

const T0 = '2026-08-19T00:00:00.000Z';

describe('checklist phases', () => {
  it('orders immediate → ongoing → demob', () => {
    expect(CHECKLIST_PHASES.map((p) => p.id)).toEqual(['immediate', 'ongoing', 'demob']);
  });
});

describe('item status', () => {
  it('reads a status, or an entry from before statuses by its checked flag', () => {
    expect(itemStatus(undefined)).toBe('not-started');
    expect(itemStatus({ checked: false, status: 'in-progress' })).toBe('in-progress');
    expect(itemStatus({ checked: true })).toBe('completed');
    expect(itemStatus({ checked: false })).toBe('not-started');
    // A status this build doesn't know falls back to the flag.
    expect(itemStatus({ checked: true, status: 'blocked' as never })).toBe('completed');
  });

  it('clicks forward — not started → in progress → completed — and stops there', () => {
    expect(nextClickStatus('not-started')).toBe('in-progress');
    expect(nextClickStatus('in-progress')).toBe('completed');
    expect(nextClickStatus('completed')).toBeNull();
  });

  it('stores checked exactly when completed', () => {
    expect(checklistEntry('completed', T0, 'Sam')).toEqual({ checked: true, status: 'completed', at: T0, by: 'Sam' });
    expect(checklistEntry('in-progress', T0)).toEqual({ checked: false, status: 'in-progress', at: T0 });
    expect(checklistEntry('not-started', T0)).toEqual({ checked: false, status: 'not-started', at: T0 });
  });
});

describe('roleProgress', () => {
  it('counts completed and in-progress items, ignoring reset entries and other roles', () => {
    const ic = tpl.roles[0];
    expect(roleProgress(ic, {})).toEqual({ done: 0, inProgress: 0, total: 3 });
    expect(roleProgress(ic, {
      'ic-1': { checked: true, at: T0 },
      'ic-2': { checked: false, at: T0 },
      'not-in-role': { checked: true, at: T0 },
    })).toEqual({ done: 1, inProgress: 0, total: 3 });
    expect(roleProgress(ic, {
      'ic-1': checklistEntry('completed', T0),
      'ic-2': checklistEntry('in-progress', T0),
      'ic-3': checklistEntry('not-started', T0),
    })).toEqual({ done: 1, inProgress: 1, total: 3 });
  });
});

describe('checklistProgress', () => {
  it('totals every role and counts the fully-done ones', () => {
    expect(checklistProgress(tpl, {})).toEqual({ done: 0, inProgress: 0, total: 6, rolesDone: 0 });
    expect(checklistProgress(tpl, {
      'g-1': { checked: true, at: T0 },
      'g-2': { checked: true, at: T0 },
      'ic-1': { checked: true, at: T0 },
      's-1': { checked: false, at: T0 },
      'ic-2': checklistEntry('in-progress', T0),
    })).toEqual({ done: 3, inProgress: 1, total: 6, rolesDone: 1 });
  });

  it('is zero for an empty template', () => {
    expect(checklistProgress({ ...tpl, roles: [] }, {})).toEqual({ done: 0, inProgress: 0, total: 0, rolesDone: 0 });
  });
});

describe('preferredChecklistRole', () => {
  const assignments = [
    { roleId: 'safety', name: 'Former Holder', endedAt: T0 },
    { roleId: 'ops', name: 'Alex Rivera' }, // org-chart role with no checklist here
    { roleId: 'gsoc-support', name: 'Alex Rivera', email: 'alex@example.com' },
  ];

  it("opens on the viewer's active assignment, matched by name case-insensitively", () => {
    expect(preferredChecklistRole(tpl, { assignments, userName: '  alex rivera ' })).toBe('gsoc-support');
  });

  it('matches by email when the display names differ', () => {
    expect(preferredChecklistRole(tpl, { assignments, userName: 'A. Rivera', userEmail: 'ALEX@example.com' }))
      .toBe('gsoc-support');
  });

  it('ignores ended assignments and roles the template lacks', () => {
    expect(preferredChecklistRole(tpl, { assignments, userName: 'Former Holder' })).toBeUndefined();
    expect(preferredChecklistRole(tpl, { assignments: [{ roleId: 'ops', name: 'Sam' }], userName: 'Sam' }))
      .toBeUndefined();
  });

  it('falls back to the remembered role, then to nothing', () => {
    expect(preferredChecklistRole(tpl, { assignments, userName: 'Nobody', remembered: 'safety' })).toBe('safety');
    expect(preferredChecklistRole(tpl, { remembered: 'finance' })).toBeUndefined();
    expect(preferredChecklistRole(tpl, {})).toBeUndefined();
  });

  it('never matches an empty name against an unnamed assignment', () => {
    expect(preferredChecklistRole(tpl, { assignments: [{ roleId: 'ic', name: '' }], userName: '' })).toBeUndefined();
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
    expect(isChecklistStateMap({ a: { checked: false, status: 'in-progress', at: 'x' } })).toBe(true);
    // An unknown status from a newer server still passes (read by its flag)…
    expect(isChecklistStateMap({ a: { checked: false, status: 'blocked', at: 'x' } })).toBe(true);
    // …but a non-string one is malformed.
    expect(isChecklistStateMap({ a: { checked: false, status: 3, at: 'x' } })).toBe(false);
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
