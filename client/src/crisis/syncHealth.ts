import { create } from 'zustand';

// ── Sync health the save dot can't express ───────────────────────────────────
// authLapsed: a save path (incident blob, action-log write, checklist toggle)
// got HTTP 401 — the sign-in lapsed. The engines keep retrying regardless;
// signing in again (in any tab: the session cookie is shared) makes the next
// retry succeed, and any 2xx from those paths clears the flag. Until then the
// operator must be told, because "will retry" alone never gets there.
//
// loadState: IncidentSync's initial incident load, which retries with backoff.
// Until it lands, an empty list means "not loaded", not "no incidents".

export type IncidentLoadState = 'loading' | 'ready' | 'error';

interface SyncHealthState {
  authLapsed: boolean;
  setAuthLapsed: (lapsed: boolean) => void;
  loadState: IncidentLoadState;
  setLoadState: (state: IncidentLoadState) => void;
}

export const useSyncHealth = create<SyncHealthState>()((set, get) => ({
  authLapsed: false,
  setAuthLapsed: (authLapsed) => { if (get().authLapsed !== authLapsed) set({ authLapsed }); },
  loadState: 'loading',
  setLoadState: (loadState) => { if (get().loadState !== loadState) set({ loadState }); },
}));

/** Feed a save path's HTTP status in: 401 flags the lapse, any 2xx clears it. */
export function noteSaveStatus(status: number): void {
  if (status === 401) useSyncHealth.getState().setAuthLapsed(true);
  else if (status >= 200 && status < 300) useSyncHealth.getState().setAuthLapsed(false);
}
