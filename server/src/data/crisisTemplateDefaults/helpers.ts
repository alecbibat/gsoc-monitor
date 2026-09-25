// Builders for the default crisis-template content. Ids are minted here from
// the scope prefix + role + phase + position, so the content files stay pure
// text. NEVER reorder or delete lines inside a published list — an id is the
// key of every incident's stored checklist/intake state, so shifting positions
// would silently re-label checked items. Append new lines at the end instead.

import type { ChecklistBlockItem, ChecklistPhaseId, IntakeBlockGroup, IntakeBlockQuestion } from '../../crisisTemplates/types';

/** Checklist role ids (match the org chart's builtin DEFAULT_ROLES ids). */
export type RoleId =
  | 'ic' | 'safety' | 'pio' | 'liaison' | 'gsoc-support'
  | 'ops' | 'planning' | 'logistics' | 'finance';

const PHASE_KEY: Record<ChecklistPhaseId, string> = { immediate: 'imm', ongoing: 'ong', demob: 'dem' };

export type RolePhaseTexts = Partial<Record<RoleId, Partial<Record<ChecklistPhaseId, string[]>>>>;

/**
 * Checklist items for one scope. Ids: `${prefix}-${roleId}-${imm|ong|dem}-${n}`
 * (e.g. `t-wildfire-ops-imm-2`, `p-yellowstone-safety-ong-1`, `g-gsoc-support-imm-3`).
 */
export function checklistItems(prefix: string, spec: RolePhaseTexts): ChecklistBlockItem[] {
  const out: ChecklistBlockItem[] = [];
  for (const [roleId, phases] of Object.entries(spec) as [RoleId, Partial<Record<ChecklistPhaseId, string[]>>][]) {
    for (const phase of ['immediate', 'ongoing', 'demob'] as ChecklistPhaseId[]) {
      (phases[phase] ?? []).forEach((text, i) => {
        out.push({ id: `${prefix}-${roleId}-${PHASE_KEY[phase]}-${i + 1}`, roleId, phase, text });
      });
    }
  }
  return out;
}

/** One intake group. Question ids: `${groupId}-${n}` (group ids are globally unique). */
export function intakeGroup(id: string, label: string, texts: string[]): IntakeBlockGroup {
  return { id, label, questions: texts.map((text, i) => ({ id: `${id}-${i + 1}`, text })) };
}

/**
 * An intake group that embeds existing questions (legacy ids, kept verbatim)
 * among new ones. New questions are minted `${id}-${k}`, k counting only the
 * new strings — so adding a legacy question later never shifts a minted id.
 */
export function intakeGroupMixed(id: string, label: string, entries: (string | IntakeBlockQuestion)[]): IntakeBlockGroup {
  let k = 0;
  return {
    id,
    label,
    questions: entries.map((e) => (typeof e === 'string' ? { id: `${id}-${++k}`, text: e } : e)),
  };
}
