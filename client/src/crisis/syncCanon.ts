import { normalizeIncidentFields } from './taxonomy';

// ── Canonical serialization for incident sync ────────────────────────────────
// The change-watcher and the live-sync merge both need to answer "is this
// incident different from what the server has?". A plain JSON.stringify can't:
// Postgres JSONB doesn't preserve key order, so an incident that round-trips
// through the DB (or arrives as our own SSE echo) serializes to different bytes
// despite identical data. stableStringify sorts object keys and drops undefined
// keys — mirroring JSON/JSONB semantics — so equal data always compares equal.
export function stableStringify(v: unknown): string | undefined {
  if (v === undefined || typeof v === 'function') return undefined;
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map((x) => stableStringify(x) ?? 'null').join(',')}]`;
  const parts: string[] = [];
  for (const k of Object.keys(v as Record<string, unknown>).sort()) {
    const sv = stableStringify((v as Record<string, unknown>)[k]);
    if (sv === undefined) continue; // omit undefined-valued keys, like JSON does
    parts.push(`${JSON.stringify(k)}:${sv}`);
  }
  return `{${parts.join(',')}}`;
}

/**
 * Canonical form of an incident's BLOB for sync comparisons: normalized
 * taxonomy values, stable key order, and the action log excluded.
 *
 * Server-origin data must ALWAYS be canonicalized through here, never through
 * bare stableStringify. The store normalizes legacy taxonomy values on ingest
 * (retired type/status ids, archived-but-not-closed), so a baseline computed
 * from the raw server blob would differ from the store's copy and make every
 * legacy incident look locally edited. That phantom edit is not harmless: it
 * schedules an unprompted write-back PUT on every client, and while that write
 * is pending the sync layer discards concurrent peers' upserts and deletes —
 * a freshly opened tab could silently overwrite another responder's edit or
 * resurrect an admin-deleted incident. Normalizing the baseline instead means
 * legacy data looks unchanged until a person actually edits it, and the edit
 * itself carries the canonical values to the server.
 *
 * The action log is excluded because it does not sync as part of the blob at
 * all: entries go through the server's append-only log endpoints, and the
 * server preserves its own actionLog on blob writes. Log changes therefore
 * must never make the blob look edited (that PUT couldn't carry them anyway).
 */
export function serverCanon(incident: {
  incidentType: string; incidentStatus: string; archivedAt?: string | null; actionLog?: unknown;
}): string {
  const { actionLog: _log, ...rest } = normalizeIncidentFields(incident);
  return stableStringify(rest)!;
}

/** Canonical form of one log entry, for per-entry change detection. */
export function entryCanon(entry: unknown): string {
  return stableStringify(entry) ?? 'null';
}

interface LogEntryLike { id: string }

/**
 * Reconcile the server's copy of an action log with local state when a remote
 * upsert arrives. The server log wins, with two exceptions:
 * - entries whose ids are in `keepLocal` (local appends/edits whose push is
 *   still in flight) keep their LOCAL version — the push will land and
 *   rebroadcast them;
 * - local-only `keepLocal` entries missing from the server log are prepended
 *   so an in-flight append doesn't flicker out of the UI.
 */
export function mergeActionLogs<E extends LogEntryLike>(
  remote: E[],
  local: E[],
  keepLocal: ReadonlySet<string>
): E[] {
  if (keepLocal.size === 0 || local.length === 0) return remote;
  const localById = new Map(local.map((e) => [e.id, e]));
  const remoteIds = new Set(remote.map((e) => e.id));
  const merged = remote.map((e) =>
    keepLocal.has(e.id) && localById.has(e.id) ? localById.get(e.id)! : e
  );
  const localOnly = local.filter((e) => keepLocal.has(e.id) && !remoteIds.has(e.id));
  return localOnly.length ? [...localOnly, ...merged] : merged;
}
