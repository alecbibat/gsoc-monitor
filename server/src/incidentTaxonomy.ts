// Server-side mirror of the incident taxonomy (client/src/crisis/taxonomy.ts).
// Only the id sets live here — labels/colors/icons are presentation and stay
// client-side. KEEP IN SYNC when adding or retiring a type or status.

// Canonical type ids, plus retired ids ('chemical', 'security') that old
// clients and previously-stored incidents may still send — the client maps
// them forward on read, so writes carrying them stay valid.
export const INCIDENT_TYPE_IDS: ReadonlySet<string> = new Set([
  // natural
  'wildfire', 'hurricane', 'severe-weather', 'winter-storm', 'flood', 'earthquake', 'wildlife',
  // fire & hazmat
  'structure-fire', 'hazmat',
  // infrastructure
  'utility-outage', 'water-system', 'it-comms', 'cyber',
  // security
  'violence-threat', 'suspicious-activity', 'theft', 'civil-unrest',
  // medical & life safety
  'medical', 'mass-casualty', 'fatality', 'search-rescue', 'public-health',
  // access & operations
  'road-access', 'maritime', 'aviation',
  // other
  'other',
  // retired ids still accepted on write
  'chemical', 'security',
]);

// Lifecycle statuses plus the retired three-state values.
export const INCIDENT_STATUS_IDS: ReadonlySet<string> = new Set([
  'monitoring', 'active', 'recovery', 'closed',
  // retired statuses still accepted on write
  'contained', 'resolved',
]);

/**
 * Validate an incident write body. Returns a human-readable reason when the
 * body is unacceptable, or null when it is fine. Only identity and taxonomy
 * fields are checked — the rest of the incident is intentionally opaque JSONB.
 */
export function invalidIncidentReason(body: unknown): string | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return 'body must be an incident object';
  }
  const inc = body as Record<string, unknown>;
  if (typeof inc.id !== 'string' || inc.id.length === 0) {
    return 'id is required';
  }
  if (typeof inc.incidentType !== 'string' || !INCIDENT_TYPE_IDS.has(inc.incidentType)) {
    return `unknown incidentType ${JSON.stringify(inc.incidentType ?? null)}`;
  }
  if (typeof inc.incidentStatus !== 'string' || !INCIDENT_STATUS_IDS.has(inc.incidentStatus)) {
    return `unknown incidentStatus ${JSON.stringify(inc.incidentStatus ?? null)}`;
  }
  return null;
}
