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
 * One line on the server collector, most urgent first:
 * the /field request failing; the 24 h restore still loading after a restart;
 * the collector down; else live with the true global rate.
 */
export function collectorLine(
  server: LightningStatusLite | null,
  fieldError: string | null,
  fmtTime: (ms: number) => string = fmtClock
): { text: string; tone: ReadoutTone } | null {
  if (fieldError) return { text: 'History unavailable — retrying', tone: 'danger' };
  if (!server) return null;
  if (server.restore.state !== 'done') {
    const pct = Math.max(0, Math.min(99, Math.floor((server.restore.progress || 0) * 100)));
    return { text: `Loading 24 h history… ${pct}%`, tone: 'muted' };
  }
  const c = server.collector;
  if (c.downSince !== null || !c.connected) {
    const text =
      c.downSince !== null
        ? `Server collector offline since ${fmtTime(c.downSince)}`
        : 'Server collector offline';
    return { text, tone: 'warn' };
  }
  return { text: `Server collector live · ${c.ratePerMin.toLocaleString()}/min`, tone: 'ok' };
}
