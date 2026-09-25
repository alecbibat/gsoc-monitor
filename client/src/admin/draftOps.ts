// ── Template editor draft operations ─────────────────────────────────────────
//
// Pure list surgery for the admin template editors (checklists, intake, roles):
// insert / remove / move / nudge, "does the draft differ from what is saved",
// the pre-save cleanup, client-side limits that mirror the server's validation
// (so most mistakes are caught before a round trip), and substituting a draft
// block into the config so the preview resolves exactly what an incident will
// get. Nothing here mutates its input; an operation that changes nothing
// returns the SAME array, so callers can skip a state update (and a spurious
// "unsaved changes") by identity.

import { CHECKLIST_PHASES, type ChecklistPhaseId } from '../crisis/checklistTemplate';
import {
  sameScope, scopeRank,
  type ChecklistBlock, type ChecklistBlockItem, type ChecklistRoleMeta, type CrisisTemplatesConfig,
  type IntakeBlock, type IntakeBlockGroup, type IntakeBlockQuestion, type TemplateScope,
} from '../crisis/templates/model';

export const PHASE_ORDER: ChecklistPhaseId[] = CHECKLIST_PHASES.map((p) => p.id);
const phaseIndex = (p: ChecklistPhaseId) => PHASE_ORDER.indexOf(p);

/** Mirrors the server's write validation (routes/crisisTemplates.ts). */
export const LIMITS = {
  checklistItems: 300,
  itemText: 500,
  intakeGroups: 40,
  groupQuestions: 80,
  groupLabel: 120,
  questionText: 500,
  roles: 30,
  roleCode: 8,
  roleTitle: 80,
  roleText: 200,
} as const;

/**
 * Template text is single-line wherever it is shown (checklist rows, intake
 * labels), so runs of whitespace — a stray Shift+Enter, a pasted line break,
 * control characters — collapse to one space, and the ends are trimmed.
 */
export function tidyText(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\u0000-\u001f\u007f\s]+/g, ' ').trim();
}

// ── Generic id-keyed lists ───────────────────────────────────────────────────

function sameOrder<T>(a: readonly T[], b: readonly T[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

/** Move the entry `id` to just before `beforeId` (null = to the end). */
export function moveBefore<T extends { id: string }>(list: T[], id: string, beforeId: string | null): T[] {
  const from = list.findIndex((x) => x.id === id);
  if (from < 0 || id === beforeId) return list;
  const rest = list.filter((x) => x.id !== id);
  const to = beforeId === null ? rest.length : rest.findIndex((x) => x.id === beforeId);
  if (to < 0) return list;
  rest.splice(to, 0, list[from]);
  return sameOrder(list, rest) ? list : rest;
}

/** Swap the entry `id` with its neighbour (−1 = up, +1 = down). */
export function nudge<T extends { id: string }>(list: T[], id: string, dir: -1 | 1): T[] {
  const i = list.findIndex((x) => x.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return list;
  const next = list.slice();
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

/** Insert `entry` after `afterId` (null or unknown = at the end). */
export function insertAfter<T extends { id: string }>(list: T[], entry: T, afterId: string | null): T[] {
  const at = afterId === null ? -1 : list.findIndex((x) => x.id === afterId);
  const next = list.slice();
  next.splice(at < 0 ? next.length : at + 1, 0, entry);
  return next;
}

export function removeById<T extends { id: string }>(list: T[], id: string): T[] {
  const next = list.filter((x) => x.id !== id);
  return next.length === list.length ? list : next;
}

/** Shallow-merge `patch` into entry `id`; unchanged fields keep the same array. */
export function updateById<T extends { id: string }>(list: T[], id: string, patch: Partial<T>): T[] {
  const i = list.findIndex((x) => x.id === id);
  if (i < 0) return list;
  const cur = list[i];
  const keys = Object.keys(patch) as (keyof T)[];
  if (keys.every((k) => cur[k] === patch[k])) return list;
  const next = list.slice();
  next[i] = { ...cur, ...patch };
  return next;
}

// ── Checklist items ──────────────────────────────────────────────────────────
//
// A block's items are one flat array; the editor shows them grouped by role,
// then phase, and resolution keeps array order WITHIN a role + phase. Where a
// group sits relative to other groups in the array is irrelevant, so moves
// only ever reason about the target group's members.

const inGroup = (i: ChecklistBlockItem, roleId: string, phase: ChecklistPhaseId) =>
  i.roleId === roleId && i.phase === phase;

export function phaseItems(items: ChecklistBlockItem[], roleId: string, phase: ChecklistPhaseId): ChecklistBlockItem[] {
  return items.filter((i) => inGroup(i, roleId, phase));
}

/** Items of one role in display order: phase by phase, array order within each. */
export function roleItems(items: ChecklistBlockItem[], roleId: string): ChecklistBlockItem[] {
  return PHASE_ORDER.flatMap((p) => phaseItems(items, roleId, p));
}

function insertAtGroupEnd(items: ChecklistBlockItem[], item: ChecklistBlockItem): ChecklistBlockItem[] {
  const next = items.slice();
  for (let i = next.length - 1; i >= 0; i--) {
    if (inGroup(next[i], item.roleId, item.phase)) {
      next.splice(i + 1, 0, item);
      return next;
    }
  }
  next.push(item);
  return next;
}

/** Insert right after `afterId`; with no anchor, at the end of the item's role + phase. */
export function insertChecklistItem(
  items: ChecklistBlockItem[], item: ChecklistBlockItem, afterId: string | null = null
): ChecklistBlockItem[] {
  const at = afterId === null ? -1 : items.findIndex((i) => i.id === afterId);
  if (at < 0) return insertAtGroupEnd(items, item);
  const next = items.slice();
  next.splice(at + 1, 0, item);
  return next;
}

export interface ChecklistDropTarget {
  roleId: string;
  phase: ChecklistPhaseId;
  /** Land before this item (which must be in the target group); null = the group's end. */
  beforeId: string | null;
}

export function moveChecklistItem(items: ChecklistBlockItem[], id: string, target: ChecklistDropTarget): ChecklistBlockItem[] {
  const cur = items.find((i) => i.id === id);
  if (!cur || target.beforeId === id) return items;
  const moved = inGroup(cur, target.roleId, target.phase)
    ? cur
    : { ...cur, roleId: target.roleId, phase: target.phase };
  const rest = items.filter((i) => i.id !== id);
  let next: ChecklistBlockItem[];
  if (target.beforeId === null) {
    next = insertAtGroupEnd(rest, moved);
  } else {
    const at = rest.findIndex((i) => i.id === target.beforeId);
    // An anchor outside the target group would land the item somewhere the
    // drop indicator never showed.
    if (at < 0 || !inGroup(rest[at], target.roleId, target.phase)) return items;
    next = rest.slice();
    next.splice(at, 0, moved);
  }
  // Same group, same order inside it = nothing visible changed, whatever
  // happened to the interleaving with other groups.
  if (moved === cur) {
    const before = phaseItems(items, cur.roleId, cur.phase);
    const after = phaseItems(next, cur.roleId, cur.phase);
    if (sameOrder(before, after)) return items;
  }
  return next;
}

/**
 * Keyboard reorder within a role: one step up/down inside the phase, and from
 * a phase's first (last) slot into the end (start) of the previous (next)
 * phase — so ↑/↓ alone can reach every position drag and drop can.
 */
export function nudgeChecklistItem(items: ChecklistBlockItem[], id: string, dir: -1 | 1): ChecklistBlockItem[] {
  const cur = items.find((i) => i.id === id);
  if (!cur) return items;
  const { roleId, phase } = cur;
  const group = phaseItems(items, roleId, phase);
  const k = group.findIndex((i) => i.id === id);
  const p = phaseIndex(phase);
  if (dir === -1) {
    if (k > 0) return moveChecklistItem(items, id, { roleId, phase, beforeId: group[k - 1].id });
    if (p <= 0) return items;
    return moveChecklistItem(items, id, { roleId, phase: PHASE_ORDER[p - 1], beforeId: null });
  }
  if (k < group.length - 1) {
    return moveChecklistItem(items, id, { roleId, phase, beforeId: group[k + 2]?.id ?? null });
  }
  if (p >= PHASE_ORDER.length - 1) return items;
  const nextPhase = PHASE_ORDER[p + 1];
  return moveChecklistItem(items, id, {
    roleId, phase: nextPhase, beforeId: phaseItems(items, roleId, nextPhase)[0]?.id ?? null,
  });
}

/**
 * The form a block is saved in: text tidied, empty items dropped, ordered by
 * the role list then phase (stable), unknown roles last.
 */
export function cleanChecklistItems(items: ChecklistBlockItem[], roleOrder: readonly string[]): ChecklistBlockItem[] {
  const roleIdx = new Map(roleOrder.map((id, i) => [id, i]));
  const rank = (id: string) => roleIdx.get(id) ?? roleOrder.length;
  return items
    .map((i) => ({ id: i.id, roleId: i.roleId, phase: i.phase, text: tidyText(i.text) }))
    .filter((i) => i.text.length > 0)
    .map((item, n) => ({ item, n }))
    .sort((a, b) =>
      rank(a.item.roleId) - rank(b.item.roleId) ||
      a.item.roleId.localeCompare(b.item.roleId) ||
      phaseIndex(a.item.phase) - phaseIndex(b.item.phase) ||
      a.n - b.n)
    .map(({ item }) => item);
}

/**
 * Content fingerprint for "is this draft different?": independent of how
 * groups are interleaved in the array and of the role list's order, sensitive
 * to everything resolution shows (text, role, phase, order within a phase).
 */
export function checklistSignature(items: ChecklistBlockItem[]): string {
  return JSON.stringify(cleanChecklistItems(items, []).map((i) => [i.roleId, i.phase, i.id, i.text]));
}

export interface DraftIssue {
  /** The offending item / question / group, when there is one to point at. */
  id: string | null;
  message: string;
}

export function checklistIssues(items: ChecklistBlockItem[], roleIds: ReadonlySet<string>): DraftIssue[] {
  const issues: DraftIssue[] = [];
  const live = items.filter((i) => tidyText(i.text).length > 0);
  if (live.length > LIMITS.checklistItems) {
    issues.push({ id: null, message: `A scope can hold at most ${LIMITS.checklistItems} items — this one has ${live.length}.` });
  }
  for (const i of live) {
    const len = tidyText(i.text).length;
    if (len > LIMITS.itemText) {
      issues.push({ id: i.id, message: `An item is ${len} characters long — the limit is ${LIMITS.itemText}.` });
    }
    if (!roleIds.has(i.roleId)) {
      issues.push({ id: i.id, message: `An item belongs to “${i.roleId}”, which is no longer a checklist role — delete it or recreate the role.` });
    }
  }
  return issues;
}

// ── Intake groups & questions ────────────────────────────────────────────────

export function findQuestion(groups: IntakeBlockGroup[], qid: string): { g: number; q: number } | null {
  for (let g = 0; g < groups.length; g++) {
    const q = groups[g].questions.findIndex((x) => x.id === qid);
    if (q >= 0) return { g, q };
  }
  return null;
}

function withQuestions(groups: IntakeBlockGroup[], g: number, questions: IntakeBlockQuestion[]): IntakeBlockGroup[] {
  if (questions === groups[g].questions) return groups;
  const next = groups.slice();
  next[g] = { ...groups[g], questions };
  return next;
}

/** Insert into `groupId` after `afterId` (null = at the end of the group). */
export function insertQuestion(
  groups: IntakeBlockGroup[], groupId: string, question: IntakeBlockQuestion, afterId: string | null = null
): IntakeBlockGroup[] {
  const g = groups.findIndex((x) => x.id === groupId);
  if (g < 0) return groups;
  return withQuestions(groups, g, insertAfter(groups[g].questions, question, afterId));
}

export function updateQuestion(groups: IntakeBlockGroup[], qid: string, text: string): IntakeBlockGroup[] {
  const at = findQuestion(groups, qid);
  if (!at) return groups;
  return withQuestions(groups, at.g, updateById(groups[at.g].questions, qid, { text }));
}

export function removeQuestion(groups: IntakeBlockGroup[], qid: string): IntakeBlockGroup[] {
  const at = findQuestion(groups, qid);
  if (!at) return groups;
  return withQuestions(groups, at.g, removeById(groups[at.g].questions, qid));
}

export interface QuestionDropTarget {
  groupId: string;
  /** Land before this question of the target group; null = the group's end. */
  beforeId: string | null;
}

export function moveQuestion(groups: IntakeBlockGroup[], qid: string, target: QuestionDropTarget): IntakeBlockGroup[] {
  const from = findQuestion(groups, qid);
  const tg = groups.findIndex((x) => x.id === target.groupId);
  if (!from || tg < 0 || target.beforeId === qid) return groups;
  if (from.g === tg) return withQuestions(groups, tg, moveBefore(groups[tg].questions, qid, target.beforeId));
  const question = groups[from.g].questions[from.q];
  const dest = groups[tg].questions;
  const at = target.beforeId === null ? dest.length : dest.findIndex((x) => x.id === target.beforeId);
  if (at < 0) return groups;
  const next = groups.slice();
  next[from.g] = { ...groups[from.g], questions: groups[from.g].questions.filter((x) => x.id !== qid) };
  const moved = dest.slice();
  moved.splice(at, 0, question);
  next[tg] = { ...groups[tg], questions: moved };
  return next;
}

/** ↑/↓ for a question: within its group, then across into the neighbouring group. */
export function nudgeQuestion(groups: IntakeBlockGroup[], qid: string, dir: -1 | 1): IntakeBlockGroup[] {
  const at = findQuestion(groups, qid);
  if (!at) return groups;
  const qs = groups[at.g].questions;
  if (dir === -1 && at.q > 0) return withQuestions(groups, at.g, nudge(qs, qid, -1));
  if (dir === 1 && at.q < qs.length - 1) return withQuestions(groups, at.g, nudge(qs, qid, 1));
  const ng = at.g + dir;
  if (ng < 0 || ng >= groups.length) return groups;
  return moveQuestion(groups, qid, {
    groupId: groups[ng].id,
    beforeId: dir === 1 ? groups[ng].questions[0]?.id ?? null : null,
  });
}

/**
 * The form an intake block is saved in: labels and text tidied, empty
 * questions dropped, and a group dropped only when it has neither a name nor
 * a question left (an untouched "+ Add group").
 */
export function cleanIntakeGroups(groups: IntakeBlockGroup[]): IntakeBlockGroup[] {
  return groups
    .map((g) => ({
      id: g.id,
      label: tidyText(g.label),
      questions: g.questions
        .map((q) => ({ id: q.id, text: tidyText(q.text) }))
        .filter((q) => q.text.length > 0),
    }))
    .filter((g) => g.label.length > 0 || g.questions.length > 0);
}

export function intakeSignature(groups: IntakeBlockGroup[]): string {
  return JSON.stringify(cleanIntakeGroups(groups).map((g) => [g.id, g.label, g.questions.map((q) => [q.id, q.text])]));
}

export function intakeIssues(groups: IntakeBlockGroup[]): DraftIssue[] {
  const issues: DraftIssue[] = [];
  const clean = cleanIntakeGroups(groups);
  if (clean.length > LIMITS.intakeGroups) {
    issues.push({ id: null, message: `A scope can hold at most ${LIMITS.intakeGroups} groups — this one has ${clean.length}.` });
  }
  for (const g of clean) {
    if (!g.label) issues.push({ id: g.id, message: 'A group with questions needs a name.' });
    if (g.label.length > LIMITS.groupLabel) {
      issues.push({ id: g.id, message: `A group name is ${g.label.length} characters long — the limit is ${LIMITS.groupLabel}.` });
    }
    if (g.questions.length > LIMITS.groupQuestions) {
      issues.push({ id: g.id, message: `“${g.label || 'Unnamed group'}” has ${g.questions.length} questions — the limit is ${LIMITS.groupQuestions} per group.` });
    }
    for (const q of g.questions) {
      if (q.text.length > LIMITS.questionText) {
        issues.push({ id: q.id, message: `A question is ${q.text.length} characters long — the limit is ${LIMITS.questionText}.` });
      }
    }
  }
  return issues;
}

// ── Checklist roles ──────────────────────────────────────────────────────────

export function cleanRoles(roles: ChecklistRoleMeta[]): ChecklistRoleMeta[] {
  return roles.map((r) => ({
    id: r.id,
    code: tidyText(r.code),
    title: tidyText(r.title),
    color: r.color.trim().toLowerCase(),
    reportsTo: tidyText(r.reportsTo),
    directs: tidyText(r.directs),
  }));
}

export function rolesSignature(roles: ChecklistRoleMeta[]): string {
  return JSON.stringify(cleanRoles(roles));
}

export type RoleField = 'code' | 'title' | 'color' | 'reportsTo' | 'directs';

export interface RoleIssues {
  /** Field-level problems, by role id. */
  byRole: Record<string, Partial<Record<RoleField, string>>>;
  /** Problems with the list as a whole. */
  general: string[];
  count: number;
}

export const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;

export function roleIssues(roles: ChecklistRoleMeta[]): RoleIssues {
  const byRole: RoleIssues['byRole'] = {};
  const general: string[] = [];
  let count = 0;
  const flag = (id: string, field: RoleField, message: string) => {
    (byRole[id] ??= {})[field] = message;
    count += 1;
  };
  if (roles.length === 0) { general.push('Keep at least one role.'); count += 1; }
  if (roles.length > LIMITS.roles) {
    general.push(`At most ${LIMITS.roles} roles — there are ${roles.length}.`);
    count += 1;
  }
  const codes = new Map<string, number>();
  for (const r of cleanRoles(roles)) codes.set(r.code.toUpperCase(), (codes.get(r.code.toUpperCase()) ?? 0) + 1);
  for (const r of cleanRoles(roles)) {
    if (!r.code) flag(r.id, 'code', 'Required');
    else if (r.code.length > LIMITS.roleCode) flag(r.id, 'code', `At most ${LIMITS.roleCode} characters`);
    else if ((codes.get(r.code.toUpperCase()) ?? 0) > 1) flag(r.id, 'code', 'Another role uses this code');
    if (!r.title) flag(r.id, 'title', 'Required');
    else if (r.title.length > LIMITS.roleTitle) flag(r.id, 'title', `At most ${LIMITS.roleTitle} characters`);
    if (!HEX_COLOR_RE.test(r.color)) flag(r.id, 'color', 'Pick a color');
    if (r.reportsTo.length > LIMITS.roleText) flag(r.id, 'reportsTo', `At most ${LIMITS.roleText} characters`);
    if (r.directs.length > LIMITS.roleText) flag(r.id, 'directs', `At most ${LIMITS.roleText} characters`);
  }
  return { byRole, general, count };
}

/** How many checklist items (and in how many scopes) use each role id. */
export function roleUsage(blocks: readonly ChecklistBlock[]): Map<string, { items: number; scopes: number }> {
  const usage = new Map<string, { items: number; scopes: number }>();
  for (const b of blocks) {
    const seen = new Set<string>();
    for (const it of b.items) {
      const u = usage.get(it.roleId) ?? { items: 0, scopes: 0 };
      u.items += 1;
      if (!seen.has(it.roleId)) { u.scopes += 1; seen.add(it.roleId); }
      usage.set(it.roleId, u);
    }
  }
  return usage;
}

// ── Preview: the config as it will be once the draft is saved ───────────────

function draftMeta() {
  return { custom: true, revision: 0, updatedAt: null, updatedBy: null };
}

export function withChecklistBlock(
  config: CrisisTemplatesConfig, scope: TemplateScope, items: ChecklistBlockItem[]
): CrisisTemplatesConfig {
  const blocks = config.checklistBlocks.slice();
  const i = blocks.findIndex((b) => sameScope(b.scope, scope));
  if (i >= 0) blocks[i] = { ...blocks[i], items };
  else blocks.push({ ...draftMeta(), scope, items });
  return { ...config, checklistBlocks: blocks };
}

export function withIntakeBlock(
  config: CrisisTemplatesConfig, scope: TemplateScope, groups: IntakeBlockGroup[]
): CrisisTemplatesConfig {
  const blocks: IntakeBlock[] = config.intakeBlocks.slice();
  const i = blocks.findIndex((b) => sameScope(b.scope, scope));
  if (i >= 0) blocks[i] = { ...blocks[i], groups };
  else blocks.push({ ...draftMeta(), scope, groups });
  return { ...config, intakeBlocks: blocks };
}

// ── Misc ─────────────────────────────────────────────────────────────────────

/** Which of `ids` a server error message names (it names the offending item). */
export function mentionedIds(message: string, ids: Iterable<string>): string[] {
  const out: string[] = [];
  for (const id of ids) {
    // Ids are [a-z0-9-] only, so no escaping is needed; the guards keep
    // "x-1" from matching inside "x-12".
    if (new RegExp(`(^|[^a-z0-9-])${id}($|[^a-z0-9-])`).test(message)) out.push(id);
  }
  return out;
}

/**
 * Entries a server validation error points at: by id (duplicate-id errors),
 * or by the quoted text snippet it names them with — `… ("Evacuate the
 * lodge…") is empty`, where the snippet is the text's first 40 characters.
 */
export function namedInError(message: string, entries: { id: string; text: string }[]): string[] {
  const out = new Set(mentionedIds(message, entries.map((e) => e.id)));
  for (const m of message.matchAll(/\("([^"]+)"\)/g)) {
    const snippet = m[1].replace(/…$/, '').trim();
    if (!snippet) continue;
    for (const e of entries) if (tidyText(e.text).startsWith(snippet)) out.add(e.id);
  }
  return [...out];
}

/**
 * Lines of a multi-line paste, list markers stripped ("- ", "• ", "3. ",
 * "[ ] ") — pasting a list from a document turns into one item per line.
 */
export function splitPastedLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*(?:[-*•▪◦·–]|\d{1,3}[.)]|\[[ xX]?\]|☐|☑|✓)\s+/, ''))
    .map(tidyText)
    .filter(Boolean);
}

// ── Scope list grouping ──────────────────────────────────────────────────────

export interface ScopeEntry {
  scope: TemplateScope;
  /** Items (checklists) or questions (intake). */
  count: number;
  /** An admin override is stored for this scope. */
  custom: boolean;
  /** Nothing stored on the server yet — a scope the admin just started. */
  isNew?: boolean;
  /** The open draft for this scope has unsaved changes. */
  dirty?: boolean;
}

export const SCOPE_GROUPS: { rank: 0 | 1 | 2 | 3; label: string }[] = [
  { rank: 0, label: 'General' },
  { rank: 1, label: 'Incident types' },
  { rank: 2, label: 'Properties' },
  { rank: 3, label: 'Type + Property' },
];

/**
 * Entries grouped General / Types / Properties / Type + Property, keeping the
 * given order inside each group (the server's canonical block order), and
 * filtered by every whitespace-separated word of `filter` (case-insensitive,
 * against `labelOf`). Groups with no entries left are omitted.
 */
export function groupScopeEntries(
  entries: ScopeEntry[], filter: string, labelOf: (s: TemplateScope) => string
): { rank: 0 | 1 | 2 | 3; label: string; entries: ScopeEntry[] }[] {
  const words = filter.toLowerCase().split(/\s+/).filter(Boolean);
  const match = (e: ScopeEntry) => {
    if (words.length === 0) return true;
    const hay = labelOf(e.scope).toLowerCase();
    return words.every((w) => hay.includes(w));
  };
  return SCOPE_GROUPS
    .map((g) => ({ ...g, entries: entries.filter((e) => scopeRank(e.scope) === g.rank && match(e)) }))
    .filter((g) => g.entries.length > 0);
}
