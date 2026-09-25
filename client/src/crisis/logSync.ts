import { useCrisisStore, type ActionLogEntry, type Incident } from './crisisStore';
import { entryCanon } from './syncCanon';
import { noteSaveStatus } from './syncHealth';

// ── Action-log sync engine ───────────────────────────────────────────────────
// The action log does NOT ride the incident blob's last-write-wins PUT: two
// operators logging at once would silently erase each other's entries. Instead
// the server owns the log (blob writes preserve it) and every local log change
// flows through dedicated endpoints:
//   append  POST   /api/incidents/:id/log            (idempotent by entry id)
//   edit    PATCH  /api/incidents/:id/log/:entryId
//   remove  DELETE /api/incidents/:id/log/:entryId
// This module diffs the store's logs against a per-entry baseline and pushes
// the difference. IncidentSync calls into it from its store watcher and its
// SSE handlers.
//
// Failure-handling rules (each closes a reviewed lost-update path):
// - An entry is only ever APPENDed when it has no baseline AND its incident's
//   baseline map exists (i.e. the incident itself is known to the server via a
//   confirmed response). Entries created while the incident's create-POST is
//   in flight simply wait for the confirmation.
// - A failed PATCH leaves the baseline untouched, so the retry is another
//   PATCH — never a re-POST (the server no-ops duplicate ids, which would
//   swallow the edit while reporting success).
// - A PATCH that 404s means a peer deleted the entry: the edit yields
//   deterministically (delete wins) — mark the entry synced so nothing
//   re-appends it; the next broadcast drops it from the local store.
// - A failure arms ONE backoff timer (5 s doubling to 60 s) that re-runs the
//   diff. A rolled-back write is not in any queue, so "nothing in flight"
//   does not mean "nothing unsent": the failure stays pending until a re-diff
//   finds nothing left to push.
// - A DELETE that fails in transit puts the entry's baseline back, so that
//   re-diff sends it again (the entry is still missing locally). A refusal
//   (403) is final and is not retried.

const baselines = new Map<string, Map<string, string>>(); // incidentId → entryId → canon
const inflight = new Set<string>();                       // appends in flight
const patchInflight = new Set<string>();                  // PATCHes in flight
const pendingDeletes = new Set<string>();                 // deletes deferred behind an in-flight append
let deletesInflight = 0;                                  // DELETEs in flight
const pendingPatches = new Map<string, { incidentId: string; timer: ReturnType<typeof setTimeout> }>();
const PATCH_DEBOUNCE_MS = 800;
const RETRY_BASE_MS = 5_000;
const RETRY_MAX_MS = 60_000;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryDelay = RETRY_BASE_MS;

const setSync = (s: 'saving' | 'saved' | 'error') => useCrisisStore.getState().setSyncState(s);

// The blob-sync side registers a check so "saved" is only shown when BOTH
// modules are quiet.
let blobIdle: () => boolean = () => true;
export function registerBlobIdleCheck(fn: () => boolean) {
  blobIdle = fn;
}

const busy = () =>
  inflight.size > 0 || patchInflight.size > 0 || pendingPatches.size > 0 || deletesInflight > 0;

/** True while any log write is queued, in flight, or waiting to be retried. */
export function hasPendingWork(): boolean {
  return busy() || retryTimer !== null;
}

/** True when the only log work left is a failed write waiting on its retry. */
export function hasOnlyFailedWork(): boolean {
  return !busy() && retryTimer !== null;
}

const resync = () => syncLogsFromStore(useCrisisStore.getState().incidents);

// The indicator says "Unsaved — will retry"; this is the retry. Failures
// land here, and only one timer is ever armed.
function markFailed() {
  setSync('error');
  if (retryTimer !== null) return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    retryDelay = Math.min(retryDelay * 2, RETRY_MAX_MS);
    resync();
    quietIfIdle(); // nothing re-queued → nothing was left to push
  }, retryDelay);
}

const quietIfIdle = () => {
  if (busy()) return;
  if (retryTimer !== null) {
    // The queue drained with a failure still armed (another write landed, or
    // the watcher already re-sent it): re-diff now rather than sit on
    // "Unsaved" until the timer. Anything still unsent goes out again; if
    // nothing does, the failure has been made good.
    clearTimeout(retryTimer);
    retryTimer = null;
    resync();
    if (busy()) return;
  }
  retryDelay = RETRY_BASE_MS;
  if (blobIdle()) setSync('saved');
};

/**
 * Entry ids whose local state has not reached the server yet (append or edit
 * in flight, or an edit waiting in the patch debounce). When a remote upsert
 * arrives, these local versions must survive the merge.
 */
export function keepLocalEntryIds(): Set<string> {
  return new Set([...inflight, ...patchInflight, ...pendingPatches.keys()]);
}

/** Record `incident`'s log as known-synced (initial load). */
export function seedBaseline(incident: Incident) {
  const m = new Map<string, string>();
  for (const e of incident.actionLog ?? []) m.set(e.id, entryCanon(e));
  baselines.set(incident.id, m);
}

/**
 * Rebuild the baseline from a server-confirmed log (SSE upsert, or the
 * response to the incident's create-POST), except entries whose local changes
 * are still in flight — those keep their previous baseline state so the
 * push/retry logic still sees them as unsynced.
 */
export function applyRemoteLog(
  incidentId: string,
  remoteLog: ActionLogEntry[],
  keepLocal: ReadonlySet<string>
) {
  const prev = baselines.get(incidentId);
  const m = new Map<string, string>();
  for (const e of remoteLog) m.set(e.id, entryCanon(e));
  for (const id of keepLocal) {
    const prevCanon = prev?.get(id);
    if (prevCanon !== undefined) m.set(id, prevCanon);
    else m.delete(id);
  }
  baselines.set(incidentId, m);
}

export function dropIncident(incidentId: string) {
  baselines.delete(incidentId);
  for (const [entryId, p] of [...pendingPatches]) {
    if (p.incidentId === incidentId) {
      clearTimeout(p.timer);
      pendingPatches.delete(entryId);
    }
  }
}

function postEntry(incidentId: string, entry: ActionLogEntry) {
  inflight.add(entry.id);
  setSync('saving');
  fetch(`/api/incidents/${incidentId}/log`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(entry),
  })
    .then((res) => {
      // 401 = signed out (the retry keeps going; the operator is told).
      noteSaveStatus(res.status);
      if (!res.ok) throw new Error(String(res.status));
      inflight.delete(entry.id);
      // A delete clicked while this append was in flight was deferred — honor
      // it now so the entry doesn't silently resurrect.
      if (pendingDeletes.has(entry.id)) {
        pendingDeletes.delete(entry.id);
        const sent = baselines.get(incidentId)?.get(entry.id) ?? entryCanon(entry);
        baselines.get(incidentId)?.delete(entry.id);
        deleteEntry(incidentId, entry.id, sent);
        return;
      }
      resyncEntry(incidentId, entry.id);
      quietIfIdle();
    })
    .catch((err) => {
      inflight.delete(entry.id);
      pendingDeletes.delete(entry.id);
      // Roll the baseline back so the next store change retries the append
      // (safe: POST is idempotent by entry id).
      baselines.get(incidentId)?.delete(entry.id);
      markFailed();
      console.warn('[log-sync] append failed:', err);
    });
}

/**
 * Once an entry's own append/PATCH settles, push any edit typed while it was in
 * flight (syncLogsFromStore skips in-flight entries). Scheduling synchronously
 * here also puts the entry in keepLocalEntryIds() before the server's SSE echo
 * is processed, so the echo can't revert the newer local text.
 */
function resyncEntry(incidentId: string, entryId: string) {
  const known = baselines.get(incidentId)?.get(entryId);
  if (known === undefined) return;
  const entry = useCrisisStore.getState().incidents
    .find((i) => i.id === incidentId)?.actionLog?.find((e) => e.id === entryId);
  if (entry && entryCanon(entry) !== known) schedulePatch(incidentId, entryId);
}

function patchBody(entry: ActionLogEntry) {
  return JSON.stringify({
    description: entry.description,
    attachmentName: entry.attachmentName ?? null,
    attachmentData: entry.attachmentData ?? null,
    entryType: entry.entryType,
  });
}

function firePatch(incidentId: string, entryId: string, keepalive = false) {
  const inc = useCrisisStore.getState().incidents.find((i) => i.id === incidentId);
  const entry = inc?.actionLog.find((e) => e.id === entryId);
  if (!entry) {
    // Removed while the edit waited out its debounce: nothing to send, but
    // this timer may have been the last thing holding "Saving…".
    quietIfIdle();
    return;
  }
  const sentCanon = entryCanon(entry);
  patchInflight.add(entryId);
  fetch(`/api/incidents/${incidentId}/log/${encodeURIComponent(entryId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: patchBody(entry),
    keepalive,
  })
    .then((res) => {
      patchInflight.delete(entryId);
      noteSaveStatus(res.status);
      if (res.ok) {
        baselines.get(incidentId)?.set(entryId, sentCanon);
        resyncEntry(incidentId, entryId);
        quietIfIdle();
        return;
      }
      if (res.status === 404) {
        // A peer deleted this entry while we were editing it: the delete wins.
        // Mark the entry synced so nothing re-appends it; the next broadcast
        // removes it from the local store.
        baselines.get(incidentId)?.set(entryId, sentCanon);
        console.warn('[log-sync] edit target was deleted by a peer; keeping the delete');
        quietIfIdle();
        return;
      }
      // Transient failure: leave the baseline at its pre-edit value, so the
      // retry (or the next store change) re-schedules another PATCH (never a POST).
      markFailed();
      console.warn('[log-sync] edit failed:', res.status);
    })
    .catch((err) => {
      patchInflight.delete(entryId);
      markFailed();
      console.warn('[log-sync] edit failed:', err);
    });
}

function schedulePatch(incidentId: string, entryId: string) {
  // Do NOT reset an armed timer: the watcher re-runs on every store change
  // (any field, any incident), and re-arming would starve the save while the
  // operator keeps typing anywhere. firePatch reads the store at fire time,
  // so the content is fresh regardless of when the timer was armed.
  if (pendingPatches.has(entryId)) return;
  setSync('saving');
  const timer = setTimeout(() => {
    pendingPatches.delete(entryId);
    firePatch(incidentId, entryId);
  }, PATCH_DEBOUNCE_MS);
  pendingPatches.set(entryId, { incidentId, timer });
}

/**
 * `canon` is the entry's baseline before the delete: a transient failure puts
 * it back, so the retry's re-diff (entry still absent locally) re-sends the
 * DELETE instead of reporting "saved" while the server keeps the entry.
 */
function deleteEntry(incidentId: string, entryId: string, canon: string) {
  deletesInflight++;
  let settled = false;
  const settle = () => { if (!settled) { settled = true; deletesInflight--; } };
  setSync('saving');
  const failed = (retry: boolean, why: unknown) => {
    // Unless a server-confirmed log (SSE upsert) already re-baselined it —
    // then the entry is back in the store and the delete has yielded.
    const base = baselines.get(incidentId);
    if (retry && base && !base.has(entryId)) base.set(entryId, canon);
    markFailed();
    console.warn('[log-sync] delete failed:', why);
  };
  fetch(`/api/incidents/${incidentId}/log/${encodeURIComponent(entryId)}`, {
    method: 'DELETE',
    credentials: 'include',
  })
    .then((res) => {
      settle();
      noteSaveStatus(res.status);
      // 404: the incident itself is gone — nothing left to delete.
      if (res.ok || res.status === 404) {
        quietIfIdle();
        return;
      }
      // 403: the server refuses (system entry) — retrying can't change that;
      // the next broadcast resurfaces the entry locally.
      failed(res.status !== 403, res.status);
    })
    .catch((err) => {
      settle();
      failed(true, err);
    });
}

/**
 * Diff every incident's log against its baseline and push local changes.
 * Incidents without a baseline map are skipped: the baseline appears when the
 * server confirms the incident (initial load, create-POST response, or a
 * peer's SSE upsert) — entries added before that simply wait their turn.
 */
export function syncLogsFromStore(incidents: Incident[]) {
  const liveIds = new Set(incidents.map((i) => i.id));
  for (const id of [...baselines.keys()]) {
    if (!liveIds.has(id)) dropIncident(id);
  }

  for (const inc of incidents) {
    const base = baselines.get(inc.id);
    if (!base) continue;

    const seen = new Set<string>();
    for (const e of inc.actionLog ?? []) {
      seen.add(e.id);
      if (inflight.has(e.id) || patchInflight.has(e.id)) continue; // reconciles on settle
      const canon = entryCanon(e);
      const known = base.get(e.id);
      if (known === canon) continue;
      if (known === undefined) {
        base.set(e.id, canon); // optimistic; rolled back on failure
        postEntry(inc.id, e);
      } else {
        schedulePatch(inc.id, e.id);
      }
    }

    for (const id of [...base.keys()]) {
      if (seen.has(id)) continue;
      if (inflight.has(id)) {
        // Deleted while its append is still in flight — defer the delete
        // until the append settles instead of forgetting it.
        pendingDeletes.add(id);
        continue;
      }
      const canon = base.get(id)!;
      base.delete(id);
      const p = pendingPatches.get(id);
      if (p) {
        clearTimeout(p.timer);
        pendingPatches.delete(id);
      }
      deleteEntry(inc.id, id, canon);
    }
  }
}

/** Flush debounced edits before the tab goes away (keepalive survives unload). */
export function flushLogPatches() {
  for (const [entryId, p] of [...pendingPatches]) {
    clearTimeout(p.timer);
    pendingPatches.delete(entryId);
    firePatch(p.incidentId, entryId, true);
  }
}
