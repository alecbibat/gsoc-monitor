import { useCrisisStore, type Incident } from './crisisStore';
import {
  foldChecklistResponse, isChecklistStateMap, itemStatus, type ChecklistStateMap, type ChecklistStatus,
} from './checklistTemplate';
import { noteSaveStatus } from './syncHealth';

// ── Checklist status sync (editor side) ──────────────────────────────────────
//
// Checklist state never rides the incident blob (syncCanon excludes it, the
// server preserves its own map on blob writes): every status change is one
// POST to the per-item endpoint, which applies it under a row lock, stamps the
// server-side timestamp, and fans out to editors' SSE and every live share
// snapshot. Here we do the optimistic local change, send the POST, and
// reconcile with the server's authoritative map — keeping items whose own POST
// is still in flight local, exactly like logSync does for action-log entries.

// In-flight change counts per incident+item (a fast double-click overlaps).
const inflight = new Map<string, Map<string, number>>();

function markInflight(incidentId: string, itemId: string, delta: 1 | -1): void {
  let items = inflight.get(incidentId);
  if (!items) { items = new Map(); inflight.set(incidentId, items); }
  const next = (items.get(itemId) ?? 0) + delta;
  if (next <= 0) items.delete(itemId); else items.set(itemId, next);
  if (items.size === 0) inflight.delete(incidentId);
}

/** Item ids whose change is still in flight — those keep their LOCAL state. */
export function inflightChecklistIds(incidentId: string): ReadonlySet<string> {
  return new Set(inflight.get(incidentId)?.keys() ?? []);
}

/**
 * Reconcile a server checklist map with local state: the server wins, except
 * items whose own push hasn't landed yet — their local (newer) state stays
 * until their response or echo arrives.
 */
export function mergeChecklists(
  remote: ChecklistStateMap,
  local: ChecklistStateMap,
  keepLocal: ReadonlySet<string>
): ChecklistStateMap {
  if (keepLocal.size === 0) return remote;
  const merged = { ...remote };
  for (const id of keepLocal) {
    if (local[id]) merged[id] = local[id];
  }
  return merged;
}

const currentChecklists = (incidentId: string): ChecklistStateMap =>
  useCrisisStore.getState().incidents.find((i) => i.id === incidentId)?.checklists ?? {};

/**
 * How one status change ended. A failure has already rolled the optimistic
 * change back and carries a message for the caller to show next to the
 * checklist (with a Retry when `retryable`). It deliberately does NOT light
 * the global sync indicator: that one says "will retry", and it is the
 * blob/log engines that keep that promise — checklist state never rides the blob.
 */
export type ChecklistToggleResult =
  | { ok: true }
  /** A later change of the same item took over; its own result is the one that counts. */
  | { ok: false; superseded: true }
  | { ok: false; superseded: false; status: number | null; message: string; retryable: boolean };

/** One automatic re-send after a transient failure, this long after it. */
export const CHECKLIST_AUTO_RETRY_MS = 3_000;

// The newest change per incident+item. An older change's failure (or pending
// auto-retry) must neither roll back nor re-send over it.
const latestToggle = new Map<string, number>();
let toggleSeq = 0;

type PostOutcome =
  | { ok: true; checklists: ChecklistStateMap }
  | { ok: false; status: number | null; error: string | null };

async function postStatus(incidentId: string, itemId: string, status: ChecklistStatus): Promise<PostOutcome> {
  let res: Response;
  try {
    res = await fetch(`/api/incidents/${incidentId}/checklist/${itemId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ status }),
    });
  } catch {
    return { ok: false, status: null, error: null };
  }
  // A 401 also raises the app-wide "signed out" notice (syncHealth.ts).
  noteSaveStatus(res.status);
  const body = (await res.json().catch(() => null)) as { checklists?: unknown; error?: unknown } | null;
  if (res.ok && body && isChecklistStateMap(body.checklists)) return { ok: true, checklists: body.checklists };
  return {
    ok: false,
    status: res.status,
    error: typeof body?.error === 'string' ? body.error : res.ok ? 'Unexpected response from the server' : null,
  };
}

/** What to tell the operator, whether a manual retry can help, and whether to re-send once automatically. */
function describeFailure(status: number | null, error: string | null): { message: string; retryable: boolean; auto: boolean } {
  if (status === null) return { message: 'No connection to the server', retryable: true, auto: true };
  if (status === 409) return { message: 'The incident was stood down — its checklist is frozen', retryable: false, auto: false };
  if (status === 401) return { message: 'Your session has expired — sign in again, then retry', retryable: true, auto: false };
  if (status === 403) return { message: 'Not permitted to change this checklist', retryable: false, auto: false };
  // A brand-new incident whose create hasn't reached the server yet.
  if (status === 404) return { message: 'The incident isn’t on the server yet', retryable: true, auto: true };
  if (status === 408 || status === 429 || status >= 500) {
    return { message: `Server error (${status}) — try again shortly`, retryable: true, auto: true };
  }
  if (status >= 200 && status < 300) return { message: error ?? 'Unexpected response from the server', retryable: true, auto: false };
  return { message: error ?? `Rejected by the server (HTTP ${status})`, retryable: false, auto: false };
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Set one item's status: optimistic store change, then the per-item POST. On
 * success the server's map (with its authoritative timestamp) replaces the
 * optimistic entry. A transient failure (offline, 5xx, the incident not
 * created server-side yet) is re-sent once after a few seconds — the change
 * is idempotent server-side, so a re-send can't move the timestamp — with the
 * optimistic state held meanwhile. A final failure rolls the change back and
 * resolves with what to tell the operator.
 */
export function setChecklistItemStatus(incident: Incident, itemId: string, status: ChecklistStatus): Promise<ChecklistToggleResult> {
  const store = useCrisisStore.getState();
  const prior = incident.checklists?.[itemId];
  const before = currentChecklists(incident.id)[itemId];
  store.setChecklistItemStatus(itemId, status);
  // The store action is archive-frozen (patchActiveEditable) — if the change
  // didn't land (no fresh entry with this status), there is nothing to sync.
  const after = currentChecklists(incident.id)[itemId];
  if (!after || after === before || itemStatus(after) !== status) {
    const archived = !!useCrisisStore.getState().incidents.find((i) => i.id === incident.id)?.archivedAt;
    return Promise.resolve({
      ok: false,
      superseded: false,
      status: null,
      message: archived ? describeFailure(409, null).message : 'This incident isn’t open for editing',
      retryable: false,
    });
  }

  const key = `${incident.id}\u0000${itemId}`;
  const seq = ++toggleSeq;
  latestToggle.set(key, seq);
  const superseded = () => latestToggle.get(key) !== seq;
  const settle = () => {
    markInflight(incident.id, itemId, -1);
    if (!superseded()) latestToggle.delete(key);
  };

  markInflight(incident.id, itemId, +1);
  const attempt = async (autoRetry: boolean): Promise<ChecklistToggleResult> => {
    const out = await postStatus(incident.id, itemId, status);
    if (out.ok) {
      const newest = !superseded();
      settle();
      // Adopt the server map, but keep any OTHER items (or a newer change of
      // this one) that are still in flight, and any item a later SSE upsert
      // already moved past this response (newest server stamp wins). An OLDER
      // change of this item that is still pending doesn't hold it back: it
      // will not re-send over this one.
      const keepLocal = new Set(inflightChecklistIds(incident.id));
      if (newest) keepLocal.delete(itemId);
      const merged = foldChecklistResponse(out.checklists, currentChecklists(incident.id), keepLocal, itemId);
      useCrisisStore.getState().applyChecklistState(incident.id, merged);
      return { ok: true };
    }
    if (superseded()) { settle(); return { ok: false, superseded: true }; }
    const failure = describeFailure(out.status, out.error);
    if (autoRetry && failure.auto) {
      await sleep(CHECKLIST_AUTO_RETRY_MS);
      if (superseded()) { settle(); return { ok: false, superseded: true }; }
      return attempt(false);
    }
    settle();
    // Roll the optimistic change back so the item reflects what the server has.
    const map = { ...currentChecklists(incident.id) };
    if (prior) map[itemId] = prior; else delete map[itemId];
    useCrisisStore.getState().applyChecklistState(incident.id, map);
    console.warn(`[checklist-sync] status change of ${itemId} failed:`, out.status ?? 'network', out.error ?? '');
    return { ok: false, superseded: false, status: out.status, message: failure.message, retryable: failure.retryable };
  };
  return attempt(true);
}
