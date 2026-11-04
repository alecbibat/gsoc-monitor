import { pool } from './db';

// ── ICS checklist state ──────────────────────────────────────────────────────
//
// Incidents carry a sparse `checklists` map (itemId → { status, checked, at,
// by }). Like the action log, it never rides whole-blob writes: two responders
// (or a responder and a share-link viewer) changing different items inside the
// same debounce window must not overwrite each other, so every change goes
// through applyChecklistToggle below — a row-locked per-item mutation — and
// the blob upserts in incidents.ts preserve the row's existing map.
//
// An item is not started, in progress or completed. `checked` stays on every
// entry (true exactly when completed) so progress counts and pages loaded
// before statuses existed keep reading completion unchanged; entries written
// before then carry only `checked`.
//
// Timestamps are stamped HERE, not taken from the client: the checked-at time
// is the point of the feature, and share-side toggles arrive unauthenticated,
// so a client-supplied clock is neither trusted nor needed.

export type ChecklistStatus = 'not-started' | 'in-progress' | 'completed';

const STATUSES: readonly ChecklistStatus[] = ['not-started', 'in-progress', 'completed'];

function isStatus(v: unknown): v is ChecklistStatus {
  return typeof v === 'string' && (STATUSES as readonly string[]).includes(v);
}

/** One item's state as stored in incidents.data.checklists. */
export interface ChecklistItemState {
  /** True exactly when the item is completed. */
  checked: boolean;
  /** Absent on entries written before statuses existed. */
  status?: ChecklistStatus;
  at: string;
  by?: string;
}

/** A stored entry's status; entries from before statuses read by their checked flag. */
export function storedStatus(state: unknown): ChecklistStatus {
  if (!state || typeof state !== 'object') return 'not-started';
  const s = state as { checked?: unknown; status?: unknown };
  if (isStatus(s.status)) return s.status;
  return s.checked === true ? 'completed' : 'not-started';
}

// Item ids come from the crisis templates (e.g. "safety-imm-2",
// "t-wildfire-ops-imm-1"). The signed-in toggle (routes/incidents.ts) accepts
// any well-formed id rather than checking it against the incident's resolved
// template: an incident's map legitimately holds ids its template no longer
// resolves to (type or property changed, or an admin edited the scope), and
// those show as retired items. The share-page toggle (routes/crisis.ts) is
// further limited to the items of the blocks that apply to the incident —
// its viewer may be anonymous, and a retired id comes back to share viewers
// with its text. The cap stops an unauthenticated writer from growing the
// blob without limit; it sits above the most an incident can resolve to (4
// applicable scopes × 300 items, crisisTemplates/validate.ts) with room for
// retired entries.
const ITEM_ID_RE = /^[a-z][a-z0-9-]{0,63}$/;
const MAX_ITEMS = 1500;
const MAX_BY_LEN = 60;

/**
 * Why a checklist request is malformed, or null. The body names the status to
 * set — { status: 'not-started' | 'in-progress' | 'completed' } — or, from a
 * page loaded before statuses existed, { checked: boolean }.
 */
export function invalidToggleReason(itemId: unknown, body: unknown): string | null {
  if (typeof itemId !== 'string' || !ITEM_ID_RE.test(itemId)) return 'invalid item id';
  if (!body || typeof body !== 'object') return 'body must be a JSON object';
  const b = body as { checked?: unknown; status?: unknown; by?: unknown };
  if (b.status !== undefined) {
    if (!isStatus(b.status)) return `status must be one of ${STATUSES.join(', ')}`;
  } else if (typeof b.checked !== 'boolean') {
    return 'checked must be a boolean';
  }
  if (b.by !== undefined && b.by !== null && typeof b.by !== 'string') return 'by must be a string';
  return null;
}

/** The status a validated request body asks for (see invalidToggleReason). */
export function requestedStatus(body: { checked?: unknown; status?: unknown }): ChecklistStatus {
  if (isStatus(body.status)) return body.status;
  return body.checked === true ? 'completed' : 'not-started';
}

/** Sanitized display name for the "by" attribution, or undefined. */
export function cleanActor(by: unknown): string | undefined {
  if (typeof by !== 'string') return undefined;
  // eslint-disable-next-line no-control-regex
  const cleaned = by.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, MAX_BY_LEN);
  return cleaned || undefined;
}

export type ToggleResult =
  | { ok: true; changed: boolean; checklists: Record<string, ChecklistItemState>; incident: Record<string, unknown> }
  | { ok: false; status: number; error: string };

/**
 * Set one item's status in an incident's checklist map under a row lock and
 * return the merged incident. Idempotent: re-asserting the current status
 * changes nothing (so a retry or double-tap can't move the timestamp). The
 * caller is responsible for fanout (editor SSE + share snapshots).
 */
export async function applyChecklistToggle(
  incidentId: string,
  itemId: string,
  status: ChecklistStatus,
  by: string | undefined
): Promise<ToggleResult> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [row] } = await client.query<{ data: Record<string, unknown> }>(
      'SELECT data FROM incidents WHERE id = $1 FOR UPDATE',
      [incidentId]
    );
    if (!row) {
      await client.query('ROLLBACK');
      return { ok: false, status: 404, error: 'Incident not found' };
    }
    const data = row.data;
    if (data.archivedAt) {
      await client.query('ROLLBACK');
      return { ok: false, status: 409, error: 'Incident is archived' };
    }
    const raw = data.checklists;
    const map: Record<string, ChecklistItemState> =
      raw && typeof raw === 'object' && !Array.isArray(raw)
        ? { ...(raw as Record<string, ChecklistItemState>) }
        : {};

    const current = map[itemId];
    // An untouched item is already "not started": setting that records nothing.
    if (current && typeof current === 'object' ? storedStatus(current) === status : status === 'not-started') {
      await client.query('ROLLBACK');
      return { ok: true, changed: false, checklists: map, incident: data };
    }
    if (!current && Object.keys(map).length >= MAX_ITEMS) {
      await client.query('ROLLBACK');
      return { ok: false, status: 400, error: 'Checklist is full' };
    }

    map[itemId] = { checked: status === 'completed', status, at: new Date().toISOString(), ...(by ? { by } : {}) };
    data.checklists = map;
    await client.query(
      'UPDATE incidents SET data = $1, updated_at = NOW() WHERE id = $2',
      [JSON.stringify(data), incidentId]
    );
    await client.query('COMMIT');
    return { ok: true, changed: true, checklists: map, incident: data };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => { /* connection already gone */ });
    throw err;
  } finally {
    client.release();
  }
}
