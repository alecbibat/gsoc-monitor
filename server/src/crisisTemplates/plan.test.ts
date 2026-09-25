import { describe, expect, it } from 'vitest';
import { buildEffectiveConfig, indexDefaults, type OverrideRow, type TemplateDefaults } from './effective';
import {
  decideChecklistReset, decideChecklistSave, decideIntakeReset, decideIntakeSave,
  decideRolesReset, decideRolesSave,
} from './plan';
import type { ChecklistRoleMeta, TemplateScope } from './types';

const S = (incidentType: string | null, propertyId: string | null): TemplateScope => ({ incidentType, propertyId });
const role = (id: string): ChecklistRoleMeta => ({ id, code: id.slice(0, 4).toUpperCase(), title: `Role ${id}`, color: '#a1b2c3', reportsTo: '', directs: '' });
const ci = (id: string, roleId = 'ic', text = `Item ${id}`) => ({ id, roleId, phase: 'immediate' as const, text });
const grp = (id: string, qs: string[]) => ({ id, label: `Group ${id}`, questions: qs.map((q) => ({ id: q, text: `Q ${q}` })) });

const DEFAULTS: TemplateDefaults = {
  roles: [role('ic'), role('ops')],
  checklistBlocks: [
    { scope: S(null, null), items: [ci('g-1'), ci('g-2', 'ops')] },
    { scope: S('flood', null), items: [ci('t-flood-1', 'ops')] },
  ],
  intakeBlocks: [
    { scope: S(null, null), groups: [grp('g-caller', ['g-caller-1'])] },
    { scope: S('flood', null), groups: [grp('t-flood', ['t-flood-1'])] },
  ],
};
const IDX = indexDefaults(DEFAULTS);
const row = (kind: string, key: string, data: unknown, revision = 1): OverrideRow =>
  ({ kind, scope_key: key, data, revision, updated_at: new Date(), updated_by: 'Ann Admin' });
const cfg = (...rows: OverrideRow[]) => buildEffectiveConfig(IDX, rows);

describe('checklist save', () => {
  const flood = S('flood', null);

  it('stores a changed default block as revision 1', () => {
    const d = decideChecklistSave(cfg(), IDX, flood, [ci('t-flood-1', 'ops', 'Edited')], 0);
    expect(d).toEqual({ type: 'upsert', revision: 1, data: { items: [ci('t-flood-1', 'ops', 'Edited')] } });
  });

  it('bumps the revision of an existing override', () => {
    const c = cfg(row('checklist-block', 'flood|*', { items: [ci('x-a', 'ops')] }, 4));
    expect(decideChecklistSave(c, IDX, flood, [ci('x-a', 'ops'), ci('x-b')], 4)).toMatchObject({ type: 'upsert', revision: 5 });
  });

  it('409s on a stale base revision, saying what happened', () => {
    const c = cfg(row('checklist-block', 'flood|*', { items: [] }, 2));
    expect(decideChecklistSave(c, IDX, flood, [], 1)).toEqual({
      type: 'reject', status: 409,
      error: 'The flood checklist was saved by Ann Admin after you started editing — reload that version before saving',
    });
    // Someone reset it while this admin edited revision 2.
    expect(decideChecklistSave(cfg(), IDX, flood, [], 2)).toMatchObject({
      status: 409, error: expect.stringMatching(/was reset to the built-in default/),
    });
  });

  it('400s on invalid items, with the validator message', () => {
    expect(decideChecklistSave(cfg(), IDX, flood, [ci('x-a', 'ops', '')], 0))
      .toEqual({ type: 'reject', status: 400, error: 'Role ops → Immediate, item 1 is empty — write the action or delete the item' });
  });

  it('refuses an id another effective block owns, but frees ids of an overridden default', () => {
    expect(decideChecklistSave(cfg(), IDX, flood, [ci('g-1', 'ops')], 0))
      .toMatchObject({ status: 400, error: expect.stringMatching(/"g-1", which already belongs to the General checklist/) });
    // The General default is overridden without g-1 → g-1 may move to flood.
    const c = cfg(row('checklist-block', '*|*', { items: [ci('g-2', 'ops')] }));
    expect(decideChecklistSave(c, IDX, flood, [ci('g-1', 'ops')], 0)).toMatchObject({ type: 'upsert' });
  });

  it('only accepts roles in the effective role list', () => {
    const c = cfg(row('checklist-roles', '*', { roles: [role('ic'), role('ops'), role('r-new')] }));
    expect(decideChecklistSave(c, IDX, flood, [ci('x-a', 'r-new')], 0)).toMatchObject({ type: 'upsert' });
    expect(decideChecklistSave(cfg(), IDX, flood, [ci('x-a', 'r-new')], 0)).toMatchObject({ status: 400 });
  });

  it('drops the override when the content matches the default again', () => {
    const c = cfg(row('checklist-block', 'flood|*', { items: [ci('x-a', 'ops')] }, 3));
    expect(decideChecklistSave(c, IDX, flood, [ci('t-flood-1', 'ops')], 3)).toEqual({ type: 'delete' });
    // …and a default saved unchanged stores nothing.
    expect(decideChecklistSave(cfg(), IDX, flood, [ci('t-flood-1', 'ops')], 0)).toEqual({ type: 'noop' });
  });

  it('treats an unchanged override as a no-op (no revision bump)', () => {
    const c = cfg(row('checklist-block', 'flood|*', { items: [ci('x-a', 'ops')] }, 3));
    expect(decideChecklistSave(c, IDX, flood, [{ ...ci('x-a', 'ops'), text: '  Item x-a ' }], 3)).toEqual({ type: 'noop' });
  });

  it('an empty save where there is no default removes / skips the override', () => {
    const fg = S('flood', 'glacier');
    expect(decideChecklistSave(cfg(), IDX, fg, [], 0)).toEqual({ type: 'noop' });
    const c = cfg(row('checklist-block', 'flood|glacier', { items: [ci('x-a')] }, 2));
    expect(decideChecklistSave(c, IDX, fg, [], 2)).toEqual({ type: 'delete' });
    // …but an empty save over a default hides it (a custom empty block).
    expect(decideChecklistSave(cfg(), IDX, flood, [], 0)).toEqual({ type: 'upsert', revision: 1, data: { items: [] } });
  });
});

describe('checklist reset', () => {
  it('is a no-op without an override, a delete with one', () => {
    expect(decideChecklistReset(cfg(), IDX, S('flood', null))).toEqual({ type: 'noop' });
    const c = cfg(row('checklist-block', 'flood|*', { items: [] }));
    expect(decideChecklistReset(c, IDX, S('flood', null))).toEqual({ type: 'delete' });
    const extra = cfg(row('checklist-block', 'flood|glacier', { items: [ci('x-a')] }));
    expect(decideChecklistReset(extra, IDX, S('flood', 'glacier'))).toEqual({ type: 'delete' });
  });

  it('refuses when the default would use a removed role', () => {
    const c = cfg(
      row('checklist-block', 'flood|*', { items: [] }),
      row('checklist-block', '*|*', { items: [ci('g-1')] }),
      row('checklist-roles', '*', { roles: [role('ic')] }),
    );
    expect(decideChecklistReset(c, IDX, S('flood', null))).toEqual({
      type: 'reject', status: 400,
      error: 'Can\'t reset the flood checklist: the built-in default uses the removed role "ops" (1 item). Reset the checklist roles to default first.',
    });
  });

  it('refuses when another scope has since taken one of the default ids', () => {
    const c = cfg(
      row('checklist-block', 'flood|*', { items: [] }),
      row('checklist-block', 'flood|glacier', { items: [ci('t-flood-1', 'ops')] }),
    );
    expect(decideChecklistReset(c, IDX, S('flood', null))).toMatchObject({
      status: 400, error: expect.stringMatching(/^Can't reset the flood checklist to the built-in default: .*"t-flood-1", which already belongs to the flood @ glacier checklist$/),
    });
  });
});

describe('intake save / reset', () => {
  const flood = S('flood', null);

  it('stores, bumps, conflicts and validates like checklists', () => {
    expect(decideIntakeSave(cfg(), IDX, flood, [grp('t-flood', ['t-flood-1', 'x-q'])], 0)).toMatchObject({ type: 'upsert', revision: 1 });
    const c = cfg(row('intake-block', 'flood|*', { groups: [grp('x-g', ['x-q'])] }, 6));
    expect(decideIntakeSave(c, IDX, flood, [grp('x-g', ['x-q', 'x-r'])], 6)).toMatchObject({ type: 'upsert', revision: 7 });
    expect(decideIntakeSave(c, IDX, flood, [], 5)).toMatchObject({ status: 409, error: expect.stringMatching(/flood intake questions was saved/) });
    expect(decideIntakeSave(cfg(), IDX, flood, [grp('g-caller', ['x-q'])], 0))
      .toMatchObject({ status: 400, error: expect.stringMatching(/"g-caller", which already belongs to a group in the General intake/) });
  });

  it('no-ops / deletes when the content is the default, and on empty with no default', () => {
    expect(decideIntakeSave(cfg(), IDX, flood, [grp('t-flood', ['t-flood-1'])], 0)).toEqual({ type: 'noop' });
    const c = cfg(row('intake-block', 'flood|*', { groups: [] }, 2));
    expect(decideIntakeSave(c, IDX, flood, [grp('t-flood', ['t-flood-1'])], 2)).toEqual({ type: 'delete' });
    expect(decideIntakeSave(cfg(), IDX, S(null, 'glacier'), [], 0)).toEqual({ type: 'noop' });
    // A labelled group waiting for questions is kept.
    expect(decideIntakeSave(cfg(), IDX, S(null, 'glacier'), [grp('x-g', [])], 0)).toMatchObject({ type: 'upsert' });
  });

  it('resets unless the default ids are now taken', () => {
    expect(decideIntakeReset(cfg(), IDX, flood)).toEqual({ type: 'noop' });
    expect(decideIntakeReset(cfg(row('intake-block', 'flood|*', { groups: [] })), IDX, flood)).toEqual({ type: 'delete' });
    const c = cfg(
      row('intake-block', 'flood|*', { groups: [] }),
      row('intake-block', '*|glacier', { groups: [grp('x-g', ['t-flood-1'])] }),
    );
    expect(decideIntakeReset(c, IDX, flood)).toMatchObject({ status: 400, error: expect.stringMatching(/^Can't reset the flood intake questions/) });
  });
});

describe('roles save / reset', () => {
  it('stores a changed list and no-ops the default', () => {
    const roles = [role('ic'), role('ops'), role('r-new')];
    expect(decideRolesSave(cfg(), IDX, roles, 0)).toEqual({ type: 'upsert', revision: 1, data: { roles } });
    expect(decideRolesSave(cfg(), IDX, [role('ic'), role('ops')], 0)).toEqual({ type: 'noop' });
    // Color case alone is not a change.
    expect(decideRolesSave(cfg(), IDX, [role('ic'), { ...role('ops'), color: '#A1B2C3' }], 0)).toEqual({ type: 'noop' });
  });

  it('refuses to drop a role in use, and conflicts on a stale revision', () => {
    expect(decideRolesSave(cfg(), IDX, [role('ic')], 0))
      .toMatchObject({ status: 400, error: expect.stringMatching(/^"Role ops" \(OPS\) is still assigned to 2 checklist items/) });
    const c = cfg(row('checklist-roles', '*', { roles: [role('ic'), role('ops'), role('r-x')] }, 3));
    expect(decideRolesSave(c, IDX, [role('ic'), role('ops')], 2)).toMatchObject({ status: 409 });
    expect(decideRolesSave(c, IDX, [role('ic'), role('ops')], 3)).toEqual({ type: 'delete' });
  });

  it('resets unless a custom role is still in use', () => {
    expect(decideRolesReset(cfg(), IDX)).toEqual({ type: 'noop' });
    const custom = row('checklist-roles', '*', { roles: [role('ic'), role('ops'), role('r-x')] });
    expect(decideRolesReset(cfg(custom), IDX)).toEqual({ type: 'delete' });
    const used = cfg(custom, row('checklist-block', 'flood|*', { items: [ci('x-a', 'r-x')] }));
    expect(decideRolesReset(used, IDX)).toMatchObject({
      status: 400, error: expect.stringMatching(/^Can't reset the checklist roles to the built-in default: "Role r-x" \(R-X\) is still assigned to 1 checklist item/),
    });
  });
});
