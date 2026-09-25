// Server-corrected clock for strike ages. Every age on the globe (colour
// stage, the 2-minute live hold, the 24 h expiry, the window filter) is
// "server now − strike time". Strike times are Blitzortung's own, so a laptop
// whose clock is a minute off would otherwise hold live Xs too long or too
// short and step every mark at the wrong moment. Each /field response carries
// the server's `now`; we compare it with the midpoint of the request (the best
// guess of when the server stamped it) and smooth the samples.

/** Weight of a new sample: smooths network jitter, converges in a few polls. */
export const CLOCK_EWMA_ALPHA = 0.3;
/**
 * A sample further than this from the running offset is a bad response or a
 * local clock that is simply wrong — one sample can't tell which, so it is not
 * folded in on its own.
 */
export const CLOCK_MAX_OFFSET_MS = 3_600_000;
/** That many such samples in a row, all within CLOCK_CONFIRM_SPREAD_MS, are believed. */
export const CLOCK_CONFIRM_SAMPLES = 3;
export const CLOCK_CONFIRM_SPREAD_MS = 5_000;

/** One offset sample: server time minus the local midpoint of the request. */
export function offsetSample(serverNowMs: number, fetchStartMs: number, fetchEndMs: number): number {
  return serverNowMs - (fetchStartMs + fetchEndMs) / 2;
}

/** Fold a sample into the running offset (EWMA). The first sample is taken as is. */
export function foldOffset(prev: number | null, sample: number, alpha = CLOCK_EWMA_ALPHA): number {
  return prev === null ? sample : prev + alpha * (sample - prev);
}

export interface ServerClock {
  /** Record one response: its server `now` and when the request started/ended locally. */
  observe(serverNowMs: number, fetchStartMs: number, fetchEndMs: number): void;
  /** Local time corrected to the server's clock (plain local time until the first sample). */
  now(): number;
  offsetMs(): number;
}

export function createServerClock(localNow: () => number = Date.now): ServerClock {
  let offset: number | null = null;
  // Consecutive samples too far from the offset to fold, newest last.
  let far: number[] = [];
  return {
    observe(serverNowMs, fetchStartMs, fetchEndMs) {
      const sample = offsetSample(serverNowMs, fetchStartMs, fetchEndMs);
      if (!Number.isFinite(sample)) return; // missing/garbled `now` — keep what we have
      if (Math.abs(sample - (offset ?? 0)) <= CLOCK_MAX_OFFSET_MS) {
        far = [];
        offset = foldOffset(offset, sample);
        return;
      }
      // A lone wild sample is dropped; a local clock hours off is the server
      // saying the same thing poll after poll, so adopt it outright (smoothing
      // from here would take dozens of polls).
      far = [...far, sample].slice(-CLOCK_CONFIRM_SAMPLES);
      if (far.length < CLOCK_CONFIRM_SAMPLES) return;
      if (Math.max(...far) - Math.min(...far) > CLOCK_CONFIRM_SPREAD_MS) return;
      offset = far.reduce((a, b) => a + b, 0) / far.length;
      far = [];
    },
    now: () => localNow() + (offset ?? 0),
    offsetMs: () => offset ?? 0,
  };
}
