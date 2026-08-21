import { pool } from './db';

// ── ICS checklist state ──────────────────────────────────────────────────────
//
// Incidents carry a sparse `checklists` map (itemId → { checked, at, by }).
// Like the action log, it never rides whole-blob writes: two responders (or a
// responder and a share-link viewer) toggling different items inside the same
// debounce window must not overwrite each other, so every toggle goes through
// applyChecklistToggle below — a row-locked per-item mutation — and the blob
// upserts in incidents.ts preserve the row's existing map.
//
// Timestamps are stamped HERE, not taken from the client: the checked-at time
// is the point of the feature, and share-side toggles arrive unauthenticated,
// so a client-supplied clock is neither trusted nor needed.

/** One item's state as stored in incidents.data.checklists. */
export interface ChecklistItemState {
  checked: boolean;
  at: string;
  by?: string;
}

// Item ids come from the client-side template (e.g. "safety-imm-2"). The
// server doesn't mirror the template, so it accepts any well-formed id and
// bounds the map instead — unknown ids are harmless (never rendered) and the
// cap stops an unauthenticated writer from growing the blob without limit.
const ITEM_ID_RE = /^[a-z][a-z0-9-]{0,63}$/;
const MAX_ITEMS = 500;
const MAX_BY_LEN = 60;

export function invalidToggleReason(itemId: unknown, body: unknown): string | null {
  if (typeof itemId !== 'string' || !ITEM_ID_RE.test(itemId)) return 'invalid item id';
  if (!body || typeof body !== 'object') return 'body must be a JSON object';
  const b = body as { checked?: unknown; by?: unknown };
  if (typeof b.checked !== 'boolean') return 'checked must be a boolean';
  if (b.by !== undefined && b.by !== null && typeof b.by !== 'string') return 'by must be a string';
  return null;
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
 * Apply one check/uncheck to an incident's checklist map under a row lock and
 * return the merged incident. Idempotent: re-asserting the current checked
 * state changes nothing (so a retry or double-tap can't move the timestamp).
 * The caller is responsible for fanout (editor SSE + share snapshots).
 */
export async function applyChecklistToggle(
  incidentId: string,
  itemId: string,
  checked: boolean,
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
    if (current && typeof current === 'object' && current.checked === checked) {
      await client.query('ROLLBACK');
      return { ok: true, changed: false, checklists: map, incident: data };
    }
    if (!current && Object.keys(map).length >= MAX_ITEMS) {
      await client.query('ROLLBACK');
      return { ok: false, status: 400, error: 'Checklist is full' };
    }

    map[itemId] = { checked, at: new Date().toISOString(), ...(by ? { by } : {}) };
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
