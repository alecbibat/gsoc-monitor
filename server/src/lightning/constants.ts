// Lightning tunables. Everything that sizes memory, the database or the
// display sample lives here so the trade-offs can be read in one place.
//
// Deployment this is sized for: ONE Heroku Basic dyno (512 MB for the whole
// app), restarted daily and on every deploy, with Heroku Postgres. The global
// Blitzortung rate R is unverified (~100/s claimed), so every limit below is
// meant to hold for R between 10 and 200 strikes/s.

/**
 * Colour-stage ends in seconds. Must equal the client palette's ends
 * (client/src/layers/lightning/lightningPalette.ts LIGHTNING_STAGES); every
 * /field response carries them so a mismatch is also caught at runtime.
 */
export const STAGE_ENDS_S: readonly number[] = [120, 600, 1_800, 3_600, 10_800, 43_200, 86_400];

/**
 * Age strata the display sampler budgets separately (seconds). They follow the
 * colour stages, except the white stage is split at 60 s: the newest minute
 * is dense and mostly covered by the `fresh` list anyway, so it gets a small
 * share of its own instead of crowding out 1–2 minute-old strikes.
 */
export const STRATA_ENDS_S: readonly number[] = [60, 600, 1_800, 3_600, 10_800, 43_200, 86_400];
/** Share of the budget per stratum (sums to 1). Older strata span far more time, so they get more. */
export const STRATA_SHARE: readonly number[] = [0.04, 0.14, 0.14, 0.14, 0.16, 0.19, 0.19];

/** Strikes are kept, drawn and counted for 24 h. */
export const RETENTION_MS = 24 * 60 * 60_000;
/** Segments are dropped only this long after their newest strike expires, so a scan never loses a live record. */
export const PRUNE_GRACE_MS = 5 * 60_000;

/**
 * Records per store segment. 16384 × 8 bytes = one 128 KB buffer; at 100/s a
 * live segment fills in ~2.7 min, at 10/s in ~27 min.
 */
export const SEG_CAP = 16_384;

/**
 * Memory cap on stored records (8 bytes each). The default is 24 h at ~140/s
 * in ~96 MB; the memory guard lowers it under RSS pressure. When old records
 * are evicted only the per-minute counts (/status) keep them: /near counts and
 * the map lose them, and say so (fidelity.evictedBeforeMs, /near coverage).
 */
export const MAX_RECORDS_FLOOR = 1_000_000;
export function parseMaxRecords(env: string | undefined): number {
  const n = Math.floor(Number(env));
  if (!env || !Number.isFinite(n)) return 12_000_000;
  return Math.max(MAX_RECORDS_FLOOR, n);
}
export const MAX_RECORDS = parseMaxRecords(process.env.LIGHTNING_MAX_STRIKES);

// --- Persistence ------------------------------------------------------------
/** Unsaved strikes are written as new rows once a minute (≤ 1 min lost on a hard kill). */
export const SAVE_INTERVAL_MS = 60_000;
/** Rows per multi-row INSERT (each row ≤ 16384 records, ~60–90 KB gzipped). */
export const ROWS_PER_INSERT = 20;
/** Queued-but-unsaved rows are dropped oldest-first beyond this (a long DB outage); counted, never silent. */
export const MAX_PENDING_BYTES = 64 * 1024 * 1024;
/** Rows per restore page. Small pages keep each synchronous decode step short. */
export const RESTORE_PAGE_ROWS = 25;
/** The database keeps a little more than the window so a restore never starts mid-hole. */
export const DB_KEEP_MS = 25 * 60 * 60_000;
/** The prune DELETEs run at most this often (and only after a successful save). */
export const DB_PRUNE_EVERY_MS = 10 * 60_000;

// --- Display ----------------------------------------------------------------
/** Every strike younger than this is sent individually in /field's `fresh` list. */
export const FRESH_S = 120;
/** /field results are memoized per view for this long (the client polls every 30 s). */
export const FIELD_BUCKET_MS = 30_000;
/** Allowed /field budgets (requests are rounded DOWN to one of these). */
export const BUDGETS: readonly number[] = [4_000, 6_000, 8_000, 10_000, 12_000, 16_000, 20_000, 24_000];
export const DEFAULT_BUDGET = 16_000;
/** Allowed /field fresh caps (rounded DOWN to one of these). */
export const FRESH_CAPS: readonly number[] = [0, 1_000, 2_500, 4_000, 6_000, 8_000];
export const DEFAULT_FRESH = 4_000;
/**
 * Lattice cell sizes (degrees) for the sampler's "one mark per active cell"
 * guarantee. Each level is exactly twice the previous, so a cell's parent is
 * (row >> 1, col >> 1) and every level nests inside the next.
 */
export const LADDER_DEG: readonly number[] = [0.05, 0.1, 0.2, 0.4, 0.8, 1.6, 3.2, 6.4, 12.8];

// --- Collector / health -----------------------------------------------------
/** The global stream is never quiet this long; an open socket that is must be half-dead. */
export const WATCHDOG_SILENCE_MS = 60_000;
/** Memory guard: shrink the store's capacity above this RSS… */
export const RSS_HIGH_BYTES = 450 * 1024 * 1024;
/** …and grow it back after 10 minutes below this. */
export const RSS_LOW_BYTES = 380 * 1024 * 1024;
