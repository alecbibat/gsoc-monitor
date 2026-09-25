import { useCrisisStore } from './crisisStore';
import { useSyncHealth } from './syncHealth';

// ── Save-status indicator ──────────────────────────────────────────────────────
// The incident sync engine's state (IncidentSync) as a dot + label. Its own
// module so full-screen views that cover the incident header — the after-
// action report, which "autosaves" — can show it too.

export function SyncIndicator() {
  const syncState = useCrisisStore((s) => s.syncState);
  const authLapsed = useSyncHealth((s) => s.authLapsed);

  // A lapsed sign-in outranks the save state: every retry fails until the
  // operator signs in again, so this one is spelled out on phones too.
  if (authLapsed) {
    const label = 'Signed out — sign in again to save';
    return (
      <div className="flex items-center gap-1.5 text-[10px]" title={label} role="status" aria-live="polite">
        <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-red-500" />
        <span className="max-w-[10rem] leading-tight text-red-400/90 sm:max-w-none">{label}</span>
      </div>
    );
  }

  if (syncState === 'idle') return null;

  const cfg = {
    saving: { dot: 'bg-amber-400', text: 'text-white/45', label: 'Saving…', pulse: true },
    saved:  { dot: 'bg-green-500', text: 'text-white/40', label: 'All changes saved', pulse: false },
    error:  { dot: 'bg-red-500',   text: 'text-red-400/80', label: 'Unsaved — will retry', pulse: true },
  }[syncState];

  return (
    <div className="flex items-center gap-1.5 text-[10px]" title={cfg.label} aria-live="polite">
      <span className={`h-1.5 w-1.5 rounded-full ${cfg.dot} ${cfg.pulse ? 'animate-pulse' : ''}`} />
      {/* Visually hidden on phones (dot only), but still announced. */}
      <span className={`sr-only sm:not-sr-only ${cfg.text}`}>{cfg.label}</span>
    </div>
  );
}
