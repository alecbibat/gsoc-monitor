import { create } from 'zustand';
import type { TemplateScope } from '../crisis/templates/model';

// Open/closed state of the full-screen admin page, so it can be opened from
// anywhere (the user menu, an incident's Checklists / Intake / IAP tab) and
// land on the right section — pre-scoped to that incident's type and property
// when opened from an incident.

export type AdminSection = 'checklists' | 'intake' | 'iap' | 'roles' | 'team' | 'access';

export const ADMIN_SECTIONS: { id: AdminSection; label: string; group: 'Crisis templates' | 'Team & access' }[] = [
  { id: 'checklists', label: 'Checklists', group: 'Crisis templates' },
  { id: 'intake', label: 'Intake questions', group: 'Crisis templates' },
  { id: 'iap', label: 'IAP documents', group: 'Crisis templates' },
  { id: 'roles', label: 'Checklist roles', group: 'Crisis templates' },
  { id: 'team', label: 'Team members', group: 'Team & access' },
  { id: 'access', label: 'Sign-up & share access', group: 'Team & access' },
];

export function isAdminSection(v: unknown): v is AdminSection {
  return typeof v === 'string' && ADMIN_SECTIONS.some((s) => s.id === v);
}

interface AdminPageState {
  open: boolean;
  section: AdminSection;
  /** Scope the template editors should start on (null = General). */
  scope: TemplateScope | null;
  openAdmin: (section?: AdminSection, scope?: TemplateScope | null) => void;
  setSection: (section: AdminSection) => void;
  close: () => void;
}

export const useAdminPageStore = create<AdminPageState>((set) => ({
  open: false,
  section: 'checklists',
  scope: null,
  openAdmin: (section, scope) =>
    set((s) => ({ open: true, section: section ?? s.section, scope: scope === undefined ? s.scope : scope })),
  setSection: (section) => set({ section }),
  close: () => set({ open: false }),
}));
