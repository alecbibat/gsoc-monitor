import type { LiveSource } from '../layers/lightning/lightningStore';

// The Lightning toggle's one-line status in the sidebar. Kept pure (and fed
// scalars only, so the sidebar's shallow selector can't re-render on every
// strike) so the priority order is testable without React.

export interface LightningStatusInputs {
  /** The /field request is failing — the map's 24 h marks are stale. */
  fieldError: string | null;
  /** From the last /field status; null until one arrives. */
  serverConnected: boolean | null;
  serverDownSince: number | null;
  serverRatePerMin: number;
  /** The server is still restoring its 24 h history after a restart. */
  restoring: boolean;
  /** 0..1 */
  restoreProgress: number;
  /** The browser's own Blitzortung socket. */
  connected: boolean;
  ratePerMin: number;
  liveSource: LiveSource;
}

/** Local HH:MM on a 24 h clock, like the top bar. */
const fmtClock = (ms: number) =>
  new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });

/**
 * Most urgent first: a failing history fetch, then a server collector that is
 * down (strikes aren't being recorded), then the post-restart restore, then
 * the live source — the browser's own socket, else the server's relay.
 */
export function lightningStatusText(s: LightningStatusInputs, fmtTime: (ms: number) => string = fmtClock): string {
  if (s.fieldError) return 'History unavailable — retrying';
  if (s.serverConnected === false || s.serverDownSince !== null) {
    return s.serverDownSince !== null
      ? `Server collector offline since ${fmtTime(s.serverDownSince)}`
      : 'Server collector offline';
  }
  if (s.restoring) {
    // Capped at 99 so "100%" never shows while it is still loading.
    const pct = Math.max(0, Math.min(99, Math.floor((s.restoreProgress || 0) * 100)));
    return `Loading 24 h history… ${pct}%`;
  }
  if (s.connected) return `${s.ratePerMin.toLocaleString()} strikes/min · live`;
  // The browser socket isn't delivering (yet, or at all) but the server's
  // collector is: its fresh list already feeds the live Xs, so say so rather
  // than "Connecting…" for the first 30 s of every load.
  if (s.liveSource === 'server' || s.serverConnected === true) {
    return `${s.serverRatePerMin.toLocaleString()} strikes/min · via server`;
  }
  return 'Connecting…';
}
