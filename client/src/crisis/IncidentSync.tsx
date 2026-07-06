import { useEffect, useRef } from 'react';
import { useAuthStore } from '../auth/authStore';
import { useCrisisStore, useActiveIncident, extractPublicState, type Incident } from './crisisStore';

// Debounced PUT per incident (keyed by id); avoids hammering the API on rapid edits.
const pendingPuts = new Map<string, ReturnType<typeof setTimeout>>();

function debouncedPut(incident: Incident) {
  const existing = pendingPuts.get(incident.id);
  if (existing) clearTimeout(existing);
  pendingPuts.set(incident.id, setTimeout(async () => {
    try {
      const res = await fetch(`/api/incidents/${incident.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(incident),
      });
      if (!res.ok) console.warn('[incident-sync] PUT failed:', res.status);
    } catch (e) {
      console.error('[incident-sync]', e);
    } finally {
      pendingPuts.delete(incident.id);
    }
  }, 1500));
}

// Auto-push the active incident to all active share links on every change.
// Lives here (always mounted) rather than in the crisis overlay, which is
// lazy-loaded and only mounted while open — live share links must keep
// updating even with the overlay closed.
function useAutoPublish() {
  const inc = useActiveIncident();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!inc) return;
    const activeTokens = (inc.shareLinks ?? [])
      .filter((l) => l.active)
      .map((l) => l.token);
    // Legacy fallback: if shareToken set but shareLinks not yet populated
    if (activeTokens.length === 0 && inc.shareToken) activeTokens.push(inc.shareToken);
    if (activeTokens.length === 0) return;

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      const body = JSON.stringify(extractPublicState(inc));
      for (const token of activeTokens) {
        fetch(`/api/crisis/share/${token}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body,
        })
          .then((res) => {
            if (!res.ok) console.warn(`[crisis] live update failed (${res.status}) for share ${token}`);
          })
          .catch(console.error);
      }
    }, 1_500);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [inc]);
}

export function IncidentSync() {
  const user = useAuthStore((s) => s.user);
  const setIncidents = useCrisisStore((s) => s.setIncidents);
  const loaded = useRef(false);

  useAutoPublish();

  // Load all incidents from the server on first auth.
  useEffect(() => {
    if (!user || loaded.current) return;
    loaded.current = true;
    fetch('/api/incidents', { credentials: 'include' })
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status}`);
        return r.json() as Promise<Incident[]>;
      })
      .then(setIncidents)
      .catch((e) => console.error('[incident-sync] initial load failed:', e));
  }, [user, setIncidents]);

  // Watch the store and push changes back to the server.
  useEffect(() => {
    if (!user) return;

    let prev = useCrisisStore.getState().incidents;

    const unsub = useCrisisStore.subscribe((state) => {
      const next = state.incidents;
      if (next === prev) return;

      const prevMap = new Map(prev.map((i) => [i.id, i]));
      const nextMap = new Map(next.map((i) => [i.id, i]));

      for (const inc of next) {
        const old = prevMap.get(inc.id);
        if (old === undefined) {
          // Newly created — POST immediately.
          fetch('/api/incidents', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(inc),
          }).catch(console.error);
        } else if (old !== inc) {
          // Changed — debounce the PUT.
          debouncedPut(inc);
        }
      }

      for (const inc of prev) {
        if (!nextMap.has(inc.id)) {
          // Deleted.
          fetch(`/api/incidents/${inc.id}`, { method: 'DELETE', credentials: 'include' })
            .catch(console.error);
        }
      }

      prev = next;
    });

    return unsub;
  }, [user]);

  return null;
}
