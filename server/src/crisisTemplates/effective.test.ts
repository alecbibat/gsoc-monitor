import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CHECKLIST_BLOCKS, DEFAULT_CHECKLIST_ROLES, DEFAULT_INTAKE_BLOCKS,
} from '../data/crisisTemplateDefaults';
import {
  buildEffectiveConfig, checklistIdOwners, compareScopes, indexDefaults, intakeIdOwners,
  roleUsage, shareTemplatesConfig, type OverrideRow, type TemplateDefaults,
} from './effective';
import { scopeKey, type ChecklistRoleMeta, type TemplateScope } from './types';
import { checkChecklistItems, checkChecklistRoles, checkIntakeGroups, parseScope } from './validate';

const S = (incidentType: string | null, propertyId: string | null): TemplateScope => ({ incidentType, propertyId });
const role = (id: string): ChecklistRoleMeta => ({ id, code: id.toUpperCase(), title: `Role ${id}`, color: '#123456', reportsTo: '', directs: '' });
const ci = (id: string, roleId = 'ic', text = `Item ${id}`) => ({ id, roleId, phase: 'immediate' as const, text });

const DEFAULTS: TemplateDefaults = {
  roles: [role('ic'), role('ops')],
  checklistBlocks: [
    { scope: S(null, null), items: [ci('g-1'), ci('g-2', 'ops')] },
    { scope: S('flood', null), items: [ci('t-flood-1', 'ops')] },
    { scope: S(null, 'glacier'), items: [ci('p-glacier-1')] },
    { scope: S('wildfire', null), items: [ci('t-wildfire-1')] },
    { scope: S('hurricane', null), items: [] }, // empty default → dropped
  ],
  intakeBlocks: [
    { scope: S(null, null), groups: [{ id: 'g-caller', label: 'Caller', questions: [{ id: 'g-caller-1', text: 'Who?' }] }] },
    { scope: S('flood', null), groups: [{ id: 't-flood', label: 'Water', questions: [{ id: 't-flood-1', text: 'Depth?' }] }] },
  ],
};
const IDX = indexDefaults(DEFAULTS);
const AT = new Date('2026-09-01T12:00:00Z');
const row = (kind: string, key: string, data: unknown, revision = 1, by: string | null = 'Ann Admin'): OverrideRow =>
  ({ kind, scope_key: key, data, revision, updated_at: AT, updated_by: by });

describe('compareScopes', () => {
  it('orders General, types (taxonomy), properties (id), then type + property', () => {
    const scopes = [
      S('flood', 'glacier'), S(null, 'yellowstone'), S('wildfire', null), S('flood', null),
      S(null, null), S(null, 'custer'), S('wildfire', 'custer'), S('flood', 'custer'),
    ];
    expect(scopes.sort(compareScopes).map(scopeKey)).toEqual([
      '*|*', 'wildfire|*', 'flood|*', '*|custer', '*|yellowstone', 'wildfire|custer', 'flood|custer', 'flood|glacier',
    ]);
  });
});

describe('buildEffectiveConfig', () => {
  it('is the defaults, in block order, when nothing is overridden', () => {
    const c = buildEffectiveConfig(IDX, []);
    expect(c.checklistRoles).toMatchObject({ custom: false, revision: 0, updatedAt: null, updatedBy: null });
    expect(c.checklistRoles.roles.map((r) => r.id)).toEqual(['ic', 'ops']);
    expect(c.checklistBlocks.map((b) => scopeKey(b.scope))).toEqual(['*|*', 'wildfire|*', 'flood|*', '*|glacier']);
    expect(c.checklistBlocks.every((b) => !b.custom && b.revision === 0)).toBe(true);
    expect(c.intakeBlocks.map((b) => scopeKey(b.scope))).toEqual(['*|*', 'flood|*']);
    expect(c.retiredChecklistItems).toBeUndefined();
  });

  it('replaces a default block wholesale and records provenance', () => {
    const c = buildEffectiveConfig(IDX, [row('checklist-block', 'flood|*', { items: [ci('x-new', 'ops')] }, 3)]);
    const flood = c.checklistBlocks.find((b) => scopeKey(b.scope) === 'flood|*')!;
    expect(flood).toEqual({
      custom: true, revision: 3, updatedAt: AT.toISOString(), updatedBy: 'Ann Admin',
      scope: S('flood', null), items: [ci('x-new', 'ops')],
    });
  });

  it('adds override-only scopes in order and keeps custom empty blocks', () => {
    const c = buildEffectiveConfig(IDX, [
      row('checklist-block', 'flood|glacier', { items: [ci('x-fg')] }),
      row('checklist-block', 'wildfire|*', { items: [] }),
      row('intake-block', '*|glacier', { groups: [] }),
    ]);
    expect(c.checklistBlocks.map((b) => `${scopeKey(b.scope)}:${b.items.length}:${b.custom}`)).toEqual([
      '*|*:2:false', 'wildfire|*:0:true', 'flood|*:1:false', '*|glacier:1:false', 'flood|glacier:1:true',
    ]);
    expect(c.intakeBlocks.map((b) => scopeKey(b.scope))).toEqual(['*|*', 'flood|*', '*|glacier']);
  });

  it('applies a roles override', () => {
    const c = buildEffectiveConfig(IDX, [row('checklist-roles', '*', { roles: [role('ops'), role('ic'), role('r-x')] }, 2)]);
    expect(c.checklistRoles).toMatchObject({ custom: true, revision: 2, updatedBy: 'Ann Admin' });
    expect(c.checklistRoles.roles.map((r) => r.id)).toEqual(['ops', 'ic', 'r-x']);
  });

  it('ignores malformed rows (with a warning) instead of breaking every checklist', () => {
    const warnings: string[] = [];
    const c = buildEffectiveConfig(IDX, [
      row('checklist-block', 'flood|*', { nope: true }),
      row('checklist-block', 'not a key', { items: [] }),
      row('checklist-roles', '*', { roles: [] }),
      row('mystery', '*|*', {}),
      // Partially bad: the bad entries are dropped, the good one kept.
      row('checklist-block', '*|glacier', { items: [ci('x-ok'), { id: 'x-bad', roleId: 'ic', phase: 'soon', text: 't' }, 'junk'] }),
      row('intake-block', 'flood|*', { groups: [{ id: 'x-g', label: 'L', questions: [{ id: 'x-q', text: 'Q' }, { id: 5 }] }, null] }),
    ], (m) => warnings.push(m));
    expect(warnings).toHaveLength(4);
    expect(c.checklistBlocks.find((b) => scopeKey(b.scope) === 'flood|*')).toMatchObject({ custom: false, items: [ci('t-flood-1', 'ops')] });
    expect(c.checklistRoles.custom).toBe(false);
    expect(c.checklistBlocks.find((b) => scopeKey(b.scope) === '*|glacier')!.items).toEqual([ci('x-ok')]);
    expect(c.intakeBlocks.find((b) => scopeKey(b.scope) === 'flood|*')!.groups)
      .toEqual([{ id: 'x-g', label: 'L', questions: [{ id: 'x-q', text: 'Q' }] }]);
  });

  it('does not let a consumer mutate the shared defaults', () => {
    const c = buildEffectiveConfig(IDX, []);
    c.checklistBlocks[0].items.push(ci('x-mut'));
    c.checklistRoles.roles[0].title = 'Changed';
    const again = buildEffectiveConfig(IDX, []);
    expect(again.checklistBlocks[0].items.map((i) => i.id)).toEqual(['g-1', 'g-2']);
    expect(again.checklistRoles.roles[0].title).toBe('Role ic');
  });
});

describe('write-path lookups', () => {
  const c = buildEffectiveConfig(IDX, [row('checklist-block', 'flood|*', { items: [ci('x-f', 'ops'), ci('x-g', 'ops')] })]);

  it('maps ids to the OTHER blocks that own them', () => {
    const owners = checklistIdOwners(c, 'flood|*');
    expect(owners.get('g-1')).toEqual(S(null, null));
    expect(owners.get('p-glacier-1')).toEqual(S(null, 'glacier'));
    expect(owners.has('x-f')).toBe(false);
    // The overridden default's ids are free again.
    expect(owners.has('t-flood-1')).toBe(false);
    const intake = intakeIdOwners(c, '*|*');
    expect([...intake.groups.keys()]).toEqual(['t-flood']);
    expect([...intake.questions.keys()]).toEqual(['t-flood-1']);
  });

  it('counts items per role across effective blocks', () => {
    expect(Object.fromEntries(roleUsage(c))).toEqual({ ic: 3, ops: 3 });
  });
});

describe('shareTemplatesConfig', () => {
  const c = buildEffectiveConfig(IDX, [
    row('checklist-block', 'flood|glacier', { items: [ci('x-fg')] }),
    row('checklist-roles', '*', { roles: [role('ic'), role('ops')] }),
  ]);

  it('keeps only applicable blocks and strips editor names', () => {
    const s = shareTemplatesConfig(c, 'flood', 'glacier', {}, {});
    expect(s.checklistBlocks.map((b) => scopeKey(b.scope))).toEqual(['*|*', 'flood|*', '*|glacier', 'flood|glacier']);
    expect(s.intakeBlocks.map((b) => scopeKey(b.scope))).toEqual(['*|*', 'flood|*']);
    expect(s.checklistBlocks.every((b) => b.updatedBy === null)).toBe(true);
    expect(s.checklistRoles.updatedBy).toBeNull();
    expect(s.checklistRoles.custom).toBe(true);
    // The source config is untouched.
    expect(c.checklistRoles.updatedBy).toBe('Ann Admin');

    const other = shareTemplatesConfig(c, 'wildfire', null, {}, {});
    expect(other.checklistBlocks.map((b) => scopeKey(b.scope))).toEqual(['*|*', 'wildfire|*']);
  });

  it('carries text for state the incident no longer resolves to', () => {
    const s = shareTemplatesConfig(
      c, 'wildfire', null,
      {
        'g-1': { checked: true, at: 'x' },          // live — not retired
        't-flood-1': { checked: true, at: 'x' },    // flood item, incident is now wildfire
        'x-fg': { checked: false, at: 'x' },        // type+property item
        'gone-forever': { checked: true, at: 'x' }, // no scope knows it: omitted (client shows it text-less)
      },
      // As parsed from JSON: an own "__proto__" key must be harmless.
      JSON.parse('{"g-caller-1":"Front desk","t-flood-1":"2 ft","x-blank":"  ","__proto__":"x"}')
    );
    expect(s.retiredChecklistItems).toEqual({
      't-flood-1': { text: 'Item t-flood-1', roleId: 'ops', phase: 'immediate' },
      'x-fg': { text: 'Item x-fg', roleId: 'ic', phase: 'immediate' },
    });
    expect(s.retiredIntakeQuestions).toEqual({ 't-flood-1': { text: 'Depth?', groupLabel: 'Water' } });
  });

  it('tolerates snapshots without state maps', () => {
    const s = shareTemplatesConfig(c, 'other', null, undefined, null);
    expect(s.retiredChecklistItems).toEqual({});
    expect(s.retiredIntakeQuestions).toEqual({});
  });
});

// The shipped defaults must pass exactly the checks an admin save would, so
// that saving any default block unchanged — or resetting one — always works.
describe('built-in defaults', () => {
  const idx = indexDefaults({
    roles: DEFAULT_CHECKLIST_ROLES, checklistBlocks: DEFAULT_CHECKLIST_BLOCKS, intakeBlocks: DEFAULT_INTAKE_BLOCKS,
  });
  const config = buildEffectiveConfig(idx, []);

  it('has valid roles that cover every item', () => {
    const r = checkChecklistRoles(DEFAULT_CHECKLIST_ROLES, { usage: roleUsage(config), currentRoles: DEFAULT_CHECKLIST_ROLES });
    expect(r.ok ? null : r.error).toBeNull();
    expect(DEFAULT_CHECKLIST_ROLES.map((x) => x.id)).toContain('gsoc-support');
  });

  it('has one block per valid scope', () => {
    for (const b of [...DEFAULT_CHECKLIST_BLOCKS, ...DEFAULT_INTAKE_BLOCKS]) {
      const r = parseScope(b.scope);
      expect(r.ok ? null : `${scopeKey(b.scope)}: ${r.error}`).toBeNull();
    }
    const keys = (bs: { scope: TemplateScope }[]) => bs.map((b) => scopeKey(b.scope));
    expect(new Set(keys(DEFAULT_CHECKLIST_BLOCKS)).size).toBe(DEFAULT_CHECKLIST_BLOCKS.length);
    expect(new Set(keys(DEFAULT_INTAKE_BLOCKS)).size).toBe(DEFAULT_INTAKE_BLOCKS.length);
  });

  it('checklist blocks validate, with ids unique across every scope', () => {
    for (const b of config.checklistBlocks) {
      const r = checkChecklistItems(b.items, { roles: config.checklistRoles.roles, takenIds: checklistIdOwners(config, scopeKey(b.scope)) });
      expect(r.ok ? null : `${scopeKey(b.scope)}: ${r.error}`).toBeNull();
    }
  });

  it('intake blocks validate, with ids unique across every scope', () => {
    for (const b of config.intakeBlocks) {
      const owners = intakeIdOwners(config, scopeKey(b.scope));
      const r = checkIntakeGroups(b.groups, { takenGroupIds: owners.groups, takenQuestionIds: owners.questions });
      expect(r.ok ? null : `${scopeKey(b.scope)}: ${r.error}`).toBeNull();
    }
  });
});
