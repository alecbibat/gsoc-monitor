import { create } from 'zustand';
import type { ShareLiveLayerId } from './shareLiveLayers';
import { normalizeIncidentFields, incidentStatusDef, type IncidentStatus, type IncidentType } from './taxonomy';
import type { ChecklistStateMap } from './checklistTemplate';
import type { IntakeAnswers } from './intakeTemplate';
import { incidentShipMmsis, shipListText } from './incidentShips';
import { useAuthStore } from '../auth/authStore';

// ── Domain types ─────────────────────────────────────────────────────────────

// The incident-type taxonomy and state model live in taxonomy.ts (the single
// source of truth for ids, labels, colors and lifecycle). Re-exported here so
// existing importers keep working.
export type { IncidentStatus, IncidentType } from './taxonomy';
export type CrisisTab = 'situation-report' | 'checklists' | 'intake' | 'iap';
export type ActionEntryType = 'action' | 'event' | 'info';

// Live save status, surfaced in the incident header. Transient UI state only —
// it is never persisted or pushed to the server.
export type SyncState = 'idle' | 'saving' | 'saved' | 'error';

export interface IcsRole {
  id: string;
  title: string;
  abbrev?: string;
  parentId: string | null;
  color: string;
  isCommandStaff: boolean;
  isSupport: boolean;
  order: number;
  builtin: boolean;
}

// Contact details captured for a person — their professional title/rank and how
// to reach them. Shared by the personnel pool and individual role assignments.
export interface PersonnelDetails {
  title?: string;
  phone?: string;
  email?: string;
}

export interface PersonnelMember extends PersonnelDetails {
  id: string;
  name: string;
}

export interface PersonnelAssignment extends PersonnelDetails {
  id: string;
  roleId: string;
  // Link back to the personnel-pool member this assignment came from, when known.
  // Identity is by id (not name) so two people who share a name don't collide and
  // a later rename can't silently break the link. Manual name-only assignments
  // leave this undefined and fall back to case-insensitive name matching.
  personnelId?: string;
  name: string;
  startedAt: string;
  endedAt?: string;
}

// Auto-generated log entries: the discriminant for entries the app writes on
// the operator's behalf when incident state changes. These are what the AAR's
// ICS-progression graphic and response metrics will be computed from, so they
// carry a machine-readable kind + meta payload alongside the human sentence.
export type SystemEventKind =
  | 'created'
  | 'status-change'
  | 'complexity-change'
  | 'assignment'
  | 'assignment-ended'
  | 'role-added'
  | 'role-removed'
  | 'role-moved'
  | 'share-created'
  | 'share-revoked'
  | 'stood-down'
  | 'reopened'
  | 'vessels-change';

export interface ActionLogEntry {
  id: string;
  timestamp: string;
  description: string;
  attachmentName?: string;
  attachmentData?: string;  // Cloudinary URL (legacy entries: base64 ≤1200px JPEG)
  entryType: ActionEntryType;
  /** Display name of whoever created the entry (from the signed-in user). */
  actor?: string;
  /** Present on auto-generated entries; absent on hand-written ones. */
  system?: SystemEventKind;
  /** Structured payload for system entries (roleId, from/to, token label, …). */
  meta?: Record<string, string>;
}

/** What an entry reads as in the UI: the operator types, plus `system`. */
export type DisplayEntryType = ActionEntryType | 'system';

/**
 * How an entry reads wherever a type is displayed, filtered or counted.
 * Auto-generated entries narrate state changes, not operator events, so they
 * class as `system` — regardless of the stored entryType (`event` on every
 * system entry ever minted, including those in published share snapshots,
 * which outlive deploys). Entries published before entry types existed have
 * no entryType at all and read as `action`.
 */
export const entryTypeOf = (e: ActionLogEntry): DisplayEntryType =>
  e.system ? 'system' : e.entryType ?? 'action';

// ICS complexity type — Type 5 (initial/minor) escalating to Type 1. Optional:
// unset means nobody has made the call yet.
export type ComplexityType = 'type-5' | 'type-4' | 'type-3' | 'type-2' | 'type-1';
export const COMPLEXITY_TYPES: { id: ComplexityType; label: string }[] = [
  { id: 'type-5', label: 'Type 5' },
  { id: 'type-4', label: 'Type 4' },
  { id: 'type-3', label: 'Type 3' },
  { id: 'type-2', label: 'Type 2' },
  { id: 'type-1', label: 'Type 1' },
];

export type DrawLayerType =
  | 'fire-perimeter' | 'burned-area' | 'flood-zone'
  | 'staging-area' | 'exclusion-zone' | 'search-grid' | 'other';

export type DrawGeometry = 'polygon' | 'line' | 'point';

export interface DrawLayerPoint {
  lat: number;
  lon: number;
}

export interface DrawLayer {
  id: string;
  name: string;
  type: DrawLayerType;
  geometry: DrawGeometry;
  // Line-only: render the line with an arrowhead pointing from the first
  // position toward the last (evacuation routes, ingress/egress, flow).
  // Optional so incidents persisted before this feature — and older clients
  // reading newer data — degrade to a plain line.
  directional?: boolean;
  color: string;
  visible: boolean;
  positions: DrawLayerPoint[];
  thumbnail?: string;  // Cloudinary URL of the map snapshot captured when drawing finishes
  createdAt: string;
}

/** Human label for a layer's shape ("area", "line", "directional line", "point"). */
export function geometryLabel(layer: Pick<DrawLayer, 'geometry' | 'directional'>): string {
  if (layer.geometry === 'line' && layer.directional) return 'directional line';
  return layer.geometry;
}

export interface ShareLink {
  token: string;
  url: string;
  createdAt: string;
  active: boolean;
  // Viewer password generated by the server at publish time. Optional because
  // links created before the password gate existed have none (and stay open).
  password?: string;
  /** Audience name ("Executives", "Property staff") — W4 named links. */
  label?: string;
  /** Server-set expiry; renewable. Absent on links created before W4. */
  expiresAt?: string;
}

// One incident — a fully self-contained situation report.
export interface Incident {
  id: string;
  createdAt: string;
  incidentName: string;
  incidentDatetime: string;
  incidentEndDatetime: string;
  incidentLocation: string;
  incidentType: IncidentType;
  incidentStatus: IncidentStatus;
  // ICS complexity call, when made. Changes are logged as system events so the
  // AAR can render the Type 5 → 4 → 3 escalation band.
  complexityType?: ComplexityType | null;
  executiveSummary: string;
  roles: IcsRole[];
  assignments: PersonnelAssignment[];
  personnel: PersonnelMember[];
  actionLog: ActionLogEntry[];
  drawLayers: DrawLayer[];
  // Live data layers prescribed for this incident's public share-link map
  // (globe feeds like hurricanes/wildfires — not the hand-drawn layers).
  // Optional because incidents persisted before this feature lack the key.
  liveLayers?: ShareLiveLayerId[];
  // Primary property group (from LOCATION_GROUPS) — set in Incident
  // Information. Drives the pins on the share map, the share page's Property
  // Watch scope, and the viewer's "Zoom to Incident" target.
  locationGroupId?: string | null;
  // Additional property groups whose pins/watch info also appear on the share
  // link, chosen in the Live Data Layers section.
  extraLocationGroups?: string[];
  // Windstar vessels involved in this incident, by MMSI — any number of them,
  // chosen in Incident Information. Identities only: positions are always read
  // live from the AIS feed, never frozen into the record. Independent of
  // locationGroupId so a shore-side incident can still involve ships (and the
  // fleet itself can be the incident's property — see SHIP_GROUP_ID).
  shipMmsis?: string[];
  // ICS role checklist state: SPARSE map of template item id → last toggle
  // ({ checked, at, by }); untouched items have no entry. Like the action log
  // it is EXCLUDED from blob sync (syncCanon/IncidentSync) — every toggle goes
  // through the per-item endpoints so concurrent responders (and share-link
  // viewers) can't overwrite each other. Optional because incidents persisted
  // before this feature lack the key.
  checklists?: ChecklistStateMap;
  // Intake questionnaire answers: SPARSE map of question id → answer text.
  // Ordinary typed content — rides the incident blob like executiveSummary.
  // Optional because incidents persisted before this feature lack the key.
  intake?: IntakeAnswers;
  shareToken: string | null;  // legacy — kept for backwards compat with persisted data
  shareLinks: ShareLink[];    // all share links ever created for this incident
  archivedAt?: string | null; // set when the incident is stood down; null/absent = active
  closedBy?: string | null;         // who stood the incident down
  standDownReason?: string | null;  // why, captured by the stand-down checklist
  /** After-action review content — editable AFTER stand-down (see updateAar). */
  aar?: IncidentAar;
}

// ── After-action report (Track 6) ────────────────────────────────────────────

export interface AarCorrectiveAction {
  id: string;
  text: string;
  owner?: string;
  due?: string;   // ISO date
  done?: boolean;
}

/**
 * The standard four-question AAR structure plus the corrective-action tracker.
 * This is post-incident work product: it is deliberately EXEMPT from the
 * archived-incident freeze (the whole point is to write it after stand-down),
 * and it is never included in share snapshots (internal, not stakeholder-facing).
 */
export interface IncidentAar {
  expected?: string;   // What was expected / planned to happen?
  happened?: string;   // What actually happened?
  wentWell?: string;   // What went well, and why?
  improve?: string;    // What can be improved, and how?
  correctiveActions?: AarCorrectiveAction[];
}

// Public shape sent to / received from the share endpoint
export interface CrisisPublicState {
  incidentName: string;
  incidentDatetime: string;
  incidentEndDatetime: string;
  incidentLocation: string;
  incidentType: IncidentType;
  incidentStatus: IncidentStatus;
  complexityType?: ComplexityType | null;
  executiveSummary: string;
  roles: IcsRole[];
  assignments: PersonnelAssignment[];
  actionLog: ActionLogEntry[];
  drawLayers: DrawLayer[];
  // Optional: snapshots published before this feature existed lack the key.
  liveLayers?: ShareLiveLayerId[];
  locationGroupId?: string | null;
  extraLocationGroups?: string[];
  shipMmsis?: string[];
  // ICS checklist state + intake answers (optional: pre-feature snapshots lack
  // them). Server-side, the checklist key on a snapshot is owned by the toggle
  // endpoints — the PATCH shallow-merge deliberately skips it (crisis.ts).
  checklists?: ChecklistStateMap;
  intake?: IntakeAnswers;
  publishedAt: string;
  lastUpdated: string;
}

// ── Default ICS/NIMS structure ───────────────────────────────────────────────

export const IC_COLOR   = '#fbbf24';
export const CMD_COLOR  = '#f97316';
export const OPS_COLOR  = '#ef4444';
export const PLAN_COLOR = '#3b82f6';
export const LOG_COLOR  = '#eab308';
export const FIN_COLOR  = '#22c55e';

export const DEFAULT_ROLES: IcsRole[] = [
  { id: 'ic',             title: 'Incident Commander',              abbrev: 'IC',   parentId: null,        color: IC_COLOR,   isCommandStaff: false, isSupport: false, order: 0, builtin: true },
  { id: 'safety',         title: 'Safety Officer',                  abbrev: 'SO',   parentId: 'ic',        color: CMD_COLOR,  isCommandStaff: true,  isSupport: false, order: 0, builtin: true },
  { id: 'pio',            title: 'Public Information Officer',      abbrev: 'PIO',  parentId: 'ic',        color: CMD_COLOR,  isCommandStaff: true,  isSupport: false, order: 1, builtin: true },
  { id: 'gsoc-support',  title: 'GSOC Support',                    abbrev: 'GSOC', parentId: 'pio',       color: CMD_COLOR,  isCommandStaff: false, isSupport: true,  order: 0, builtin: true },
  { id: 'liaison',        title: 'Liaison Officer',                 abbrev: 'LO',   parentId: 'ic',        color: CMD_COLOR,  isCommandStaff: true,  isSupport: false, order: 2, builtin: true },
  { id: 'ops',            title: 'Operations Section Chief',        abbrev: 'OSC',  parentId: 'ic',        color: OPS_COLOR,  isCommandStaff: false, isSupport: false, order: 3, builtin: true },
  { id: 'planning',       title: 'Planning Section Chief',          abbrev: 'PSC',  parentId: 'ic',        color: PLAN_COLOR, isCommandStaff: false, isSupport: false, order: 4, builtin: true },
  { id: 'logistics',      title: 'Logistics Section Chief',         abbrev: 'LSC',  parentId: 'ic',        color: LOG_COLOR,  isCommandStaff: false, isSupport: false, order: 5, builtin: true },
  { id: 'finance',        title: 'Finance/Admin Section Chief',     abbrev: 'FSC',  parentId: 'ic',        color: FIN_COLOR,  isCommandStaff: false, isSupport: false, order: 6, builtin: true },
  { id: 'ops-branch',     title: 'Branch Director',                 abbrev: 'BD',   parentId: 'ops',       color: OPS_COLOR,  isCommandStaff: false, isSupport: false, order: 0, builtin: true },
  { id: 'ops-division',   title: 'Division/Group Supervisor',       abbrev: 'DIVS', parentId: 'ops',       color: OPS_COLOR,  isCommandStaff: false, isSupport: false, order: 1, builtin: true },
  { id: 'plan-resources', title: 'Resources Unit Leader',           abbrev: 'RESL', parentId: 'planning',  color: PLAN_COLOR, isCommandStaff: false, isSupport: false, order: 0, builtin: true },
  { id: 'plan-situation', title: 'Situation Unit Leader',           abbrev: 'SITL', parentId: 'planning',  color: PLAN_COLOR, isCommandStaff: false, isSupport: false, order: 1, builtin: true },
  { id: 'plan-docs',      title: 'Documentation Unit Leader',       abbrev: 'DOCL', parentId: 'planning',  color: PLAN_COLOR, isCommandStaff: false, isSupport: false, order: 2, builtin: true },
  { id: 'plan-demob',     title: 'Demob. Unit Leader',              abbrev: 'DMBL', parentId: 'planning',  color: PLAN_COLOR, isCommandStaff: false, isSupport: false, order: 3, builtin: true },
  { id: 'log-support',    title: 'Support Branch Director',         abbrev: 'SUBD', parentId: 'logistics', color: LOG_COLOR,  isCommandStaff: false, isSupport: false, order: 0, builtin: true },
  { id: 'log-service',    title: 'Service Branch Director',         abbrev: 'SEBD', parentId: 'logistics', color: LOG_COLOR,  isCommandStaff: false, isSupport: false, order: 1, builtin: true },
  { id: 'fin-time',       title: 'Time Unit Leader',                abbrev: 'TIME', parentId: 'finance',   color: FIN_COLOR,  isCommandStaff: false, isSupport: false, order: 0, builtin: true },
  { id: 'fin-proc',       title: 'Procurement Unit Leader',         abbrev: 'PROC', parentId: 'finance',   color: FIN_COLOR,  isCommandStaff: false, isSupport: false, order: 1, builtin: true },
  { id: 'fin-comp',       title: 'Compensation/Claims Unit Leader', abbrev: 'COMP', parentId: 'finance',   color: FIN_COLOR,  isCommandStaff: false, isSupport: false, order: 2, builtin: true },
  { id: 'fin-cost',       title: 'Cost Unit Leader',                abbrev: 'COST', parentId: 'finance',   color: FIN_COLOR,  isCommandStaff: false, isSupport: false, order: 3, builtin: true },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

// Globally-unique IDs. Incidents are a shared workspace where several clients
// mint IDs independently, so a per-tab counter could collide and make two
// incidents (or roles/log entries) clobber each other on upsert. randomUUID is
// collision-free across clients. Falls back to a random string on the rare
// browser without crypto.randomUUID (non-secure context).
const uid = () =>
  `c-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;

// Who to attribute a log entry to — the signed-in user's display name.
const currentActor = (): string | undefined =>
  useAuthStore.getState().user?.name || undefined;

// Auto-generated log entry for a state change. Prepended like manual entries;
// the log sync layer pushes it through the append-only endpoint like any other.
function sysEntry(
  system: SystemEventKind,
  description: string,
  meta?: Record<string, string>
): ActionLogEntry {
  return {
    id: uid(),
    timestamp: new Date().toISOString(),
    description,
    entryType: 'event',
    actor: currentActor(),
    system,
    ...(meta ? { meta } : {}),
  };
}

/**
 * Where moveRole puts a role: under `parentId` (null = top level), in front of
 * `beforeRoleId` within its new sibling group — absent, null or not in that
 * group means at the end. `isCommandStaff` picks the row; see moveRole for the
 * default.
 */
export interface MoveRoleTarget {
  parentId: string | null;
  beforeRoleId?: string | null;
  isCommandStaff?: boolean;
}

/** A role's id plus the ids of everything beneath it. */
export function roleSubtreeIds(roles: readonly IcsRole[], rootId: string): Set<string> {
  // Breadth-first over parent links. The set doubles as the visited guard, so
  // corrupt data with a parent cycle can't spin forever.
  const ids = new Set<string>([rootId]);
  const queue = [rootId];
  while (queue.length) {
    const pid = queue.shift()!;
    for (const r of roles) {
      if (r.parentId === pid && !ids.has(r.id)) {
        ids.add(r.id);
        queue.push(r.id);
      }
    }
  }
  return ids;
}

/**
 * The ordered row a role sits in: same parent AND same command-staff flag.
 * The chart draws a parent's advisory command staff and its general staff as
 * separate rows, so each row numbers its own `order` from 0. The sort is
 * stable on ties (older data can repeat an order), matching the chart's.
 */
export function roleSiblings(roles: readonly IcsRole[], parentId: string | null, isCommandStaff: boolean): IcsRole[] {
  return roles
    .filter((r) => r.parentId === parentId && !!r.isCommandStaff === isCommandStaff)
    .sort((a, b) => a.order - b.order);
}

/**
 * Whether assignment `a` is held by the person named `name` / `personnelId`:
 * by pool id when both sides have one (so namesakes don't collide and a rename
 * can't break the link), else by case-insensitive name for manual, pool-less
 * entries. The one identity rule for assignRole and the org chart.
 */
export function isSamePerson(
  a: Pick<PersonnelAssignment, 'name' | 'personnelId'>,
  name: string,
  personnelId?: string,
): boolean {
  return personnelId && a.personnelId
    ? a.personnelId === personnelId
    : a.name.trim().toLowerCase() === name.trim().toLowerCase();
}

/** Open assignments on a role or anywhere beneath it — what blocks removeRole. */
export function activeAssignmentsInSubtree(
  roles: readonly IcsRole[],
  assignments: readonly PersonnelAssignment[],
  roleId: string,
): PersonnelAssignment[] {
  const ids = roleSubtreeIds(roles, roleId);
  return assignments.filter((a) => !a.endedAt && ids.has(a.roleId));
}

/**
 * A role's title, including roles since removed: assignments outlive the roles
 * they were on (they're the AAR's staffing record), and every assignment's log
 * entry recorded the title it was made under. The log is newest-first, so a
 * renamed role reads by its latest title. Undefined when neither knows it.
 */
export function assignmentRoleTitle(
  inc: Pick<Incident, 'roles' | 'actionLog'>,
  roleId: string,
): string | undefined {
  return (
    inc.roles.find((r) => r.id === roleId)?.title ??
    inc.actionLog.find((e) => e.system === 'assignment' && e.meta?.roleId === roleId)?.meta?.roleTitle
  );
}

const COMPLEXITY_LABEL = (c: ComplexityType | null | undefined) =>
  COMPLEXITY_TYPES.find((t) => t.id === c)?.label ?? 'unset';

/**
 * Set the incident's vessel list, normalized (deduped, fleet order, unknown
 * MMSIs dropped) and logged.
 *
 * Which vessels are in play is an operational fact the AAR has to be able to
 * reconstruct — "when did Wind Surf come into this?" — so each change lands in
 * the action log as a system event naming what was added or removed. A patch
 * that resolves to the same list logs nothing.
 */
function withVessels(inc: Incident, next: readonly string[]): Incident {
  const before = incidentShipMmsis(inc.shipMmsis);
  const after = incidentShipMmsis(next);
  if (before.join(',') === after.join(',')) return inc;
  const added = after.filter((m) => !before.includes(m));
  const removed = before.filter((m) => !after.includes(m));
  const parts = [
    added.length ? `added ${shipListText(added)}` : '',
    removed.length ? `removed ${shipListText(removed)}` : '',
  ].filter(Boolean);
  return {
    ...inc,
    shipMmsis: after,
    actionLog: [
      sysEntry(
        'vessels-change',
        `Vessels ${parts.join(', ')} — now ${after.length ? shipListText(after, 7) : 'none'}`,
        {
          ...(added.length ? { added: shipListText(added, 7) } : {}),
          ...(removed.length ? { removed: shipListText(removed, 7) } : {}),
          count: String(after.length),
        }
      ),
      ...inc.actionLog,
    ],
  };
}

function newIncident(type: IncidentType = 'other'): Incident {
  return {
    id: uid(),
    createdAt: new Date().toISOString(),
    incidentName: '',
    incidentDatetime: '',
    incidentEndDatetime: '',
    incidentLocation: '',
    incidentType: type,
    incidentStatus: 'active',
    complexityType: null,
    executiveSummary: '',
    roles: DEFAULT_ROLES,
    assignments: [],
    personnel: [],
    actionLog: [sysEntry('created', 'Incident created')],
    drawLayers: [],
    liveLayers: [],
    locationGroupId: null,
    extraLocationGroups: [],
    shipMmsis: [],
    checklists: {},
    intake: {},
    shareToken: null,
    shareLinks: [],
  };
}

// ── Store ────────────────────────────────────────────────────────────────────

interface CrisisFields {
  incidentName: string;
  incidentDatetime: string;
  incidentEndDatetime: string;
  incidentLocation: string;
  incidentType: IncidentType;
  incidentStatus: IncidentStatus;
  complexityType: ComplexityType | null;
  executiveSummary: string;
  locationGroupId: string | null;
}

export interface PickedLayer {
  layerId: string;
  x: number;
  y: number;
}

interface CrisisState {
  open: boolean;
  activeIncidentId: string | null;
  activeTab: CrisisTab;
  activeDrawLayerId: string | null;
  pickedLayer: PickedLayer | null;
  incidents: Incident[];
  syncState: SyncState;

  // Overlay
  toggle: () => void;
  close: () => void;
  setOpen: (open: boolean) => void;
  setTab: (tab: CrisisTab) => void;

  // Incident lifecycle
  createIncident: (type?: IncidentType) => string;
  openIncident: (id: string) => void;
  backToList: () => void;
  removeIncident: (id: string) => void;
  standDownIncident: (id: string, reason?: string) => void;
  reopenIncident: (id: string) => void;

  // Active-incident field updates
  update: (patch: Partial<CrisisFields>) => void;
  setShareToken: (token: string | null) => void;
  addShareLink: (token: string, url: string, password?: string, label?: string, expiresAt?: string, incidentId?: string) => void;
  deactivateShareLink: (token: string, incidentId?: string) => void;
  renewShareLink: (token: string, expiresAt: string, incidentId?: string) => void;

  // Roles
  addRole: (role: Omit<IcsRole, 'id' | 'builtin'>) => void;
  updateRole: (id: string, patch: Partial<Omit<IcsRole, 'id' | 'builtin'>>) => void;
  removeRole: (id: string) => void;
  moveRole: (roleId: string, target: MoveRoleTarget) => void;
  restoreBuiltinRole: (roleId: string) => void;
  resetRoles: () => void;

  // Personnel pool
  addPersonnelMember: (name: string, details?: PersonnelDetails) => void;
  removePersonnelMember: (id: string) => void;

  // Assignments
  assignRole: (roleId: string, name: string, details?: PersonnelDetails, personnelId?: string) => void;
  endAssignment: (id: string) => void;

  // Action log
  addActionEntry: (type?: ActionEntryType) => string;
  updateActionEntry: (
    id: string,
    patch: Partial<Pick<ActionLogEntry, 'description' | 'attachmentName' | 'attachmentData' | 'entryType'>>,
    incidentId?: string,
  ) => void;
  removeActionEntry: (id: string) => void;

  // ICS checklists — optimistic local toggle (the sync layer posts it through
  // the per-item endpoint; see checklistSync.ts) + server-authoritative apply.
  toggleChecklistItem: (itemId: string, checked: boolean) => void;
  applyChecklistState: (incidentId: string, checklists: ChecklistStateMap) => void;

  // Intake questionnaire
  setIntakeAnswer: (questionId: string, answer: string) => void;

  // AAR — keyed by explicit incident id (the report opens from the archive
  // list, where no incident is "active"), and NOT gated on archived state.
  updateAar: (incidentId: string, patch: Partial<Omit<IncidentAar, 'correctiveActions'>>) => void;
  addCorrectiveAction: (incidentId: string) => string;
  updateCorrectiveAction: (incidentId: string, actionId: string, patch: Partial<Omit<AarCorrectiveAction, 'id'>>) => void;
  removeCorrectiveAction: (incidentId: string, actionId: string) => void;

  // Live layers on the share map
  toggleLiveLayer: (id: ShareLiveLayerId) => void;
  // Additional property-pin groups on the share map
  toggleExtraLocationGroup: (id: string) => void;
  // Windstar vessels attached to the incident (any number)
  toggleIncidentShip: (mmsi: string) => void;
  setIncidentShips: (mmsis: string[]) => void;

  // Draw layers
  addDrawLayer: (layer: Omit<DrawLayer, 'id' | 'createdAt'>) => string;
  updateDrawLayer: (id: string, patch: Partial<Omit<DrawLayer, 'id' | 'createdAt'>>) => void;
  removeDrawLayer: (id: string) => void;
  setActiveDrawLayer: (id: string | null) => void;
  setPickedLayer: (p: PickedLayer | null) => void;

  // Server sync
  setIncidents: (incidents: Incident[]) => void;
  setSyncState: (state: SyncState) => void;
  // Apply a change pushed from another responder (live sync) without echoing it
  // straight back to the server.
  applyRemoteUpsert: (incident: Incident) => void;
  applyRemoteDelete: (id: string) => void;
}

// Select the currently-open incident (or null in list view).
export const selectActive = (s: CrisisState): Incident | null =>
  s.incidents.find((i) => i.id === s.activeIncidentId) ?? null;

export const useActiveIncident = (): Incident | null => useCrisisStore(selectActive);

// Find which incident owns a given draw layer id.
export function incidentOfLayer(s: CrisisState, layerId: string): Incident | null {
  return s.incidents.find((i) => i.drawLayers.some((l) => l.id === layerId)) ?? null;
}

// Incidents currently open as Active in crisis response. Archived (stood-down)
// incidents never count, even if legacy data left their stored status 'active'
// — that combination kept the ⚠ CRISIS tab badge lit forever. Single source of
// truth for the tab title (TitleBadge) and the top-bar crisis button.
export const selectActiveCrisisCount = (s: CrisisState): number =>
  s.incidents.filter((i) => i.incidentStatus === 'active' && !i.archivedAt).length;

// Patch the active incident immutably.
function patchActive(s: CrisisState, fn: (inc: Incident) => Incident): Partial<CrisisState> {
  if (!s.activeIncidentId) return {};
  return { incidents: s.incidents.map((i) => (i.id === s.activeIncidentId ? fn(i) : i)) };
}

// Same, but a no-op while the incident is stood down: an archived incident is
// a frozen record (F3) — reopen it to edit. Share-link actions intentionally
// bypass this (revoking a leaked link must work on archived incidents too).
function patchActiveEditable(s: CrisisState, fn: (inc: Incident) => Incident): Partial<CrisisState> {
  const inc = s.incidents.find((i) => i.id === s.activeIncidentId);
  if (!inc || inc.archivedAt) return {};
  return patchActive(s, fn);
}

// Patch a specific incident by id, archived or not — for post-incident work
// (the AAR) that by definition happens on frozen records.
function patchById(s: CrisisState, id: string, fn: (inc: Incident) => Incident): Partial<CrisisState> {
  return { incidents: s.incidents.map((i) => (i.id === id ? fn(i) : i)) };
}

// Patch a named incident when given (async completions must land on the
// incident they were issued for, not whichever is open now), else the active one.
function patchTarget(s: CrisisState, incidentId: string | undefined, fn: (inc: Incident) => Incident): Partial<CrisisState> {
  if (incidentId === undefined) return patchActive(s, fn);
  if (!s.incidents.some((i) => i.id === incidentId)) return {};
  return patchById(s, incidentId, fn);
}

// Patch whichever incident owns the given layer.
function patchLayerOwner(s: CrisisState, layerId: string, fn: (inc: Incident) => Incident): Partial<CrisisState> {
  return {
    incidents: s.incidents.map((i) =>
      i.drawLayers.some((l) => l.id === layerId) ? fn(i) : i
    ),
  };
}

export const useCrisisStore = create<CrisisState>()((set) => ({
      open: false,
      activeIncidentId: null,
      activeTab: 'situation-report',
      activeDrawLayerId: null,
      pickedLayer: null,
      incidents: [],
      syncState: 'idle',

      // Reopening returns to the incident the operator closed the workspace
      // on (the top-bar button is how they get back mid-incident); Esc steps
      // back to the list before closing, so a deliberate exit from the list
      // still reopens on the list. Falls back to the list if it was deleted.
      toggle: () =>
        set((s) => (s.open
          ? { open: false }
          : { open: true, activeIncidentId: s.incidents.some((i) => i.id === s.activeIncidentId) ? s.activeIncidentId : null })),
      close: () => set({ open: false }),
      setOpen: (open) => set({ open }),
      setTab: (activeTab) => set({ activeTab }),

      createIncident: (type) => {
        const inc = newIncident(type);
        // A new incident opens on its Situation Report (name, property, type
        // first), not on whichever tab the previous incident was left on.
        set((s) => ({ incidents: [...s.incidents, inc], activeIncidentId: inc.id, open: true, activeTab: 'situation-report' }));
        return inc.id;
      },
      openIncident: (id) => set({ activeIncidentId: id, open: true }),
      backToList: () => set({ activeIncidentId: null }),
      removeIncident: (id) =>
        set((s) => ({
          incidents: s.incidents.filter((i) => i.id !== id),
          activeIncidentId: s.activeIncidentId === id ? null : s.activeIncidentId,
          // Same as applyRemoteDelete: never leave a draw session on a layer that is gone.
          activeDrawLayerId:
            s.incidents.find((i) => i.id === id)?.drawLayers.some((l) => l.id === s.activeDrawLayerId)
              ? null
              : s.activeDrawLayerId,
        })),

      standDownIncident: (id, reason) =>
        set((s) => ({
          incidents: s.incidents.map((inc) => {
            if (inc.id !== id) return inc;
            const now = new Date().toISOString();
            const openAssignments = inc.assignments.filter((a) => !a.endedAt);
            // Standing down closes the incident: archived-but-still-"active"
            // rows are what kept tab badges lit forever. Open ICS assignments
            // are released so the archived org chart reads as concluded (their
            // start/end stamps remain the AAR's staffing record).
            return {
              ...inc,
              archivedAt: now,
              incidentStatus: 'closed' as IncidentStatus,
              closedBy: currentActor() ?? null,
              standDownReason: reason?.trim() || null,
              assignments: inc.assignments.map((a) => (a.endedAt ? a : { ...a, endedAt: now })),
              actionLog: [
                sysEntry(
                  'stood-down',
                  `Incident stood down and archived${reason?.trim() ? ` — ${reason.trim()}` : ''}`,
                  {
                    ...(reason?.trim() ? { reason: reason.trim() } : {}),
                    releasedAssignments: String(openAssignments.length),
                  }
                ),
                ...inc.actionLog,
              ],
            };
          }),
          // Navigation stays with the caller: the stand-down checklist modal
          // lives inside the incident view, and yanking activeIncidentId here
          // unmounted it mid-sequence. Its Done button calls backToList().
        })),

      reopenIncident: (id) =>
        set((s) => ({
          incidents: s.incidents.map((inc) =>
            // Reopen conservatively as Monitoring — the operator escalates to
            // Active if the situation actually warrants it. Closure stamps
            // clear (the log keeps the stand-down history).
            inc.id === id
              ? {
                  ...inc,
                  archivedAt: null,
                  incidentStatus: 'monitoring' as IncidentStatus,
                  closedBy: null,
                  standDownReason: null,
                  actionLog: [sysEntry('reopened', 'Incident reopened (status: Monitoring)'), ...inc.actionLog],
                }
              : inc
          ),
        })),

      update: (patch) =>
        set((s) => patchActiveEditable(s, (inc) => {
          // Lifecycle fields get a system log entry alongside the change, so
          // the AAR can reconstruct when the incident escalated and who did it.
          const events: ActionLogEntry[] = [];
          if (patch.incidentStatus !== undefined && patch.incidentStatus !== inc.incidentStatus) {
            events.push(sysEntry(
              'status-change',
              `Status changed: ${incidentStatusDef(inc.incidentStatus).label} → ${incidentStatusDef(patch.incidentStatus).label}`,
              { from: inc.incidentStatus, to: patch.incidentStatus }
            ));
          }
          if (patch.complexityType !== undefined && patch.complexityType !== (inc.complexityType ?? null)) {
            events.push(sysEntry(
              'complexity-change',
              `Complexity changed: ${COMPLEXITY_LABEL(inc.complexityType)} → ${COMPLEXITY_LABEL(patch.complexityType)}`,
              { from: inc.complexityType ?? '', to: patch.complexityType ?? '' }
            ));
          }
          return {
            ...inc,
            ...patch,
            ...(events.length ? { actionLog: [...events, ...inc.actionLog] } : {}),
          };
        })),
      setShareToken: (token) => set((s) => patchActive(s, (inc) => ({ ...inc, shareToken: token }))),

      addShareLink: (token, url, password, label, expiresAt, incidentId) =>
        set((s) => patchTarget(s, incidentId, (inc) => ({
          ...inc,
          shareToken: token,
          shareLinks: [
            ...(inc.shareLinks ?? []),
            { token, url, createdAt: new Date().toISOString(), active: true, password, label, expiresAt },
          ],
          actionLog: [
            sysEntry(
              'share-created',
              `Public share link published${label ? ` for ${label}` : ''}`,
              { token, ...(label ? { label } : {}) }
            ),
            ...inc.actionLog,
          ],
        }))),

      renewShareLink: (token, expiresAt, incidentId) =>
        set((s) => patchTarget(s, incidentId, (inc) => ({
          ...inc,
          shareLinks: (inc.shareLinks ?? []).map((l) => (l.token === token ? { ...l, expiresAt } : l)),
        }))),

      deactivateShareLink: (token, incidentId) =>
        set((s) => patchTarget(s, incidentId, (inc) => {
          const updated = (inc.shareLinks ?? []).map((l) =>
            l.token === token ? { ...l, active: false } : l
          );
          const anyActive = updated.find((l) => l.active);
          return {
            ...inc,
            shareToken: anyActive?.token ?? null,
            shareLinks: updated,
            actionLog: [
              sysEntry('share-revoked', 'Public share link revoked', { token }),
              ...inc.actionLog,
            ],
          };
        })),

      addPersonnelMember: (name, details) =>
        set((s) => patchActiveEditable(s, (inc) => ({
          ...inc,
          personnel: [...(inc.personnel ?? []), { id: uid(), name, ...details }],
        }))),

      removePersonnelMember: (id) =>
        set((s) => patchActiveEditable(s, (inc) => ({
          ...inc,
          personnel: (inc.personnel ?? []).filter((p) => p.id !== id),
        }))),

      addRole: (role) =>
        set((s) => patchActiveEditable(s, (inc) => ({
          ...inc,
          roles: [...inc.roles, { ...role, id: uid(), builtin: false }],
          actionLog: [
            sysEntry('role-added', `ICS role added: ${role.title}`, { roleTitle: role.title }),
            ...inc.actionLog,
          ],
        }))),

      updateRole: (id, patch) =>
        set((s) => patchActiveEditable(s, (inc) => ({ ...inc, roles: inc.roles.map((r) => (r.id === id ? { ...r, ...patch } : r)) }))),

      // Removes a role and its whole subtree — but never the people in it or
      // their history:
      //   - Refused (a no-op) while anyone in the branch is still assigned.
      //     The chart disables Remove and says who to release first; this
      //     also catches a peer's assignment that landed after the confirm.
      //   - Assignments are NOT deleted. The ended ones on these roles are the
      //     AAR's staffing record (roster, swimlane, personnel count); they
      //     outlive the roles, titled via assignmentRoleTitle. Restoring a
      //     builtin role with the same id reattaches its history.
      removeRole: (id) =>
        set((s) => patchActiveEditable(s, (inc) => {
          const role = inc.roles.find((r) => r.id === id);
          if (!role || activeAssignmentsInSubtree(inc.roles, inc.assignments, id).length > 0) return inc;
          const toRemove = roleSubtreeIds(inc.roles, id);
          const title = role.title;
          const subCount = toRemove.size - 1;
          return {
            ...inc,
            roles: inc.roles.filter((r) => !toRemove.has(r.id)),
            actionLog: [
              sysEntry(
                'role-removed',
                `ICS role removed: ${title}${subCount > 0 ? ` (and ${subCount} sub-role${subCount === 1 ? '' : 's'})` : ''}`,
                { roleId: id, roleTitle: title, subRoles: String(subCount) }
              ),
              ...inc.actionLog,
            ],
          };
        })),

      // Re-parent and/or reorder one role (its subtree travels with it).
      // Assignments are keyed by role id, so whoever holds the role keeps it.
      moveRole: (roleId, target) =>
        set((s) => patchActiveEditable(s, (inc) => {
          const role = inc.roles.find((r) => r.id === roleId);
          if (!role || target.beforeRoleId === roleId) return inc;
          const toParent = target.parentId;
          // No cycles: a role can't report to itself, to anything beneath it,
          // or to a role that doesn't exist (it would vanish from the chart).
          if (
            toParent !== null &&
            (roleSubtreeIds(inc.roles, roleId).has(toParent) || !inc.roles.some((r) => r.id === toParent))
          ) {
            return inc;
          }
          const fromParent = role.parentId;
          const fromCmd = !!role.isCommandStaff;
          // Command staff is the advisory row directly beneath a parent, so a
          // top-level role is never in it. Otherwise, absent an explicit
          // choice, a role keeps its row while it stays with its parent and
          // joins general staff under a new one.
          const toCmd = toParent === null
            ? false
            : target.isCommandStaff ?? (toParent === fromParent ? fromCmd : false);
          const sameRow = toParent === fromParent && toCmd === fromCmd;

          const oldRow = roleSiblings(inc.roles, fromParent, fromCmd);
          const dest = roleSiblings(inc.roles, toParent, toCmd).filter((r) => r.id !== roleId);
          const at = target.beforeRoleId ? dest.findIndex((r) => r.id === target.beforeRoleId) : -1;
          const nextRow = at < 0 ? [...dest, role] : [...dest.slice(0, at), role, ...dest.slice(at)];
          if (sameRow && nextRow.every((r, i) => r.id === oldRow[i]?.id)) return inc;

          // Renumber densely: the destination row, and the row it left.
          // Untouched roles keep their object identity so selectors skip them.
          const next = new Map<string, Pick<IcsRole, 'parentId' | 'isCommandStaff' | 'order'>>();
          if (!sameRow) {
            oldRow.filter((r) => r.id !== roleId).forEach((r, i) =>
              next.set(r.id, { parentId: r.parentId, isCommandStaff: r.isCommandStaff, order: i }));
          }
          nextRow.forEach((r, i) =>
            next.set(r.id, r.id === roleId
              ? { parentId: toParent, isCommandStaff: toCmd, order: i }
              : { parentId: r.parentId, isCommandStaff: r.isCommandStaff, order: i }));
          const roles = inc.roles.map((r) => {
            const p = next.get(r.id);
            return !p || (p.order === r.order && p.parentId === r.parentId && p.isCommandStaff === r.isCommandStaff)
              ? r
              : { ...r, ...p };
          });

          const titleOf = (id: string | null) =>
            id === null ? 'top level' : inc.roles.find((r) => r.id === id)?.title ?? 'role';
          const where = (id: string | null) => (id === null ? 'at top level' : `under ${titleOf(id)}`);
          const position = nextRow.findIndex((r) => r.id === roleId) + 1;
          const description = sameRow
            ? `ICS role reordered: ${role.title} (${position} of ${nextRow.length}, ${where(toParent)})`
            : toParent === fromParent
              ? `ICS role moved: ${role.title} → ${toCmd ? 'command staff' : 'general staff'} ${where(toParent)}`
              : `ICS role moved: ${role.title} → ${toParent === null ? 'top level' : where(toParent)}${toCmd ? ' (command staff)' : ''}`;
          return {
            ...inc,
            roles,
            actionLog: [
              sysEntry('role-moved', description, {
                roleId,
                roleTitle: role.title,
                fromParent: titleOf(fromParent),
                toParent: titleOf(toParent),
                fromParentId: fromParent ?? '',
                toParentId: toParent ?? '',
                position: String(position),
                ...(toCmd ? { commandStaff: 'true' } : {}),
              }),
              ...inc.actionLog,
            ],
          };
        })),

      restoreBuiltinRole: (roleId) =>
        set((s) => patchActiveEditable(s, (inc) => {
          const target = DEFAULT_ROLES.find((r) => r.id === roleId);
          if (!target || inc.roles.find((r) => r.id === roleId)) return inc;
          // Also restore any missing ancestors so the role is properly connected.
          const toAdd: IcsRole[] = [];
          const addWithAncestors = (role: IcsRole) => {
            if (inc.roles.find((r) => r.id === role.id) || toAdd.find((r) => r.id === role.id)) return;
            if (role.parentId !== null) {
              const parent = DEFAULT_ROLES.find((r) => r.id === role.parentId);
              if (parent) addWithAncestors(parent);
            }
            toAdd.push(role);
          };
          addWithAncestors(target);
          return { ...inc, roles: [...inc.roles, ...toAdd] };
        })),

      resetRoles: () => set((s) => patchActiveEditable(s, (inc) => ({ ...inc, roles: DEFAULT_ROLES }))),

      assignRole: (roleId, name, details, personnelId) =>
        set((s) => patchActiveEditable(s, (inc) => {
          const now = new Date().toISOString();
          const role = inc.roles.find((r) => r.id === roleId);
          // A role a peer just removed: an assignment to it would be invisible.
          if (!role) return inc;
          const endPrevious = !role.isSupport;
          const samePerson = (a: PersonnelAssignment) => isSamePerson(a, name, personnelId);

          // Re-assigning whoever already holds this role is not a new
          // assignment — that would split their AAR swimlane bar, reset their
          // time in role, and list them twice on a support role. It's how the
          // role panel corrects their details: update in place, log nothing.
          const current = inc.assignments.find((a) => !a.endedAt && a.roleId === roleId && samePerson(a));
          if (current) {
            const patch: Partial<PersonnelAssignment> = {};
            for (const k of ['title', 'phone', 'email'] as const) {
              const v = details?.[k];
              if (v !== undefined && v !== current[k]) patch[k] = v;
            }
            if (personnelId && !current.personnelId) patch.personnelId = personnelId;
            if (Object.keys(patch).length === 0) return inc;
            return {
              ...inc,
              assignments: inc.assignments.map((a) => (a.id === current.id ? { ...a, ...patch } : a)),
            };
          }

          // End any other active assignment for this person across all roles
          // (one person cannot hold more than one role at a time).
          const movedFrom = inc.assignments.filter((a) => !a.endedAt && a.roleId !== roleId && samePerson(a));
          const assignments = inc.assignments.map((a) => {
            if (a.endedAt) return a;
            if (samePerson(a) && a.roleId !== roleId) {
              return { ...a, endedAt: now };
            }
            if (endPrevious && a.roleId === roleId) {
              return { ...a, endedAt: now };
            }
            return a;
          });
          // Command-transfer history is AAR gold: record who took the role,
          // whom they replaced, and which seat they left — a move can leave
          // even the IC seat empty, and the log (the AAR narrative, and what
          // share-link readers see) must say so.
          const displaced = endPrevious
            ? inc.assignments.find((a) => !a.endedAt && a.roleId === roleId)
            : undefined;
          const fromTitle = (a: PersonnelAssignment) => assignmentRoleTitle(inc, a.roleId) ?? 'a removed role';
          const vacated = movedFrom.filter(
            (m) => !assignments.some((a) => !a.endedAt && a.roleId === m.roleId)
          );
          const from = movedFrom.map(fromTitle).join(', ');
          const notes = [
            ...(displaced ? [`replacing ${displaced.name}`] : []),
            ...(movedFrom.length
              ? [`moved from ${from}${vacated.length === movedFrom.length ? ', now vacant' : ''}`]
              : []),
          ];
          const roleTitle = role.title;
          return {
            ...inc,
            assignments: [
              ...assignments,
              { id: uid(), roleId, personnelId, name, ...details, startedAt: now },
            ],
            actionLog: [
              sysEntry(
                'assignment',
                `${name} assigned as ${roleTitle}${notes.length ? ` (${notes.join('; ')})` : ''}`,
                {
                  roleId, roleTitle, name,
                  ...(displaced ? { replaced: displaced.name } : {}),
                  ...(movedFrom.length ? { from, fromRoleId: movedFrom.map((a) => a.roleId).join(',') } : {}),
                  ...(vacated.length ? { vacated: vacated.map(fromTitle).join(', ') } : {}),
                }
              ),
              ...inc.actionLog,
            ],
          };
        })),

      endAssignment: (id) =>
        set((s) => patchActiveEditable(s, (inc) => {
          const target = inc.assignments.find((a) => a.id === id);
          // Already released (a double tap, or a peer got there first): its
          // end time is the record — never re-stamp it.
          if (!target || target.endedAt) return inc;
          const roleTitle = assignmentRoleTitle(inc, target.roleId) ?? 'a removed role';
          return {
            ...inc,
            assignments: inc.assignments.map((a) => (a.id === id ? { ...a, endedAt: new Date().toISOString() } : a)),
            actionLog: [
              sysEntry('assignment-ended', `${target.name} released from ${roleTitle}`, {
                roleId: target.roleId, roleTitle, name: target.name,
              }),
              ...inc.actionLog,
            ],
          };
        })),

      addActionEntry: (type = 'action') => {
        const id = uid();
        set((s) => patchActiveEditable(s, (inc) => ({
          ...inc,
          actionLog: [
            { id, timestamp: new Date().toISOString(), description: '', entryType: type, actor: currentActor() },
            ...inc.actionLog,
          ],
        })));
        return id;
      },

      updateActionEntry: (id, patch, incidentId) =>
        set((s) => {
          const fn = (inc: Incident): Incident => ({
            ...inc,
            actionLog: inc.actionLog.map((e) => (e.id === id ? { ...e, ...patch } : e)),
          });
          // No incidentId given: the active incident, as before (every sync UI call site).
          if (incidentId === undefined) return patchActiveEditable(s, fn);
          // Async completions (image upload) target their own incident, so they still
          // land if the operator has navigated away. Archived incidents stay frozen (F3).
          const target = s.incidents.find((i) => i.id === incidentId);
          if (!target || target.archivedAt) return {};
          return patchById(s, incidentId, fn);
        }),

      removeActionEntry: (id) =>
        set((s) => patchActiveEditable(s, (inc) => ({ ...inc, actionLog: inc.actionLog.filter((e) => e.id !== id) }))),

      // Optimistic check/uncheck with a local timestamp; the sync layer's POST
      // comes back with the server-stamped map and replaces this via
      // applyChecklistState. Excluded from serverCanon, so this never schedules
      // a blob PUT. patchActiveEditable keeps archived incidents frozen.
      toggleChecklistItem: (itemId, checked) =>
        set((s) => patchActiveEditable(s, (inc) => ({
          ...inc,
          checklists: {
            ...(inc.checklists ?? {}),
            [itemId]: { checked, at: new Date().toISOString(), by: currentActor() },
          },
        }))),

      // Server-authoritative checklist state (toggle responses, SSE merges).
      // patchById, not patchActiveEditable: the response must land even if the
      // operator has navigated away from the incident meanwhile.
      applyChecklistState: (incidentId, checklists) =>
        set((s) => patchById(s, incidentId, (inc) => ({ ...inc, checklists }))),

      setIntakeAnswer: (questionId, answer) =>
        set((s) => patchActiveEditable(s, (inc) => {
          const cur = inc.intake ?? {};
          // Keep the map sparse: clearing a field removes the key, so the
          // share page's "at least one answer" gate stays truthful.
          if (!answer) {
            if (!(questionId in cur)) return inc;
            const { [questionId]: _gone, ...rest } = cur;
            return { ...inc, intake: rest };
          }
          return { ...inc, intake: { ...cur, [questionId]: answer } };
        })),

      // AAR content rides the incident blob (synced by the generic watcher,
      // archived incidents included) and stays out of extractPublicState.
      updateAar: (incidentId, patch) =>
        set((s) => patchById(s, incidentId, (inc) => ({ ...inc, aar: { ...inc.aar, ...patch } }))),
      addCorrectiveAction: (incidentId) => {
        const id = uid();
        set((s) => patchById(s, incidentId, (inc) => ({
          ...inc,
          aar: { ...inc.aar, correctiveActions: [...(inc.aar?.correctiveActions ?? []), { id, text: '' }] },
        })));
        return id;
      },
      updateCorrectiveAction: (incidentId, actionId, patch) =>
        set((s) => patchById(s, incidentId, (inc) => ({
          ...inc,
          aar: {
            ...inc.aar,
            correctiveActions: (inc.aar?.correctiveActions ?? []).map((a) =>
              a.id === actionId ? { ...a, ...patch } : a
            ),
          },
        }))),
      removeCorrectiveAction: (incidentId, actionId) =>
        set((s) => patchById(s, incidentId, (inc) => ({
          ...inc,
          aar: {
            ...inc.aar,
            correctiveActions: (inc.aar?.correctiveActions ?? []).filter((a) => a.id !== actionId),
          },
        }))),

      toggleLiveLayer: (id) =>
        set((s) => patchActiveEditable(s, (inc) => {
          const cur = inc.liveLayers ?? [];
          return {
            ...inc,
            liveLayers: cur.includes(id) ? cur.filter((l) => l !== id) : [...cur, id],
          };
        })),

      toggleExtraLocationGroup: (id) =>
        set((s) => patchActiveEditable(s, (inc) => {
          const cur = inc.extraLocationGroups ?? [];
          return {
            ...inc,
            extraLocationGroups: cur.includes(id) ? cur.filter((g) => g !== id) : [...cur, id],
          };
        })),

      toggleIncidentShip: (mmsi) =>
        set((s) => patchActiveEditable(s, (inc) => {
          const cur = inc.shipMmsis ?? [];
          return withVessels(
            inc,
            cur.includes(mmsi) ? cur.filter((m) => m !== mmsi) : [...cur, mmsi]
          );
        })),

      setIncidentShips: (mmsis) =>
        set((s) => patchActiveEditable(s, (inc) => withVessels(inc, mmsis))),

      addDrawLayer: (layer) => {
        const id = uid();
        set((s) => patchActiveEditable(s, (inc) => ({
          ...inc,
          drawLayers: [...inc.drawLayers, { ...layer, id, createdAt: new Date().toISOString() }],
        })));
        return id;
      },

      updateDrawLayer: (id, patch) =>
        set((s) => patchLayerOwner(s, id, (inc) => ({
          ...inc,
          drawLayers: inc.drawLayers.map((l) => (l.id === id ? { ...l, ...patch } : l)),
        }))),

      removeDrawLayer: (id) =>
        set((s) => ({
          incidents: s.incidents.map((i) =>
            i.drawLayers.some((l) => l.id === id) ? { ...i, drawLayers: i.drawLayers.filter((l) => l.id !== id) } : i
          ),
          activeDrawLayerId: s.activeDrawLayerId === id ? null : s.activeDrawLayerId,
          pickedLayer: s.pickedLayer?.layerId === id ? null : s.pickedLayer,
        })),

      setActiveDrawLayer: (id) => set({ activeDrawLayerId: id }),
      setPickedLayer: (pickedLayer) => set({ pickedLayer }),

      // Both server ingest paths normalize legacy taxonomy values (retired
      // type/status ids, archived-but-not-closed) on the way into the store.
      // The sync layer canonicalizes its baselines the same way (syncCanon.ts),
      // so normalization alone never registers as a local edit — stored legacy
      // values migrate when a person genuinely edits the incident, not on load
      // (an unprompted write-back could race and overwrite peers' edits).
      setIncidents: (incidents) => set({ incidents: incidents.map(normalizeIncidentFields) }),
      setSyncState: (syncState) => set({ syncState }),

      applyRemoteUpsert: (incident) =>
        set((s) => {
          const inc = normalizeIncidentFields(incident);
          const exists = s.incidents.some((i) => i.id === inc.id);
          return {
            incidents: exists
              ? s.incidents.map((i) => (i.id === inc.id ? inc : i))
              : [...s.incidents, inc],
          };
        }),

      applyRemoteDelete: (id) =>
        set((s) => ({
          incidents: s.incidents.filter((i) => i.id !== id),
          activeIncidentId: s.activeIncidentId === id ? null : s.activeIncidentId,
          activeDrawLayerId:
            s.incidents.find((i) => i.id === id)?.drawLayers.some((l) => l.id === s.activeDrawLayerId)
              ? null
              : s.activeDrawLayerId,
        })),
}));

// ── Share helper ──────────────────────────────────────────────────────────────

export function extractPublicState(inc: Incident, publishedAt?: string): CrisisPublicState {
  return {
    incidentName: inc.incidentName,
    incidentDatetime: inc.incidentDatetime,
    incidentEndDatetime: inc.incidentEndDatetime,
    incidentLocation: inc.incidentLocation,
    incidentType: inc.incidentType,
    incidentStatus: inc.incidentStatus,
    complexityType: inc.complexityType ?? null,
    executiveSummary: inc.executiveSummary,
    roles: inc.roles,
    // Strip personnel contact details (title/phone/email) from the public share
    // payload — they're internal-only and must not leak through a share link.
    // The public org chart renders names only, so nothing visible is lost.
    assignments: inc.assignments.map((a) => ({
      id: a.id,
      roleId: a.roleId,
      name: a.name,
      startedAt: a.startedAt,
      endedAt: a.endedAt,
    })),
    actionLog: inc.actionLog,
    drawLayers: inc.drawLayers,
    // Always concrete values, never undefined: JSON.stringify drops undefined
    // keys, and the server's PATCH shallow-merge would then keep the snapshot's
    // OLD values forever — viewers could never see layers/groups removed.
    liveLayers: inc.liveLayers ?? [],
    locationGroupId: inc.locationGroupId ?? null,
    extraLocationGroups: inc.extraLocationGroups ?? [],
    // Vessel identities only — share viewers read live positions from the
    // public AIS endpoint, so a snapshot never carries a stale one.
    shipMmsis: incidentShipMmsis(inc.shipMmsis),
    // Checklist state is included for completeness (new-link publishes), but
    // the server PATCH deliberately ignores this key on live snapshots — the
    // per-item toggle endpoints own it (see crisis.ts).
    checklists: inc.checklists ?? {},
    intake: inc.intake ?? {},
    publishedAt: publishedAt ?? new Date().toISOString(),
    lastUpdated: new Date().toISOString(),
  };
}
