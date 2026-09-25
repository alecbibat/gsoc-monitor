// ── Built-in crisis-template defaults ────────────────────────────────────────
//
// What every scope holds until an admin overrides it (Admin → Checklists /
// Intake). Assembled from per-area content files; see helpers.ts for the id
// scheme and why published lines must never be reordered, and legacy.ts for
// the original vessel-grounding template's split into General + Maritime.

import type {
  ChecklistBlockItem, ChecklistRoleMeta, DefaultChecklistBlock, DefaultIntakeBlock, IntakeBlockGroup,
} from '../../crisisTemplates/types';
import { LEGACY_GENERAL_CHECKLIST, LEGACY_MARITIME_CHECKLIST, LEGACY_MARITIME_INTAKE } from './legacy';
import { GENERAL_CHECKLIST, GENERAL_INTAKE } from './general';
import { NATURAL_TYPE_CHECKLISTS, NATURAL_TYPE_INTAKE } from './types-natural';
import { FIRE_INFRA_TYPE_CHECKLISTS, FIRE_INFRA_TYPE_INTAKE } from './types-fire-infra';
import { SECURITY_TYPE_CHECKLISTS, SECURITY_TYPE_INTAKE } from './types-security';
import { MEDICAL_TYPE_CHECKLISTS, MEDICAL_TYPE_INTAKE } from './types-medical';
import { OPS_OTHER_TYPE_CHECKLISTS, OPS_OTHER_TYPE_INTAKE } from './types-ops-other';
import { PROPERTY_CHECKLISTS, PROPERTY_INTAKE } from './properties';

// Colors mirror the org chart's section colors (IC_COLOR … in crisisStore).
const IC = '#fbbf24';
const CMD = '#f97316';
const OPS = '#ef4444';
const PLAN = '#3b82f6';
const LOG = '#eab308';
const FIN = '#22c55e';

/** Checklist positions, in display order. Ids match the org chart's DEFAULT_ROLES. */
export const DEFAULT_CHECKLIST_ROLES: ChecklistRoleMeta[] = [
  { id: 'ic', code: 'IC', title: 'Incident Commander', color: IC,
    reportsTo: 'Company senior leadership / Unified Command', directs: 'All Command Staff & Section Chiefs' },
  { id: 'gsoc-support', code: 'GSOC', title: 'GSOC Support', color: CMD,
    reportsTo: 'Incident Commander (via the PIO for public information)',
    directs: 'GSOC operators on shift — monitoring, notifications, intelligence & records' },
  { id: 'safety', code: 'SO', title: 'Safety Officer', color: CMD,
    reportsTo: 'Incident Commander', directs: 'Assistant Safety Officers (as assigned)' },
  { id: 'pio', code: 'PIO', title: 'Public Information Officer', color: CMD,
    reportsTo: 'Incident Commander', directs: 'Assistant PIOs / Joint Information Center staff' },
  { id: 'liaison', code: 'LNO', title: 'Liaison Officer', color: CMD,
    reportsTo: 'Incident Commander', directs: 'Agency / Assisting & Cooperating representatives' },
  { id: 'ops', code: 'OSC', title: 'Operations Section Chief', color: OPS,
    reportsTo: 'Incident Commander', directs: 'Branches, Divisions/Groups, Strike Teams & Task Forces' },
  { id: 'planning', code: 'PSC', title: 'Planning Section Chief', color: PLAN,
    reportsTo: 'Incident Commander', directs: 'Resources, Situation, Documentation & Demobilization Units' },
  { id: 'logistics', code: 'LSC', title: 'Logistics Section Chief', color: LOG,
    reportsTo: 'Incident Commander', directs: 'Service & Support Branches (Comms, Medical, Food, Supply, Facilities, Ground)' },
  { id: 'finance', code: 'FSC', title: 'Finance / Administration Section Chief', color: FIN,
    reportsTo: 'Incident Commander', directs: 'Time, Procurement, Compensation/Claims & Cost Units' },
];

const TYPE_CHECKLISTS: Record<string, ChecklistBlockItem[]> = {
  ...NATURAL_TYPE_CHECKLISTS,
  ...FIRE_INFRA_TYPE_CHECKLISTS,
  ...SECURITY_TYPE_CHECKLISTS,
  ...MEDICAL_TYPE_CHECKLISTS,
  ...OPS_OTHER_TYPE_CHECKLISTS,
};
// The original vessel-grounding items lead the Maritime list (legacy ids).
TYPE_CHECKLISTS.maritime = [...LEGACY_MARITIME_CHECKLIST, ...(TYPE_CHECKLISTS.maritime ?? [])];

const TYPE_INTAKE: Record<string, IntakeBlockGroup[]> = {
  ...NATURAL_TYPE_INTAKE,
  ...FIRE_INFRA_TYPE_INTAKE,
  ...SECURITY_TYPE_INTAKE,
  ...MEDICAL_TYPE_INTAKE,
  ...OPS_OTHER_TYPE_INTAKE,
};
TYPE_INTAKE.maritime = [...LEGACY_MARITIME_INTAKE, ...(TYPE_INTAKE.maritime ?? [])];

export const DEFAULT_CHECKLIST_BLOCKS: DefaultChecklistBlock[] = [
  { scope: { incidentType: null, propertyId: null }, items: [...LEGACY_GENERAL_CHECKLIST, ...GENERAL_CHECKLIST] },
  ...Object.entries(TYPE_CHECKLISTS)
    .filter(([, items]) => items.length > 0)
    .map(([incidentType, items]) => ({ scope: { incidentType, propertyId: null }, items })),
  ...Object.entries(PROPERTY_CHECKLISTS)
    .filter(([, items]) => items.length > 0)
    .map(([propertyId, items]) => ({ scope: { incidentType: null, propertyId }, items })),
];

export const DEFAULT_INTAKE_BLOCKS: DefaultIntakeBlock[] = [
  { scope: { incidentType: null, propertyId: null }, groups: GENERAL_INTAKE },
  ...Object.entries(TYPE_INTAKE)
    .filter(([, groups]) => groups.length > 0)
    .map(([incidentType, groups]) => ({ scope: { incidentType, propertyId: null }, groups })),
  ...Object.entries(PROPERTY_INTAKE)
    .filter(([, groups]) => groups.length > 0)
    .map(([propertyId, groups]) => ({ scope: { incidentType: null, propertyId }, groups })),
];
