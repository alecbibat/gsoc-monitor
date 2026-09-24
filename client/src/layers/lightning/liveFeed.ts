// Pure pieces of the live feed: reconnect backoff, the strikes/min counter and
// the choice of live source. Kept apart from the socket and the layer so they
// can be unit-tested.
import type { LiveSource } from './lightningStore';

// --- Reconnect backoff --------------------------------------------------------
// The first retry is quick (a relay restart is usually over in seconds), then it
// doubles to a minute so a blocked network (a corporate proxy refusing wss://,
// say) isn't hammered all day. The attempt count resets once a strike arrives.
export const RELAY_BACKOFF_MIN_MS = 3_000;
export const RELAY_BACKOFF_MAX_MS = 60_000;

/** Delay before reconnect attempt `attempt` (0-based): 3 s, 6 s, 12 s, … capped at 60 s. */
export function relayBackoffMs(attempt: number): number {
  const n = Math.max(0, Math.min(30, Math.floor(attempt))); // 2^30 is past the cap already
  return Math.min(RELAY_BACKOFF_MAX_MS, RELAY_BACKOFF_MIN_MS * 2 ** n);
}

// --- Strikes per minute -------------------------------------------------------
// Sixty one-second buckets instead of a timestamp per strike: at 200 strikes/s
// a timestamp array holds 12,000 entries and shifts ~200 of them every second;
// the buckets are fixed-size and O(1) per strike.
export class RateWindow {
  private readonly counts = new Uint32Array(60);
  private readonly secs = new Float64Array(60).fill(-Infinity);

  add(nowMs: number): void {
    const s = Math.floor(nowMs / 1000);
    const i = ((s % 60) + 60) % 60;
    if (this.secs[i] !== s) {
      this.secs[i] = s;
      this.counts[i] = 0;
    }
    this.counts[i]++;
  }

  /** Strikes in the last 60 s (this second and the 59 before it). */
  perMinute(nowMs: number): number {
    const s = Math.floor(nowMs / 1000);
    let n = 0;
    for (let i = 0; i < 60; i++) {
      const age = s - this.secs[i];
      if (age >= 0 && age < 60) n += this.counts[i];
    }
    return n;
  }

  clear(): void {
    this.counts.fill(0);
    this.secs.fill(-Infinity);
  }
}

// --- Live source --------------------------------------------------------------
/**
 * After this long without a strike from the browser socket, the server's
 * `fresh` list becomes the live feed.
 */
export const SOCKET_FALLBACK_MS = 30_000;

export interface LiveSourceDecision {
  source: LiveSource;
  /** Poll /field on the fast cadence so its `fresh` list stands in for the socket. */
  fastPoll: boolean;
}

/**
 * - 'browser' while the socket delivers (a strike within the last 30 s);
 * - once it has been quiet for 30 s (counted from mount when it never
 *   delivered), 'server' when the last /field succeeded and the server's own
 *   collector is up, 'offline' otherwise — and poll fast either way, since the
 *   poll is now the only way live strikes arrive;
 * - in the first 30 s before the socket's first strike: 'offline' (still
 *   connecting), on the normal cadence. Declaring 'server' there would flash a
 *   "live via server" note on every page load.
 */
export function decideLiveSource(p: {
  nowMs: number;
  startedMs: number;
  socketLastStrikeMs: number | null;
  serverLive: boolean;
}): LiveSourceDecision {
  const quietMs = p.nowMs - (p.socketLastStrikeMs ?? p.startedMs);
  if (quietMs < SOCKET_FALLBACK_MS) {
    return { source: p.socketLastStrikeMs !== null ? 'browser' : 'offline', fastPoll: false };
  }
  return { source: p.serverLive ? 'server' : 'offline', fastPoll: true };
}
