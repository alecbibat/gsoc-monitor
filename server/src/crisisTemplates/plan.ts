// ── Crisis templates — write decisions ───────────────────────────────────────
//
// What one admin save or reset should do to the overrides table, decided
// purely from the effective config read under the templates lock (store.ts
// runs the SQL). Kept free of the database so every rule is unit-testable:
//
//   - optimistic concurrency: a save names the revision it started from (a
//     reset may too); a mismatch is a 409, never a silent overwrite of
//     someone else's edit. New revisions are drawn by store.ts from one
//     sequence, never current + 1: a reset deletes the override, and a scope
//     saved again afterwards must not come back to a number an editor of the
//     old override still holds — that editor's save would pass the check;
//   - validation against the REST of the config (ids other scopes own, roles
//     items still use) — so the result can always be resolved cleanly;
//   - no pointless overrides: content identical to the built-in default (or
//     an empty block where there is no default) removes the override, so the
//     scope keeps following future default updates; an unchanged save is a
//     no-op that doesn't change the revision;
//   - reset restores the default only if the default still fits (its roles
//     exist, its ids aren't taken by another scope's override).

import {
  scopeKey,
  type BlockMeta, type ChecklistBlockItem, type ChecklistRoleMeta, type CrisisTemplatesConfig,
  type IntakeBlockGroup, type TemplateScope,
} from './types';
import { checklistIdOwners, intakeIdOwners, roleUsage, type DefaultsIndex } from './effective';
import { checkChecklistItems, checkChecklistRoles, checkIntakeGroups, describeScope } from './validate';

export type WriteDecision =
  | { type: 'reject'; status: 400 | 409; error: string }
  | { type: 'noop' }
  | { type: 'delete' }
  /** Store `data` under a new revision (store.ts draws it). */
  | { type: 'upsert'; data: Record<string, unknown> };

const reject = (status: 400 | 409, error: string): WriteDecision => ({ type: 'reject', status, error });

/** Order-sensitive fingerprints — the only fields that are content. */
const itemsKey = (items: readonly ChecklistBlockItem[]) =>
  JSON.stringify(items.map((i) => [i.id, i.roleId, i.phase, i.text]));
const groupsKey = (groups: readonly IntakeBlockGroup[]) =>
  JSON.stringify(groups.map((g) => [g.id, g.label, g.questions.map((q) => [q.id, q.text])]));
const rolesKey = (roles: readonly ChecklistRoleMeta[]) =>
  JSON.stringify(roles.map((r) => [r.id, r.code, r.title, r.color.toLowerCase(), r.reportsTo, r.directs]));

function conflict(what: string, current: BlockMeta | undefined, doing = 'saving'): WriteDecision {
  const how = current?.custom
    ? `was saved${current.updatedBy ? ` by ${current.updatedBy}` : ''}`
    : 'was reset to the built-in default';
  return reject(409, `${what.charAt(0).toUpperCase()}${what.slice(1)} ${how} after you started editing — reload that version before ${doing}`);
}

/**
 * The write for new content (fingerprint `nextKey`) given the unit's current
 * state: matching the default (or empty with no default) → drop the
 * override; matching the current override → nothing; otherwise store it
 * under a new revision.
 */
function planWrite(
  current: { custom: boolean; key: string | null },
  defaultKey: string | null,
  nextKey: string,
  empty: boolean,
  data: Record<string, unknown>
): WriteDecision {
  const matchesDefault = defaultKey !== null ? nextKey === defaultKey : empty;
  if (matchesDefault) return current.custom ? { type: 'delete' } : { type: 'noop' };
  if (current.custom && current.key === nextKey) return { type: 'noop' };
  return { type: 'upsert', data };
}

/**
 * A reset quoting the revision it was looking at (`baseRevision`; null when
 * the request didn't say) must not delete a newer save it never saw. Only
 * called for a custom unit: resetting one already at its default is a no-op
 * whatever the base.
 */
function resetConflict(what: string, current: BlockMeta, baseRevision: number | null): WriteDecision | null {
  return baseRevision !== null && baseRevision !== current.revision ? conflict(what, current, 'resetting') : null;
}

// ── Checklist blocks ─────────────────────────────────────────────────────────

export function decideChecklistSave(
  config: CrisisTemplatesConfig, defaults: DefaultsIndex,
  scope: TemplateScope, rawItems: unknown, baseRevision: number
): WriteDecision {
  const key = scopeKey(scope);
  const current = config.checklistBlocks.find((b) => scopeKey(b.scope) === key);
  const revision = current?.custom ? current.revision : 0;
  if (baseRevision !== revision) return conflict(`${describeScope(scope)} checklist`, current);

  const checked = checkChecklistItems(rawItems, {
    roles: config.checklistRoles.roles,
    takenIds: checklistIdOwners(config, key),
  });
  if (!checked.ok) return reject(400, checked.error);
  const items = checked.value;
  const def = defaults.checklist.get(key);
  return planWrite(
    { custom: !!current?.custom, key: current ? itemsKey(current.items) : null },
    def ? itemsKey(def.items) : null,
    itemsKey(items),
    items.length === 0,
    { items }
  );
}

export function decideChecklistReset(
  config: CrisisTemplatesConfig, defaults: DefaultsIndex, scope: TemplateScope, baseRevision: number | null = null
): WriteDecision {
  const key = scopeKey(scope);
  const current = config.checklistBlocks.find((b) => scopeKey(b.scope) === key);
  if (!current?.custom) return { type: 'noop' };
  const stale = resetConflict(`${describeScope(scope)} checklist`, current, baseRevision);
  if (stale) return stale;
  const def = defaults.checklist.get(key);
  if (def) {
    // Items of a role that has since been removed would be invisible on every
    // incident — say which role to restore instead of resetting into that.
    const roleIds = new Set(config.checklistRoles.roles.map((r) => r.id));
    const missing = new Map<string, number>();
    for (const it of def.items) if (!roleIds.has(it.roleId)) missing.set(it.roleId, (missing.get(it.roleId) ?? 0) + 1);
    if (missing.size > 0) {
      const list = [...missing].map(([id, n]) => `"${id}" (${n} item${n === 1 ? '' : 's'})`).join(', ');
      return reject(400,
        `Can't reset ${describeScope(scope)} checklist: the built-in default uses the removed role${missing.size === 1 ? '' : 's'} ${list}. ` +
        'Reset the checklist roles to default first.');
    }
    const checked = checkChecklistItems(def.items, {
      roles: config.checklistRoles.roles,
      takenIds: checklistIdOwners(config, key),
    });
    if (!checked.ok) return reject(400, `Can't reset ${describeScope(scope)} checklist to the built-in default: ${checked.error}`);
  }
  return { type: 'delete' };
}

// ── Intake blocks ────────────────────────────────────────────────────────────

export function decideIntakeSave(
  config: CrisisTemplatesConfig, defaults: DefaultsIndex,
  scope: TemplateScope, rawGroups: unknown, baseRevision: number
): WriteDecision {
  const key = scopeKey(scope);
  const current = config.intakeBlocks.find((b) => scopeKey(b.scope) === key);
  const revision = current?.custom ? current.revision : 0;
  if (baseRevision !== revision) return conflict(`${describeScope(scope)} intake questions`, current);

  const owners = intakeIdOwners(config, key);
  const checked = checkIntakeGroups(rawGroups, { takenGroupIds: owners.groups, takenQuestionIds: owners.questions });
  if (!checked.ok) return reject(400, checked.error);
  const groups = checked.value;
  const def = defaults.intake.get(key);
  return planWrite(
    { custom: !!current?.custom, key: current ? groupsKey(current.groups) : null },
    def ? groupsKey(def.groups) : null,
    groupsKey(groups),
    // Only NO groups counts as empty: a labelled group still waiting for its
    // questions is work in progress worth keeping.
    groups.length === 0,
    { groups }
  );
}

export function decideIntakeReset(
  config: CrisisTemplatesConfig, defaults: DefaultsIndex, scope: TemplateScope, baseRevision: number | null = null
): WriteDecision {
  const key = scopeKey(scope);
  const current = config.intakeBlocks.find((b) => scopeKey(b.scope) === key);
  if (!current?.custom) return { type: 'noop' };
  const stale = resetConflict(`${describeScope(scope)} intake questions`, current, baseRevision);
  if (stale) return stale;
  const def = defaults.intake.get(key);
  if (def) {
    const owners = intakeIdOwners(config, key);
    const checked = checkIntakeGroups(def.groups, { takenGroupIds: owners.groups, takenQuestionIds: owners.questions });
    if (!checked.ok) return reject(400, `Can't reset ${describeScope(scope)} intake questions to the built-in default: ${checked.error}`);
  }
  return { type: 'delete' };
}

// ── Checklist roles ──────────────────────────────────────────────────────────

export function decideRolesSave(
  config: CrisisTemplatesConfig, defaults: DefaultsIndex, rawRoles: unknown, baseRevision: number
): WriteDecision {
  const current = config.checklistRoles;
  const revision = current.custom ? current.revision : 0;
  if (baseRevision !== revision) return conflict('the checklist role list', current);

  const checked = checkChecklistRoles(rawRoles, { usage: roleUsage(config), currentRoles: current.roles });
  if (!checked.ok) return reject(400, checked.error);
  const roles = checked.value;
  return planWrite(
    { custom: current.custom, key: rolesKey(current.roles) },
    rolesKey(defaults.roles),
    rolesKey(roles),
    false,
    { roles }
  );
}

export function decideRolesReset(
  config: CrisisTemplatesConfig, defaults: DefaultsIndex, baseRevision: number | null = null
): WriteDecision {
  const current = config.checklistRoles;
  if (!current.custom) return { type: 'noop' };
  const stale = resetConflict('the checklist role list', current, baseRevision);
  if (stale) return stale;
  const checked = checkChecklistRoles(defaults.roles, { usage: roleUsage(config), currentRoles: current.roles });
  if (!checked.ok) return reject(400, `Can't reset the checklist roles to the built-in default: ${checked.error}`);
  return { type: 'delete' };
}
