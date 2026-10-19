// Nominatim's usage policy allows one request per second from a client — and
// that's everything this server sends it: the intel ingest's place lookups and
// the search box's fallback. Each caller takes a turn here before fetching;
// turns are handed out at least MIN_SPACING_MS apart, in call order.

const MIN_SPACING_MS = 1_100;

let nextTurnAt = 0;

/**
 * Wait for a turn. With `maxWaitMs`, a caller that would wait longer than that
 * gives up instead (resolving false, its turn not taken) — an interactive
 * search shouldn't queue behind a backlog. Otherwise always resolves true.
 */
export async function nominatimTurn(maxWaitMs = Infinity, now: () => number = Date.now): Promise<boolean> {
  const t = now();
  const at = Math.max(t, nextTurnAt);
  if (at - t > maxWaitMs) return false;
  nextTurnAt = at + MIN_SPACING_MS;
  if (at > t) await new Promise((resolve) => setTimeout(resolve, at - t));
  return true;
}
