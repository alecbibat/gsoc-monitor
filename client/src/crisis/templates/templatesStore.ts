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
  /** Fetch the effective config; calls during a fetch coalesce into one follow-up. */
  load: () => Promise<void>;
  /** Adopt a config the server just returned (admin saves). */
  setConfig: (config: CrisisTemplatesConfig) => void;
}

// One request at a time. A load() asked for while one is running queues ONE
// follow-up instead of sharing it: the running GET may have been answered
// before the save that prompted the new call (two quick admin saves, or a
// `templates` event landing mid-reconnect), and sharing it would strand the
// editor on the older config until the next event.
let inflight: Promise<void> | null = null;
let followUp: Promise<void> | null = null;
// Bumped by setConfig: a GET that started before an admin's save response was
// adopted must not overwrite it with what may be the pre-save config (the
// save's `templates` event triggers a fresh load anyway).
let generation = 0;

function describeLoadError(status: number): string {
  if (status === 401) return 'Your session has expired — sign in again';
  if (status === 403) return 'Not permitted to read the templates';
  if (status >= 500) return `Server error (${status}) — try again shortly`;
  return `HTTP ${status}`;
}

export const useTemplatesStore = create<TemplatesState>((set) => {
  const start = (): Promise<void> => {
    const gen = generation;
    set((s) => ({ status: s.config ? s.status : 'loading' }));
    inflight = fetch('/api/crisis-templates', { credentials: 'include', cache: 'no-cache' })
      .then(async (res) => {
        if (!res.ok) throw new Error(describeLoadError(res.status));
        const body: unknown = await res.json();
        if (!isCrisisTemplatesConfig(body)) throw new Error('Unexpected response from the server');
        if (gen === generation) set({ config: body, status: 'ready', error: null });
      })
      .catch((err: unknown) => {
        if (gen !== generation) return; // superseded by a save's config
        // Keep the last good config: a reload failing mid-incident must not
        // blank the checklist an operator is working from.
        const msg = err instanceof Error ? err.message : String(err);
        console.warn('[templates] load failed:', msg);
        set((s) => (s.config ? { error: msg } : { status: 'error', error: msg }));
      })
      .finally(() => { inflight = null; });
    return inflight;
  };

  return {
    config: null,
    status: 'idle',
    error: null,

    load: () => {
      if (!inflight) return start();
      if (!followUp) {
        followUp = inflight.then(() => {
          followUp = null;
          // A caller may have started a fresh load in the gap — join it.
          return inflight ?? start();
        });
      }
      return followUp;
    },

    setConfig: (config) => {
      generation += 1;
      set({ config, status: 'ready', error: null });
    },
  };
});

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
