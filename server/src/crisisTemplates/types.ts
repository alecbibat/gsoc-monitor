// ── Crisis templates — server-side model ─────────────────────────────────────
//
// Mirror of client/src/crisis/templates/model.ts (types + scope helpers only;
// resolution/merging is client-side). KEEP IN SYNC with that file.
//
// The effective config is the built-in defaults (data/crisisTemplateDefaults)
// overlaid with admin overrides stored per scope in crisis_template_overrides
// (see store.ts). An override REPLACES the default block for its scope — it is
// not merged item-by-item — so "reset to default" is just deleting the row.

export type ChecklistPhaseId = 'immediate' | 'ongoing' | 'demob';
export const CHECKLIST_PHASE_IDS: ReadonlySet<string> = new Set(['immediate', 'ongoing', 'demob']);

/** Ids of items, questions, groups, roles and scope parts — and the checklist
 *  toggle route's item-id pattern (checklist.ts), which these ids must pass. */
export const TEMPLATE_ID_RE = /^[a-z][a-z0-9-]{0,63}$/;

export interface TemplateScope {
  incidentType: string | null;
  propertyId: string | null;
}

export const GENERAL_SCOPE: TemplateScope = { incidentType: null, propertyId: null };

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

export function scopeApplies(s: TemplateScope, incidentType: string | null, propertyId: string | null): boolean {
  return (s.incidentType === null || s.incidentType === incidentType) &&
    (s.propertyId === null || s.propertyId === propertyId);
}

export interface BlockMeta {
  custom: boolean;
  revision: number;
  updatedAt: string | null;
  updatedBy: string | null;
}

export interface ChecklistRoleMeta {
  id: string;
  code: string;
  title: string;
  color: string;
  reportsTo: string;
  directs: string;
}

export interface ChecklistRolesDoc extends BlockMeta {
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
  retiredChecklistItems?: Record<string, RetiredChecklistItem>;
  retiredIntakeQuestions?: Record<string, RetiredIntakeQuestion>;
}

/** A default block before provenance is attached (data/crisisTemplateDefaults). */
export interface DefaultChecklistBlock {
  scope: TemplateScope;
  items: ChecklistBlockItem[];
}

export interface DefaultIntakeBlock {
  scope: TemplateScope;
  groups: IntakeBlockGroup[];
}
