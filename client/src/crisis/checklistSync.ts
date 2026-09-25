import { useCrisisStore, type Incident } from './crisisStore';
import { foldChecklistResponse, isChecklistStateMap, type ChecklistStateMap } from './checklistTemplate';

// ── Checklist toggle sync (editor side) ──────────────────────────────────────
//
// Checklist state never rides the incident blob (syncCanon excludes it, the
// server preserves its own map on blob writes): every check/uncheck is one
// POST to the per-item endpoint, which applies it under a row lock, stamps the
// server-side timestamp, and fans out to editors' SSE and every live share
// snapshot. Here we do the optimistic local flip, send the POST, and reconcile
// with the server's authoritative map — keeping items whose own POST is still
// in flight local, exactly like logSync does for action-log entries.

// In-flight toggle counts per incident+item (a fast double-tap overlaps).
const inflight = new Map<string, Map<string, number>>();

function markInflight(incidentId: string, itemId: string, delta: 1 | -1): void {
  let items = inflight.get(incidentId);
  if (!items) { items = new Map(); inflight.set(incidentId, items); }
  const next = (items.get(itemId) ?? 0) + delta;
  if (next <= 0) items.delete(itemId); else items.set(itemId, next);
  if (items.size === 0) inflight.delete(incidentId);
}

/** Item ids whose toggle is still in flight — those keep their LOCAL state. */
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
 * How one toggle ended. A failure has already rolled the optimistic flip back
 * and carries a message for the caller to show next to the checklist (with a
 * Retry when `retryable`). It deliberately does NOT light the global sync
 * indicator: that one says "will retry", and it is the blob/log engines that
 * keep that promise — checklist state never rides the blob.
 */
export type ChecklistToggleResult =
  | { ok: true }
  /** A later toggle of the same item took over; its own result is the one that counts. */
  | { ok: false; superseded: true }
  | { ok: false; superseded: false; status: number | null; message: string; retryable: boolean };

/** One automatic re-send after a transient failure, this long after it. */
export const CHECKLIST_AUTO_RETRY_MS = 3_000;

// The newest toggle per incident+item. An older toggle's failure (or pending
// auto-retry) must neither roll back nor re-send over it.
const latestToggle = new Map<string, number>();
let toggleSeq = 0;

type PostOutcome =
  | { ok: true; checklists: ChecklistStateMap }
  | { ok: false; status: number | null; error: string | null };

async function postToggle(incidentId: string, itemId: string, checked: boolean): Promise<PostOutcome> {
  let res: Response;
  try {
    res = await fetch(`/api/incidents/${incidentId}/checklist/${itemId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ checked }),
    });
  } catch {
    return { ok: false, status: null, error: null };
  }
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
 * Check/uncheck one item: optimistic store flip, then the per-item POST. On
 * success the server's map (with its authoritative timestamp) replaces the
 * optimistic entry. A transient failure (offline, 5xx, the incident not
 * created server-side yet) is re-sent once after a few seconds — the toggle
 * is idempotent server-side, so a re-send can't move the timestamp — with the
 * optimistic state held meanwhile. A final failure rolls the flip back and
 * resolves with what to tell the operator.
 */
export function toggleChecklistItem(incident: Incident, itemId: string, checked: boolean): Promise<ChecklistToggleResult> {
  const store = useCrisisStore.getState();
  const prior = incident.checklists?.[itemId];
  store.toggleChecklistItem(itemId, checked);
  // The store action is archive-frozen (patchActiveEditable) — if the flip
  // didn't land, there is nothing to sync.
  if (currentChecklists(incident.id)[itemId]?.checked !== checked) {
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
    const out = await postToggle(incident.id, itemId, checked);
    if (out.ok) {
      const newest = !superseded();
      settle();
      // Adopt the server map, but keep any OTHER items (or a newer toggle of
      // this one) that are still in flight, and any item a later SSE upsert
      // already moved past this response (newest server stamp wins). An OLDER
      // toggle of this item that is still pending doesn't hold it back: it
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
    // Roll the optimistic flip back so the box reflects what the server has.
    const map = { ...currentChecklists(incident.id) };
    if (prior) map[itemId] = prior; else delete map[itemId];
    useCrisisStore.getState().applyChecklistState(incident.id, map);
    console.warn(`[checklist-sync] toggle of ${itemId} failed:`, out.status ?? 'network', out.error ?? '');
    return { ok: false, superseded: false, status: out.status, message: failure.message, retryable: failure.retryable };
  };
  return attempt(true);
}
