// Request scheduling for radar tiles. RainViewer's free tier allows about 100
// requests per IP per minute and answers the excess with HTTP 429, and a loop
// of 13 frames needs every visible tile once per frame, so an unmanaged
// preload blows through that in seconds and Cesium, which never retries a
// failed tile, leaves those frames blurry for good. This queue keeps under a
// rolling budget, serves tiles in view and the frames that matter first,
// backs off on 429 and requeues instead of failing. Other tabs behind the
// same IP report their requests so the budget is shared. Pure — clock and
// timers are injected — so the policy is testable.

export type FetchOutcome =
  | { kind: 'ok'; bytes: Uint8Array }
  | { kind: 'gone' } // 404/410: the frame expired upstream
  | { kind: 'rate-limited'; retryAfterMs: number | null }
  // Retried with backoff. `terminal`: a 4xx that won't clear by retrying
  // (given a few tries anyway); `network`: no response at all (a CORS-less
  // 429 looks like this too).
  | { kind: 'error'; message: string; terminal?: boolean; network?: boolean };

export interface ScheduledJob {
  id: number;
  key: string; // z/x/y — for the "in view" test
  frameKey: string;
  level: number;
  seq: number;
  attempts: number;
  notBefore: number; // earliest network start (retry backoff)
}

export interface SchedulerOptions {
  maxInFlight: number;
  budget: number; // network requests per window (the ceiling the adaptive budget recovers to)
  windowMs: number;
  now: () => number;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
  fetchJob: (job: ScheduledJob) => Promise<FetchOutcome>;
  // A finished job (ok, gone, or an error given up on).
  onResult: (job: ScheduledJob, outcome: FetchOutcome) => void;
  // Whether a failed job is still worth retrying (someone still wants it).
  shouldRetry?: (job: ScheduledJob) => boolean;
  onStart?: (at: number) => void; // a network request started (to share with other tabs)
  onCooldown?: (until: number) => void;
}

export const COOLDOWN_MIN_MS = 15_000;
const COOLDOWN_MAX_MS = 60_000; // the limit is per rolling minute
const RETRY_MAX_MS = 5 * 60_000;
// Give up on a tile after this many failures (~13 minutes of backoff for
// network errors and 5xx; a few tries for a 4xx that means "no").
const MAX_ATTEMPTS = 10;
const MAX_TERMINAL_ATTEMPTS = 3;
// This many failed requests with no response inside the window, while the
// browser believes it is online, is treated as rate limiting: a 429 without
// CORS headers reaches script as a bare network error.
const NETWORK_BURST = 4;
const NETWORK_BURST_WINDOW_MS = 10_000;
const MIN_BUDGET = 20;
const BUDGET_RECOVERY = 8; // per clean window

export class TileScheduler {
  private queue: ScheduledJob[] = [];
  private inFlight = 0;
  private starts: number[] = []; // request starts in the window (ours and other tabs'), sorted
  private cooldownUntil = 0;
  private cooldownMs = COOLDOWN_MIN_MS;
  private episodeStart = -Infinity; // when the current back-off episode began
  private budget: number;
  private lastBudgetStep = 0;
  private slowStart = Infinity; // max in flight right after a cool-down, doubling on success
  private networkErrors: number[] = [];
  private timer: unknown = null;
  private timerAt = Infinity;
  private ranks = new Map<string, number>();
  private visible = new Set<string>();
  private dirty = false;
  private seq = 0;
  private jobs = new Map<number, ScheduledJob>();
  private startedAt = new Map<number, number>();

  constructor(private opts: SchedulerOptions) {
    this.budget = opts.budget;
  }

  enqueue(id: number, frameKey: string, level: number, key: string): void {
    const job: ScheduledJob = { id, key, frameKey, level, seq: this.seq++, attempts: 0, notBefore: 0 };
    this.jobs.set(id, job);
    this.queue.push(job);
    this.dirty = true;
    this.pump();
  }

  // Drop a job that hasn't started. Returns false for one already in flight
  // (its result still arrives and is cached).
  cancel(id: number): boolean {
    const job = this.jobs.get(id);
    if (!job) return false;
    const i = this.queue.indexOf(job);
    if (i < 0) return false;
    this.queue.splice(i, 1);
    this.jobs.delete(id);
    return true;
  }

  // Lower rank = more urgent. Frames without a rank go last.
  setRanks(ranks: Record<string, number>): void {
    this.ranks = new Map(Object.entries(ranks));
    this.dirty = true;
    this.pump();
  }

  // Tile keys (z/x/y) Cesium is drawing or about to: they load before tiles
  // it merely still holds from a view the camera has left.
  setVisible(keys: Iterable<string>): void {
    this.visible = new Set(keys);
    this.dirty = true;
    this.pump();
  }

  // A request made by another tab from the same browser (same IP), or by
  // this tab's previous worker.
  noteExternalStart(at: number): void {
    this.trim(this.opts.now());
    let i = this.starts.length;
    while (i > 0 && this.starts[i - 1] > at) i--;
    this.starts.splice(i, 0, at);
  }

  // Another tab was rate-limited: everyone waits.
  noteExternalCooldown(until: number): void {
    if (until > this.cooldownUntil) {
      this.cooldownUntil = until;
      this.slowStart = 1;
    }
  }

  get stats() {
    const now = this.opts.now();
    this.trim(now);
    return {
      queued: this.queue.length,
      inFlight: this.inFlight,
      budget: this.budget,
      coolingDownMs: Math.max(0, this.cooldownUntil - now),
    };
  }

  private rank(job: ScheduledJob): number {
    return this.ranks.get(job.frameKey) ?? 1e6;
  }

  private trim(now: number): void {
    while (this.starts.length && now - this.starts[0] >= this.opts.windowMs) this.starts.shift();
  }

  private wakeAt(at: number): void {
    if (at >= this.timerAt) return;
    if (this.timer !== null) this.opts.clearTimer(this.timer);
    this.timerAt = at;
    this.timer = this.opts.setTimer(() => {
      this.timer = null;
      this.timerAt = Infinity;
      this.pump();
    }, Math.max(0, at - this.opts.now()));
  }

  private recoverBudget(now: number): void {
    // Additive increase: after each clean window without a back-off, allow a
    // little more, up to the configured ceiling.
    if (this.budget >= this.opts.budget || now - this.lastBudgetStep < this.opts.windowMs) return;
    if (now - this.episodeStart < this.opts.windowMs) return;
    this.budget = Math.min(this.opts.budget, this.budget + BUDGET_RECOVERY);
    this.lastBudgetStep = now;
  }

  pump(): void {
    if (this.queue.length === 0) return;
    const now = this.opts.now();
    this.trim(now);
    this.recoverBudget(now);
    if (this.dirty) {
      // In view first; then urgent frames; within a frame coarse levels first
      // (they paint the whole view soonest); then arrival order.
      const vis = (j: ScheduledJob) => (this.visible.size === 0 || this.visible.has(j.key) ? 0 : 1);
      this.queue.sort(
        (a, b) => vis(a) - vis(b) || this.rank(a) - this.rank(b) || a.level - b.level || a.seq - b.seq
      );
      this.dirty = false;
    }
    if (this.cooldownUntil > now) {
      this.wakeAt(this.cooldownUntil);
      return;
    }
    const maxInFlight = Math.min(this.opts.maxInFlight, this.slowStart);
    let wake = Infinity;
    for (let i = 0; i < this.queue.length && this.inFlight < maxInFlight; ) {
      if (this.starts.length >= this.budget) {
        wake = Math.min(wake, this.starts[0] + this.opts.windowMs);
        break;
      }
      const job = this.queue[i];
      if (job.notBefore > now) {
        wake = Math.min(wake, job.notBefore);
        i++;
        continue;
      }
      this.queue.splice(i, 1);
      this.start(job, now);
    }
    if (this.queue.length && wake < Infinity) this.wakeAt(wake);
  }

  private start(job: ScheduledJob, now: number): void {
    this.inFlight++;
    this.starts.push(now);
    this.startedAt.set(job.id, now);
    this.opts.onStart?.(now);
    this.opts
      .fetchJob(job)
      .catch((err): FetchOutcome => ({ kind: 'error', message: String(err), network: true }))
      .then((outcome) => {
        this.inFlight--;
        this.settle(job, outcome);
        this.pump();
      });
  }

  // Everyone waits: RainViewer's limit is per IP, so more requests only
  // extend it. One back-off per episode — the other requests already in
  // flight when the limit hit will fail too, and must not each double it.
  private backOff(started: number, now: number, retryAfterMs: number | null): void {
    if (started < this.episodeStart || now < this.cooldownUntil) return;
    const wait = Math.min(COOLDOWN_MAX_MS, retryAfterMs ?? this.cooldownMs);
    this.cooldownUntil = now + wait;
    this.cooldownMs = Math.min(COOLDOWN_MAX_MS, this.cooldownMs * 2);
    this.episodeStart = now;
    this.budget = Math.max(MIN_BUDGET, Math.floor(this.budget / 2)); // multiplicative decrease
    this.lastBudgetStep = now;
    this.slowStart = 1;
    this.opts.onCooldown?.(this.cooldownUntil);
  }

  private settle(job: ScheduledJob, outcome: FetchOutcome): void {
    const started = this.startedAt.get(job.id) ?? 0;
    this.startedAt.delete(job.id);
    const now = this.opts.now();
    const wanted = () => !this.opts.shouldRetry || this.opts.shouldRetry(job);

    if (outcome.kind === 'rate-limited') {
      this.backOff(started, now, outcome.retryAfterMs);
      if (wanted()) this.requeue(job, 0);
      else this.finish(job, outcome);
      return;
    }
    if (outcome.kind === 'ok') {
      if (this.slowStart < this.opts.maxInFlight) this.slowStart *= 2;
      if (now - this.episodeStart > this.opts.windowMs) this.cooldownMs = COOLDOWN_MIN_MS;
      this.finish(job, outcome);
      return;
    }
    if (outcome.kind === 'gone') {
      this.finish(job, outcome);
      return;
    }
    if (outcome.network) {
      this.networkErrors = this.networkErrors.filter((t) => now - t < NETWORK_BURST_WINDOW_MS);
      this.networkErrors.push(now);
      if (this.networkErrors.length >= NETWORK_BURST) {
        this.networkErrors = [];
        this.backOff(started, now, null);
      }
    }
    job.attempts++;
    const limit = outcome.terminal ? MAX_TERMINAL_ATTEMPTS : MAX_ATTEMPTS;
    if (job.attempts >= limit || !wanted()) {
      this.finish(job, outcome);
      return;
    }
    this.requeue(job, now + Math.min(RETRY_MAX_MS, 2000 * 2 ** (job.attempts - 1)));
  }

  private finish(job: ScheduledJob, outcome: FetchOutcome): void {
    this.jobs.delete(job.id);
    this.opts.onResult(job, outcome);
  }

  private requeue(job: ScheduledJob, notBefore: number): void {
    job.notBefore = notBefore;
    this.queue.push(job);
    this.dirty = true;
  }
}
