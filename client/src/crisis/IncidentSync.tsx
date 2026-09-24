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

// Blob writes outstanding per id (POST/PUT), and the ids touched by a local
// write or an SSE event while a reconnect resync is in flight. A resync must
// never apply a GET snapshot that may predate either one.
const blobInflight = new Map<string, number>();
let resyncTouched: Set<string> | null = null;

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
  resyncTouched?.add(incident.id);
  blobInflight.set(incident.id, (blobInflight.get(incident.id) ?? 0) + 1);
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
    })
    .finally(() => {
      const n = (blobInflight.get(incident.id) ?? 1) - 1;
      if (n > 0) blobInflight.set(incident.id, n); else blobInflight.delete(incident.id);
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
  for (const [id, { timer, incident }] of [...pending]) {
    clearTimeout(timer);
    pending.delete(id); // before pushIncident, so its "saved" check sees an empty queue
    let ok = false;
    try {
      const blob = new Blob([JSON.stringify(incident)], { type: 'application/json' });
      ok = navigator.sendBeacon('/api/incidents', blob);
    } catch {
      /* fall through to the regular PUT */
    }
    if (ok) {
      resyncTouched?.add(id);
      serverState.set(id, serverCanon(incident));
    } else {
      // Beacon refused (e.g. body over the 64 KiB keepalive quota). The page is
      // usually still alive (tab hidden, not unloading), so send the normal PUT
      // rather than dropping the edit. On a real unload this is best effort.
      void pushIncident(incident, 'PUT');
    }
  }
}

// Pending auto-publish per incident id. Deliberately NOT cancelled when the
// operator navigates away: the last edit before "back to list" must still
// reach the share links.
const publishTimers = new Map<string, ReturnType<typeof setTimeout>>();

function activeShareTokens(inc: Incident): string[] {
  const tokens = (inc.shareLinks ?? []).filter((l) => l.active).map((l) => l.token);
  // Legacy fallback: if shareToken set but shareLinks not yet populated
  if (tokens.length === 0 && inc.shareToken) tokens.push(inc.shareToken);
  return tokens;
}

// Auto-push the active incident to all active share links on every change.
// Lives here (always mounted) rather than in the crisis overlay, which is
// lazy-loaded and only mounted while open — live share links must keep
// updating even with the overlay closed.
function useAutoPublish() {
  const inc = useActiveIncident();

  useEffect(() => {
    if (!inc) return;
    const id = inc.id;
    // Re-arm per incident: cancel this incident's pending publish first, even
    // when no link is active any more (revoking the last link cancels it).
    const prev = publishTimers.get(id);
    if (prev !== undefined) { clearTimeout(prev); publishTimers.delete(id); }
    if (activeShareTokens(inc).length === 0) return;

    publishTimers.set(id, setTimeout(() => {
      publishTimers.delete(id);
      // Latest state: identical to `inc` while the incident stays open (any
      // change re-runs this effect); after navigation it still skips a deleted
      // incident and respects links deactivated in the meantime.
      const latest = useCrisisStore.getState().incidents.find((i) => i.id === id);
      if (!latest) return;
      const tokens = activeShareTokens(latest);
      if (tokens.length === 0) return;
      const body = JSON.stringify(extractPublicState(latest));
      for (const token of tokens) {
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
    }, 1_500));
    // No per-run cleanup: navigation must not cancel another incident's publish.
  }, [inc]);

  // Real unmount (e.g. sign-out) still drops pending publishes, as before.
  useEffect(() => () => {
    for (const t of publishTimers.values()) clearTimeout(t);
    publishTimers.clear();
  }, []);
}

export function IncidentSync() {
  const user = useAuthStore((s) => s.user);
  const setIncidents = useCrisisStore((s) => s.setIncidents);
  const loaded = useRef(false);
  // Ids deleted (by a peer via SSE, or locally) while the initial GET is in
  // flight; null when no load is pending. The snapshot may predate the delete.
  const deletedDuringLoad = useRef<Set<string> | null>(null);

  useAutoPublish();

  // Load all incidents from the server on first auth.
  useEffect(() => {
    if (!user || loaded.current) return;
    loaded.current = true;
    deletedDuringLoad.current = new Set();
    fetch('/api/incidents', { credentials: 'include' })
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status}`);
        return r.json() as Promise<Incident[]>;
      })
      .then((incidents) => {
        const deleted = deletedDuringLoad.current ?? new Set<string>();
        // Anything already in the store was created locally or applied from SSE
        // while this GET was in flight. It is at least as new as the snapshot and
        // already baselined by that path, so keep it: replacing it would revert a
        // peer's edit, or drop a just-created incident (which the watcher would
        // then DELETE on the server).
        const local = useCrisisStore.getState().incidents;
        const byId = new Map(local.map((i) => [i.id, i]));
        const merged: Incident[] = [];
        for (const inc of incidents) {
          const mine = byId.get(inc.id);
          if (mine) { merged.push(mine); byId.delete(inc.id); continue; }
          if (deleted.has(inc.id)) continue;
          serverState.set(inc.id, serverCanon(inc));
          logSync.seedBaseline(inc);
          merged.push(inc);
        }
        for (const inc of byId.values()) merged.push(inc); // local-only, in store order
        setIncidents(merged);
      })
      .catch((e) => console.error('[incident-sync] initial load failed:', e))
      .finally(() => { deletedDuringLoad.current = null; });
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
          resyncTouched?.add(id);
          serverState.delete(id);
          logSync.dropIncident(id);
          const p = pending.get(id);
          if (p) { clearTimeout(p.timer); pending.delete(id); }
          deletedDuringLoad.current?.add(id);
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
    let es: EventSource | null = null;
    let disposed = false;
    let opens = 0;
    let retryMs = 5_000;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let resyncCtrl: AbortController | null = null;
    let resyncRetry: ReturnType<typeof setTimeout> | undefined;
    let resyncDelay = 5_000;

    const applyUpsert = (inc: Incident) => {
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
      const localLog = local?.actionLog;
      // Element-wise compare = identical to comparing the whole-array canon strings
      // (canon strings are valid JSON values), but reuses the per-entry cache.
      const logSame =
        local !== undefined &&
        Array.isArray(localLog) &&
        mergedLog.length === localLog.length &&
        mergedLog.every((e, i) => entryCanon(e) === entryCanon(localLog[i]));
      if (blobSame && logSame && chkSame) return; // our own echo / no change

      serverState.set(inc.id, canon);
      logSync.applyRemoteLog(inc.id, remoteLog, keep);
      useCrisisStore.getState().applyRemoteUpsert({ ...inc, actionLog: mergedLog, checklists: mergedChk });
    };

    const applyDelete = (id: string) => {
      if (!id || pending.has(id)) return;
      deletedDuringLoad.current?.add(id);
      serverState.delete(id);
      logSync.dropIncident(id);
      useCrisisStore.getState().applyRemoteDelete(id);
    };

    // Events broadcast while the stream was down are gone (no replay), so
    // every reconnect re-reads the list and folds it in through the same
    // merge rules. Skips any incident whose snapshot could predate what we
    // already have: touched by an SSE event or local write during the GET,
    // or with a blob write in flight when it started.
    const resync = () => {
      clearTimeout(resyncRetry); // a new resync supersedes a scheduled retry
      resyncCtrl?.abort();
      const ctrl = new AbortController();
      resyncCtrl = ctrl;
      const touched = new Set<string>();
      resyncTouched = touched;
      const busyAtStart = new Set(blobInflight.keys());
      const skip = (id: string) =>
        touched.has(id) || busyAtStart.has(id) || pending.has(id) || blobInflight.has(id);
      fetch('/api/incidents', { credentials: 'include', signal: ctrl.signal })
        .then((r) => {
          if (!r.ok) throw new Error(String(r.status));
          return r.json() as Promise<Incident[]>;
        })
        .then((incidents) => {
          if (ctrl.signal.aborted || disposed) return;
          if (!Array.isArray(incidents)) throw new Error('unexpected body');
          resyncDelay = 5_000;
          // A local incident with no baseline holds an edit whose push failed
          // (rolled back); the watcher re-pushes it on the next change, so the
          // snapshot must not revert it.
          const unconfirmed = new Set(
            useCrisisStore.getState().incidents.filter((i) => !serverState.has(i.id)).map((i) => i.id)
          );
          // Same for log work: an append or edit that failed offline is rolled
          // back and only retried on the next store change, so the merge below
          // would drop it. Re-queue it now (as the watcher would) so it is in
          // keepLocalEntryIds() and survives the merge; appends are prepended,
          // where the server will put them too. The incident is still applied
          // rather than skipped: a retried append the server already has is a
          // no-op with no echo, which would leave the stale blob in place.
          logSync.syncLogsFromStore(useCrisisStore.getState().incidents);
          const seen = new Set<string>();
          for (const inc of incidents) {
            if (!inc?.id) continue;
            seen.add(inc.id);
            if (!skip(inc.id) && !unconfirmed.has(inc.id)) applyUpsert(inc);
          }
          for (const id of [...serverState.keys()]) {
            if (!seen.has(id) && !skip(id)) applyDelete(id);
          }
        })
        .catch((e) => {
          if (ctrl.signal.aborted || disposed) return;
          console.warn('[incident-sync] resync failed:', e);
          // The stream can be back while the list GET still fails (database
          // still recovering); retry with backoff so the missed changes land
          // without waiting for the next disconnect. If the stream drops again,
          // its next 'connected' resyncs anyway.
          resyncRetry = setTimeout(() => {
            if (!disposed && es?.readyState === EventSource.OPEN) resync();
          }, resyncDelay);
          resyncDelay = Math.min(resyncDelay * 2, 60_000);
        })
        .finally(() => {
          if (resyncTouched === touched) resyncTouched = null;
          if (resyncCtrl === ctrl) resyncCtrl = null;
        });
    };

    const open = () => {
      if (disposed) return;
      const initial = opens++ === 0;
      let seenConnect = false;
      const src = new EventSource('/api/incidents/events', { withCredentials: true });
      es = src;
      src.addEventListener('connected', () => {
        retryMs = 5_000;
        resyncDelay = 5_000;
        // The initial load covers the very first connection; every later one
        // (browser auto-reconnect, or a reopened stream) may have missed events.
        if (initial && !seenConnect) { seenConnect = true; return; }
        seenConnect = true;
        resync();
      });

      src.addEventListener('upsert', (e) => {
        let inc: Incident;
        try { inc = JSON.parse((e as MessageEvent).data); } catch { return; }
        if (!inc?.id) return;
        resyncTouched?.add(inc.id);
        applyUpsert(inc);
      });

      src.addEventListener('delete', (e) => {
        let id: string | undefined;
        try { id = JSON.parse((e as MessageEvent).data).id; } catch { return; }
        if (!id) return;
        resyncTouched?.add(id);
        applyDelete(id);
      });

      // Transient drops auto-reconnect (readyState CONNECTING). A non-200
      // reconnect (401, router 503) CLOSES the stream for good — reopen it
      // with backoff; the new stream's 'connected' triggers a resync.
      src.onerror = () => {
        if (src.readyState !== EventSource.CLOSED || disposed) return;
        clearTimeout(retryTimer);
        retryTimer = setTimeout(open, retryMs);
        retryMs = Math.min(retryMs * 2, 60_000);
      };
    };

    open();
    return () => {
      disposed = true;
      clearTimeout(retryTimer);
      clearTimeout(resyncRetry);
      resyncCtrl?.abort();
      es?.close();
    };
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
