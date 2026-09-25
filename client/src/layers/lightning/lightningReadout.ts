// Text for the sidebar card (LightningControls), kept pure so the wording and
// its edge cases are testable without React.
import type { LightningCounts, LightningGap, LightningStatusLite } from '../../types/lightning';
import type { LightningWindow } from './lightningStore';

/** Exact server count for a window (every received strike, not the sampled marks). */
export function countForWindow(counts: LightningCounts, windowMinutes: LightningWindow): number {
  switch (windowMinutes) {
    case 60:
      return counts.m60;
    case 360:
      return counts.m360;
    case 720:
      return counts.m720;
    default:
      return counts.m1440;
  }
}

/**
 * Whether a window's count is exact. The server's `counts.exact` covers the
 * 24 h window, so a shorter one is also exact once the pre-upgrade history
 * (kept 1-in-6, counted ×6) ends before the window starts. While the restore
 * hasn't said where that history ends, only the 24 h flag is known.
 */
export function countIsExact(server: LightningStatusLite, windowMinutes: LightningWindow): boolean {
  if (server.counts.exact) return true;
  const legacyBeforeMs = server.fidelity.legacyBeforeMs;
  return legacyBeforeMs !== null && legacyBeforeMs <= server.now - windowMinutes * 60_000;
}

/** Total collector blind time, whole minutes. */
export function gapMinutes(gaps: readonly LightningGap[] | null | undefined): number {
  if (!gaps) return 0;
  let ms = 0;
  for (const g of gaps) ms += Math.max(0, g.toMs - g.fromMs);
  return Math.round(ms / 60_000);
}

/** Below this the gap chip stays hidden: a relay hop or a deploy restart is expected. */
export const GAP_CHIP_MIN = 5;

/** Local HH:MM on a 24 h clock, like the top bar. */
export const fmtClock = (ms: number) =>
  new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });

export type ReadoutTone = 'ok' | 'muted' | 'warn' | 'danger';

/**
 * One line on the server collector, most urgent first (the sidebar's
 * lightningStatusText uses the same order): the /field request failing; the
 * collector down (strikes aren't being recorded); the 24 h restore failing
 * against the database, or still loading after a restart; else live with the
 * true global rate.
 */
export function collectorLine(
  server: LightningStatusLite | null,
  fieldError: string | null,
  fmtTime: (ms: number) => string = fmtClock
): { text: string; tone: ReadoutTone } | null {
  if (fieldError) return { text: 'History unavailable — retrying', tone: 'danger' };
  if (!server) return null;
  const c = server.collector;
  if (c.downSince !== null || !c.connected) {
    const text =
      c.downSince !== null
        ? `Server collector offline since ${fmtTime(c.downSince)}`
        : 'Server collector offline';
    return { text, tone: 'warn' };
  }
  // The server stays in 'retrying' for as long as Postgres is unreachable, so
  // this is no loading bar that will finish on its own.
  if (server.restore.state === 'retrying') {
    return { text: 'History unavailable (database) — retrying', tone: 'warn' };
  }
  if (server.restore.state !== 'done') {
    const pct = Math.max(0, Math.min(99, Math.floor((server.restore.progress || 0) * 100)));
    return { text: `Loading 24 h history… ${pct}%`, tone: 'muted' };
  }
  return { text: `Server collector live · ${c.ratePerMin.toLocaleString()}/min`, tone: 'ok' };
}

/**
 * The server's memory cap dropped the positions of strikes before
 * `evictedBeforeMs`. Inside the selected window that leaves the map empty
 * there while the count above still includes them, so say so rather than let
 * it read as a quiet sky.
 */
export function evictionLine(
  server: LightningStatusLite | null,
  windowMinutes: LightningWindow,
  fmtTime: (ms: number) => string = fmtClock
): { text: string; tone: ReadoutTone } | null {
  if (!server) return null;
  const before = server.fidelity.evictedBeforeMs;
  if (before === null || before <= server.now - windowMinutes * 60_000) return null;
  // "Exact" only when the count above carries no "≈".
  const counts = countIsExact(server, windowMinutes) ? 'counts are exact' : 'counts still include them';
  const text = `Positions before ${fmtTime(before)} not held (server memory) — older marks are missing; ${counts}`;
  return { text, tone: 'warn' };
}
