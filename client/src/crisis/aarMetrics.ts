import type { ActionLogEntry, Incident, PersonnelAssignment } from './crisisStore';

// ── AAR response metrics (Track 6) ───────────────────────────────────────────
// Pure computations over the incident record — every number here must be
// derivable from data the incident actually captured (the W3 log and the
// assignment history); nothing is estimated.

export interface AarMetrics {
  /** Operational span: incident start (or creation) → stand-down (or now). */
  durationMs: number;
  /** Creation → first recorded transition to Active; null = never went active
   * via a logged transition (incidents created directly as Active have none). */
  timeToActiveMs: number | null;
  /** True when there is no to-Active transition but the incident reached a
   * closed/active lifecycle anyway — i.e. it started life already Active. */
  activeAtCreation: boolean;
  personnelCount: number;   // unique people who held an assignment
  assignmentCount: number;  // total assignments (a person can hold several)
  /** IC seat changes beyond the first assignment (command transfers). */
  commandTransfers: number;
  logTotal: number;
  logByType: { action: number; event: number; info: number };
  operatorEntries: number;  // manually written entries (non-system)
}

const ts = (iso: string | undefined | null): number | null => {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : t;
};

export function computeAarMetrics(inc: Incident): AarMetrics {
  const created = ts(inc.createdAt) ?? Date.now();
  const start = ts(inc.incidentDatetime) ?? created;
  const end = ts(inc.archivedAt) ?? Date.now();
  const durationMs = Math.max(0, end - start);

  // First logged Monitoring/etc → Active transition. Log is newest-first in
  // storage but never trust ordering — take the earliest by timestamp.
  let firstActive: number | null = null;
  for (const e of inc.actionLog) {
    if (e.system === 'status-change' && e.meta?.to === 'active') {
      const t = ts(e.timestamp);
      if (t !== null && (firstActive === null || t < firstActive)) firstActive = t;
    }
  }
  const timeToActiveMs = firstActive === null ? null : Math.max(0, firstActive - created);

  const names = new Set(inc.assignments.map((a: PersonnelAssignment) => a.name.trim().toLowerCase()).filter(Boolean));
  const icSeats = inc.assignments.filter((a) => a.roleId === 'ic').length;

  const logByType = { action: 0, event: 0, info: 0 };
  let operatorEntries = 0;
  for (const e of inc.actionLog as ActionLogEntry[]) {
    logByType[e.entryType ?? 'action'] += 1;
    if (!e.system) operatorEntries += 1;
  }

  return {
    durationMs,
    timeToActiveMs,
    activeAtCreation: firstActive === null,
    personnelCount: names.size,
    assignmentCount: inc.assignments.length,
    commandTransfers: Math.max(0, icSeats - 1),
    logTotal: inc.actionLog.length,
    logByType,
    operatorEntries,
  };
}

/** "3d 4h" / "5h 12m" / "18m" — coarse humanized span for stat cards. */
export function fmtSpan(ms: number): string {
  const m = Math.round(ms / 60_000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${m % 60}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

// ── Swimlane data ────────────────────────────────────────────────────────────

export interface SwimlaneBar {
  name: string;
  startMs: number;
  endMs: number;      // clamped to the lane window
  open: boolean;      // still assigned at window end
}

export interface SwimlaneRow {
  roleId: string;
  title: string;
  abbrev?: string;
  color: string;
  bars: SwimlaneBar[];
}

export interface SwimlaneData {
  t0: number;
  t1: number;
  rows: SwimlaneRow[];
}

/**
 * The ICS progression: one row per role that was ever staffed, bars for each
 * assignment span. Row order follows the incident's own role list (which is
 * authored hierarchically: IC, command staff, then general staff).
 */
export function buildSwimlane(inc: Incident): SwimlaneData | null {
  if (inc.assignments.length === 0) return null;

  const starts = inc.assignments.map((a) => ts(a.startedAt)).filter((t): t is number => t !== null);
  if (starts.length === 0) return null;
  const created = ts(inc.createdAt);
  const t0 = Math.min(...starts, ...(created !== null ? [created] : []));
  const ends = inc.assignments.map((a) => ts(a.endedAt)).filter((t): t is number => t !== null);
  const archived = ts(inc.archivedAt);
  const t1 = Math.max(archived ?? Date.now(), ...ends, t0 + 60_000);

  const rows: SwimlaneRow[] = [];
  for (const role of inc.roles) {
    const bars = inc.assignments
      .filter((a) => a.roleId === role.id)
      .map((a) => {
        const s = ts(a.startedAt) ?? t0;
        const e = ts(a.endedAt);
        return {
          name: a.name,
          startMs: Math.max(t0, Math.min(s, t1)),
          endMs: e === null ? t1 : Math.max(t0, Math.min(e, t1)),
          open: e === null,
        };
      })
      .sort((a, b) => a.startMs - b.startMs);
    if (bars.length > 0) {
      rows.push({ roleId: role.id, title: role.title, abbrev: role.abbrev, color: role.color, bars });
    }
  }
  return rows.length > 0 ? { t0, t1, rows } : null;
}
