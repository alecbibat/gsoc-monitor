// ── Crisis templates — admin-editable checklists & intake questions ──────────
//
// The ICS role checklists and the intake questionnaire are no longer fixed in
// code: an admin edits them per SCOPE (Admin → Checklists / Intake), and each
// incident resolves the scopes that apply to it:
//
//   General (every incident) → Incident type → Property → Type + Property
//
// so an incident sees the general items first, then what is specific to its
// type (Wildfire), its property (Grand Canyon), and finally anything written
// for that exact combination. The server owns the effective config (built-in
// defaults overlaid with admin overrides, routes/crisisTemplates.ts); this
// module is the pure, store-free model + resolver shared by the editor, the
// admin page and the public share page (so it must stay free of crisisStore
// and any other heavy import — see the share-bundle note in CrisisShareView).
//
// Item / question ids are the keys of an incident's sparse state maps
// (`Incident.checklists`, `Incident.intake`), so they are stable, globally
// unique across every scope, and must match the server's id pattern
// (TEMPLATE_ID_RE, mirrored in server/src/crisisTemplates/types.ts).

import {
  CHECKLIST_PHASES,
  type ChecklistItemDef, type ChecklistPhaseId, type ChecklistRoleDef,
  type ChecklistStateMap, type ChecklistTemplate,
} from '../checklistTemplate';
import type { IntakeAnswers, IntakeGroupDef, IntakeTemplate } from '../intakeTemplate';

/** Same pattern the server enforces for item/question/group/role ids. */
export const TEMPLATE_ID_RE = /^[a-z][a-z0-9-]{0,63}$/;

// ── Scopes ───────────────────────────────────────────────────────────────────

/**
 * Which incidents a block applies to. null = "any". Both null is the General
 * scope; propertyId is a LOCATION_GROUPS id or the fleet pseudo-group
 * ('windstar-ships').
 */
export interface TemplateScope {
  incidentType: string | null;
  propertyId: string | null;
}

export const GENERAL_SCOPE: TemplateScope = { incidentType: null, propertyId: null };

/** Canonical string form, used as the override row key: `type|property`, `*` = any. */
export function scopeKey(s: TemplateScope): string {
  return `${s.incidentType ?? '*'}|${s.propertyId ?? '*'}`;
}

export function parseScopeKey(key: string): TemplateScope | null {
  const parts = key.split('|');
  if (parts.length !== 2) return null;
  const [t, p] = parts;
  const ok = (v: string) => v === '*' || TEMPLATE_ID_RE.test(v);
  if (!ok(t) || !ok(p)) return null;
  return { incidentType: t === '*' ? null : t, propertyId: p === '*' ? null : p };
}

export function sameScope(a: TemplateScope, b: TemplateScope): boolean {
  return a.incidentType === b.incidentType && a.propertyId === b.propertyId;
}

/** Does a block with scope `s` apply to an incident of this type at this property? */
export function scopeApplies(s: TemplateScope, incidentType: string | null, propertyId: string | null): boolean {
  return (s.incidentType === null || s.incidentType === incidentType) &&
    (s.propertyId === null || s.propertyId === propertyId);
}

/** Resolution order: General 0 → Type 1 → Property 2 → Type + Property 3. */
export function scopeRank(s: TemplateScope): 0 | 1 | 2 | 3 {
  if (s.incidentType !== null && s.propertyId !== null) return 3;
  if (s.propertyId !== null) return 2;
  if (s.incidentType !== null) return 1;
  return 0;
}

// ── Config (what GET /api/crisis-templates returns) ──────────────────────────

/** Provenance of one editable unit (a block, or the role list). */
export interface BlockMeta {
  /** true = an admin override is stored; false = the built-in default. */
  custom: boolean;
  /** Optimistic-concurrency token: 0 for a default, bumped on every save. */
  revision: number;
  updatedAt: string | null;
  updatedBy: string | null;
}

/** A checklist position (IC, GSOC, …) — global, shared by every scope. */
export interface ChecklistRoleMeta {
  /** Matches the org chart's builtin role ids where one exists (DEFAULT_ROLES). */
  id: string;
  code: string;
  title: string;
  color: string;
  reportsTo: string;
  directs: string;
}

export interface ChecklistRolesDoc extends BlockMeta {
  /** Display order = array order. */
  roles: ChecklistRoleMeta[];
}

export interface ChecklistBlockItem {
  id: string;
  roleId: string;
  phase: ChecklistPhaseId;
  text: string;
}

export interface ChecklistBlock extends BlockMeta {
  scope: TemplateScope;
  /** Ordered; resolution keeps this order within each role + phase. */
  items: ChecklistBlockItem[];
}

export interface IntakeBlockQuestion {
  id: string;
  text: string;
}

export interface IntakeBlockGroup {
  id: string;
  label: string;
  questions: IntakeBlockQuestion[];
}

export interface IntakeBlock extends BlockMeta {
  scope: TemplateScope;
  groups: IntakeBlockGroup[];
}

/** Text for an id no longer in the applicable scopes (share route only). */
export interface RetiredChecklistItem {
  text: string;
  roleId: string;
  phase: ChecklistPhaseId;
}
export interface RetiredIntakeQuestion {
  text: string;
  groupLabel: string;
}

export interface CrisisTemplatesConfig {
  checklistRoles: ChecklistRolesDoc;
  checklistBlocks: ChecklistBlock[];
  intakeBlocks: IntakeBlock[];
  /**
   * Only on the share route's scope-filtered answer: text for ids present in
   * the incident's state maps but outside the scopes it now resolves to (the
   * type or property changed after items were checked / answered). The full
   * config doesn't need them — every block is in it.
   */
  retiredChecklistItems?: Record<string, RetiredChecklistItem>;
  retiredIntakeQuestions?: Record<string, RetiredIntakeQuestion>;
}

// ── Resolution ───────────────────────────────────────────────────────────────

/** Blocks that apply to this incident, in resolution order (stable within a rank). */
export function applicableBlocks<B extends { scope: TemplateScope }>(
  blocks: readonly B[], incidentType: string | null, propertyId: string | null
): B[] {
  return blocks
    .map((b, i) => ({ b, i }))
    .filter(({ b }) => scopeApplies(b.scope, incidentType, propertyId))
    .sort((x, y) => scopeRank(x.b.scope) - scopeRank(y.b.scope) || x.i - y.i)
    .map(({ b }) => b);
}

/**
 * The checklist one incident sees: every role in the role list's order, each
 * with its three phases, items concatenated General → Type → Property →
 * Type+Property. Roles with no items at all are left out. A duplicated id
 * keeps its first (most general) occurrence — ids key shared state.
 */
export function resolveChecklist(
  config: Pick<CrisisTemplatesConfig, 'checklistRoles' | 'checklistBlocks'>,
  incidentType: string | null,
  propertyId: string | null
): ChecklistTemplate {
  const blocks = applicableBlocks(config.checklistBlocks, incidentType, propertyId);
  const seen = new Set<string>();
  // role → phase → items, filled in block order.
  const byRole = new Map<string, Map<ChecklistPhaseId, ChecklistItemDef[]>>();
  for (const block of blocks) {
    for (const item of block.items) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      let phases = byRole.get(item.roleId);
      if (!phases) { phases = new Map(); byRole.set(item.roleId, phases); }
      const list = phases.get(item.phase) ?? [];
      list.push({ id: item.id, text: item.text, scope: block.scope });
      phases.set(item.phase, list);
    }
  }

  const roles: ChecklistRoleDef[] = [];
  for (const meta of config.checklistRoles.roles) {
    const phases = byRole.get(meta.id);
    if (!phases) continue;
    roles.push({
      ...meta,
      phases: CHECKLIST_PHASES
        .map((p) => ({ id: p.id, items: phases.get(p.id) ?? [] }))
        .filter((p) => p.items.length > 0),
    });
  }

  return {
    id: `resolved:${incidentType ?? '*'}|${propertyId ?? '*'}`,
    title: 'ICS Role Checklists',
    source: 'Admin checklist templates',
    roles,
  };
}

/**
 * The intake questionnaire one incident sees: groups concatenated General →
 * Type → Property → Type+Property, questions numbered 1…n across the whole
 * set (display only — answers key by id). Duplicate question ids keep their
 * first occurrence; groups left empty by that are dropped.
 */
export function resolveIntake(
  config: Pick<CrisisTemplatesConfig, 'intakeBlocks'>,
  incidentType: string | null,
  propertyId: string | null
): IntakeTemplate {
  const blocks = applicableBlocks(config.intakeBlocks, incidentType, propertyId);
  const seen = new Set<string>();
  let n = 0;
  const groups: IntakeGroupDef[] = [];
  for (const block of blocks) {
    for (const g of block.groups) {
      const questions = [];
      for (const q of g.questions) {
        if (seen.has(q.id)) continue;
        seen.add(q.id);
        n += 1;
        questions.push({ id: q.id, n, text: q.text });
      }
      if (questions.length > 0) groups.push({ id: g.id, label: g.label, scope: block.scope, questions });
    }
  }
  return {
    id: `resolved:${incidentType ?? '*'}|${propertyId ?? '*'}`,
    title: 'Intake — Initial Contact Questions',
    source: 'Admin intake templates',
    groups,
  };
}

// ── Retired entries (state that outlived its template) ───────────────────────

export interface RetiredChecklistEntry {
  id: string;
  /** Item text, or null when no scope knows the id any more. */
  text: string | null;
  roleId: string | null;
  checked: boolean;
  at: string;
  by?: string;
}

/**
 * Checklist state for items the incident no longer resolves to — its type or
 * property changed after they were toggled, or an admin removed them. Kept
 * visible (read-only) so the record an AAR relies on never silently loses a
 * checked item. Text comes from any block in `config` (the editor has them
 * all) or the share route's retired map.
 */
export function retiredChecklistEntries(
  config: Pick<CrisisTemplatesConfig, 'checklistBlocks' | 'retiredChecklistItems'>,
  resolved: ChecklistTemplate,
  state: ChecklistStateMap
): RetiredChecklistEntry[] {
  const live = new Set(resolved.roles.flatMap((r) => r.phases.flatMap((p) => p.items.map((i) => i.id))));
  const known = new Map<string, { text: string; roleId: string }>();
  for (const b of config.checklistBlocks) {
    for (const it of b.items) if (!known.has(it.id)) known.set(it.id, { text: it.text, roleId: it.roleId });
  }
  const out: RetiredChecklistEntry[] = [];
  for (const [id, s] of Object.entries(state)) {
    if (live.has(id)) continue;
    const k = known.get(id) ?? (config.retiredChecklistItems && Object.prototype.hasOwnProperty.call(config.retiredChecklistItems, id)
      ? config.retiredChecklistItems[id]
      : undefined);
    out.push({ id, text: k?.text ?? null, roleId: k?.roleId ?? null, checked: s.checked, at: s.at, ...(s.by ? { by: s.by } : {}) });
  }
  // Most recent first — the latest toggles are the ones someone is asking about.
  return out.sort((a, b) => (Date.parse(b.at) || 0) - (Date.parse(a.at) || 0));
}

export interface RetiredIntakeEntry {
  id: string;
  text: string | null;
  answer: string;
}

/** Non-empty answers to questions the incident no longer resolves to. */
export function retiredIntakeEntries(
  config: Pick<CrisisTemplatesConfig, 'intakeBlocks' | 'retiredIntakeQuestions'>,
  resolved: IntakeTemplate,
  answers: IntakeAnswers
): RetiredIntakeEntry[] {
  const live = new Set(resolved.groups.flatMap((g) => g.questions.map((q) => q.id)));
  const known = new Map<string, string>();
  for (const b of config.intakeBlocks) {
    for (const g of b.groups) for (const q of g.questions) if (!known.has(q.id)) known.set(q.id, q.text);
  }
  const out: RetiredIntakeEntry[] = [];
  for (const [id, answer] of Object.entries(answers)) {
    if (live.has(id) || !answer.trim()) continue;
    const text = known.get(id) ?? (config.retiredIntakeQuestions && Object.prototype.hasOwnProperty.call(config.retiredIntakeQuestions, id)
      ? config.retiredIntakeQuestions[id].text
      : null);
    out.push({ id, text, answer });
  }
  return out;
}

// ── Id minting (admin editor) ────────────────────────────────────────────────

/**
 * A fresh id for an item/question/group an admin adds: `x-` + 12 base-36
 * chars. Random rather than sequential so two admins editing different scopes
 * can never mint the same id (the server still rejects cross-scope clashes).
 */
export function mintTemplateId(prefix = 'x'): string {
  const bytes = new Uint8Array(12);
  globalThis.crypto?.getRandomValues?.(bytes);
  let s = '';
  for (let i = 0; i < 12; i++) {
    const b = bytes[i] || Math.floor(Math.random() * 256);
    s += (b % 36).toString(36);
  }
  return `${prefix}-${s}`;
}

/** Type guard for a config arriving over the wire (share route: untrusted-ish JSON). */
export function isCrisisTemplatesConfig(v: unknown): v is CrisisTemplatesConfig {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const c = v as Record<string, unknown>;
  const roles = (c.checklistRoles as { roles?: unknown } | undefined)?.roles;
  return Array.isArray(roles) &&
    roles.every((r) => !!r && typeof r === 'object' && typeof (r as ChecklistRoleMeta).id === 'string') &&
    Array.isArray(c.checklistBlocks) &&
    (c.checklistBlocks as unknown[]).every((b) =>
      !!b && typeof b === 'object' && Array.isArray((b as ChecklistBlock).items) &&
      !!(b as ChecklistBlock).scope && typeof (b as ChecklistBlock).scope === 'object') &&
    Array.isArray(c.intakeBlocks) &&
    (c.intakeBlocks as unknown[]).every((b) =>
      !!b && typeof b === 'object' && Array.isArray((b as IntakeBlock).groups) &&
      !!(b as IntakeBlock).scope && typeof (b as IntakeBlock).scope === 'object');
}
