// ── Crisis templates — effective config ──────────────────────────────────────
//
// Pure assembly of what GET /api/crisis-templates answers: the built-in
// defaults (data/crisisTemplateDefaults) with every admin override row laid
// over them, one row per (kind, scope). An override REPLACES its scope's
// default block wholesale; a scope with an override but no default is simply
// added. A custom block left empty stays in the config (it is how an admin
// hides a default block, and the editor needs it to offer "Reset"), while an
// empty default is dropped.
//
// Block order is fixed so every client lists scopes the same way: General,
// then incident types in taxonomy order, then properties by id, then
// type + property pairs (type order, then property id).
//
// Also here: the share page's scope-filtered copy and the lookups the write
// path validates against (which ids other blocks own, which roles are in use).

import {
  CHECKLIST_PHASE_IDS, parseScopeKey, scopeApplies, scopeKey,
  type BlockMeta, type ChecklistBlock, type ChecklistBlockItem, type ChecklistPhaseId,
  type ChecklistRoleMeta, type ChecklistRolesDoc, type CrisisTemplatesConfig,
  type DefaultChecklistBlock, type DefaultIntakeBlock, type IntakeBlock, type IntakeBlockGroup,
  type RetiredChecklistItem, type RetiredIntakeQuestion, type TemplateScope,
} from './types';
import { CANONICAL_TYPE_IDS } from './validate';

export type OverrideKind = 'checklist-block' | 'intake-block' | 'checklist-roles';

/** scope_key of the single, global checklist-roles override row. */
export const ROLES_SCOPE_KEY = '*';

/** A crisis_template_overrides row as pg returns it. */
export interface OverrideRow {
  kind: string;
  scope_key: string;
  data: unknown;
  revision: number;
  updated_at: Date | string | null;
  updated_by: string | null;
}

export interface TemplateDefaults {
  roles: readonly ChecklistRoleMeta[];
  checklistBlocks: readonly DefaultChecklistBlock[];
  intakeBlocks: readonly DefaultIntakeBlock[];
}

/** The defaults keyed by scopeKey — what "reset" restores and saves compare against. */
export interface DefaultsIndex {
  roles: readonly ChecklistRoleMeta[];
  checklist: ReadonlyMap<string, { scope: TemplateScope; items: ChecklistBlockItem[] }>;
  intake: ReadonlyMap<string, { scope: TemplateScope; groups: IntakeBlockGroup[] }>;
}

/**
 * Key the default blocks by scope. Two default blocks for one scope would be a
 * content-assembly slip; they are concatenated rather than one dropped, and
 * empty ones are left out (an empty default has nothing to show or hide).
 */
export function indexDefaults(d: TemplateDefaults): DefaultsIndex {
  const checklist = new Map<string, { scope: TemplateScope; items: ChecklistBlockItem[] }>();
  for (const b of d.checklistBlocks) {
    if (b.items.length === 0) continue;
    const key = scopeKey(b.scope);
    const prev = checklist.get(key);
    checklist.set(key, { scope: { ...b.scope }, items: [...(prev?.items ?? []), ...b.items] });
  }
  const intake = new Map<string, { scope: TemplateScope; groups: IntakeBlockGroup[] }>();
  for (const b of d.intakeBlocks) {
    if (b.groups.length === 0) continue;
    const key = scopeKey(b.scope);
    const prev = intake.get(key);
    intake.set(key, { scope: { ...b.scope }, groups: [...(prev?.groups ?? []), ...b.groups] });
  }
  return { roles: d.roles, checklist, intake };
}

// ── Ordering ─────────────────────────────────────────────────────────────────

const TYPE_ORDER = new Map(CANONICAL_TYPE_IDS.map((id, i) => [id, i]));

function rank(s: TemplateScope): number {
  if (s.incidentType !== null && s.propertyId !== null) return 3;
  if (s.propertyId !== null) return 2;
  if (s.incidentType !== null) return 1;
  return 0;
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** General → types (taxonomy order; unknown ids last, by id) → properties (by id) → type + property. */
export function compareScopes(a: TemplateScope, b: TemplateScope): number {
  const r = rank(a) - rank(b);
  if (r !== 0) return r;
  if (a.incidentType !== b.incidentType) {
    const at = a.incidentType ?? '';
    const bt = b.incidentType ?? '';
    const d = (TYPE_ORDER.get(at) ?? TYPE_ORDER.size) - (TYPE_ORDER.get(bt) ?? TYPE_ORDER.size);
    return d !== 0 ? d : cmp(at, bt);
  }
  return cmp(a.propertyId ?? '', b.propertyId ?? '');
}

// ── Override rows (defensive parse) ──────────────────────────────────────────
//
// Rows are only ever written through the validated routes, but a hand-edited
// or half-migrated row must not take the checklist down for every incident:
// malformed entries are dropped, and a row with no usable payload is ignored
// (its scope falls back to the default) with a warning.

const isObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string';

function parseItems(data: unknown): ChecklistBlockItem[] | null {
  if (!isObject(data) || !Array.isArray(data.items)) return null;
  return data.items
    .filter((i): i is Record<string, unknown> =>
      isObject(i) && isStr(i.id) && isStr(i.roleId) && isStr(i.text) &&
      isStr(i.phase) && CHECKLIST_PHASE_IDS.has(i.phase))
    .map((i) => ({ id: i.id as string, roleId: i.roleId as string, phase: i.phase as ChecklistPhaseId, text: i.text as string }));
}

function parseGroups(data: unknown): IntakeBlockGroup[] | null {
  if (!isObject(data) || !Array.isArray(data.groups)) return null;
  return data.groups
    .filter((g): g is Record<string, unknown> =>
      isObject(g) && isStr(g.id) && isStr(g.label) && Array.isArray(g.questions))
    .map((g) => ({
      id: g.id as string,
      label: g.label as string,
      questions: (g.questions as unknown[])
        .filter((q): q is Record<string, unknown> => isObject(q) && isStr(q.id) && isStr(q.text))
        .map((q) => ({ id: q.id as string, text: q.text as string })),
    }));
}

function parseRoles(data: unknown): ChecklistRoleMeta[] | null {
  if (!isObject(data) || !Array.isArray(data.roles)) return null;
  const roles = data.roles
    .filter((r): r is Record<string, unknown> =>
      isObject(r) && isStr(r.id) && isStr(r.code) && isStr(r.title) && isStr(r.color))
    .map((r) => ({
      id: r.id as string,
      code: r.code as string,
      title: r.title as string,
      color: r.color as string,
      reportsTo: isStr(r.reportsTo) ? r.reportsTo : '',
      directs: isStr(r.directs) ? r.directs : '',
    }));
  // An empty role list would hide every checklist item — never honor one.
  return roles.length > 0 ? roles : null;
}

const DEFAULT_META: BlockMeta = { custom: false, revision: 0, updatedAt: null, updatedBy: null };

function metaOf(row: OverrideRow): BlockMeta {
  const at = row.updated_at === null ? NaN : new Date(row.updated_at).getTime();
  return {
    custom: true,
    revision: Number.isSafeInteger(row.revision) ? row.revision : 1,
    updatedAt: Number.isNaN(at) ? null : new Date(at).toISOString(),
    updatedBy: row.updated_by ?? null,
  };
}

// ── Assembly ─────────────────────────────────────────────────────────────────

/** Defaults + override rows → the effective config (custom=true where overridden). */
export function buildEffectiveConfig(
  defaults: DefaultsIndex,
  rows: readonly OverrideRow[],
  warn: (msg: string) => void = () => {}
): CrisisTemplatesConfig {
  let checklistRoles: ChecklistRolesDoc = { ...DEFAULT_META, roles: defaults.roles.map((r) => ({ ...r })) };
  const checklist = new Map<string, ChecklistBlock>();
  for (const [key, b] of defaults.checklist) {
    checklist.set(key, { ...DEFAULT_META, scope: { ...b.scope }, items: [...b.items] });
  }
  const intake = new Map<string, IntakeBlock>();
  for (const [key, b] of defaults.intake) {
    intake.set(key, { ...DEFAULT_META, scope: { ...b.scope }, groups: [...b.groups] });
  }

  for (const row of rows) {
    const where = `${row.kind} ${JSON.stringify(row.scope_key)}`;
    if (row.kind === 'checklist-roles') {
      const roles = parseRoles(row.data);
      if (!roles) { warn(`[crisis-templates] ignoring malformed override ${where}`); continue; }
      checklistRoles = { ...metaOf(row), roles };
      continue;
    }
    const scope = parseScopeKey(row.scope_key);
    if (!scope) { warn(`[crisis-templates] ignoring override with bad scope ${where}`); continue; }
    const key = scopeKey(scope);
    if (row.kind === 'checklist-block') {
      const items = parseItems(row.data);
      if (!items) { warn(`[crisis-templates] ignoring malformed override ${where}`); continue; }
      checklist.set(key, { ...metaOf(row), scope, items });
    } else if (row.kind === 'intake-block') {
      const groups = parseGroups(row.data);
      if (!groups) { warn(`[crisis-templates] ignoring malformed override ${where}`); continue; }
      intake.set(key, { ...metaOf(row), scope, groups });
    } else {
      warn(`[crisis-templates] ignoring override of unknown kind ${where}`);
    }
  }

  return {
    checklistRoles,
    checklistBlocks: [...checklist.values()].sort((a, b) => compareScopes(a.scope, b.scope)),
    intakeBlocks: [...intake.values()].sort((a, b) => compareScopes(a.scope, b.scope)),
  };
}

// ── Lookups for the write path ───────────────────────────────────────────────

/** Item id → scope of the block that owns it, over every block except `exceptKey`. */
export function checklistIdOwners(config: CrisisTemplatesConfig, exceptKey: string | null): Map<string, TemplateScope> {
  const owners = new Map<string, TemplateScope>();
  for (const b of config.checklistBlocks) {
    if (scopeKey(b.scope) === exceptKey) continue;
    for (const it of b.items) if (!owners.has(it.id)) owners.set(it.id, b.scope);
  }
  return owners;
}

/** Group / question id → owning scope, over every intake block except `exceptKey`. */
export function intakeIdOwners(
  config: CrisisTemplatesConfig, exceptKey: string | null
): { groups: Map<string, TemplateScope>; questions: Map<string, TemplateScope> } {
  const groups = new Map<string, TemplateScope>();
  const questions = new Map<string, TemplateScope>();
  for (const b of config.intakeBlocks) {
    if (scopeKey(b.scope) === exceptKey) continue;
    for (const g of b.groups) {
      if (!groups.has(g.id)) groups.set(g.id, b.scope);
      for (const q of g.questions) if (!questions.has(q.id)) questions.set(q.id, b.scope);
    }
  }
  return { groups, questions };
}

/** Role id → number of effective checklist items assigned to it. */
export function roleUsage(config: CrisisTemplatesConfig): Map<string, number> {
  const usage = new Map<string, number>();
  for (const b of config.checklistBlocks) {
    for (const it of b.items) usage.set(it.roleId, (usage.get(it.roleId) ?? 0) + 1);
  }
  return usage;
}

// ── Share page copy ──────────────────────────────────────────────────────────

/**
 * What a share link's viewer gets: only the blocks that apply to the
 * incident's type + property, editor names removed, plus the text of any
 * checked item / answered question the incident holds state for but no
 * longer resolves to (its type or property changed, or an admin removed the
 * line) — so the share page can still show that record read-only without
 * being handed every other scope's content.
 */
export function shareTemplatesConfig(
  config: CrisisTemplatesConfig,
  incidentType: string | null,
  propertyId: string | null,
  checklists: unknown,
  intake: unknown
): CrisisTemplatesConfig {
  const applies = (b: { scope: TemplateScope }) => scopeApplies(b.scope, incidentType, propertyId);
  const checklistBlocks = config.checklistBlocks.filter(applies).map((b) => ({ ...b, updatedBy: null }));
  const intakeBlocks = config.intakeBlocks.filter(applies).map((b) => ({ ...b, updatedBy: null }));

  const retiredChecklistItems: Record<string, RetiredChecklistItem> = {};
  if (isObject(checklists)) {
    const live = new Set(checklistBlocks.flatMap((b) => b.items.map((i) => i.id)));
    const known = new Map<string, ChecklistBlockItem>();
    for (const b of config.checklistBlocks) for (const it of b.items) if (!known.has(it.id)) known.set(it.id, it);
    for (const id of Object.keys(checklists)) {
      const it = live.has(id) ? undefined : known.get(id);
      if (it) retiredChecklistItems[id] = { text: it.text, roleId: it.roleId, phase: it.phase };
    }
  }

  const retiredIntakeQuestions: Record<string, RetiredIntakeQuestion> = {};
  if (isObject(intake)) {
    const live = new Set(intakeBlocks.flatMap((b) => b.groups.flatMap((g) => g.questions.map((q) => q.id))));
    const known = new Map<string, RetiredIntakeQuestion>();
    for (const b of config.intakeBlocks) {
      for (const g of b.groups) {
        for (const q of g.questions) if (!known.has(q.id)) known.set(q.id, { text: q.text, groupLabel: g.label });
      }
    }
    for (const [id, answer] of Object.entries(intake)) {
      // Blank answers are not shown as retired (templates/model.ts), so their text isn't needed.
      if (typeof answer !== 'string' || !answer.trim() || live.has(id)) continue;
      const q = known.get(id);
      if (q) retiredIntakeQuestions[id] = q;
    }
  }

  return {
    checklistRoles: { ...config.checklistRoles, updatedBy: null },
    checklistBlocks,
    intakeBlocks,
    retiredChecklistItems,
    retiredIntakeQuestions,
  };
}
