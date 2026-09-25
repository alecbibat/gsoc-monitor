import { useEffect } from 'react';
import { useAuthStore } from '../../auth/authStore';
import { useAdminPageStore } from '../../admin/adminPageStore';
import { useCrisisStore } from '../crisisStore';
import type { TemplatesStatus } from './templatesStore';

// Shared chrome for the editor's Checklists and Intake tabs: the templates
// load / error states, the admin "Edit templates" shortcut and the missing-
// property hint. EDITOR-ONLY — it imports the auth, admin and crisis stores,
// so the share page must never import it (unlike the rest of templates/).

/** Kick the templates load if nothing has started it yet (e.g. a tab opened before IncidentSync ran). */
export function useEnsureTemplatesLoaded(status: TemplatesStatus, reload: () => Promise<void>): void {
  useEffect(() => {
    if (status === 'idle') void reload();
  }, [status, reload]);
}

/**
 * Loading / failure states around a resolved template. Renders the full-size
 * placeholder while there is nothing to show yet, and a slim warning when a
 * refresh failed but the last good version is still on screen.
 */
export function TemplatesLoadState({ what, status, error, hasTemplate, reload }: {
  /** "checklists" / "intake questions" */
  what: string;
  status: TemplatesStatus;
  error: string | null;
  hasTemplate: boolean;
  reload: () => Promise<void>;
}) {
  if (hasTemplate) {
    if (!error) return null;
    return (
      <p role="status" className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 rounded border border-amber-400/20 bg-amber-400/6 px-3 py-1.5 text-[10px] text-amber-200/80">
        Couldn't refresh the {what} — showing the last version loaded.
        <button onClick={() => void reload()} className="underline decoration-amber-200/40 underline-offset-2 hover:text-amber-100">
          Retry
        </button>
      </p>
    );
  }
  if (status === 'error') {
    return (
      <div role="alert" className="rounded-lg border border-red-400/25 bg-red-400/8 px-4 py-5 text-center">
        <p className="text-[12px] text-red-200/90">Couldn't load the {what}.</p>
        {error && <p className="mt-1 text-[10px] text-red-200/50">{error}</p>}
        <button
          onClick={() => void reload()}
          className="mt-3 rounded border border-white/20 bg-white/8 px-3 py-1.5 text-[11px] text-white/75 transition hover:border-white/35"
        >
          Try again
        </button>
      </div>
    );
  }
  return (
    <div role="status" className="flex items-center justify-center gap-2.5 rounded-lg border border-white/8 bg-white/4 px-4 py-8 text-[12px] text-white/40">
      <span aria-hidden className="h-4 w-4 animate-spin rounded-full border-2 border-white/20 border-t-accent" />
      Loading {what}…
    </div>
  );
}

/** Admin-only shortcut into the template editor, pre-scoped to this incident's type + property. */
export function EditTemplatesButton({ section, incidentType, propertyId }: {
  section: 'checklists' | 'intake';
  incidentType: string | null;
  propertyId: string | null;
}) {
  const isAdmin = useAuthStore((s) => s.user?.role === 'admin');
  if (!isAdmin) return null;
  return (
    <button
      onClick={() => useAdminPageStore.getState().openAdmin(section, { incidentType, propertyId })}
      title={`Open Admin → ${section === 'checklists' ? 'Checklists' : 'Intake questions'} for this incident's type and property`}
      className="shrink-0 rounded border border-white/12 bg-white/4 px-2.5 py-1 text-[10px] text-white/55 transition hover:border-white/25 hover:text-white/80"
    >
      ✎ Edit templates
    </button>
  );
}

/** Nudge when the incident has no property yet — property-specific items can't apply without one. */
export function MissingPropertyHint({ what }: { what: string }) {
  return (
    <p className="mt-1 text-[10px] text-white/35">
      No property set, so only general and incident-type {what} apply.{' '}
      <button
        onClick={() => useCrisisStore.getState().setTab('situation-report')}
        className="text-accent/70 underline decoration-accent/30 underline-offset-2 transition hover:text-accent"
      >
        Set the property
      </button>{' '}
      in Incident Information to add property-specific ones.
    </p>
  );
}
