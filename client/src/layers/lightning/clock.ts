// Server-corrected clock for strike ages. Every age on the globe (colour
// stage, the 2-minute live hold, the 24 h expiry, the window filter) is
// "server now − strike time". Strike times are Blitzortung's own, so a laptop
// whose clock is a minute off would otherwise hold live Xs too long or too
// short and step every mark at the wrong moment. Each /field response carries
// the server's `now`; we compare it with the midpoint of the request (the best
// guess of when the server stamped it) and smooth the samples.

/** Weight of a new sample: smooths network jitter, converges in a few polls. */
export const CLOCK_EWMA_ALPHA = 0.3;
/** A skew beyond this is a broken clock or a bad response, not drift; never trust more. */
export const CLOCK_MAX_OFFSET_MS = 3_600_000;

const clamp = (v: number) => Math.max(-CLOCK_MAX_OFFSET_MS, Math.min(CLOCK_MAX_OFFSET_MS, v));

/** One offset sample: server time minus the local midpoint of the request. */
export function offsetSample(serverNowMs: number, fetchStartMs: number, fetchEndMs: number): number {
  return serverNowMs - (fetchStartMs + fetchEndMs) / 2;
}

/**
 * Fold a sample into the running offset (EWMA). The first sample is taken as
 * is; each sample is clamped to ±1 h first, so the result is too.
 */
export function foldOffset(prev: number | null, sample: number, alpha = CLOCK_EWMA_ALPHA): number {
  const s = clamp(sample);
  return prev === null ? s : prev + alpha * (s - prev);
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
  return {
    observe(serverNowMs, fetchStartMs, fetchEndMs) {
      const sample = offsetSample(serverNowMs, fetchStartMs, fetchEndMs);
      if (!Number.isFinite(sample)) return; // missing/garbled `now` — keep what we have
      offset = foldOffset(offset, sample);
    },
    now: () => localNow() + (offset ?? 0),
    offsetMs: () => offset ?? 0,
  };
}
