// ── Crisis templates — admin input validation ────────────────────────────────
//
// Pure checks for the admin template writes (routes/crisisTemplates.ts). Each
// parser returns either the CLEANED value (trimmed text, control characters
// stripped, colors lower-cased, unknown fields dropped) or a human-readable
// reason that names the offending entry the way the editor shows it
// ("Operations Section Chief → Immediate, item 2") — the admin sees these
// verbatim next to Save, so "invalid body" is not good enough.
//
// Nothing here truncates: an over-long line is rejected, never silently cut,
// because the admin would not notice the lost words until an incident.
//
// Cross-block rules (an id owned by another scope, a role still in use) need
// the rest of the effective config; the caller passes that in as a context,
// built under the templates advisory lock (store.ts) so it can't go stale.

import { INCIDENT_TYPE_IDS, normalizeIncidentTypeId } from '../incidentTaxonomy';
import {
  CHECKLIST_PHASE_IDS, TEMPLATE_ID_RE, parseScopeKey,
  type ChecklistBlockItem, type ChecklistPhaseId, type ChecklistRoleMeta,
  type IntakeBlockGroup, type IntakeBlockQuestion, type TemplateScope,
} from './types';

export const LIMITS = {
  checklistItemsPerBlock: 300,
  itemText: 500,
  intakeGroupsPerBlock: 40,
  questionsPerGroup: 80,
  groupLabel: 120,
  questionText: 500,
  rolesMax: 30,
  roleCode: 8,
  roleTitle: 80,
  roleNote: 200,
} as const;

/**
 * Canonical incident type ids in taxonomy order — the server mirror's set
 * minus the retired aliases ('chemical', 'security'), which old incidents may
 * still carry but which no template may be written for (they resolve as their
 * successors).
 */
export const CANONICAL_TYPE_IDS: readonly string[] =
  [...INCIDENT_TYPE_IDS].filter((id) => normalizeIncidentTypeId(id) === id);
const CANONICAL_TYPES = new Set(CANONICAL_TYPE_IDS);

export type Checked<T> = { ok: true; value: T } | { ok: false; error: string };

const ok = <T>(value: T): Checked<T> => ({ ok: true, value });
const fail = <T>(error: string): Checked<T> => ({ ok: false, error });

const isObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * Admin-typed text, cleaned: each line break or tab (with the spaces around
 * it) becomes one space, so a pasted paragraph stays readable as one line;
 * other control characters are removed and the ends trimmed. Non-strings
 * clean to ''.
 */
export function cleanText(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw
    .replace(/\s*[\t\n\r\v\f]\s*/g, ' ')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim();
}

/** A rejected value, quoted for a message — bounded, since it is client-supplied. */
function shown(v: unknown): string {
  const s = JSON.stringify(v ?? null) ?? String(v);
  return s.length > 70 ? `${s.slice(0, 70)}…` : s;
}

/** A few words of an entry's text, for pointing at it in a message. */
function snippet(text: string): string {
  return text.length > 40 ? `${text.slice(0, 40).trimEnd()}…` : text;
}

/** "the General", "the wildfire", "the grand-canyon", "the wildfire @ grand-canyon". */
export function describeScope(s: TemplateScope): string {
  if (s.incidentType && s.propertyId) return `the ${s.incidentType} @ ${s.propertyId}`;
  if (s.incidentType) return `the ${s.incidentType}`;
  if (s.propertyId) return `the ${s.propertyId}`;
  return 'the General';
}

const PHASE_LABEL: Record<ChecklistPhaseId, string> = {
  immediate: 'Immediate',
  ongoing: 'Ongoing',
  demob: 'Demobilization',
};

// ── Scope + revision ─────────────────────────────────────────────────────────

function checkScopeParts(incidentType: unknown, propertyId: unknown): Checked<TemplateScope> {
  const type = incidentType ?? null;
  const prop = propertyId ?? null;
  if (type !== null && (typeof type !== 'string' || !CANONICAL_TYPES.has(type))) {
    return fail(`Unknown incident type ${shown(type)}`);
  }
  if (prop !== null && (typeof prop !== 'string' || !TEMPLATE_ID_RE.test(prop))) {
    return fail(`Invalid property id ${shown(prop)}`);
  }
  return ok({ incidentType: type as string | null, propertyId: prop as string | null });
}

/** The `scope` object of a PUT body. Missing parts mean "any". */
export function parseScope(raw: unknown): Checked<TemplateScope> {
  if (!isObject(raw)) return fail('scope must be an object { incidentType, propertyId }');
  return checkScopeParts(raw.incidentType, raw.propertyId);
}

/** The `?scope=` query parameter of a reset (DELETE): a scopeKey like `wildfire|*`. */
export function parseScopeParam(raw: unknown): Checked<TemplateScope> {
  if (typeof raw !== 'string' || !raw) return fail('scope query parameter is required (e.g. ?scope=wildfire|*)');
  const scope = parseScopeKey(raw);
  if (!scope) return fail(`Invalid scope ${shown(raw)}`);
  return checkScopeParts(scope.incidentType, scope.propertyId);
}

export function parseBaseRevision(raw: unknown): Checked<number> {
  if (typeof raw !== 'number' || !Number.isSafeInteger(raw) || raw < 0) {
    return fail('baseRevision is required (the revision you started editing from; 0 for a built-in default)');
  }
  return ok(raw);
}

// ── Checklist items ──────────────────────────────────────────────────────────

export interface ChecklistCheckContext {
  /** The effective role list — every item's roleId must be one of these. */
  roles: readonly ChecklistRoleMeta[];
  /** Item id → scope of the OTHER effective block that already uses it. */
  takenIds: ReadonlyMap<string, TemplateScope>;
}

/** Validate + clean one checklist block's items (order preserved). */
export function checkChecklistItems(raw: unknown, ctx: ChecklistCheckContext): Checked<ChecklistBlockItem[]> {
  if (!Array.isArray(raw)) return fail('items must be an array');
  if (raw.length > LIMITS.checklistItemsPerBlock) {
    return fail(`A checklist can hold at most ${LIMITS.checklistItemsPerBlock} items per scope (this one has ${raw.length})`);
  }
  const roleTitle = new Map(ctx.roles.map((r) => [r.id, r.title]));
  const seen = new Map<string, string>(); // id → description of its first item
  // Position within role + phase, which is how the editor lays items out.
  const slot = new Map<string, number>();
  const out: ChecklistBlockItem[] = [];

  for (let i = 0; i < raw.length; i++) {
    const r = raw[i];
    if (!isObject(r)) return fail(`Item ${i + 1} is not an object`);
    const text = cleanText(r.text);
    const roleId = r.roleId;
    const phase = r.phase;
    const validRole = typeof roleId === 'string' && roleTitle.has(roleId);
    const validPhase = typeof phase === 'string' && CHECKLIST_PHASE_IDS.has(phase);

    let where: string;
    if (validRole && validPhase) {
      const k = `${roleId}|${phase}`;
      const n = (slot.get(k) ?? 0) + 1;
      slot.set(k, n);
      where = `${roleTitle.get(roleId)} → ${PHASE_LABEL[phase as ChecklistPhaseId]}, item ${n}`;
    } else {
      where = `Item ${i + 1}`;
    }
    const named = text ? `${where} ("${snippet(text)}")` : where;

    if (!validRole) return fail(`${named} is assigned to an unknown role ${shown(roleId)}`);
    if (!validPhase) return fail(`${named} has an unknown phase ${shown(phase)}`);
    if (!text) return fail(`${named} is empty — write the action or delete the item`);
    if (text.length > LIMITS.itemText) {
      return fail(`${named} is ${text.length} characters long — the limit is ${LIMITS.itemText}`);
    }
    const id = r.id;
    if (typeof id !== 'string' || !TEMPLATE_ID_RE.test(id)) {
      return fail(`${named} has an invalid id ${shown(id)}`);
    }
    const first = seen.get(id);
    if (first) return fail(`${named} repeats the id "${id}" of ${first}`);
    const owner = ctx.takenIds.get(id);
    if (owner) return fail(`${named} uses the id "${id}", which already belongs to ${describeScope(owner)} checklist`);
    seen.set(id, where);
    out.push({ id, roleId: roleId as string, phase: phase as ChecklistPhaseId, text });
  }
  return ok(out);
}

// ── Intake groups ────────────────────────────────────────────────────────────

export interface IntakeCheckContext {
  /** Group id → scope of the OTHER effective intake block that uses it. */
  takenGroupIds: ReadonlyMap<string, TemplateScope>;
  /** Question id → scope of the OTHER effective intake block that uses it. */
  takenQuestionIds: ReadonlyMap<string, TemplateScope>;
}

/** Validate + clean one intake block's groups (order preserved). */
export function checkIntakeGroups(raw: unknown, ctx: IntakeCheckContext): Checked<IntakeBlockGroup[]> {
  if (!Array.isArray(raw)) return fail('groups must be an array');
  if (raw.length > LIMITS.intakeGroupsPerBlock) {
    return fail(`Intake can hold at most ${LIMITS.intakeGroupsPerBlock} groups per scope (this one has ${raw.length})`);
  }
  const groupIds = new Set<string>();
  const questionIds = new Map<string, string>(); // id → where it first appeared
  const out: IntakeBlockGroup[] = [];

  for (let gi = 0; gi < raw.length; gi++) {
    const g = raw[gi];
    if (!isObject(g)) return fail(`Group ${gi + 1} is not an object`);
    const label = cleanText(g.label);
    const gName = label ? `Group ${gi + 1} ("${snippet(label)}")` : `Group ${gi + 1}`;
    if (!label) return fail(`${gName} needs a label`);
    if (label.length > LIMITS.groupLabel) {
      return fail(`${gName} label is ${label.length} characters long — the limit is ${LIMITS.groupLabel}`);
    }
    const gid = g.id;
    if (typeof gid !== 'string' || !TEMPLATE_ID_RE.test(gid)) {
      return fail(`${gName} has an invalid id ${shown(gid)}`);
    }
    if (groupIds.has(gid)) return fail(`${gName} repeats the group id "${gid}"`);
    const gOwner = ctx.takenGroupIds.get(gid);
    if (gOwner) return fail(`${gName} uses the id "${gid}", which already belongs to a group in ${describeScope(gOwner)} intake`);
    groupIds.add(gid);

    if (!Array.isArray(g.questions)) return fail(`${gName} questions must be an array`);
    if (g.questions.length > LIMITS.questionsPerGroup) {
      return fail(`${gName} has ${g.questions.length} questions — the limit is ${LIMITS.questionsPerGroup} per group`);
    }
    const questions: IntakeBlockQuestion[] = [];
    for (let qi = 0; qi < g.questions.length; qi++) {
      const q = g.questions[qi];
      const where = `question ${qi + 1} in group "${snippet(label)}"`;
      if (!isObject(q)) return fail(`${capitalize(where)} is not an object`);
      const text = cleanText(q.text);
      const named = text ? `${capitalize(where)} ("${snippet(text)}")` : capitalize(where);
      if (!text) return fail(`${named} is empty — write the question or delete it`);
      if (text.length > LIMITS.questionText) {
        return fail(`${named} is ${text.length} characters long — the limit is ${LIMITS.questionText}`);
      }
      const qid = q.id;
      if (typeof qid !== 'string' || !TEMPLATE_ID_RE.test(qid)) {
        return fail(`${named} has an invalid id ${shown(qid)}`);
      }
      const first = questionIds.get(qid);
      if (first) return fail(`${named} repeats the id "${qid}" of ${first}`);
      const owner = ctx.takenQuestionIds.get(qid);
      if (owner) return fail(`${named} uses the id "${qid}", which already belongs to ${describeScope(owner)} intake`);
      questionIds.set(qid, where);
      questions.push({ id: qid, text });
    }
    out.push({ id: gid, label, questions });
  }
  return ok(out);
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// ── Checklist roles ──────────────────────────────────────────────────────────

export interface RolesCheckContext {
  /** Role id → number of effective checklist items assigned to it. */
  usage: ReadonlyMap<string, number>;
  /** The role list being replaced — for naming a role the new list drops. */
  currentRoles: readonly ChecklistRoleMeta[];
}

const COLOR_RE = /^#[0-9a-f]{6}$/i;

/** Validate + clean the global checklist role list (order = display order). */
export function checkChecklistRoles(raw: unknown, ctx: RolesCheckContext): Checked<ChecklistRoleMeta[]> {
  if (!Array.isArray(raw)) return fail('roles must be an array');
  if (raw.length === 0) return fail('Keep at least one checklist role');
  if (raw.length > LIMITS.rolesMax) {
    return fail(`At most ${LIMITS.rolesMax} checklist roles are allowed (this list has ${raw.length})`);
  }
  const ids = new Set<string>();
  const out: ChecklistRoleMeta[] = [];
  for (let i = 0; i < raw.length; i++) {
    const r = raw[i];
    if (!isObject(r)) return fail(`Role ${i + 1} is not an object`);
    const title = cleanText(r.title);
    const code = cleanText(r.code);
    const named = title ? `Role ${i + 1} ("${snippet(title)}")` : `Role ${i + 1}`;
    if (!title) return fail(`${named} needs a title`);
    if (title.length > LIMITS.roleTitle) {
      return fail(`${named} title is ${title.length} characters long — the limit is ${LIMITS.roleTitle}`);
    }
    if (!code) return fail(`${named} needs a short code (e.g. OSC)`);
    if (code.length > LIMITS.roleCode) {
      return fail(`${named} code "${code}" is longer than ${LIMITS.roleCode} characters`);
    }
    const id = r.id;
    if (typeof id !== 'string' || !TEMPLATE_ID_RE.test(id)) {
      return fail(`${named} has an invalid id ${shown(id)}`);
    }
    if (ids.has(id)) return fail(`${named} repeats the role id "${id}"`);
    ids.add(id);
    if (typeof r.color !== 'string' || !COLOR_RE.test(r.color)) {
      return fail(`${named} color must be a hex color like #3b82f6`);
    }
    const notes: Record<'reportsTo' | 'directs', string> = { reportsTo: '', directs: '' };
    for (const key of ['reportsTo', 'directs'] as const) {
      if (r[key] !== undefined && r[key] !== null && typeof r[key] !== 'string') {
        return fail(`${named} ${key === 'reportsTo' ? '"Reports to"' : '"Directs"'} must be text`);
      }
      const v = cleanText(r[key]);
      if (v.length > LIMITS.roleNote) {
        return fail(`${named} ${key === 'reportsTo' ? '"Reports to"' : '"Directs"'} is ${v.length} characters long — the limit is ${LIMITS.roleNote}`);
      }
      notes[key] = v;
    }
    out.push({ id, code, title, color: r.color.toLowerCase(), reportsTo: notes.reportsTo, directs: notes.directs });
  }

  // A role that checklist items still point at must stay: resolution lists
  // roles from this list, so dropping it would silently hide those items (and
  // their checked state) from every incident.
  for (const [roleId, count] of ctx.usage) {
    if (count === 0 || ids.has(roleId)) continue;
    const current = ctx.currentRoles.find((r) => r.id === roleId);
    const name = current ? `"${current.title}" (${current.code})` : `"${roleId}"`;
    return fail(
      `${name} is still assigned to ${count} checklist item${count === 1 ? '' : 's'} — ` +
      'move or delete those items before removing the role'
    );
  }
  return ok(out);
}
