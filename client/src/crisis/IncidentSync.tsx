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
import { rebaseIncident } from './syncRebase';
import { normalizeIncidentFields } from './taxonomy';
import * as logSync from './logSync';
import { inflightChecklistIds, mergeChecklists } from './checklistSync';
import type { ChecklistStateMap } from './checklistTemplate';
import { useTemplatesStore } from './templates/templatesStore';
import { noteSaveStatus, useSyncHealth } from './syncHealth';

// Admin-edited checklist / intake templates: fetched on sign-in, re-fetched
// when an admin saves (the stream's `templates` event) and after a reconnect
// (a save made while the stream was down has no replay). load() dedupes and
// keeps the last good config on failure, so none of these can blank a tab.
const reloadTemplates = () => { void useTemplatesStore.getState().load(); };

// "Saved" is only truthful when the log engine is also idle (and vice versa).
logSync.registerBlobIdleCheck(() => pending.size === 0 && retries.size === 0);

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

// Creates (POSTs) outstanding per id. A PUT must not overtake one: it would
// find no row and answer 404, which reads as a teammate's delete.
const createInflight = new Map<string, number>();

// Ids the server is known to have: seen in a GET or an SSE upsert, or saved
// by a push. Only for these does a 404 (or absence from a resync) mean a
// teammate deleted the incident — a create that never landed is re-sent.
const confirmed = new Set<string>();

// Pushes per id, numbered: only the latest one may settle the incident's
// save state. An older push that lands after a newer one failed must not
// clear that failure (and report "Saved" for an edit the server never got).
const pushSeq = new Map<string, number>();

// The last failed push per id: the copy it sent (which never landed) and the
// server state that copy was made on. A push queued behind it took that copy
// as its base; if it fails too, its edit really sits on the older base.
// Cleared once the server's own copy arrives (a newer, real baseline).
const lastFailed = new Map<string, { sent: string; base: string | undefined }>();

// A failed push rolls its optimistic baseline back (serverState.delete) so the
// edit is re-sent. The baseline it had BEFORE that push is kept here: it is
// the server state the unsaved edit was made against, which a peer's upsert
// arriving meanwhile must be rebased onto rather than replacing the edit.
const failedBase = new Map<string, string>();

// Fields that sync through their own endpoints, never the blob: a rebase takes
// them from the server copy and they are reconciled separately below.
const SEPARATELY_SYNCED = ['actionLog', 'checklists'];

// Automatic re-push of a failed save, with backoff. Without it "Unsaved —
// will retry" only retried on the operator's next keystroke.
const retries = new Map<string, { timer: ReturnType<typeof setTimeout> | null; delay: number }>();

function clearRetry(id: string): void {
  const r = retries.get(id);
  if (r?.timer) clearTimeout(r.timer);
  retries.delete(id);
}

function scheduleRetry(id: string): void {
  const prev = retries.get(id);
  if (prev?.timer) clearTimeout(prev.timer);
  const delay = prev ? Math.min(prev.delay * 2, 60_000) : 5_000;
  const timer = setTimeout(() => {
    const entry = retries.get(id);
    if (entry) entry.timer = null; // keep the delay for the next backoff step
    const latest = useCrisisStore.getState().incidents.find((i) => i.id === id);
    // Gone, or already re-sent (a new edit, a rebase): nothing left to retry.
    // A push still in flight re-arms the retry itself if it fails.
    if (!latest || serverState.has(id)) { clearRetry(id); return; }
    if (pending.has(id) || blobInflight.has(id)) return;
    // An incident the server had confirmed retries with PUT, so one a teammate
    // deleted meanwhile answers 404 instead of being recreated by an upsert.
    // Only a create that never landed is re-POSTed.
    pushIncident(latest, failedBase.has(id) ? 'PUT' : 'POST');
  }, delay);
  retries.set(id, { timer, delay });
}

const setSync = (s: 'idle' | 'saving' | 'saved' | 'error') =>
  useCrisisStore.getState().setSyncState(s);

/** Nothing left to send anywhere — the only moment "Saved" is truthful. */
const allIdle = () =>
  pending.size === 0 && retries.size === 0 && blobInflight.size === 0 && !logSync.hasPendingWork();

/**
 * Forget an incident a teammate deleted, local unsaved edit included. The
 * delete wins (as it does for log entries): keeping the edit would have its
 * next push recreate the incident on the server — without the share links the
 * delete revoked. serverState is cleared before the store drops it, so the
 * watcher doesn't answer with a DELETE of its own.
 */
function dropDeletedIncident(id: string): void {
  const p = pending.get(id);
  if (p) { clearTimeout(p.timer); pending.delete(id); }
  serverState.delete(id);
  failedBase.delete(id);
  lastFailed.delete(id);
  confirmed.delete(id);
  clearRetry(id);
  logSync.dropIncident(id);
  useCrisisStore.getState().applyRemoteDelete(id);
}

const bump = (m: Map<string, number>, id: string, by: 1 | -1) => {
  const n = (m.get(id) ?? 0) + by;
  if (n > 0) m.set(id, n); else m.delete(id);
};

/** `keepalive`: the request may outlive the page (tab-close flush; ≤ 64 KiB). */
function pushIncident(incident: Incident, method: 'POST' | 'PUT', keepalive = false) {
  const id = incident.id;
  const url = method === 'POST' ? '/api/incidents' : `/api/incidents/${id}`;
  const isCreate = method === 'POST';
  const priorBase = serverState.get(id) ?? failedBase.get(id);
  const sent = serverCanon(incident);
  serverState.set(id, sent); // optimistic baseline
  const seq = (pushSeq.get(id) ?? 0) + 1;
  pushSeq.set(id, seq);
  const isLatest = () => pushSeq.get(id) === seq;
  setSync('saving');
  // Updates omit the action log and the checklist map: the server preserves
  // its own copies on blob writes (they travel through their per-entry
  // endpoints), so sending them would only waste the 5 MB body budget.
  // Creates keep them — the insert seeds the server with the client's
  // initial state.
  const body = isCreate ? incident : { ...incident, actionLog: undefined, checklists: undefined };
  resyncTouched?.add(id);
  bump(blobInflight, id, 1);
  if (isCreate) bump(createInflight, id, 1);
  return fetch(url, {
    method,
    keepalive,
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  })
    .then(async (res) => {
      if (!res.ok) throw Object.assign(new Error(String(res.status)), { status: res.status });
      noteSaveStatus(res.status);
      confirmed.add(id);
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
      // A newer push of this incident owns its save state: still in flight,
      // or failed — and then its failure (and retry) must stand.
      if (!isLatest()) return;
      failedBase.delete(id);
      lastFailed.delete(id);
      clearRetry(id);
      // Only clear to "saved" if nothing newer is queued anywhere — and if
      // all that's left is a log write waiting on its retry, say so rather
      // than leaving "Saving…" up until that retry fires.
      if (!pending.has(id) && retries.size === 0) {
        if (!logSync.hasPendingWork()) setSync('saved');
        else if (logSync.hasOnlyFailedWork()) setSync('error');
      }
    })
    .catch((e) => {
      const status = (e as { status?: number }).status;
      // Signed out: the retry below keeps going, and succeeds once the
      // operator signs in again (any tab), but they have to be told.
      if (status === 401) noteSaveStatus(401);
      if (method === 'PUT' && status === 404 && confirmed.has(id)) {
        // The row is gone: a teammate deleted the incident while this edit
        // was queued. Recreating it would undo their delete.
        console.warn(`[incident-sync] ${id} was deleted on the server; dropping the local copy`);
        dropDeletedIncident(id);
        if (allIdle()) setSync('idle');
        return;
      }
      // What this push's edit was really made on: if the push it was queued
      // behind failed as well, that one's copy never landed — its base did.
      const lf = lastFailed.get(id);
      const madeOn = lf && lf.sent === priorBase ? lf.base : priorBase;
      lastFailed.set(id, { sent, base: madeOn });
      if (!isLatest()) {
        // A newer push carries this one's edit too, and settles the save. If
        // it already failed, it took this push's copy as its base — but that
        // never landed either.
        if (failedBase.get(id) === sent) {
          if (madeOn !== undefined) failedBase.set(id, madeOn); else failedBase.delete(id);
        }
        console.warn('[incident-sync] push failed (superseded):', e);
        return;
      }
      if (method === 'PUT' && status === 404) {
        // Never confirmed by the server: a create that didn't land, not a
        // delete. Send it again as a create (the retry re-POSTs without a
        // failed base).
        serverState.delete(id);
        failedBase.delete(id);
        setSync('error');
        scheduleRetry(id);
        console.warn(`[incident-sync] ${id} is not on the server yet; re-creating it`);
        return;
      }
      // Roll the baseline back so the push is re-attempted (by the retry
      // timer, or sooner by the next edit), remembering what the edit was
      // made against so a peer's change meanwhile rebases instead of winning.
      // A peer's upsert that landed while this push was out moved the
      // baseline on: that is the server state the edit now sits on, not the
      // one it was sent against.
      const cur = serverState.get(id);
      const base = cur !== undefined && cur !== sent ? cur : madeOn;
      serverState.delete(id);
      if (base !== undefined) failedBase.set(id, base);
      setSync('error');
      // A body the server rejects as malformed or too large fails the same
      // way every time; retrying it on a timer would only spin. The next edit
      // still re-sends it.
      if (status !== 400 && status !== 413) scheduleRetry(id);
      console.warn('[incident-sync] push failed:', e);
    })
    .finally(() => {
      bump(blobInflight, id, -1);
      if (isCreate) bump(createInflight, id, -1);
    });
}

function scheduleSync(incident: Incident) {
  const id = incident.id;
  const existing = pending.get(id);
  if (existing) clearTimeout(existing.timer);
  setSync('saving');
  const timer = setTimeout(() => {
    // Its create is still on the way: a PUT could overtake it, find no row
    // and 404. Wait for the create to settle.
    if (createInflight.has(id)) { scheduleSync(incident); return; }
    pending.delete(id);
    // The create failed meanwhile: never confirmed, so this is still a
    // create — its retry (or the next edit) re-POSTs the latest copy.
    if (!serverState.has(id) && !confirmed.has(id) && !failedBase.has(id)) return;
    pushIncident(incident, 'PUT');
  }, 1500);
  pending.set(id, { timer, incident });
}

/** The store watcher's call for one incident: send it if it differs from the server's copy. */
function syncChanged(inc: Incident): void {
  const canon = serverCanon(inc);
  const known = serverState.get(inc.id);
  if (known === canon) return; // matches server / just applied from a peer
  if (known === undefined && !failedBase.has(inc.id)) {
    pushIncident(inc, 'POST'); // newly created (or a create that never landed)
  } else {
    // Changed — debounce the PUT. That includes a confirmed incident whose
    // last save failed: it must go as a PUT, so one a teammate deleted
    // meanwhile answers 404 instead of being recreated by the POST's upsert.
    scheduleSync(inc);
  }
}

// Best-effort flush of unsaved edits when the tab is hidden or closing. Uses
// sendBeacon (a background POST that still carries the auth cookie); the POST
// route upserts, so it stands in for the pending PUT — except for a confirmed
// incident whose save failed, which goes as a keepalive PUT (below).
function flushPending() {
  // The beacon's upsert keeps the server's action log and checklist map, so
  // they are left out — a long incident's log alone overruns the ~64 KiB
  // beacon quota. The exception is a create the server hasn't confirmed (in
  // flight, or failed): if that POST never lands, the beacon's INSERT is what
  // seeds the row.
  const beaconBody = (incident: Incident, isNew: boolean) =>
    JSON.stringify(isNew ? incident : { ...incident, actionLog: undefined, checklists: undefined });
  const beacon = (body: string) => {
    try {
      return navigator.sendBeacon('/api/incidents', new Blob([body], { type: 'application/json' }));
    } catch {
      return false;
    }
  };

  // A confirmed incident whose last save failed goes as a PUT, like its
  // retry — never as the beacon's upsert: a teammate may have deleted it
  // meanwhile (unseen while this tab was offline), and an upsert would bring
  // it back. keepalive lets the PUT outlive the page.
  const failedConfirmed = (id: string) => !serverState.has(id) && failedBase.has(id);

  for (const [id, { timer, incident }] of [...pending]) {
    clearTimeout(timer);
    pending.delete(id); // before pushIncident, so its "saved" check sees an empty queue
    if (failedConfirmed(id)) {
      void pushIncident(incident, 'PUT', true);
    } else if (beacon(beaconBody(incident, !confirmed.has(id)))) {
      resyncTouched?.add(id);
      serverState.set(id, serverCanon(incident));
    } else {
      // Beacon refused (e.g. body over the keepalive quota). The page is
      // usually still alive (tab hidden, not unloading), so send the normal PUT
      // rather than dropping the edit. On a real unload this is best effort.
      void pushIncident(incident, 'PUT');
    }
  }

  // Saves that already failed and are waiting on their retry timer: send the
  // latest copy too, or closing the tab loses them.
  for (const id of retries.keys()) {
    if (serverState.has(id) || blobInflight.has(id)) continue;
    const latest = useCrisisStore.getState().incidents.find((i) => i.id === id);
    if (!latest) continue;
    if (failedConfirmed(id)) void pushIncident(latest, 'PUT', true);
    else beacon(beaconBody(latest, true)); // a create that never landed
  }
}

/**
 * Apply a server copy of an incident (a peer's SSE upsert, our own echo, or a
 * resync row) to the store, keeping whatever this tab hasn't saved yet.
 */
function applyUpsert(inc: Incident): void {
  confirmed.add(inc.id);
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
  const localLog = local?.actionLog;
  // Element-wise compare = identical to comparing the whole-array canon strings
  // (canon strings are valid JSON values), but reuses the per-entry cache.
  const logSame =
    local !== undefined &&
    Array.isArray(localLog) &&
    mergedLog.length === localLog.length &&
    mergedLog.every((e, i) => entryCanon(e) === entryCanon(localLog[i]));

  // A blob edit of ours that the server doesn't have yet — debounced, or
  // failed and awaiting its retry. Replacing the incident with the peer's
  // copy would lose it, and ignoring the peer (what this used to do) let
  // our eventual whole-blob PUT revert whatever they changed. Rebase: keep
  // their changes and re-apply only ours (syncRebase.ts); the watcher then
  // re-sends the rebased incident against the new baseline. A queued edit is
  // based on the current baseline — or, once a failed push has rolled that
  // back, on the failed push's base.
  const p = pending.get(inc.id);
  const unsavedBase = p
    ? serverState.get(inc.id) ?? failedBase.get(inc.id)
    : serverState.has(inc.id) ? undefined : failedBase.get(inc.id);
  if (local && unsavedBase !== undefined) {
    if (canon === unsavedBase && logSame && chkSame) return; // nothing new from peers
    const blob = canon === unsavedBase
      ? local
      : rebaseIncident(JSON.parse(unsavedBase) as object, local, normalizeIncidentFields(inc), SEPARATELY_SYNCED);
    serverState.set(inc.id, canon);
    // A failed save is now re-sent by the watcher (below) against the new
    // baseline; its own retry would only duplicate that.
    failedBase.delete(inc.id);
    lastFailed.delete(inc.id);
    clearRetry(inc.id);
    if (serverCanon(blob) === canon) {
      // The peer's copy already contains our edit (e.g. our own save's
      // echo): nothing left to send, so drop the queued write — pushing
      // its older snapshot would now revert the peer.
      if (p) { clearTimeout(p.timer); pending.delete(inc.id); }
      if (pending.size === 0 && retries.size === 0 && !logSync.hasPendingWork()) setSync('saved');
    }
    logSync.applyRemoteLog(inc.id, remoteLog, keep);
    // Any remaining difference from `canon` re-schedules the PUT (watcher).
    useCrisisStore.getState().applyRemoteUpsert({ ...blob, actionLog: mergedLog, checklists: mergedChk });
    return;
  }

  const blobSame = serverState.get(inc.id) === canon;
  if (blobSame && logSame && chkSame) {
    // Our own echo. After a tab-close beacon (which reports nothing back)
    // this broadcast is the server's confirmation that the write landed.
    if (useCrisisStore.getState().syncState === 'saving' && allIdle()) setSync('saved');
    return;
  }

  serverState.set(inc.id, canon);
  lastFailed.delete(inc.id);
  // The store takes the peer's copy whole: a queued snapshot from before
  // it must not be PUT afterwards and revert it.
  if (p) { clearTimeout(p.timer); pending.delete(inc.id); }
  logSync.applyRemoteLog(inc.id, remoteLog, keep);
  useCrisisStore.getState().applyRemoteUpsert({ ...inc, actionLog: mergedLog, checklists: mergedChk });
}

/**
 * Fold a reconnect's GET snapshot into the store (see resync in the stream
 * effect). `skip`: ids whose snapshot may predate what this tab already has.
 * `drop`: forget an incident the server no longer has.
 */
function applyResyncSnapshot(incidents: Incident[], skip: (id: string) => boolean, drop: (id: string) => void): void {
  // A local incident with no baseline and no failed base is a create whose
  // push failed (rolled back); its retry re-creates it, so the snapshot must
  // not revert it.
  const unconfirmed = new Set(
    useCrisisStore.getState().incidents
      .filter((i) => !serverState.has(i.id) && !failedBase.has(i.id))
      .map((i) => i.id)
  );
  // Log work that failed offline is rolled back and only re-sent when
  // logSync's backoff timer fires, so the merge below would drop it. Re-queue
  // it now (as the watcher would) so it is in keepLocalEntryIds() and
  // survives the merge; appends are prepended, where the server will put
  // them too. The incident is still applied rather than skipped: a retried
  // append the server already has is a no-op with no echo, which would leave
  // the stale blob in place.
  logSync.syncLogsFromStore(useCrisisStore.getState().incidents);
  const seen = new Set<string>();
  const rows = incidents.filter((inc) => {
    if (!inc?.id) return false;
    seen.add(inc.id);
    return !skip(inc.id) && !unconfirmed.has(inc.id);
  });
  // Unsaved edits first: applying any other incident fires the store
  // watcher, which would queue this one's re-send before its rebase.
  const unsaved = (inc: Incident) => failedBase.has(inc.id) || pending.has(inc.id);
  for (const inc of [...rows.filter(unsaved), ...rows.filter((inc) => !unsaved(inc))]) applyUpsert(inc);
  // Missing from the list: deleted by a teammate — if the server ever had
  // it. A create that never landed is not a delete.
  for (const id of [...serverState.keys()]) {
    if (!seen.has(id) && !skip(id) && confirmed.has(id)) drop(id);
  }
  // A confirmed incident whose last save failed has no baseline, so the loop
  // above can't see it; if the server no longer has it, a teammate deleted it
  // while this tab was offline.
  for (const id of [...failedBase.keys()]) {
    if (!seen.has(id) && !skip(id)) drop(id);
  }
}

/** The sync engine's internals, exported for IncidentSync.test.ts only. */
export const __test = {
  pushIncident, scheduleSync, syncChanged, applyUpsert, applyResyncSnapshot, flushPending,
  serverState, failedBase, confirmed, pending, retries,
};

// Pending auto-publish per incident id. Deliberately NOT cancelled when the
// operator navigates away: the last edit before "back to list" must still
// reach the share links.
const publishTimers = new Map<string, ReturnType<typeof setTimeout>>();

// What each share link was last successfully sent, minus the fields that
// change on every publish (timestamps) or that the server ignores on PATCH
// (the checklist map — toggles reach snapshots through their own endpoint).
// A checklist toggle, a peer's echo or a log-entry round trip re-runs the
// publish effect in every editor that has the incident open; without this each
// one re-sent the whole snapshot to every link and bumped the stakeholders'
// "Last updated" with nothing new to show. Recorded only on success, so a link
// that failed (or had expired and was renewed) is sent again.
const lastPublished = new Map<string, string>();

const publicCanon = (inc: Incident) =>
  stableStringify({ ...extractPublicState(inc), lastUpdated: undefined, publishedAt: undefined, checklists: undefined })!;

function activeShareTokens(inc: Incident): string[] {
  const links = inc.shareLinks ?? [];
  // Every un-revoked link, whatever this client's clock says about expiry:
  // the server decides that, and a renewed link must not be skipped here.
  const tokens = links.filter((l) => l.active).map((l) => l.token);
  // Legacy fallback: shareToken set but shareLinks never populated. Once any
  // link exists the legacy token is either among them or was revoked.
  if (links.length === 0 && inc.shareToken) tokens.push(inc.shareToken);
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
      const canon = publicCanon(latest);
      const tokens = activeShareTokens(latest).filter((t) => lastPublished.get(t) !== canon);
      if (tokens.length === 0) return;
      const body = JSON.stringify(extractPublicState(latest));
      for (const token of tokens) {
        fetch(`/api/crisis/share/${token}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body,
        })
          .then((res) => {
            if (res.ok) lastPublished.set(token, canon);
            else console.warn(`[crisis] live update failed (${res.status}) for share ${token}`);
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

  // Per account, not per user-object identity: a profile refresh that hands
  // back a new object for the same person must not refetch.
  const userId = user?.id;
  useEffect(() => {
    if (userId) reloadTemplates();
  }, [userId]);

  // Load all incidents from the server on first auth. A failed load retries
  // with backoff: the live stream's first 'connected' is deliberately not a
  // resync, so without this a 503 at page load left the list empty ("Start
  // your first incident") until the stream happened to drop — hours, maybe —
  // inviting a duplicate incident mid-response.
  useEffect(() => {
    if (!user || loaded.current) return;
    loaded.current = true;
    let delay = 5_000;
    // 'loading' until the first attempt settles; 'error' from a failure until
    // a retry lands — the list must not read as "no incidents" meanwhile.
    useSyncHealth.getState().setLoadState('loading');
    const load = () => {
    // Re-armed per attempt; SSE upserts that land between attempts are kept
    // by the merge below (anything already in the store wins).
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
          if (mine) { confirmed.add(inc.id); merged.push(mine); byId.delete(inc.id); continue; }
          if (deleted.has(inc.id)) continue;
          confirmed.add(inc.id);
          serverState.set(inc.id, serverCanon(inc));
          logSync.seedBaseline(inc);
          merged.push(inc);
        }
        for (const inc of byId.values()) merged.push(inc); // local-only, in store order
        setIncidents(merged);
        useSyncHealth.getState().setLoadState('ready');
      })
      .catch((e) => {
        console.error('[incident-sync] initial load failed:', e);
        useSyncHealth.getState().setLoadState('error');
        // Guarded on the signed-in user rather than effect cleanup: loaded
        // makes this effect run once, so a cleared timer would never re-arm.
        setTimeout(() => { if (useAuthStore.getState().user) load(); }, delay);
        delay = Math.min(delay * 2, 60_000);
      })
      .finally(() => { deletedDuringLoad.current = null; });
    };
    load();
  }, [user, setIncidents]);

  // Watch the store and push local changes back to the server.
  useEffect(() => {
    if (!user) return;

    let lastArr = useCrisisStore.getState().incidents;

    const unsub = useCrisisStore.subscribe((state) => {
      const next = state.incidents;
      if (next === lastArr) return; // ignore non-incident state changes (e.g. syncState)
      const prevArr = lastArr;
      lastArr = next;

      const nextIds = new Set(next.map((i) => i.id));

      for (const inc of next) syncChanged(inc);

      // Log changes sync separately, per entry, through the append endpoints.
      logSync.syncLogsFromStore(next);

      for (const id of [...serverState.keys()]) {
        if (!nextIds.has(id)) {
          resyncTouched?.add(id);
          serverState.delete(id);
          failedBase.delete(id);
          confirmed.delete(id);
          clearRetry(id);
          logSync.dropIncident(id);
          const p = pending.get(id);
          if (p) { clearTimeout(p.timer); pending.delete(id); }
          deletedDuringLoad.current?.add(id);
          const removed = prevArr.find((i) => i.id === id);
          fetch(`/api/incidents/${id}`, { method: 'DELETE', credentials: 'include' })
            .then((res) => {
              // 404 = already gone. Anything else (403 on an archived incident
              // for a non-admin, a 5xx) means it still exists on the server:
              // put it back rather than let this tab alone believe it's gone.
              if (res.ok || res.status === 404 || !removed) return;
              console.warn(`[incident-sync] delete of ${id} failed (${res.status}); restoring it`);
              serverState.set(id, serverCanon(removed));
              confirmed.add(id);
              logSync.seedBaseline(removed);
              if (!useCrisisStore.getState().incidents.some((i) => i.id === id)) {
                useCrisisStore.getState().applyRemoteUpsert(removed);
              }
            })
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

    const applyDelete = (id: string) => {
      if (!id) return;
      deletedDuringLoad.current?.add(id);
      // A pending local edit no longer holds the delete off: its PUT would
      // 404 and the next push would recreate the incident (dropDeletedIncident).
      dropDeletedIncident(id);
    };

    // Events broadcast while the stream was down are gone (no replay), so
    // every reconnect re-reads the list and folds it in through the same
    // merge rules. Skips any incident whose snapshot could predate what we
    // already have: touched by an SSE event or local write during the GET,
    // or with a blob write in flight when it started. An unsaved edit (queued,
    // or failed and awaiting its retry) is NOT skipped: applyUpsert rebases it
    // onto the snapshot, so its re-send can't revert what peers changed while
    // this tab was offline.
    const resync = () => {
      clearTimeout(resyncRetry); // a new resync supersedes a scheduled retry
      resyncCtrl?.abort();
      const ctrl = new AbortController();
      resyncCtrl = ctrl;
      const touched = new Set<string>();
      resyncTouched = touched;
      const busyAtStart = new Set(blobInflight.keys());
      const skip = (id: string) => touched.has(id) || busyAtStart.has(id) || blobInflight.has(id);
      let fetched = false; // past the GET: a later throw is bad data, not an outage
      fetch('/api/incidents', { credentials: 'include', signal: ctrl.signal })
        .then((r) => {
          if (!r.ok) throw new Error(String(r.status));
          return r.json() as Promise<Incident[]>;
        })
        .then((incidents) => {
          if (ctrl.signal.aborted || disposed) return;
          if (!Array.isArray(incidents)) throw new Error('unexpected body');
          fetched = true;
          applyResyncSnapshot(incidents, skip, applyDelete);
          resyncDelay = 5_000;
        })
        .catch((e) => {
          if (ctrl.signal.aborted || disposed) return;
          console.warn('[incident-sync] resync failed:', e);
          // Retrying can't fix data that failed to apply; only a failed GET is.
          if (fetched) return;
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
        if (initial && !seenConnect) {
          seenConnect = true;
          // The sign-in templates load may have failed while the server was
          // still coming up; the stream being up is a good moment to retry.
          if (useTemplatesStore.getState().status === 'error') reloadTemplates();
          return;
        }
        seenConnect = true;
        resync();
        reloadTemplates();
      });

      src.addEventListener('upsert', (e) => {
        let inc: Incident;
        try { inc = JSON.parse((e as MessageEvent).data); } catch { return; }
        if (!inc?.id) return;
        resyncTouched?.add(inc.id);
        applyUpsert(inc);
      });

      // An admin saved a checklist / intake / role template. The event carries
      // no payload worth trusting for content — just refetch the config.
      src.addEventListener('templates', reloadTemplates);

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
    // A save that already FAILED can't be rescued by the flush (the server is
    // what's failing), so ask before the tab closes on it rather than losing
    // it silently. Debounced edits don't prompt: the flush beacons them —
    // unless the sign-in lapsed, when the beacon would be refused too.
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (
        retries.size === 0 &&
        useCrisisStore.getState().syncState !== 'error' &&
        !useSyncHealth.getState().authLapsed
      ) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('pagehide', flushAll);
    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', flushAll);
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [user]);

  // Only a save's 2xx clears the signed-out notice, so a lapse flagged by a
  // path with no retry of its own (a checklist toggle's 401 is final) — or a
  // 401 that landed after a newer success — would outlive the operator
  // signing in again from another tab, and keep the unload prompt armed.
  // While it is up, re-check the session when this tab regains focus, and
  // every 30 s.
  const authLapsed = useSyncHealth((s) => s.authLapsed);
  useEffect(() => {
    if (!user || !authLapsed) return;
    let disposed = false;
    const probe = () => {
      fetch('/api/auth/me', { credentials: 'include', cache: 'no-store' })
        .then((r) => { if (!disposed && r.ok) useSyncHealth.getState().setAuthLapsed(false); })
        .catch(() => { /* offline: the next probe (or save) tells */ });
    };
    const onVisible = () => { if (document.visibilityState === 'visible') probe(); };
    const timer = setInterval(probe, 30_000);
    window.addEventListener('focus', probe);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      disposed = true;
      clearInterval(timer);
      window.removeEventListener('focus', probe);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [user, authLapsed]);

  return null;
}
