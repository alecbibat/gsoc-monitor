import { useMemo } from 'react';
import { create } from 'zustand';
import {
  isCrisisTemplatesConfig, resolveChecklist, resolveIntake,
  retiredChecklistEntries, retiredIntakeEntries,
  type CrisisTemplatesConfig, type RetiredChecklistEntry, type RetiredIntakeEntry,
} from './model';
import type { ChecklistStateMap, ChecklistTemplate } from '../checklistTemplate';
import type { IntakeAnswers, IntakeTemplate } from '../intakeTemplate';

// ── Editor-side crisis templates ─────────────────────────────────────────────
//
// The effective checklist / intake config (built-in defaults + admin
// overrides) for signed-in editors. Loaded once per sign-in by IncidentSync,
// reloaded when the incidents SSE stream says an admin saved (`templates`
// event) and after a reconnect. NOT for the share page — that fetches its own
// scope-filtered copy through the share token (CrisisShareView), so this store
// must stay out of the share bundle.

export type TemplatesStatus = 'idle' | 'loading' | 'ready' | 'error';

interface TemplatesState {
  config: CrisisTemplatesConfig | null;
  status: TemplatesStatus;
  error: string | null;
  /** Fetch the effective config; concurrent calls share one request. */
  load: () => Promise<void>;
  /** Adopt a config the server just returned (admin saves). */
  setConfig: (config: CrisisTemplatesConfig) => void;
}

let inflight: Promise<void> | null = null;

export const useTemplatesStore = create<TemplatesState>((set) => ({
  config: null,
  status: 'idle',
  error: null,

  load: () => {
    if (inflight) return inflight;
    set((s) => ({ status: s.config ? s.status : 'loading' }));
    inflight = fetch('/api/crisis-templates', { credentials: 'include' })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body: unknown = await res.json();
        if (!isCrisisTemplatesConfig(body)) throw new Error('unexpected response');
        set({ config: body, status: 'ready', error: null });
      })
      .catch((err: unknown) => {
        // Keep the last good config: a reload failing mid-incident must not
        // blank the checklist an operator is working from.
        const msg = err instanceof Error ? err.message : String(err);
        console.warn('[templates] load failed:', msg);
        set((s) => (s.config ? { error: msg } : { status: 'error', error: msg }));
      })
      .finally(() => { inflight = null; });
    return inflight;
  },

  setConfig: (config) => set({ config, status: 'ready', error: null }),
}));

export const useCrisisTemplates = () => useTemplatesStore((s) => s.config);

export interface ResolvedChecklist {
  template: ChecklistTemplate | null;
  retiredFor: (state: ChecklistStateMap) => RetiredChecklistEntry[];
  status: TemplatesStatus;
  error: string | null;
  reload: () => Promise<void>;
}

/** The checklist an incident of this type at this property sees. */
export function useResolvedChecklist(incidentType: string | null, propertyId: string | null): ResolvedChecklist {
  const config = useTemplatesStore((s) => s.config);
  const status = useTemplatesStore((s) => s.status);
  const error = useTemplatesStore((s) => s.error);
  const load = useTemplatesStore((s) => s.load);
  const template = useMemo(
    () => (config ? resolveChecklist(config, incidentType, propertyId) : null),
    [config, incidentType, propertyId]
  );
  const retiredFor = useMemo(
    () => (state: ChecklistStateMap) => (config && template ? retiredChecklistEntries(config, template, state) : []),
    [config, template]
  );
  return { template, retiredFor, status, error, reload: load };
}

export interface ResolvedIntake {
  template: IntakeTemplate | null;
  retiredFor: (answers: IntakeAnswers) => RetiredIntakeEntry[];
  status: TemplatesStatus;
  error: string | null;
  reload: () => Promise<void>;
}

/** The intake questionnaire an incident of this type at this property sees. */
export function useResolvedIntake(incidentType: string | null, propertyId: string | null): ResolvedIntake {
  const config = useTemplatesStore((s) => s.config);
  const status = useTemplatesStore((s) => s.status);
  const error = useTemplatesStore((s) => s.error);
  const load = useTemplatesStore((s) => s.load);
  const template = useMemo(
    () => (config ? resolveIntake(config, incidentType, propertyId) : null),
    [config, incidentType, propertyId]
  );
  const retiredFor = useMemo(
    () => (answers: IntakeAnswers) => (config && template ? retiredIntakeEntries(config, template, answers) : []),
    [config, template]
  );
  return { template, retiredFor, status, error, reload: load };
}
