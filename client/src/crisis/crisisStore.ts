import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type IncidentStatus = 'active' | 'contained' | 'resolved';

export type IncidentType =
  | 'wildfire'
  | 'hurricane'
  | 'earthquake'
  | 'flood'
  | 'chemical'
  | 'mass-casualty'
  | 'cyber'
  | 'security'
  | 'severe-weather'
  | 'other';

export type CrisisTab = 'situation-report';

interface CrisisFields {
  incidentName: string;
  incidentDatetime: string;
  incidentLocation: string;
  incidentType: IncidentType;
  incidentStatus: IncidentStatus;
  executiveSummary: string;
}

interface CrisisState extends CrisisFields {
  open: boolean;
  activeTab: CrisisTab;
  personnel: Record<string, string>; // roleId → name
  toggle: () => void;
  close: () => void;
  setTab: (tab: CrisisTab) => void;
  update: (patch: Partial<CrisisFields>) => void;
  setPersonnel: (roleId: string, value: string) => void;
  reset: () => void;
}

const DEFAULTS: CrisisFields = {
  incidentName: '',
  incidentDatetime: '',
  incidentLocation: '',
  incidentType: 'other',
  incidentStatus: 'active',
  executiveSummary: '',
};

export const useCrisisStore = create<CrisisState>()(
  persist(
    (set) => ({
      open: false,
      activeTab: 'situation-report',
      personnel: {},
      ...DEFAULTS,
      toggle: () => set((s) => ({ open: !s.open })),
      close: () => set({ open: false }),
      setTab: (activeTab) => set({ activeTab }),
      update: (patch) => set(patch),
      setPersonnel: (roleId, value) =>
        set((s) => ({ personnel: { ...s.personnel, [roleId]: value } })),
      reset: () => set({ ...DEFAULTS, personnel: {} }),
    }),
    { name: 'gsoc-crisis-v1' }
  )
);
