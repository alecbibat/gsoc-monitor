// Wire contract for the lightning endpoints. The server keeps an identical copy
// in server/src/lightning/types.ts — change both together.
//
// Strikes travel quantized: latQ/lonQ are 20-bit grid indices (≈19 m lat /
// ≈38 m lon steps, see strikeKey.ts) and time is 10 ms "ticks" since the epoch.
// The same (tick, latQ, lonQ) triple is a strike's identity on both sides, so a
// strike the browser saw live and the copy the server returns dedupe exactly.

/** A set of strikes, ascending by time, delta-encoded to keep payloads small. */
export interface LightningMarks {
  /** Tick (10 ms units since epoch) of the first mark; 0 when empty. */
  tick0: number;
  /** Tick deltas; dt[0] = 0 and tick_i = tick0 + dt[0] + … + dt[i]. */
  dt: number[];
  /** Quantized latitude, 0..QMAX. */
  la: number[];
  /** Quantized longitude, 0..QMAX. */
  lo: number[];
}

export interface LightningGap {
  fromMs: number;
  toMs: number;
}

/**
 * Strike counts over the trailing windows, from the per-minute counts (every
 * received strike, including ones the memory cap has since evicted).
 * Windows are minute-aligned: mN sums every minute bucket that overlaps the
 * last N minutes, the current partial minute included — the last N to N+1
 * minutes, so up to one minute's strikes over. `exact` means not sampled.
 */
export interface LightningCounts {
  m60: number;
  m360: number;
  m720: number;
  m1440: number;
  /** false when a window includes pre-upgrade history that was kept 1-in-6 (counted ×6). */
  exact: boolean;
}

export interface LightningCoverage {
  windowMin: number;
  /**
   * Minutes of the window the answer actually covers (window − gaps − unknown).
   * For /near, time before fidelity.evictedBeforeMs is unknown too: its counts
   * and points no longer include those strikes.
   */
  coveredMin: number;
  /**
   * Collector blind spots inside the window, oldest first: minutes with no
   * strike, outages and the restart hole (≥ 30 s, to the second), and the
   * ongoing outage.
   */
  gaps: LightningGap[];
  /** The server is still loading persisted history; time before restoredBackToMs is unknown, not a gap. */
  restoring: boolean;
  restoredBackToMs: number | null;
}

export interface LightningCollector {
  /** Server-side Blitzortung socket is open. */
  connected: boolean;
  /** Epoch ms the collector went down (closed, or silent > 60 s); null when healthy. */
  downSince: number | null;
  lastStrikeAgeS: number | null;
  /** Strikes the server received in the last 60 s (the true global rate). */
  ratePerMin: number;
}

export interface LightningFidelity {
  /**
   * Strikes before this time may come from pre-upgrade history kept 1-in-6
   * (counted ×6): the end of the newest minute filled from it.
   */
  legacyBeforeMs: number | null;
  /**
   * Strikes before this time are no longer held (memory cap). Only the
   * per-minute counts (LightningCounts, /status) still include them; /near
   * counts, its nearest strike and every map point do not.
   */
  evictedBeforeMs: number | null;
}

export interface LightningRestore {
  state: 'pending' | 'loading' | 'retrying' | 'done';
  /** 0..1 */
  progress: number;
  /** Oldest time restored so far (restore runs newest → oldest). */
  backToMs: number | null;
}

export interface LightningStatusLite {
  now: number;
  collector: LightningCollector;
  counts: LightningCounts;
  /** Always the trailing 24 h. */
  coverage: LightningCoverage;
  fidelity: LightningFidelity;
  restore: LightningRestore;
}

/**
 * GET /api/lightning/field?bbox=w,s,e,n&budget=16000&fresh=4000
 * `bbox` omitted = whole globe; w > e means the box crosses the antimeridian.
 */
export interface LightningFieldResponse {
  v: 1;
  /** Server epoch ms when the response was built (use it to correct client clock skew). */
  now: number;
  /** Colour-stage ends in seconds; must equal LIGHTNING_STAGES' ends. */
  stageEndsS: number[];
  view: {
    bbox: [number, number, number, number] | null;
    budget: number;
    /** Lattice cell size (degrees) that guarantees one mark per active cell per age stage. */
    cellDeg: number;
    /** Strikes in the box over 24 h (weighted, before sampling). */
    total: number;
    degraded: null | 'busy' | 'stale';
  };
  /** Deterministic, stable sample of the box's last 24 h — ≤ budget marks, all ages. */
  field: LightningMarks;
  /** Every strike in the box younger than FRESH_S, newest `fresh` kept. */
  fresh: LightningMarks;
  status: LightningStatusLite;
}

/** GET /api/lightning/near?lat=&lon=&radiusMi=130&hours=24&maxPoints=6000 */
export interface LightningNearResponse {
  v: 1;
  /** Server epoch ms of the response. counts, points and nearest may be up to 30 s older (memoized); nearest.ageS is re-based to `now`. */
  now: number;
  lat: number;
  lon: number;
  radiusMi: number;
  hours: number;
  /**
   * Computed over every stored strike before any point thinning. exact is
   * false when the window holds pre-upgrade (×6) minutes or reaches
   * fidelity.evictedBeforeMs (evicted strikes are not counted).
   */
  counts: { le5: number; le25: number; le100: number; inRadius: number; exact: boolean };
  /** Closest stored strike within the radius and window; null when none. */
  nearest: { mi: number; ageS: number; lat: number; lon: number } | null;
  /** t is epoch SECONDS, oldest → newest. The nearest strike is always included. */
  points: { lat: number[]; lon: number[]; t: number[]; sampled: boolean };
  fidelity: LightningFidelity;
  /** Clipped to the `hours` window. */
  coverage: LightningCoverage;
  collector: LightningCollector;
}

/** GET /api/lightning/status — collector health; also what /debug extends. */
export interface LightningStatusResponse extends LightningStatusLite {
  v: 1;
  bootId: string;
  rates: {
    perSec: number;
    per15mPerSec: number;
    per1hPerSec: number;
    /** Busiest completed minute in the last hour, as strikes/s. */
    peak1hPerSec: number;
  };
  /** Strikes per completed minute for the last 60 minutes, oldest → newest. */
  perMinute: number[];
  collectorDetail: {
    relay: string | null;
    connectedSince: number | null;
    reconnects24h: number;
    /** Share of strikes timestamped from Blitzortung's own time field (vs receive time). */
    networkTimePct: number;
    rejected: number;
    dupes: number;
  };
  persist: {
    lastSaveAt: number | null;
    lastSaveOk: boolean;
    lastError: string | null;
    pendingRecords: number;
    oldestPendingAgeS: number | null;
  };
  restoreDetail: {
    attempts: number;
    lastError: string | null;
    rows: number;
    strikes: number;
    legacyRows: number;
    dupes: number;
    ms: number | null;
  };
  store: { records: number; segments: number; capacity: number; bytes: number };
  mem: { rss: number; heapUsed: number; arrayBuffers: number; pressure: boolean };
}
