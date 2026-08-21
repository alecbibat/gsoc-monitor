import { useEffect, useRef } from 'react';
import { useAuthStore } from '../auth/authStore';
import { useCrisisStore, useActiveIncident, extractPublicState, type Incident } from './crisisStore';
// serverCanon normalizes before serializing and EXCLUDES the action log and
// the checklist map. Server-origin blobs may carry retired taxonomy values
// that the store rewrites on ingest — canonicalizing both sides identically
// is what keeps that rewrite from registering as a local edit (see
// syncCanon.ts for why a phantom edit here is dangerous). The log and the
// checklists are excluded because they sync through their own per-entry
// endpoints (logSync.ts / checklistSync.ts), never via blob PUT.
import { entryCanon, mergeActionLogs, serverCanon, stableStringify } from './syncCanon';
import * as logSync from './logSync';
import { inflightChecklistIds, mergeChecklists } from './checklistSync';
import type { ChecklistStateMap } from './checklistTemplate';

// "Saved" is only truthful when the log engine is also idle (and vice versa).
logSync.registerBlobIdleCheck(() => pending.size === 0);

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
  const isCreate = method === 'POST';
  serverState.set(incident.id, serverCanon(incident)); // optimistic baseline
  setSync('saving');
  // Updates omit the action log and the checklist map: the server preserves
  // its own copies on blob writes (they travel through their per-entry
  // endpoints), so sending them would only waste the 5 MB body budget.
  // Creates keep them — the insert seeds the server with the client's
  // initial state.
  const body = isCreate ? incident : { ...incident, actionLog: undefined, checklists: undefined };
  return fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  })
    .then(async (res) => {
      if (!res.ok) throw new Error(String(res.status));
      if (isCreate) {
        // Baseline the log from the server's RESPONSE, not from what we sent:
        // if this POST hit the upsert path (retry after a lost response, or
        // the tab-close beacon), the server kept its own log and the sent one
        // never landed. In-flight local entries keep their unsynced state so
        // the log watcher still pushes them.
        try {
          const data = await res.json() as Incident;
          const remoteLog = Array.isArray(data?.actionLog) ? data.actionLog : [];
          logSync.applyRemoteLog(incident.id, remoteLog, logSync.keepLocalEntryIds());
        } catch {
          /* body unavailable — the next SSE echo rebuilds the baseline */
        }
      }
      // Only clear to "saved" if nothing newer is queued anywhere.
      if (!pending.has(incident.id) && !logSync.hasPendingWork()) setSync('saved');
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
      if (ok) serverState.set(incident.id, serverCanon(incident));
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
        for (const inc of incidents) {
          serverState.set(inc.id, serverCanon(inc));
          logSync.seedBaseline(inc);
        }
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
        const canon = serverCanon(inc);
        const known = serverState.get(inc.id);
        if (known === canon) continue; // matches server / just applied from a peer
        if (known === undefined) {
          pushIncident(inc, 'POST'); // newly created
        } else {
          scheduleSync(inc); // changed — debounce the PUT
        }
      }

      // Log changes sync separately, per entry, through the append endpoints.
      logSync.syncLogsFromStore(next);

      for (const id of [...serverState.keys()]) {
        if (!nextIds.has(id)) {
          serverState.delete(id);
          logSync.dropIncident(id);
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
      // Don't stomp a blob edit we're still saving locally — our write wins,
      // and its echo (which carries the server's merged log) converges us.
      if (pending.has(inc.id)) return;

      const remoteLog = Array.isArray(inc.actionLog) ? inc.actionLog : [];
      const local = useCrisisStore.getState().incidents.find((i) => i.id === inc.id);
      // The server log wins except for local entries whose push is still in
      // flight — those keep their local version until their own echo lands.
      const keep = logSync.keepLocalEntryIds();
      const mergedLog = mergeActionLogs(remoteLog, local?.actionLog ?? [], keep);

      // Checklists reconcile the same way: server map wins, items with an
      // in-flight toggle keep their local state. This also catches upserts
      // where ONLY the checklist changed (a share-link viewer checking an
      // item) — the blob canon excludes the map, so blobSame stays true.
      const rawChk = (inc as { checklists?: unknown }).checklists;
      const remoteChk: ChecklistStateMap =
        rawChk && typeof rawChk === 'object' && !Array.isArray(rawChk)
          ? (rawChk as ChecklistStateMap)
          : {};
      const mergedChk = mergeChecklists(remoteChk, local?.checklists ?? {}, inflightChecklistIds(inc.id));
      const chkSame =
        local !== undefined && stableStringify(mergedChk) === stableStringify(local.checklists ?? {});

      const canon = serverCanon(inc);
      const blobSame = serverState.get(inc.id) === canon;
      const logSame = local !== undefined && entryCanon(mergedLog) === entryCanon(local.actionLog);
      if (blobSame && logSame && chkSame) return; // our own echo / no change

      serverState.set(inc.id, canon);
      logSync.applyRemoteLog(inc.id, remoteLog, keep);
      useCrisisStore.getState().applyRemoteUpsert({ ...inc, actionLog: mergedLog, checklists: mergedChk });
    });

    es.addEventListener('delete', (e) => {
      let id: string | undefined;
      try { id = JSON.parse((e as MessageEvent).data).id; } catch { return; }
      if (!id || pending.has(id)) return;
      serverState.delete(id);
      logSync.dropIncident(id);
      useCrisisStore.getState().applyRemoteDelete(id);
    });

    // EventSource reconnects automatically on transient errors.
    es.onerror = () => { /* handled by the browser's built-in retry */ };

    return () => es.close();
  }, [user]);

  // Flush unsaved edits before the tab goes away.
  useEffect(() => {
    if (!user) return;
    const flushAll = () => { flushPending(); logSync.flushLogPatches(); };
    const onVisibility = () => { if (document.visibilityState === 'hidden') flushAll(); };
    window.addEventListener('pagehide', flushAll);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', flushAll);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [user]);

  return null;
}
