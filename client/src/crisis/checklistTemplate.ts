// ── ICS role checklists ───────────────────────────────────────────────────────
//
// Position checklists for the NIMS ICS command & general staff (plus GSOC
// support), down to the section chiefs. The CONTENT is no longer defined in
// code: an admin edits it per incident type / property (Admin → Checklists),
// the server owns the effective config, and templates/model.ts resolves the
// ChecklistTemplate one incident sees. This module keeps the shapes that
// resolution produces and the helpers every consumer shares.
//
// The per-incident record is only the SPARSE state map on the incident
// (`Incident.checklists`): itemId → { checked, at, by }. Untouched items have
// no entry, so old incidents need no migration and template wording can evolve
// without touching stored data (state keys by stable item id).
//
// This module is value-imported by the public share page, so it must stay
// free of crisisStore (and any other heavy import) — see the share-bundle
// comment in CrisisShareView.tsx.

import type { TemplateScope } from './templates/model';

export type ChecklistPhaseId = 'immediate' | 'ongoing' | 'demob';

export interface ChecklistItemDef {
  /** Stable id — also the key in the incident's checklist state map. */
  id: string;
  text: string;
  /** Which template scope contributed the item (set by resolveChecklist). */
  scope?: TemplateScope;
}

export interface ChecklistRoleDef {
  /** Matches the builtin ICS role ids in DEFAULT_ROLES (crisisStore). */
  id: string;
  code: string;
  title: string;
  /** Section color, matching the org chart's role colors. */
  color: string;
  reportsTo: string;
  directs: string;
  phases: { id: ChecklistPhaseId; items: ChecklistItemDef[] }[];
}

export interface ChecklistTemplate {
  id: string;
  title: string;
  /** Where the item text came from, shown as a small credit line. */
  source: string;
  roles: ChecklistRoleDef[];
}

/** One item's live state. Absent from the map = never touched. */
export interface ChecklistItemState {
  checked: boolean;
  /** ISO timestamp of the LAST check/uncheck (server-stamped on sync). */
  at: string;
  /** Display name of whoever toggled it, when known. */
  by?: string;
}

export type ChecklistStateMap = Record<string, ChecklistItemState>;

export const CHECKLIST_PHASES: { id: ChecklistPhaseId; label: string }[] = [
  { id: 'immediate', label: 'Immediate — first minutes' },
  { id: 'ongoing', label: 'Ongoing — operational period' },
  { id: 'demob', label: 'Stabilization / Demobilization' },
];

/** Type guard for state maps arriving in share snapshots (untrusted JSON). */
export function isChecklistStateMap(v: unknown): v is ChecklistStateMap {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  return Object.values(v as Record<string, unknown>).every(
    (s) =>
      !!s && typeof s === 'object' && !Array.isArray(s) &&
      typeof (s as ChecklistItemState).checked === 'boolean' &&
      typeof (s as ChecklistItemState).at === 'string'
  );
}

/**
 * Fold a toggle endpoint's RESPONSE map into the checklist state already on
 * screen. The server answers only after its share-snapshot fanout, so SSE
 * upserts carrying LATER commits (a teammate's toggle) can land first; a
 * wholesale replace would revert them. Per item the later server stamp wins
 * (ties / unparsable stamps -> the response). Items in `keepLocal` (a toggle of
 * theirs still in flight) keep the local entry; `ownItemId` (the item this
 * response answers) always takes the server entry, because its local entry
 * carries an optimistic client-clock stamp. Local-only entries are kept: the
 * server never removes items, so they can only come from a newer echo.
 */
export function foldChecklistResponse(
  remote: ChecklistStateMap,
  local: ChecklistStateMap,
  keepLocal: ReadonlySet<string> = new Set(),
  ownItemId: string | null = null
): ChecklistStateMap {
  const merged: ChecklistStateMap = { ...local };
  for (const [id, r] of Object.entries(remote)) {
    const l = local[id];
    if (l && keepLocal.has(id)) continue;
    if (!l || id === ownItemId || !(Date.parse(l.at) > Date.parse(r.at))) merged[id] = r;
  }
  return merged;
}

/** Checked/total across one role, for the progress chips. */
export function roleProgress(role: ChecklistRoleDef, state: ChecklistStateMap): { done: number; total: number } {
  let done = 0;
  let total = 0;
  for (const ph of role.phases) {
    for (const item of ph.items) {
      total += 1;
      if (state[item.id]?.checked) done += 1;
    }
  }
  return { done, total };
}

/** Checked/total across every role, plus how many roles are fully done. */
export function checklistProgress(
  template: ChecklistTemplate,
  state: ChecklistStateMap
): { done: number; total: number; rolesDone: number } {
  let done = 0;
  let total = 0;
  let rolesDone = 0;
  for (const role of template.roles) {
    const p = roleProgress(role, state);
    done += p.done;
    total += p.total;
    if (p.total > 0 && p.done === p.total) rolesDone += 1;
  }
  return { done, total, rolesDone };
}

/** The slice of an org-chart assignment the role preference needs. */
export interface RoleHolder {
  roleId: string;
  name: string;
  email?: string;
  endedAt?: string;
}

/**
 * Which role's checklist to open first for this viewer: the role they hold on
 * the incident's org chart (an ACTIVE assignment under their name or email —
 * builtin org-chart role ids equal checklist role ids), else the role they
 * last worked, else nothing (the board falls back to its first role). Only
 * roles the template actually has are returned — a custom org-chart role or a
 * role with no items for this incident can't be opened.
 */
export function preferredChecklistRole(
  template: ChecklistTemplate,
  opts: { assignments?: readonly RoleHolder[]; userName?: string | null; userEmail?: string | null; remembered?: string | null }
): string | undefined {
  const has = (id: string | null | undefined): id is string => !!id && template.roles.some((r) => r.id === id);
  const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();
  const name = norm(opts.userName);
  const email = norm(opts.userEmail);
  if (name || email) {
    const held = (opts.assignments ?? []).find(
      (a) => !a.endedAt && has(a.roleId) &&
        ((name !== '' && norm(a.name) === name) || (email !== '' && norm(a.email) === email))
    );
    if (held) return held.roleId;
  }
  return has(opts.remembered) ? opts.remembered : undefined;
}
