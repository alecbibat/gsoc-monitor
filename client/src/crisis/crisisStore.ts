import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// ── Domain types ─────────────────────────────────────────────────────────────

export type IncidentStatus = 'active' | 'contained' | 'resolved';
export type IncidentType =
  | 'wildfire' | 'hurricane' | 'earthquake' | 'flood'
  | 'chemical' | 'mass-casualty' | 'cyber' | 'security'
  | 'severe-weather' | 'other';
export type CrisisTab = 'situation-report';
export type ActionEntryType = 'action' | 'event';

export interface IcsRole {
  id: string;
  title: string;
  abbrev?: string;
  parentId: string | null;
  color: string;
  isCommandStaff: boolean;
  order: number;
  builtin: boolean;
}

export interface PersonnelAssignment {
  id: string;
  roleId: string;
  name: string;
  organization?: string;
  startedAt: string;
  endedAt?: string;
}

export interface ActionLogEntry {
  id: string;
  timestamp: string;
  description: string;
  attachmentName?: string;
  entryType: ActionEntryType;
}

export type DrawLayerType =
  | 'fire-perimeter' | 'burned-area' | 'flood-zone'
  | 'staging-area' | 'exclusion-zone' | 'search-grid' | 'other';

export interface DrawLayerPoint {
  lat: number;
  lon: number;
}

export interface DrawLayer {
  id: string;
  name: string;
  type: DrawLayerType;
  color: string;
  visible: boolean;
  positions: DrawLayerPoint[];
  closed: boolean;
  createdAt: string;
}

// Public shape sent to / received from the share endpoint
export interface CrisisPublicState {
  incidentName: string;
  incidentDatetime: string;
  incidentLocation: string;
  incidentType: IncidentType;
  incidentStatus: IncidentStatus;
  executiveSummary: string;
  roles: IcsRole[];
  assignments: PersonnelAssignment[];
  actionLog: ActionLogEntry[];
  drawLayers: DrawLayer[];
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
  { id: 'ic',             title: 'Incident Commander',              abbrev: 'IC',   parentId: null,        color: IC_COLOR,   isCommandStaff: false, order: 0, builtin: true },
  { id: 'safety',         title: 'Safety Officer',                  abbrev: 'SO',   parentId: 'ic',        color: CMD_COLOR,  isCommandStaff: true,  order: 0, builtin: true },
  { id: 'pio',            title: 'Public Information Officer',      abbrev: 'PIO',  parentId: 'ic',        color: CMD_COLOR,  isCommandStaff: true,  order: 1, builtin: true },
  { id: 'liaison',        title: 'Liaison Officer',                 abbrev: 'LO',   parentId: 'ic',        color: CMD_COLOR,  isCommandStaff: true,  order: 2, builtin: true },
  { id: 'ops',            title: 'Operations Section Chief',        abbrev: 'OSC',  parentId: 'ic',        color: OPS_COLOR,  isCommandStaff: false, order: 3, builtin: true },
  { id: 'planning',       title: 'Planning Section Chief',          abbrev: 'PSC',  parentId: 'ic',        color: PLAN_COLOR, isCommandStaff: false, order: 4, builtin: true },
  { id: 'logistics',      title: 'Logistics Section Chief',         abbrev: 'LSC',  parentId: 'ic',        color: LOG_COLOR,  isCommandStaff: false, order: 5, builtin: true },
  { id: 'finance',        title: 'Finance/Admin Section Chief',     abbrev: 'FSC',  parentId: 'ic',        color: FIN_COLOR,  isCommandStaff: false, order: 6, builtin: true },
  { id: 'ops-branch',     title: 'Branch Director',                 abbrev: 'BD',   parentId: 'ops',       color: OPS_COLOR,  isCommandStaff: false, order: 0, builtin: true },
  { id: 'ops-division',   title: 'Division/Group Supervisor',       abbrev: 'DIVS', parentId: 'ops',       color: OPS_COLOR,  isCommandStaff: false, order: 1, builtin: true },
  { id: 'plan-resources', title: 'Resources Unit Leader',           abbrev: 'RESL', parentId: 'planning',  color: PLAN_COLOR, isCommandStaff: false, order: 0, builtin: true },
  { id: 'plan-situation', title: 'Situation Unit Leader',           abbrev: 'SITL', parentId: 'planning',  color: PLAN_COLOR, isCommandStaff: false, order: 1, builtin: true },
  { id: 'plan-docs',      title: 'Documentation Unit Leader',       abbrev: 'DOCL', parentId: 'planning',  color: PLAN_COLOR, isCommandStaff: false, order: 2, builtin: true },
  { id: 'plan-demob',     title: 'Demob. Unit Leader',              abbrev: 'DMBL', parentId: 'planning',  color: PLAN_COLOR, isCommandStaff: false, order: 3, builtin: true },
  { id: 'log-support',    title: 'Support Branch Director',         abbrev: 'SUBD', parentId: 'logistics', color: LOG_COLOR,  isCommandStaff: false, order: 0, builtin: true },
  { id: 'log-service',    title: 'Service Branch Director',         abbrev: 'SEBD', parentId: 'logistics', color: LOG_COLOR,  isCommandStaff: false, order: 1, builtin: true },
  { id: 'fin-time',       title: 'Time Unit Leader',                abbrev: 'TIME', parentId: 'finance',   color: FIN_COLOR,  isCommandStaff: false, order: 0, builtin: true },
  { id: 'fin-proc',       title: 'Procurement Unit Leader',         abbrev: 'PROC', parentId: 'finance',   color: FIN_COLOR,  isCommandStaff: false, order: 1, builtin: true },
  { id: 'fin-comp',       title: 'Compensation/Claims Unit Leader', abbrev: 'COMP', parentId: 'finance',   color: FIN_COLOR,  isCommandStaff: false, order: 2, builtin: true },
  { id: 'fin-cost',       title: 'Cost Unit Leader',                abbrev: 'COST', parentId: 'finance',   color: FIN_COLOR,  isCommandStaff: false, order: 3, builtin: true },
];

// ── Store ────────────────────────────────────────────────────────────────────

interface CrisisFields {
  incidentName: string;
  incidentDatetime: string;
  incidentLocation: string;
  incidentType: IncidentType;
  incidentStatus: IncidentStatus;
  executiveSummary: string;
}

let _seq = Date.now();
const uid = () => `c-${++_seq}`;

interface CrisisState extends CrisisFields {
  open: boolean;
  activeTab: CrisisTab;
  shareToken: string | null;
  roles: IcsRole[];
  assignments: PersonnelAssignment[];
  actionLog: ActionLogEntry[];
  drawLayers: DrawLayer[];
  activeDrawLayerId: string | null;
  // Core
  toggle: () => void;
  close: () => void;
  setTab: (tab: CrisisTab) => void;
  update: (patch: Partial<CrisisFields>) => void;
  // Share
  setShareToken: (token: string | null) => void;
  // Roles
  addRole: (role: Omit<IcsRole, 'id' | 'builtin'>) => void;
  updateRole: (id: string, patch: Partial<Omit<IcsRole, 'id' | 'builtin'>>) => void;
  removeRole: (id: string) => void;
  resetRoles: () => void;
  // Assignments
  assignRole: (roleId: string, name: string, org?: string) => void;
  endAssignment: (id: string) => void;
  // Action log
  addActionEntry: (type?: ActionEntryType) => void;
  updateActionEntry: (id: string, patch: Partial<Pick<ActionLogEntry, 'description' | 'attachmentName' | 'entryType'>>) => void;
  removeActionEntry: (id: string) => void;
  // Draw layers
  addDrawLayer: (layer: Omit<DrawLayer, 'id' | 'createdAt'>) => string;
  updateDrawLayer: (id: string, patch: Partial<Omit<DrawLayer, 'id' | 'createdAt'>>) => void;
  removeDrawLayer: (id: string) => void;
  setActiveDrawLayer: (id: string | null) => void;
  // Full reset
  reset: () => void;
}

const FIELD_DEFAULTS: CrisisFields = {
  incidentName: '',
  incidentDatetime: '',
  incidentLocation: '',
  incidentType: 'other',
  incidentStatus: 'active',
  executiveSummary: '',
};

export const useCrisisStore = create<CrisisState>()(
  persist(
    (set, get) => ({
      open: false,
      activeTab: 'situation-report',
      shareToken: null,
      roles: DEFAULT_ROLES,
      assignments: [],
      actionLog: [],
      drawLayers: [],
      activeDrawLayerId: null,
      ...FIELD_DEFAULTS,

      toggle: () => set((s) => ({ open: !s.open })),
      close: () => set({ open: false }),
      setTab: (activeTab) => set({ activeTab }),
      update: (patch) => set(patch),
      setShareToken: (shareToken) => set({ shareToken }),

      addRole: (role) =>
        set((s) => ({ roles: [...s.roles, { ...role, id: uid(), builtin: false }] })),

      updateRole: (id, patch) =>
        set((s) => ({ roles: s.roles.map((r) => (r.id === id ? { ...r, ...patch } : r)) })),

      removeRole: (id) => {
        const { roles } = get();
        const toRemove = new Set<string>();
        const collect = (pid: string) => {
          toRemove.add(pid);
          roles.filter((r) => r.parentId === pid).forEach((c) => collect(c.id));
        };
        collect(id);
        set((s) => ({
          roles: s.roles.filter((r) => !toRemove.has(r.id)),
          assignments: s.assignments.filter((a) => !toRemove.has(a.roleId)),
        }));
      },

      resetRoles: () => set({ roles: DEFAULT_ROLES }),

      assignRole: (roleId, name, org) => {
        const now = new Date().toISOString();
        set((s) => ({
          assignments: [
            ...s.assignments.map((a) =>
              a.roleId === roleId && !a.endedAt ? { ...a, endedAt: now } : a
            ),
            { id: uid(), roleId, name, organization: org || undefined, startedAt: now },
          ],
        }));
      },

      endAssignment: (id) =>
        set((s) => ({
          assignments: s.assignments.map((a) =>
            a.id === id ? { ...a, endedAt: new Date().toISOString() } : a
          ),
        })),

      addActionEntry: (type = 'action') =>
        set((s) => ({
          actionLog: [
            { id: uid(), timestamp: new Date().toISOString(), description: '', entryType: type },
            ...s.actionLog,
          ],
        })),

      updateActionEntry: (id, patch) =>
        set((s) => ({
          actionLog: s.actionLog.map((e) => (e.id === id ? { ...e, ...patch } : e)),
        })),

      removeActionEntry: (id) =>
        set((s) => ({ actionLog: s.actionLog.filter((e) => e.id !== id) })),

      addDrawLayer: (layer) => {
        const id = uid();
        set((s) => ({
          drawLayers: [
            ...s.drawLayers,
            { ...layer, id, createdAt: new Date().toISOString() },
          ],
        }));
        return id;
      },

      updateDrawLayer: (id, patch) =>
        set((s) => ({
          drawLayers: s.drawLayers.map((l) => (l.id === id ? { ...l, ...patch } : l)),
        })),

      removeDrawLayer: (id) =>
        set((s) => ({
          drawLayers: s.drawLayers.filter((l) => l.id !== id),
          activeDrawLayerId: s.activeDrawLayerId === id ? null : s.activeDrawLayerId,
        })),

      setActiveDrawLayer: (id) => set({ activeDrawLayerId: id }),

      reset: () =>
        set({
          ...FIELD_DEFAULTS,
          roles: DEFAULT_ROLES,
          assignments: [],
          actionLog: [],
          drawLayers: [],
          activeDrawLayerId: null,
          shareToken: null,
        }),
    }),
    { name: 'gsoc-crisis-v2' }
  )
);

// ── Helpers ──────────────────────────────────────────────────────────────────

export function extractPublicState(s: CrisisState, publishedAt?: string): CrisisPublicState {
  return {
    incidentName: s.incidentName,
    incidentDatetime: s.incidentDatetime,
    incidentLocation: s.incidentLocation,
    incidentType: s.incidentType,
    incidentStatus: s.incidentStatus,
    executiveSummary: s.executiveSummary,
    roles: s.roles,
    assignments: s.assignments,
    actionLog: s.actionLog,
    drawLayers: s.drawLayers,
    publishedAt: publishedAt ?? new Date().toISOString(),
    lastUpdated: new Date().toISOString(),
  };
}
