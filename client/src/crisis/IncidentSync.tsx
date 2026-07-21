import { useEffect, useRef } from 'react';
import { useAuthStore } from '../auth/authStore';
import { useCrisisStore, useActiveIncident, extractPublicState, type Incident } from './crisisStore';

// ── Canonical serialization ───────────────────────────────────────────────────
// The change-watcher and the live-sync merge both need to answer "is this
// incident different from what the server has?". A plain JSON.stringify can't:
// Postgres JSONB doesn't preserve key order, so an incident that round-trips
// through the DB (or arrives as our own SSE echo) serializes to different bytes
// despite identical data. stableStringify sorts object keys and drops undefined
// keys — mirroring JSON/JSONB semantics — so equal data always compares equal.
function stableStringify(v: unknown): string | undefined {
  if (v === undefined || typeof v === 'function') return undefined;
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map((x) => stableStringify(x) ?? 'null').join(',')}]`;
  const parts: string[] = [];
  for (const k of Object.keys(v as Record<string, unknown>).sort()) {
    const sv = stableStringify((v as Record<string, unknown>)[k]);
    if (sv === undefined) continue; // omit undefined-valued keys, like JSON does
    parts.push(`${JSON.stringify(k)}:${sv}`);
  }
  return `{${parts.join(',')}}`;
}

// Server-known state per incident id — the baseline the watcher diffs against.
// Populated on load, after each successful push, and whenever a peer's change
// arrives, so replaying a remote edit into the store never echoes back out.
const serverState = new Map<string, string>();

// In-flight debounced writes, keyed by id, keeping the latest incident so a tab
// close can still flush it.
const pending = new Map<string, { timer: ReturnType<typeof setTimeout>; incident: Incident }>();

const setSync = (s: 'idle' | 'saving' | 'saved' | 'error') =>
  useCrisisStore.getState().setSyncState(s);

function pushIncident(incident: Incident, method: 'POST' | 'PUT') {
  const url = method === 'POST' ? '/api/incidents' : `/api/incidents/${incident.id}`;
  serverState.set(incident.id, stableStringify(incident)!); // optimistic baseline
  setSync('saving');
  return fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(incident),
  })
    .then((res) => {
      if (!res.ok) throw new Error(String(res.status));
      // Only clear to "saved" if nothing newer is queued.
      if (!pending.has(incident.id)) setSync('saved');
    })
    .catch((e) => {
      // Roll the baseline back so the next edit re-attempts the push.
      serverState.delete(incident.id);
      setSync('error');
      console.warn('[incident-sync] push failed:', e);
    });
}

function scheduleSync(incident: Incident) {
  const existing = pending.get(incident.id);
  if (existing) clearTimeout(existing.timer);
  setSync('saving');
  const timer = setTimeout(() => {
    pending.delete(incident.id);
    pushIncident(incident, 'PUT');
  }, 1500);
  pending.set(incident.id, { timer, incident });
}

// Best-effort flush of unsaved edits when the tab is hidden or closing. Uses
// sendBeacon (a background POST that still carries the auth cookie); the POST
// route upserts, so it stands in for the pending PUT.
function flushPending() {
  for (const { timer, incident } of pending.values()) {
    clearTimeout(timer);
    try {
      const blob = new Blob([JSON.stringify(incident)], { type: 'application/json' });
      const ok = navigator.sendBeacon('/api/incidents', blob);
      if (ok) serverState.set(incident.id, stableStringify(incident)!);
    } catch {
      /* best effort — nothing more we can do as the page unloads */
    }
  }
  pending.clear();
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
      .then((incidents) => {
        for (const inc of incidents) serverState.set(inc.id, stableStringify(inc)!);
        setIncidents(incidents);
      })
      .catch((e) => console.error('[incident-sync] initial load failed:', e));
  }, [user, setIncidents]);

  // Watch the store and push local changes back to the server.
  useEffect(() => {
    if (!user) return;

    let lastArr = useCrisisStore.getState().incidents;

    const unsub = useCrisisStore.subscribe((state) => {
      const next = state.incidents;
      if (next === lastArr) return; // ignore non-incident state changes (e.g. syncState)
      lastArr = next;

      const nextIds = new Set(next.map((i) => i.id));

      for (const inc of next) {
        const canon = stableStringify(inc)!;
        const known = serverState.get(inc.id);
        if (known === canon) continue; // matches server / just applied from a peer
        if (known === undefined) {
          pushIncident(inc, 'POST'); // newly created
        } else {
          scheduleSync(inc); // changed — debounce the PUT
        }
      }

      for (const id of [...serverState.keys()]) {
        if (!nextIds.has(id)) {
          serverState.delete(id);
          const p = pending.get(id);
          if (p) { clearTimeout(p.timer); pending.delete(id); }
          fetch(`/api/incidents/${id}`, { method: 'DELETE', credentials: 'include' })
            .catch(console.error);
        }
      }
    });

    return unsub;
  }, [user]);

  // Live sync: apply other responders' changes as they happen.
  useEffect(() => {
    if (!user) return;
    const es = new EventSource('/api/incidents/events', { withCredentials: true });

    es.addEventListener('upsert', (e) => {
      let inc: Incident;
      try { inc = JSON.parse((e as MessageEvent).data); } catch { return; }
      if (!inc?.id) return;
      // Don't stomp an edit we're still saving locally — our write wins.
      if (pending.has(inc.id)) return;
      const canon = stableStringify(inc)!;
      if (serverState.get(inc.id) === canon) return; // our own echo / no change
      serverState.set(inc.id, canon);
      useCrisisStore.getState().applyRemoteUpsert(inc);
    });

    es.addEventListener('delete', (e) => {
      let id: string | undefined;
      try { id = JSON.parse((e as MessageEvent).data).id; } catch { return; }
      if (!id || pending.has(id)) return;
      serverState.delete(id);
      useCrisisStore.getState().applyRemoteDelete(id);
    });

    // EventSource reconnects automatically on transient errors.
    es.onerror = () => { /* handled by the browser's built-in retry */ };

    return () => es.close();
  }, [user]);

  // Flush unsaved edits before the tab goes away.
  useEffect(() => {
    if (!user) return;
    const onVisibility = () => { if (document.visibilityState === 'hidden') flushPending(); };
    window.addEventListener('pagehide', flushPending);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', flushPending);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [user]);

  return null;
}
