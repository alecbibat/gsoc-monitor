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
  isSupport: boolean;
  order: number;
  builtin: boolean;
}

export interface PersonnelMember {
  id: string;
  name: string;
  organization?: string;
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
  attachmentData?: string;  // base64 data URL for images; stored compressed (≤1200px JPEG)
  entryType: ActionEntryType;
}

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
  color: string;
  visible: boolean;
  positions: DrawLayerPoint[];
  thumbnail?: string;  // compressed JPEG data URL captured when drawing finishes
  createdAt: string;
}

export interface ShareLink {
  token: string;
  url: string;
  createdAt: string;
  active: boolean;
}

// One incident — a fully self-contained situation report.
export interface Incident {
  id: string;
  createdAt: string;
  incidentName: string;
  incidentDatetime: string;
  incidentLocation: string;
  incidentType: IncidentType;
  incidentStatus: IncidentStatus;
  executiveSummary: string;
  roles: IcsRole[];
  assignments: PersonnelAssignment[];
  personnel: PersonnelMember[];
  actionLog: ActionLogEntry[];
  drawLayers: DrawLayer[];
  shareToken: string | null;  // legacy — kept for backwards compat with persisted data
  shareLinks: ShareLink[];    // all share links ever created for this incident
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

let _seq = Date.now();
const uid = () => `c-${++_seq}`;

function newIncident(): Incident {
  return {
    id: uid(),
    createdAt: new Date().toISOString(),
    incidentName: '',
    incidentDatetime: '',
    incidentLocation: '',
    incidentType: 'other',
    incidentStatus: 'active',
    executiveSummary: '',
    roles: DEFAULT_ROLES,
    assignments: [],
    personnel: [],
    actionLog: [],
    drawLayers: [],
    shareToken: null,
    shareLinks: [],
  };
}

// ── Store ────────────────────────────────────────────────────────────────────

interface CrisisFields {
  incidentName: string;
  incidentDatetime: string;
  incidentLocation: string;
  incidentType: IncidentType;
  incidentStatus: IncidentStatus;
  executiveSummary: string;
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

  // Overlay
  toggle: () => void;
  close: () => void;
  setOpen: (open: boolean) => void;
  setTab: (tab: CrisisTab) => void;

  // Incident lifecycle
  createIncident: () => string;
  openIncident: (id: string) => void;
  backToList: () => void;
  removeIncident: (id: string) => void;

  // Active-incident field updates
  update: (patch: Partial<CrisisFields>) => void;
  setShareToken: (token: string | null) => void;
  addShareLink: (token: string, url: string) => void;
  deactivateShareLink: (token: string) => void;

  // Roles
  addRole: (role: Omit<IcsRole, 'id' | 'builtin'>) => void;
  updateRole: (id: string, patch: Partial<Omit<IcsRole, 'id' | 'builtin'>>) => void;
  removeRole: (id: string) => void;
  restoreBuiltinRole: (roleId: string) => void;
  resetRoles: () => void;

  // Personnel pool
  addPersonnelMember: (name: string, org?: string) => void;
  removePersonnelMember: (id: string) => void;

  // Assignments
  assignRole: (roleId: string, name: string, org?: string) => void;
  endAssignment: (id: string) => void;

  // Action log
  addActionEntry: (type?: ActionEntryType) => void;
  updateActionEntry: (id: string, patch: Partial<Pick<ActionLogEntry, 'description' | 'attachmentName' | 'attachmentData' | 'entryType'>>) => void;
  removeActionEntry: (id: string) => void;

  // Draw layers
  addDrawLayer: (layer: Omit<DrawLayer, 'id' | 'createdAt'>) => string;
  updateDrawLayer: (id: string, patch: Partial<Omit<DrawLayer, 'id' | 'createdAt'>>) => void;
  removeDrawLayer: (id: string) => void;
  setActiveDrawLayer: (id: string | null) => void;
  setPickedLayer: (p: PickedLayer | null) => void;
}

// Select the currently-open incident (or null in list view).
export const selectActive = (s: CrisisState): Incident | null =>
  s.incidents.find((i) => i.id === s.activeIncidentId) ?? null;

export const useActiveIncident = (): Incident | null => useCrisisStore(selectActive);

// Find which incident owns a given draw layer id.
export function incidentOfLayer(s: CrisisState, layerId: string): Incident | null {
  return s.incidents.find((i) => i.drawLayers.some((l) => l.id === layerId)) ?? null;
}

// Patch the active incident immutably.
function patchActive(s: CrisisState, fn: (inc: Incident) => Incident): Partial<CrisisState> {
  if (!s.activeIncidentId) return {};
  return { incidents: s.incidents.map((i) => (i.id === s.activeIncidentId ? fn(i) : i)) };
}

// Patch whichever incident owns the given layer.
function patchLayerOwner(s: CrisisState, layerId: string, fn: (inc: Incident) => Incident): Partial<CrisisState> {
  return {
    incidents: s.incidents.map((i) =>
      i.drawLayers.some((l) => l.id === layerId) ? fn(i) : i
    ),
  };
}

export const useCrisisStore = create<CrisisState>()(
  persist(
    (set) => ({
      open: false,
      activeIncidentId: null,
      activeTab: 'situation-report',
      activeDrawLayerId: null,
      pickedLayer: null,
      incidents: [],

      toggle: () => set((s) => (s.open ? { open: false } : { open: true, activeIncidentId: null })),
      close: () => set({ open: false }),
      setOpen: (open) => set({ open }),
      setTab: (activeTab) => set({ activeTab }),

      createIncident: () => {
        const inc = newIncident();
        set((s) => ({ incidents: [...s.incidents, inc], activeIncidentId: inc.id, open: true }));
        return inc.id;
      },
      openIncident: (id) => set({ activeIncidentId: id, open: true }),
      backToList: () => set({ activeIncidentId: null }),
      removeIncident: (id) =>
        set((s) => ({
          incidents: s.incidents.filter((i) => i.id !== id),
          activeIncidentId: s.activeIncidentId === id ? null : s.activeIncidentId,
        })),

      update: (patch) => set((s) => patchActive(s, (inc) => ({ ...inc, ...patch }))),
      setShareToken: (token) => set((s) => patchActive(s, (inc) => ({ ...inc, shareToken: token }))),

      addShareLink: (token, url) =>
        set((s) => patchActive(s, (inc) => ({
          ...inc,
          shareToken: token,
          shareLinks: [
            ...(inc.shareLinks ?? []),
            { token, url, createdAt: new Date().toISOString(), active: true },
          ],
        }))),

      deactivateShareLink: (token) =>
        set((s) => patchActive(s, (inc) => {
          const updated = (inc.shareLinks ?? []).map((l) =>
            l.token === token ? { ...l, active: false } : l
          );
          const anyActive = updated.find((l) => l.active);
          return { ...inc, shareToken: anyActive?.token ?? null, shareLinks: updated };
        })),

      addPersonnelMember: (name, org) =>
        set((s) => patchActive(s, (inc) => ({
          ...inc,
          personnel: [...(inc.personnel ?? []), { id: uid(), name, organization: org || undefined }],
        }))),

      removePersonnelMember: (id) =>
        set((s) => patchActive(s, (inc) => ({
          ...inc,
          personnel: (inc.personnel ?? []).filter((p) => p.id !== id),
        }))),

      addRole: (role) =>
        set((s) => patchActive(s, (inc) => ({ ...inc, roles: [...inc.roles, { ...role, id: uid(), builtin: false }] }))),

      updateRole: (id, patch) =>
        set((s) => patchActive(s, (inc) => ({ ...inc, roles: inc.roles.map((r) => (r.id === id ? { ...r, ...patch } : r)) }))),

      removeRole: (id) =>
        set((s) => patchActive(s, (inc) => {
          const toRemove = new Set<string>();
          const collect = (pid: string) => {
            toRemove.add(pid);
            inc.roles.filter((r) => r.parentId === pid).forEach((c) => collect(c.id));
          };
          collect(id);
          return {
            ...inc,
            roles: inc.roles.filter((r) => !toRemove.has(r.id)),
            assignments: inc.assignments.filter((a) => !toRemove.has(a.roleId)),
          };
        })),

      restoreBuiltinRole: (roleId) =>
        set((s) => patchActive(s, (inc) => {
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

      resetRoles: () => set((s) => patchActive(s, (inc) => ({ ...inc, roles: DEFAULT_ROLES }))),

      assignRole: (roleId, name, org) =>
        set((s) => patchActive(s, (inc) => {
          const now = new Date().toISOString();
          const role = inc.roles.find((r) => r.id === roleId);
          const endPrevious = !role?.isSupport;
          // End any other active assignment for this person across all roles
          // (one person cannot hold more than one role at a time).
          const assignments = inc.assignments.map((a) => {
            if (a.endedAt) return a;
            if (a.name.toLowerCase() === name.toLowerCase() && a.roleId !== roleId) {
              return { ...a, endedAt: now };
            }
            if (endPrevious && a.roleId === roleId) {
              return { ...a, endedAt: now };
            }
            return a;
          });
          return {
            ...inc,
            assignments: [
              ...assignments,
              { id: uid(), roleId, name, organization: org || undefined, startedAt: now },
            ],
          };
        })),

      endAssignment: (id) =>
        set((s) => patchActive(s, (inc) => ({
          ...inc,
          assignments: inc.assignments.map((a) => (a.id === id ? { ...a, endedAt: new Date().toISOString() } : a)),
        }))),

      addActionEntry: (type = 'action') =>
        set((s) => patchActive(s, (inc) => ({
          ...inc,
          actionLog: [{ id: uid(), timestamp: new Date().toISOString(), description: '', entryType: type }, ...inc.actionLog],
        }))),

      updateActionEntry: (id, patch) =>
        set((s) => patchActive(s, (inc) => ({
          ...inc,
          actionLog: inc.actionLog.map((e) => (e.id === id ? { ...e, ...patch } : e)),
        }))),

      removeActionEntry: (id) =>
        set((s) => patchActive(s, (inc) => ({ ...inc, actionLog: inc.actionLog.filter((e) => e.id !== id) }))),

      addDrawLayer: (layer) => {
        const id = uid();
        set((s) => patchActive(s, (inc) => ({
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
    }),
    {
      name: 'gsoc-crisis-v3',
      partialize: (s) => ({ incidents: s.incidents }),
    }
  )
);

// ── Share helper ──────────────────────────────────────────────────────────────

export function extractPublicState(inc: Incident, publishedAt?: string): CrisisPublicState {
  return {
    incidentName: inc.incidentName,
    incidentDatetime: inc.incidentDatetime,
    incidentLocation: inc.incidentLocation,
    incidentType: inc.incidentType,
    incidentStatus: inc.incidentStatus,
    executiveSummary: inc.executiveSummary,
    roles: inc.roles,
    assignments: inc.assignments,
    actionLog: inc.actionLog,
    drawLayers: inc.drawLayers,
    publishedAt: publishedAt ?? new Date().toISOString(),
    lastUpdated: new Date().toISOString(),
  };
}
