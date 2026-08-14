// ── Incident taxonomy & state model ──────────────────────────────────────────
// Single source of truth for incident types (F1) and the incident state model
// (F2). Everything downstream — pickers, cards, badges, the map, reports and
// share pages — reads labels, colors and icons from here. The server keeps a
// mirrored id list in server/src/incidentTaxonomy.ts for write validation;
// change the two together.
//
// Incidents persisted before this module existed may carry retired ids
// ('chemical', 'security') and retired statuses ('contained', 'resolved').
// The normalizers below map those forward; they are applied on every ingest
// path (initial load, live-sync upserts), so legacy data is migrated lazily —
// the first edit after normalization writes the canonical values back.

export type IncidentSeverity = 'low' | 'moderate' | 'high' | 'critical';

// ── Categories ───────────────────────────────────────────────────────────────

export type IncidentCategory =
  | 'natural'
  | 'fire-hazmat'
  | 'infrastructure'
  | 'security'
  | 'medical'
  | 'operational'
  | 'other';

// Display order for grouped pickers.
export const INCIDENT_CATEGORIES: { id: IncidentCategory; label: string }[] = [
  { id: 'natural',        label: 'Natural Hazards' },
  { id: 'fire-hazmat',    label: 'Fire & HazMat' },
  { id: 'infrastructure', label: 'Infrastructure & Utilities' },
  { id: 'security',       label: 'Security' },
  { id: 'medical',        label: 'Medical & Life Safety' },
  { id: 'operational',    label: 'Access & Operations' },
  { id: 'other',          label: 'Other' },
];

// ── Incident types ───────────────────────────────────────────────────────────

export interface IncidentTypeDef {
  id: IncidentType;
  label: string;
  category: IncidentCategory;
  /** Hex color for map markers and color-by-type accents. */
  color: string;
  /** Emoji glyph for pickers and cards (same convention as LOCATION_GROUPS). */
  icon: string;
  /** Starting severity for a fresh incident of this type — advisory only. */
  defaultSeverity: IncidentSeverity;
  /** Position within its category (and overall display order). */
  sortOrder: number;
}

export const INCIDENT_TYPES = [
  // Natural hazards
  { id: 'wildfire',            label: 'Wildfire',                category: 'natural',        color: '#f97316', icon: '🔥', defaultSeverity: 'high',     sortOrder: 0 },
  { id: 'hurricane',           label: 'Hurricane / Tropical',    category: 'natural',        color: '#8b5cf6', icon: '🌀', defaultSeverity: 'high',     sortOrder: 1 },
  { id: 'severe-weather',      label: 'Severe Weather',          category: 'natural',        color: '#6366f1', icon: '⛈️', defaultSeverity: 'moderate', sortOrder: 2 },
  { id: 'winter-storm',        label: 'Winter Storm',            category: 'natural',        color: '#38bdf8', icon: '❄️', defaultSeverity: 'moderate', sortOrder: 3 },
  { id: 'flood',               label: 'Flood',                   category: 'natural',        color: '#3b82f6', icon: '🌊', defaultSeverity: 'high',     sortOrder: 4 },
  { id: 'earthquake',          label: 'Earthquake',              category: 'natural',        color: '#a16207', icon: '🏚️', defaultSeverity: 'high',     sortOrder: 5 },
  { id: 'wildlife',            label: 'Wildlife',                category: 'natural',        color: '#84cc16', icon: '🐻', defaultSeverity: 'low',      sortOrder: 6 },
  // Fire & HazMat
  { id: 'structure-fire',      label: 'Fire (Structure)',        category: 'fire-hazmat',    color: '#ef4444', icon: '🚒', defaultSeverity: 'high',     sortOrder: 10 },
  { id: 'hazmat',              label: 'HazMat',                  category: 'fire-hazmat',    color: '#eab308', icon: '☣️', defaultSeverity: 'high',     sortOrder: 11 },
  // Infrastructure & utilities
  { id: 'utility-outage',      label: 'Utility / Power Outage',  category: 'infrastructure', color: '#facc15', icon: '⚡', defaultSeverity: 'moderate', sortOrder: 20 },
  { id: 'water-system',        label: 'Water System',            category: 'infrastructure', color: '#0ea5e9', icon: '🚰', defaultSeverity: 'moderate', sortOrder: 21 },
  { id: 'it-comms',            label: 'IT / Comms Outage',       category: 'infrastructure', color: '#64748b', icon: '📡', defaultSeverity: 'moderate', sortOrder: 22 },
  { id: 'cyber',               label: 'Cyber Incident',          category: 'infrastructure', color: '#14b8a6', icon: '🖥️', defaultSeverity: 'high',     sortOrder: 23 },
  // Security
  { id: 'violence-threat',     label: 'Violence / Threat',       category: 'security',       color: '#dc2626', icon: '🚨', defaultSeverity: 'critical', sortOrder: 30 },
  { id: 'suspicious-activity', label: 'Suspicious Activity',     category: 'security',       color: '#d946ef', icon: '👁️', defaultSeverity: 'low',      sortOrder: 31 },
  { id: 'theft',               label: 'Theft / Loss Prevention', category: 'security',       color: '#f43f5e', icon: '🔓', defaultSeverity: 'low',      sortOrder: 32 },
  { id: 'civil-unrest',        label: 'Civil Unrest',            category: 'security',       color: '#fb7185', icon: '📢', defaultSeverity: 'moderate', sortOrder: 33 },
  // Medical & life safety
  { id: 'medical',             label: 'Medical',                 category: 'medical',        color: '#22c55e', icon: '🚑', defaultSeverity: 'moderate', sortOrder: 40 },
  { id: 'mass-casualty',       label: 'Mass Casualty',           category: 'medical',        color: '#16a34a', icon: '⛑️', defaultSeverity: 'critical', sortOrder: 41 },
  { id: 'fatality',            label: 'Fatality',                category: 'medical',        color: '#94a3b8', icon: '🕊️', defaultSeverity: 'critical', sortOrder: 42 },
  { id: 'search-rescue',       label: 'Search & Rescue',         category: 'medical',        color: '#10b981', icon: '🧭', defaultSeverity: 'high',     sortOrder: 43 },
  { id: 'public-health',       label: 'Public Health',           category: 'medical',        color: '#4ade80', icon: '🦠', defaultSeverity: 'moderate', sortOrder: 44 },
  // Access & operations
  { id: 'road-access',         label: 'Road Closure / Access',   category: 'operational',    color: '#fb923c', icon: '🚧', defaultSeverity: 'low',      sortOrder: 50 },
  { id: 'maritime',            label: 'Maritime',                category: 'operational',    color: '#06b6d4', icon: '⚓', defaultSeverity: 'moderate', sortOrder: 51 },
  { id: 'aviation',            label: 'Aviation',                category: 'operational',    color: '#60a5fa', icon: '✈️', defaultSeverity: 'moderate', sortOrder: 52 },
  // Other
  { id: 'other',               label: 'Other',                   category: 'other',          color: '#a3a3a3', icon: '📋', defaultSeverity: 'low',      sortOrder: 90 },
] as const satisfies readonly {
  id: string;
  label: string;
  category: IncidentCategory;
  color: string;
  icon: string;
  defaultSeverity: IncidentSeverity;
  sortOrder: number;
}[];

export type IncidentType = (typeof INCIDENT_TYPES)[number]['id'];

const TYPE_BY_ID = new Map<string, IncidentTypeDef>(
  INCIDENT_TYPES.map((t) => [t.id, t])
);

// Retired ids from the original hardcoded union, mapped to their successors.
export const LEGACY_TYPE_ALIASES: Record<string, IncidentType> = {
  chemical: 'hazmat',
  security: 'violence-threat',
};

export function normalizeIncidentType(raw: unknown): IncidentType {
  if (typeof raw === 'string') {
    if (TYPE_BY_ID.has(raw)) return raw as IncidentType;
    // Own-property check: share snapshots are attacker-influenceable JSON, and
    // a bare index would read inherited keys ('toString', '__proto__', …) off
    // the object prototype and return a non-string.
    const alias = Object.prototype.hasOwnProperty.call(LEGACY_TYPE_ALIASES, raw)
      ? LEGACY_TYPE_ALIASES[raw]
      : undefined;
    if (alias) return alias;
  }
  return 'other';
}

/** Total lookup: legacy ids are mapped forward, unknown ids fall back to Other. */
export function incidentTypeDef(raw: string | null | undefined): IncidentTypeDef {
  return TYPE_BY_ID.get(normalizeIncidentType(raw))!;
}

/** Types of one category in display order, for grouped pickers. */
export function incidentTypesInCategory(category: IncidentCategory): IncidentTypeDef[] {
  return INCIDENT_TYPES.filter((t) => t.category === category);
}

// ── Incident statuses ────────────────────────────────────────────────────────
//
// Lifecycle: monitoring → active → recovery → closed. Stand-down archives an
// incident and forces `closed`; only `active` incidents count toward the tab
// title and crisis-button badges.

export interface IncidentStatusDef {
  id: IncidentStatus;
  label: string;
  /** Hex color for the status dot. */
  dot: string;
  /** Tailwind classes for the status badge/chip. */
  badge: string;
  /** Sort rank for incident lists — most urgent first. */
  listRank: number;
}

// Array order is lifecycle order (drives the status chip row).
export const INCIDENT_STATUSES = [
  { id: 'monitoring', label: 'Monitoring', dot: '#38bdf8', badge: 'text-sky-300 bg-sky-400/15 border-sky-400/40',     listRank: 1 },
  { id: 'active',     label: 'Active',     dot: '#ef4444', badge: 'text-red-400 bg-red-500/15 border-red-500/40',     listRank: 0 },
  { id: 'recovery',   label: 'Recovery',   dot: '#f59e0b', badge: 'text-amber-300 bg-amber-400/15 border-amber-400/40', listRank: 2 },
  { id: 'closed',     label: 'Closed',     dot: '#22c55e', badge: 'text-green-400 bg-green-500/15 border-green-500/40', listRank: 3 },
] as const satisfies readonly {
  id: string;
  label: string;
  dot: string;
  badge: string;
  listRank: number;
}[];

export type IncidentStatus = (typeof INCIDENT_STATUSES)[number]['id'];

const STATUS_BY_ID = new Map<string, IncidentStatusDef>(
  INCIDENT_STATUSES.map((s) => [s.id, s])
);

// Retired statuses from the original three-state model.
export const LEGACY_STATUS_ALIASES: Record<string, IncidentStatus> = {
  contained: 'recovery',
  resolved: 'closed',
};

export function normalizeIncidentStatus(raw: unknown): IncidentStatus {
  if (typeof raw === 'string') {
    if (STATUS_BY_ID.has(raw)) return raw as IncidentStatus;
    // Own-property check — same prototype-chain hazard as the type aliases.
    const alias = Object.prototype.hasOwnProperty.call(LEGACY_STATUS_ALIASES, raw)
      ? LEGACY_STATUS_ALIASES[raw]
      : undefined;
    if (alias) return alias;
  }
  // Unknown → active, matching the old `?? STATUS_BADGE.active` fallbacks:
  // failing loud-side is safer than quietly filing an incident as closed.
  return 'active';
}

/** Total lookup: legacy statuses are mapped forward, unknown fall back to Active. */
export function incidentStatusDef(raw: string | null | undefined): IncidentStatusDef {
  return STATUS_BY_ID.get(normalizeIncidentStatus(raw))!;
}

// ── Incident normalization ───────────────────────────────────────────────────

/**
 * Map an incident's type/status forward to the current taxonomy, and force
 * `closed` on stood-down (archived) incidents — the conflation of "archived
 * but still status=active" is what kept the ⚠ CRISIS tab badge lit forever.
 *
 * Returns the SAME object when nothing needs to change, so callers (and the
 * sync layer's identity/equality checks) see no phantom edits for data that is
 * already canonical.
 */
export function normalizeIncidentFields<
  T extends { incidentType: string; incidentStatus: string; archivedAt?: string | null }
>(inc: T): T {
  const type = normalizeIncidentType(inc.incidentType);
  let status = normalizeIncidentStatus(inc.incidentStatus);
  if (inc.archivedAt) status = 'closed';
  if (type === inc.incidentType && status === inc.incidentStatus) return inc;
  return { ...inc, incidentType: type, incidentStatus: status };
}
