import { useCrisisStore, type Incident } from './crisisStore';
import type { ChecklistStateMap } from './checklistTemplate';

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
 * Check/uncheck one item: optimistic store flip, then the per-item POST. On
 * success the server's map (with its authoritative timestamp) replaces the
 * optimistic entry; on failure the flip is rolled back and the sync indicator
 * shows the error.
 */
export function toggleChecklistItem(incident: Incident, itemId: string, checked: boolean): void {
  const store = useCrisisStore.getState();
  const prior = incident.checklists?.[itemId];
  store.toggleChecklistItem(itemId, checked);
  // The store action is archive-frozen (patchActiveEditable) — if the flip
  // didn't land, there is nothing to sync.
  if (currentChecklists(incident.id)[itemId]?.checked !== checked) return;

  markInflight(incident.id, itemId, +1);
  fetch(`/api/incidents/${incident.id}/checklist/${itemId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ checked }),
  })
    .then(async (res) => {
      if (!res.ok) throw new Error(String(res.status));
      const { checklists } = (await res.json()) as { checklists: ChecklistStateMap };
      markInflight(incident.id, itemId, -1);
      // Adopt the server map, but keep any OTHER items (or a newer toggle of
      // this one) that are still in flight.
      const merged = mergeChecklists(checklists, currentChecklists(incident.id), inflightChecklistIds(incident.id));
      useCrisisStore.getState().applyChecklistState(incident.id, merged);
    })
    .catch((err) => {
      markInflight(incident.id, itemId, -1);
      // Roll the optimistic flip back so the box reflects what the server has.
      const map = { ...currentChecklists(incident.id) };
      if (prior) map[itemId] = prior; else delete map[itemId];
      useCrisisStore.getState().applyChecklistState(incident.id, map);
      useCrisisStore.getState().setSyncState('error');
      console.warn('[checklist-sync] toggle failed:', err);
    });
}
