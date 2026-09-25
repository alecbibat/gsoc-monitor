import type { Incident, IncidentAar } from './crisisStore';
import { LOCATION_GROUPS } from '../layers/locations/locations';
import { isShipGroupId } from './incidentShips';
import { propertyDef } from './templates/scopeLabels';

// ── Incident summaries for the list cards, the workspace header and the map ──
// Pure, store-free helpers: cheap enough to run for every card on every list
// render.

/**
 * Unique people who ever held a role on the incident — by pool id, falling
 * back to name (the AAR's personnelCount rule). Counts ended assignments too:
 * stand-down releases every seat, so an "open assignments" count reads 0 on
 * every archived incident.
 */
export function staffedCount(inc: Pick<Incident, 'assignments'>): number {
  const people = new Set<string>();
  for (const a of inc.assignments) {
    const key = a.personnelId ?? (a.name.trim() ? `name:${a.name.trim().toLowerCase()}` : '');
    if (key) people.add(key);
  }
  return people.size;
}

/** "🏔 Grand Canyon" for the incident's property (fleet included), or null when unset/unknown. */
export function incidentPropertyLabel(propertyId: string | null | undefined): string | null {
  const p = propertyDef(propertyId);
  return p ? `${p.icon} ${p.name}` : null;
}

// Future-dated entries (a mistyped time) must not pin "last activity" to "just now".
const FUTURE_SLACK_MS = 5 * 60_000;

/**
 * Epoch ms of the latest thing anyone did on the incident that carries a time:
 * log entries (typed, attached, or auto-logged state changes) and checklist
 * toggles. Falls back to creation.
 */
export function lastActivityAt(inc: Pick<Incident, 'createdAt' | 'actionLog' | 'checklists'>, now = Date.now()): number {
  let latest = Date.parse(inc.createdAt);
  if (Number.isNaN(latest)) latest = 0;
  const consider = (iso: string | undefined) => {
    if (!iso) return;
    const t = Date.parse(iso);
    if (!Number.isNaN(t) && t > latest && t <= now + FUTURE_SLACK_MS) latest = t;
  };
  for (const e of inc.actionLog) consider(e.timestamp);
  for (const st of Object.values(inc.checklists ?? {})) consider(st?.at);
  return latest;
}

/** "just now" / "5m ago" / "3h ago" / "2d ago" */
export function fmtAgo(ms: number, now = Date.now()): string {
  const d = Math.max(0, now - ms);
  if (d < 60_000) return 'just now';
  if (d < 3600_000) return `${Math.floor(d / 60_000)}m ago`;
  if (d < 48 * 3600_000) return `${Math.floor(d / 3600_000)}h ago`;
  return `${Math.floor(d / 86_400_000)}d ago`;
}

/** Local calendar date as YYYY-MM-DD — the form an <input type="date"> stores. */
export function localDateKey(d: Date = new Date()): string {
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

export interface AarProgress {
  /** Of the four standard AAR questions. */
  answered: number;
  /** Corrective actions with text that aren't done. */
  openActions: number;
  /** Open actions whose due date is before today (local). */
  overdue: number;
}

export function aarProgress(aar: IncidentAar | undefined, today = localDateKey()): AarProgress {
  const a = aar ?? {};
  const answered = [a.expected, a.happened, a.wentWell, a.improve].filter((v) => v?.trim()).length;
  let openActions = 0;
  let overdue = 0;
  for (const ca of a.correctiveActions ?? []) {
    if (!ca.text?.trim() || ca.done) continue;
    openActions += 1;
    const due = ca.due?.slice(0, 10);
    if (due && due < today) overdue += 1;
  }
  return { answered, openActions, overdue };
}

export interface Extent { west: number; south: number; east: number; north: number }

/**
 * What "Zoom to incident" frames: the visible drawn layers plus the fixed
 * locations of the incident's property and extra property groups. The ship
 * fleet has no fixed coordinates (positions are live AIS), so it is skipped.
 * Null when there is nothing to frame. Unpadded — the caller pads.
 */
export function incidentExtent(
  inc: Pick<Incident, 'drawLayers' | 'locationGroupId' | 'extraLocationGroups'>
): Extent | null {
  let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity;
  const add = (lon: number, lat: number) => {
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;
    if (lon < west) west = lon;
    if (lon > east) east = lon;
    if (lat < south) south = lat;
    if (lat > north) north = lat;
  };
  for (const layer of inc.drawLayers) {
    if (!layer.visible) continue;
    for (const p of layer.positions) add(p.lon, p.lat);
  }
  const groupIds = new Set([inc.locationGroupId, ...(inc.extraLocationGroups ?? [])]);
  for (const id of groupIds) {
    if (!id || isShipGroupId(id)) continue;
    const g = LOCATION_GROUPS.find((x) => x.id === id);
    for (const loc of g?.locations ?? []) add(loc.lon, loc.lat);
  }
  return west === Infinity ? null : { west, south, east, north };
}

// ── Delete confirmation ──────────────────────────────────────────────────────

/** What the operator types to delete an incident: its name, or DELETE when it has none. */
export function deleteConfirmPhrase(inc: Pick<Incident, 'incidentName'>): string {
  return inc.incidentName.trim() || 'DELETE';
}

/** Case- and spacing-insensitive: the point is a deliberate act, not a password. */
export function matchesDeletePhrase(typed: string, phrase: string): boolean {
  const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();
  return norm(typed) !== '' && norm(typed) === norm(phrase);
}
