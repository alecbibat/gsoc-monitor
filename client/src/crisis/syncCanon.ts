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
 * Canonical form of an incident for sync comparisons: normalized taxonomy
 * values, stable key order.
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
 */
export function serverCanon(incident: { incidentType: string; incidentStatus: string; archivedAt?: string | null }): string {
  return stableStringify(normalizeIncidentFields(incident))!;
}
