import type { ActionLogEntry, Incident, PersonnelAssignment } from './crisisStore';

// ── AAR response metrics (Track 6) ───────────────────────────────────────────
// Pure computations over the incident record — every number here must be
// derivable from data the incident actually captured (the W3 log and the
// assignment history); nothing is estimated.

export interface AarMetrics {
  /** Operational span: incident start (or creation) → stand-down (or now). */
  durationMs: number;
  /** Creation → first transition to Active during the FIRST activation run
   * (transitions after a stand-down are re-activations, not this metric).
   * null when the incident began life Active (the store's creation default)
   * or never reached Active. */
  timeToActiveMs: number | null;
  /** The incident started life already Active (no pre-Active phase logged). */
  activeAtCreation: boolean;
  personnelCount: number;   // unique people (by personnelId, name fallback)
  assignmentCount: number;  // total assignments (a person can hold several)
  /** Root-role (IC) seat changes to a DIFFERENT person — command transfers.
   * Derived from the assignment record, so it survives a renamed/rebuilt IC
   * role and ignores same-person re-assignment. */
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

  // Time to Active — FIRST activation run only. Incidents are created Active
  // by default and stand-down/reopen cycles log later monitoring→active
  // transitions, so a naive "earliest to-active" reads a re-activation as a
  // ten-day activation delay. Only status changes BEFORE the first stand-down
  // count, and the first change's `from` tells us the creation status.
  const firstStoodDown = inc.actionLog
    .filter((e) => e.system === 'stood-down')
    .reduce<number>((m, e) => Math.min(m, ts(e.timestamp) ?? Infinity), Infinity);
  const firstRun = inc.actionLog
    .filter((e) => e.system === 'status-change' && (ts(e.timestamp) ?? Infinity) < firstStoodDown)
    .sort((a, b) => (ts(a.timestamp) ?? 0) - (ts(b.timestamp) ?? 0));
  const initialStatus = firstRun[0]?.meta?.from ?? 'active'; // store default
  let timeToActiveMs: number | null = null;
  let activeAtCreation = initialStatus === 'active';
  if (!activeAtCreation) {
    const toActive = firstRun.find((e) => e.meta?.to === 'active');
    const t = toActive ? ts(toActive.timestamp) : null;
    if (t !== null) timeToActiveMs = Math.max(0, t - created);
  }

  // Unique people: personnelId is the identity when present — two people can
  // legitimately share a name (the store models exactly this).
  const names = new Set(
    inc.assignments
      .map((a: PersonnelAssignment) => a.personnelId ?? `name:${a.name.trim().toLowerCase()}`)
      .filter((k) => k && k !== 'name:')
  );

  // Command transfers: consecutive DIFFERENT holders of a root (command) role.
  // Root lookup instead of the literal 'ic' id — the built-in IC role can be
  // deleted and rebuilt with a generated id; same-person re-assignment is not
  // a transfer (matching the store's own log semantics).
  const rootIds = new Set(inc.roles.filter((r) => r.parentId === null).map((r) => r.id));
  const icSeatHolders = inc.assignments
    .filter((a) => rootIds.has(a.roleId))
    .sort((a, b) => (ts(a.startedAt) ?? 0) - (ts(b.startedAt) ?? 0));
  let commandTransfers = 0;
  for (let i = 1; i < icSeatHolders.length; i++) {
    const prev = icSeatHolders[i - 1];
    const cur = icSeatHolders[i];
    const samePerson =
      (cur.personnelId !== undefined && cur.personnelId === prev.personnelId) ||
      cur.name.trim().toLowerCase() === prev.name.trim().toLowerCase();
    if (!samePerson) commandTransfers += 1;
  }

  const logByType = { action: 0, event: 0, info: 0 };
  let operatorEntries = 0;
  for (const e of inc.actionLog as ActionLogEntry[]) {
    logByType[e.entryType ?? 'action'] += 1;
    if (!e.system) operatorEntries += 1;
  }

  return {
    durationMs,
    timeToActiveMs,
    activeAtCreation,
    personnelCount: names.size,
    assignmentCount: inc.assignments.length,
    commandTransfers,
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
