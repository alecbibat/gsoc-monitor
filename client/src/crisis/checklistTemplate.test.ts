import { describe, expect, it } from 'vitest';
import {
  CHECKLIST_PHASES, CHECKLIST_TEMPLATES, checklistTemplateFor,
  isChecklistStateMap, roleProgress,
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
