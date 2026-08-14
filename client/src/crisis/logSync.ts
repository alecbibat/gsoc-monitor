import { useCrisisStore, type ActionLogEntry, type Incident } from './crisisStore';
import { entryCanon } from './syncCanon';

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

const baselines = new Map<string, Map<string, string>>(); // incidentId → entryId → canon
const inflight = new Set<string>();                       // entry ids with an append in flight
const pendingPatches = new Map<string, { incidentId: string; timer: ReturnType<typeof setTimeout> }>();
const PATCH_DEBOUNCE_MS = 800;

const setSync = (s: 'saving' | 'saved' | 'error') => useCrisisStore.getState().setSyncState(s);

const quietIfIdle = () => {
  if (inflight.size === 0 && pendingPatches.size === 0) setSync('saved');
};

/**
 * Entry ids whose local state has not reached the server yet (append in
 * flight, or an edit waiting in the patch debounce). When a remote upsert
 * arrives, these local versions must survive the merge.
 */
export function keepLocalEntryIds(): Set<string> {
  return new Set([...inflight, ...pendingPatches.keys()]);
}

/** Record `incident`'s log as known-synced (initial load / post-insert). */
export function seedBaseline(incident: Incident) {
  const m = new Map<string, string>();
  for (const e of incident.actionLog ?? []) m.set(e.id, entryCanon(e));
  baselines.set(incident.id, m);
}

/**
 * Rebuild the baseline from a remote log, except entries whose local changes
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
      if (!res.ok) throw new Error(String(res.status));
      inflight.delete(entry.id);
      quietIfIdle();
    })
    .catch((err) => {
      inflight.delete(entry.id);
      // Roll the baseline back so the next store change retries the append.
      baselines.get(incidentId)?.delete(entry.id);
      setSync('error');
      console.warn('[log-sync] append failed:', err);
    });
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
  if (!entry) return;
  const sentCanon = entryCanon(entry);
  fetch(`/api/incidents/${incidentId}/log/${encodeURIComponent(entryId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: patchBody(entry),
    keepalive,
  })
    .then((res) => {
      if (!res.ok) throw new Error(String(res.status));
      baselines.get(incidentId)?.set(entryId, sentCanon);
      quietIfIdle();
    })
    .catch((err) => {
      baselines.get(incidentId)?.delete(entryId); // retry on next store change
      setSync('error');
      console.warn('[log-sync] edit failed:', err);
    });
}

function schedulePatch(incidentId: string, entryId: string) {
  const existing = pendingPatches.get(entryId);
  if (existing) clearTimeout(existing.timer);
  setSync('saving');
  const timer = setTimeout(() => {
    pendingPatches.delete(entryId);
    firePatch(incidentId, entryId);
  }, PATCH_DEBOUNCE_MS);
  pendingPatches.set(entryId, { incidentId, timer });
}

function deleteEntry(incidentId: string, entryId: string) {
  fetch(`/api/incidents/${incidentId}/log/${encodeURIComponent(entryId)}`, {
    method: 'DELETE',
    credentials: 'include',
  })
    .then((res) => {
      if (!res.ok) throw new Error(String(res.status));
      quietIfIdle();
    })
    .catch((err) => {
      // Server still has the entry; the next broadcast resurfaces it locally.
      setSync('error');
      console.warn('[log-sync] delete failed:', err);
    });
}

/**
 * Diff every incident's log against its baseline and push local changes.
 * Incidents the server doesn't know yet are skipped — their log travels with
 * the initial blob POST, and `seedBaseline` records it on success.
 */
export function syncLogsFromStore(incidents: Incident[], isServerKnown: (id: string) => boolean) {
  const liveIds = new Set(incidents.map((i) => i.id));
  for (const id of [...baselines.keys()]) {
    if (!liveIds.has(id)) dropIncident(id);
  }

  for (const inc of incidents) {
    if (!isServerKnown(inc.id)) continue;
    const base = baselines.get(inc.id);
    if (!base) {
      // First sight of a server-known incident (e.g. another tab created it
      // and the blob arrived via SSE before any log diff ran here).
      seedBaseline(inc);
      continue;
    }

    const seen = new Set<string>();
    for (const e of inc.actionLog ?? []) {
      seen.add(e.id);
      if (inflight.has(e.id)) continue; // append in flight — reconciles on echo
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
      if (seen.has(id) || inflight.has(id)) continue;
      base.delete(id);
      const p = pendingPatches.get(id);
      if (p) {
        clearTimeout(p.timer);
        pendingPatches.delete(id);
      }
      deleteEntry(inc.id, id);
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
