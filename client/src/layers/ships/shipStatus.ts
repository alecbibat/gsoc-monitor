// Ship status vocabulary shared by anything that has to say what a vessel is
// doing right now: the daily fleet snapshot, the crisis vessel picker, and the
// public share page's vessel card.
//
// It lives apart from fleetSnapshot.ts on purpose — that module carries the
// offline coastline and city datasets (~240 KB of source), and a share-link
// viewer reading "Underway · 12.4 kt" should not download a world map to see
// it.
import type { ShipState } from '../../types';

export type StatusKind = 'docked' | 'anchored' | 'underway' | 'alert' | 'unknown';

// Abnormal AIS statuses must never be dressed up as routine by the speed
// heuristic — a digest that shows an aground ship as "In port" is worse than
// no digest.
const ALERT_STATUS: Record<number, string> = {
  2: 'Not under command',
  3: 'Restricted maneuv.',
  4: 'Constrained',
  6: 'Aground',
};

export function statusOf(s: ShipState): { kind: StatusKind; label: string } {
  if (s.navStatus != null && ALERT_STATUS[s.navStatus]) {
    return { kind: 'alert', label: ALERT_STATUS[s.navStatus] };
  }
  if (s.navStatus === 5) return { kind: 'docked', label: 'Docked' };
  if (s.navStatus === 1) return { kind: 'anchored', label: 'At anchor' };
  if (s.navStatus === 0) return { kind: 'underway', label: 'Underway' };
  if (s.navStatus === 8) return { kind: 'underway', label: 'Under sail' };
  if (s.speedKt != null) {
    return s.speedKt > 0.7
      ? { kind: 'underway', label: 'Underway' }
      : { kind: 'docked', label: 'In port' };
  }
  return { kind: 'unknown', label: 'Last known' };
}

/** Tailwind text colour per status kind, for the compact status chips. */
export const STATUS_TONE: Record<StatusKind, string> = {
  alert: 'text-accent-danger',
  underway: 'text-accent-ok',
  docked: 'text-white/70',
  anchored: 'text-white/70',
  unknown: 'text-white/40',
};

/** "3m ago" / "5h ago" from an AIS report age in seconds. */
export function lastSeenText(lastSeenSec: number): string {
  if (!Number.isFinite(lastSeenSec) || lastSeenSec < 0) return 'age unknown';
  if (lastSeenSec < 90) return 'just now';
  if (lastSeenSec < 3_600) return `${Math.round(lastSeenSec / 60)}m ago`;
  if (lastSeenSec < 86_400) return `${Math.round(lastSeenSec / 3_600)}h ago`;
  return `${Math.round(lastSeenSec / 86_400)}d ago`;
}

/** Decimal degrees as an operator-readable position: "18.5412°N 154.0021°W". */
export function positionText(lat: number, lon: number): string {
  const ns = lat >= 0 ? 'N' : 'S';
  const ew = lon >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(4)}°${ns} ${Math.abs(lon).toFixed(4)}°${ew}`;
}
