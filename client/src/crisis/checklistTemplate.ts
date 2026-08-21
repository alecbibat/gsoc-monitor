// ── ICS role checklists ───────────────────────────────────────────────────────
//
// Position checklists for the NIMS ICS command & general staff, down to the
// section chiefs. The template (roles, phases, item text) is defined in code
// here; the per-incident record is only the SPARSE state map on the incident
// (`Incident.checklists`): itemId → { checked, at, by }. Untouched items have
// no entry, so old incidents need no migration and template wording can evolve
// without touching stored data (state keys by stable item id).
//
// This module is value-imported by the public share page, so it must stay
// free of crisisStore (and any other heavy import) — see the share-bundle
// comment in CrisisShareView.tsx.

export type ChecklistPhaseId = 'immediate' | 'ongoing' | 'demob';

export interface ChecklistItemDef {
  /** Stable id — also the key in the incident's checklist state map. */
  id: string;
  text: string;
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

// Colors mirror the org-chart section colors (IC_COLOR etc. in crisisStore) —
// duplicated as literals so this module stays store-free.
const IC = '#fbbf24';
const CMD = '#f97316';
const OPS = '#ef4444';
const PLAN = '#3b82f6';
const LOG = '#eab308';
const FIN = '#22c55e';

// Builds phase entries with stable ids: `${roleId}-${imm|ong|dem}-${n}`.
const PHASE_KEY: Record<ChecklistPhaseId, string> = { immediate: 'imm', ongoing: 'ong', demob: 'dem' };
function phase(roleId: string, id: ChecklistPhaseId, texts: string[]) {
  return {
    id,
    items: texts.map((text, i) => ({ id: `${roleId}-${PHASE_KEY[id]}-${i + 1}`, text })),
  };
}

const VESSEL_GROUNDING_TEMPLATE: ChecklistTemplate = {
  id: 'vessel-grounding-v1',
  title: 'ICS Role Checklists',
  source: 'Vessel Grounding / Run Aground scenario template',
  roles: [
    {
      id: 'ic', code: 'IC', title: 'Incident Commander', color: IC,
      reportsTo: 'Company senior leadership / Unified Command',
      directs: 'All Command Staff & Section Chiefs',
      phases: [
        phase('ic', 'immediate', [
          'Confirm the report: vessel name, position, time of grounding, and that life-safety accounting is underway.',
          'Assume command and announce it; establish the Incident Command Post (ICP) location.',
          'Confirm the Master has sounded the appropriate alarm and mustered passengers and crew.',
          'Verify emergency notifications made: Coast Guard, VTS/port authority, and company DPA.',
          'Set initial incident priorities: life safety, incident stabilization, environmental/property protection.',
          'Conduct rapid size-up: casualties, flooding/stability, pollution, and vessel movement.',
        ]),
        phase('ic', 'ongoing', [
          'Activate and brief Command Staff (Safety, PIO, Liaison) and General Staff as the incident requires.',
          'Establish operational periods and approve the Incident Action Plan (IAP) objectives.',
          'Approve all resource requests and external assistance (tugs, salvage, SAR, medical).',
          'Approve public information releases before they are issued.',
          'Hold regular command briefings; maintain a common operating picture.',
          'Ensure a decision/communications log is maintained throughout.',
        ]),
        phase('ic', 'demob', [
          'Confirm all persons accounted for and life-safety objectives met before scaling down.',
          'Approve the demobilization plan and transfer of command if relieved (with full briefing).',
          'Ensure documentation is collected for the after-action review and investigation.',
        ]),
      ],
    },
    {
      id: 'safety', code: 'SO', title: 'Safety Officer', color: CMD,
      reportsTo: 'Incident Commander',
      directs: 'Assistant Safety Officers (as assigned)',
      phases: [
        phase('safety', 'immediate', [
          'Conduct an initial hazard assessment: flooding, list/heel, structural instability, fuel/oil, confined spaces.',
          'Confirm all responders are wearing appropriate PPE and life jackets in work areas.',
          'Identify and communicate any immediate life-threatening hazards to the IC — you may stop unsafe acts.',
          'Verify emergency egress routes and muster stations are clear and lit.',
        ]),
        phase('safety', 'ongoing', [
          'Develop the Safety Message / Site Safety Plan (ICS 208) for each operational period.',
          'Monitor damage-control and dewatering operations for safe practices.',
          'Track responder fatigue, weather/sea conditions, and slip/trip/fall hazards on listing decks.',
          "Coordinate with Operations on rescue/evacuation safety and with Liaison on external responders' safety.",
          'Investigate near-misses and injuries; recommend corrective actions to the IC.',
        ]),
        phase('safety', 'demob', [
          'Confirm hazards are mitigated before areas are reopened or personnel released.',
          'Document safety issues, injuries, and lessons learned for the after-action review.',
        ]),
      ],
    },
    {
      id: 'pio', code: 'PIO', title: 'Public Information Officer', color: CMD,
      reportsTo: 'Incident Commander',
      directs: 'Assistant PIOs / Joint Information Center staff',
      phases: [
        phase('pio', 'immediate', [
          'Confirm facts with the IC before any release; never speculate on cause or casualties.',
          'Draft a holding statement acknowledging the incident and the safety-first response.',
          'Coordinate on-board guest messaging with the Master (align with the PA scripts).',
          'Identify approved spokesperson(s); ensure no unauthorized statements are made.',
        ]),
        phase('pio', 'ongoing', [
          'Establish a Joint Information Center (JIC) if warranted; coordinate with agency PIOs via Liaison.',
          'Prepare IC-approved press releases and social/website updates on a set cadence.',
          'Monitor media and social channels; correct misinformation promptly.',
          "Coordinate messaging to guests' families and next-of-kin inquiries with company support lines.",
          'Log all releases, inquiries, and media contacts.',
        ]),
        phase('pio', 'demob', [
          'Issue an incident-resolution statement once approved by the IC.',
          'Compile a media/communications summary for the after-action review.',
        ]),
      ],
    },
    {
      id: 'liaison', code: 'LNO', title: 'Liaison Officer', color: CMD,
      reportsTo: 'Incident Commander',
      directs: 'Agency / Assisting & Cooperating representatives',
      phases: [
        phase('liaison', 'immediate', [
          'Identify assisting and cooperating agencies: Coast Guard, port/VTS, salvage, SAR, local EMS.',
          "Establish contact points and confirm each agency's capabilities and constraints.",
          'Brief arriving agency representatives on the incident status and ICS structure.',
        ]),
        phase('liaison', 'ongoing', [
          'Serve as the primary contact for all external agency representatives at the ICP.',
          'Relay agency resource offers and requirements to the IC and Operations/Logistics.',
          'Resolve inter-agency coordination issues and de-conflict overlapping authorities (e.g., NPS/USCG jurisdiction).',
          'Keep a roster of agency reps, contacts, and resources committed.',
          'Coordinate with the PIO on unified public messaging across agencies.',
        ]),
        phase('liaison', 'demob', [
          'Coordinate the orderly release of assisting agency resources with the IC and Logistics.',
          'Capture agency feedback and contacts for the after-action review.',
        ]),
      ],
    },
    {
      id: 'ops', code: 'OSC', title: 'Operations Section Chief', color: OPS,
      reportsTo: 'Incident Commander',
      directs: 'Branches, Divisions/Groups, Strike Teams & Task Forces',
      phases: [
        phase('ops', 'immediate', [
          'Obtain a situation brief from the IC and the Master; establish tactical priorities.',
          'Direct life-safety operations first: muster verification, injured-party care, evacuation readiness.',
          'Launch damage control: assess flooding, set boundaries, close watertight doors, begin dewatering.',
          'Account for all passengers and crew via muster teams; report gaps immediately.',
          'Assess whether the vessel is stable and secure or requires immediate evacuation.',
        ]),
        phase('ops', 'ongoing', [
          'Develop and execute the tactical work assignments (ICS 204) to meet IAP objectives.',
          'Organize resources into Branches/Divisions/Groups as the incident scales.',
          'Coordinate evacuation/transfer of guests to shore or assisting vessels if ordered.',
          'Direct pollution-containment actions in coordination with Safety and environmental resources.',
          'Provide regular status reports and resource needs to the IC and Planning.',
          'Coordinate salvage/tug operations once resources arrive.',
        ]),
        phase('ops', 'demob', [
          'Confirm the vessel is secured/refloated and all persons are safe before reducing tactical resources.',
          'Provide demobilization input to Planning and debrief tactical teams.',
        ]),
      ],
    },
    {
      id: 'planning', code: 'PSC', title: 'Planning Section Chief', color: PLAN,
      reportsTo: 'Incident Commander',
      directs: 'Resources, Situation, Documentation & Demobilization Units',
      phases: [
        phase('planning', 'immediate', [
          'Begin collecting and displaying situation information (position, stability, weather, tide, casualties).',
          'Start resource tracking: what is on scene, en route, and requested.',
          'Establish the incident documentation process and a master event log.',
        ]),
        phase('planning', 'ongoing', [
          'Facilitate the planning cycle and assemble the written IAP for each operational period.',
          'Maintain the common operating picture: situation status, maps, and vessel stability data.',
          'Track status and location of all resources (Resources Unit) and predict future needs.',
          'Prepare contingency plans (worsening flooding, weather change, full evacuation).',
          'Ensure all forms and records are collected by the Documentation Unit.',
        ]),
        phase('planning', 'demob', [
          'Develop the written demobilization plan and coordinate approval with the IC.',
          'Compile the complete incident record for the after-action review and investigation.',
        ]),
      ],
    },
    {
      id: 'logistics', code: 'LSC', title: 'Logistics Section Chief', color: LOG,
      reportsTo: 'Incident Commander',
      directs: 'Service & Support Branches (Comms, Medical, Food, Supply, Facilities, Ground)',
      phases: [
        phase('logistics', 'immediate', [
          'Establish incident communications (ICS 205): radios, channels, satellite/backup links.',
          'Identify immediate resource needs: pumps, life rafts, medical supplies, lighting, PPE.',
          'Arrange transport for shore-side resources and potential guest reception ashore.',
        ]),
        phase('logistics', 'ongoing', [
          'Order, receive, and track all resources requested by Operations and the IC.',
          'Provide medical support coordination (ICS 206) and staging for casualties.',
          'Arrange food, water, shelter, and welfare for responders and displaced guests.',
          'Maintain communications infrastructure and resolve equipment failures.',
          'Coordinate ground/marine transport and reception facilities ashore.',
        ]),
        phase('logistics', 'demob', [
          'Recover, account for, and return/replace equipment and supplies.',
          'Coordinate return transport of released resources and personnel.',
        ]),
      ],
    },
    {
      id: 'finance', code: 'FSC', title: 'Finance / Administration Section Chief', color: FIN,
      reportsTo: 'Incident Commander',
      directs: 'Time, Procurement, Compensation/Claims & Cost Units',
      phases: [
        phase('finance', 'immediate', [
          'Establish incident cost-tracking and a financial documentation process from the outset.',
          'Begin time-keeping for all responders and hired resources.',
          'Stand ready to authorize emergency procurement (tugs, salvage, supplies).',
        ]),
        phase('finance', 'ongoing', [
          'Track all incident costs, contracts, and resource expenditures.',
          'Process procurement requests and vendor agreements from Logistics.',
          'Document any injuries and initiate compensation/claims paperwork with HR/Risk.',
          'Coordinate with company legal/insurance and preserve records for potential liability.',
          'Provide cost projections and financial updates to the IC and Planning.',
        ]),
        phase('finance', 'demob', [
          'Finalize time records, contracts, and cost accounting for the incident.',
          'Compile the financial and claims package for the after-action review and insurers.',
        ]),
      ],
    },
  ],
};

// Per-incident-type checklists: key an entry by IncidentType id to give that
// type its own checklist; anything unlisted falls back to the default. Same
// change-it-here pattern as the intake questions (intakeTemplate.ts) — the IAP
// PDFs are runtime-managed instead (admin panel / iap_documents table).
export const CHECKLIST_TEMPLATES: {
  default: ChecklistTemplate;
  byType: Partial<Record<string, ChecklistTemplate>>;
} = {
  default: VESSEL_GROUNDING_TEMPLATE,
  byType: {},
};

export function checklistTemplateFor(incidentType: string): ChecklistTemplate {
  return CHECKLIST_TEMPLATES.byType[incidentType] ?? CHECKLIST_TEMPLATES.default;
}

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
