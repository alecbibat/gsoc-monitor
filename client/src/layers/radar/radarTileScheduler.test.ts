import { describe, expect, it } from 'vitest';
import { COOLDOWN_MIN_MS, TileScheduler, type FetchOutcome, type ScheduledJob } from './radarTileScheduler';

// A deterministic harness: virtual time, manual timers, and fetches that
// resolve when the test says so.
function harness(opts: { budget?: number; maxInFlight?: number; shouldRetry?: (job: ScheduledJob) => boolean } = {}) {
  let now = 0;
  const timers: Array<{ at: number; fn: () => void; id: number }> = [];
  let timerId = 0;
  const started: ScheduledJob[] = [];
  const startTimes: number[] = [];
  const pending = new Map<number, (o: FetchOutcome) => void>();
  const results: Array<{ id: number; kind: string }> = [];
  const cooldowns: number[] = [];
  const s = new TileScheduler({
    maxInFlight: opts.maxInFlight ?? 2,
    budget: opts.budget ?? 4,
    windowMs: 60_000,
    now: () => now,
    setTimer: (fn, ms) => {
      const id = ++timerId;
      timers.push({ at: now + ms, fn, id });
      return id;
    },
    clearTimer: (h) => {
      const i = timers.findIndex((t) => t.id === h);
      if (i >= 0) timers.splice(i, 1);
    },
    fetchJob: (job) =>
      new Promise<FetchOutcome>((resolve) => {
        started.push(job);
        pending.set(job.id, resolve);
      }),
    onResult: (job, o) => results.push({ id: job.id, kind: o.kind }),
    shouldRetry: opts.shouldRetry,
    onStart: (at) => startTimes.push(at),
    onCooldown: (until) => cooldowns.push(until),
  });
  const flush = () => new Promise<void>((r) => setTimeout(r, 0));
  return {
    s,
    started,
    startTimes,
    results,
    cooldowns,
    get now() {
      return now;
    },
    async advance(ms: number) {
      const end = now + ms;
      for (;;) {
        timers.sort((a, b) => a.at - b.at);
        const next = timers[0];
        if (!next || next.at > end) break;
        timers.shift();
        now = next.at;
        next.fn();
        await flush();
      }
      now = end;
      await flush();
    },
    async resolve(id: number, o: FetchOutcome) {
      const fn = pending.get(id);
      expect(fn, `job ${id} is not in flight`).toBeDefined();
      pending.delete(id);
      fn?.(o);
      await flush();
    },
    inFlightIds: () => [...pending.keys()],
  };
}

const ok: FetchOutcome = { kind: 'ok', bytes: new Uint8Array([1]) };
const limited = (retryAfterMs: number | null = null): FetchOutcome => ({ kind: 'rate-limited', retryAfterMs });
const http502: FetchOutcome = { kind: 'error', message: 'HTTP 502' };
const netError: FetchOutcome = { kind: 'error', message: 'TypeError: Failed to fetch', network: true };

describe('TileScheduler', () => {
  it('caps concurrency and the per-window budget', async () => {
    const h = harness({ budget: 3, maxInFlight: 2 });
    for (let i = 1; i <= 5; i++) h.s.enqueue(i, 'f', 4, `4/${i}/0`);
    expect(h.started.map((j) => j.id)).toEqual([1, 2]);
    expect(h.s.stats).toEqual({ queued: 3, inFlight: 2, budget: 3, coolingDownMs: 0 });
    await h.resolve(1, ok);
    expect(h.started.map((j) => j.id)).toEqual([1, 2, 3]);
    await h.resolve(2, ok);
    await h.resolve(3, ok);
    expect(h.started).toHaveLength(3); // budget spent for this minute
    expect(h.s.stats).toEqual({ queued: 2, inFlight: 0, budget: 3, coolingDownMs: 0 });
    await h.advance(59_999);
    expect(h.started).toHaveLength(3);
    await h.advance(1);
    expect(h.started.map((j) => j.id)).toEqual([1, 2, 3, 4, 5]);
    expect(h.startTimes).toEqual([0, 0, 0, 60_000, 60_000]);
  });

  it('serves tiles in view, then urgent frames, then coarse levels', async () => {
    const h = harness({ budget: 100, maxInFlight: 1 });
    h.s.setRanks({ now: 0, old: 1 });
    h.s.setVisible(['5/1/1']);
    h.s.enqueue(1, 'blocker', 3, '3/0/0'); // starts immediately, holds the slot
    h.s.enqueue(2, 'old', 3, '3/9/9');
    h.s.enqueue(3, 'now', 5, '5/9/9');
    h.s.enqueue(4, 'now', 4, '4/9/9');
    h.s.enqueue(5, 'old', 5, '5/1/1'); // in view
    for (const id of [1, 5, 4, 3]) await h.resolve(id, ok);
    expect(h.started.map((j) => j.id)).toEqual([1, 5, 4, 3, 2]);
  });

  it('backs off once per 429 episode, however many requests were in flight, then restarts slowly', async () => {
    const h = harness({ budget: 100, maxInFlight: 4 });
    for (let i = 1; i <= 6; i++) h.s.enqueue(i, 'f', 4, `4/${i}/0`);
    expect(h.started).toHaveLength(4);
    for (const id of [1, 2, 3, 4]) await h.resolve(id, limited());
    expect(h.cooldowns).toEqual([COOLDOWN_MIN_MS]); // one episode, not four doublings
    expect(h.s.stats).toEqual({ queued: 6, inFlight: 0, budget: 50, coolingDownMs: COOLDOWN_MIN_MS });
    await h.advance(COOLDOWN_MIN_MS - 1);
    expect(h.started).toHaveLength(4);
    // After the cool-down: one request, then twice as many after each success.
    await h.advance(1);
    expect(h.inFlightIds()).toHaveLength(1);
    await h.resolve(h.inFlightIds()[0], ok);
    expect(h.inFlightIds()).toHaveLength(2);
    await h.resolve(h.inFlightIds()[0], ok);
    expect(h.inFlightIds()).toHaveLength(4);
    // Nothing failed for good: rate-limited jobs were requeued.
    expect(h.results.filter((r) => r.kind !== 'ok')).toEqual([]);
  });

  it('doubles the cool-down per episode up to a minute, and resets it after a clean window', async () => {
    const h = harness({ budget: 1000, maxInFlight: 1 });
    h.s.enqueue(1, 'f', 4, '4/0/0');
    await h.resolve(1, limited());
    for (const wait of [15_000, 30_000, 60_000]) {
      await h.advance(wait); // the job restarts the moment the cool-down ends
      await h.resolve(1, limited());
    }
    expect(h.startTimes).toEqual([0, 15_000, 45_000, 105_000]);
    expect(h.cooldowns).toEqual([15_000, 45_000, 105_000, 165_000]);
    await h.advance(60_001);
    await h.resolve(1, ok); // more than a window after the last back-off
    h.s.enqueue(2, 'f', 4, '4/1/0');
    await h.resolve(2, limited());
    expect(h.cooldowns.at(-1)).toBe(h.now + COOLDOWN_MIN_MS);
  });

  it('honours Retry-After, capped at a minute', async () => {
    const h = harness({ budget: 100, maxInFlight: 1 });
    h.s.enqueue(1, 'f', 4, '4/0/0');
    await h.resolve(1, limited(5 * 60_000));
    expect(h.s.stats.coolingDownMs).toBe(60_000);
    await h.advance(20_000);
    expect(h.s.stats.coolingDownMs).toBe(40_000);
  });

  it('halves the budget after a 429 (not below 20) and adds 8 back per clean window', async () => {
    const h = harness({ budget: 80, maxInFlight: 1 });
    h.s.enqueue(1, 'f', 4, '4/0/0');
    await h.resolve(1, limited(1000));
    expect(h.s.stats.budget).toBe(40);
    await h.advance(1000);
    await h.resolve(1, ok);
    // The budget grows only when there is work to schedule, one step per window.
    let id = 1;
    const budgetAt = async (t: number) => {
      await h.advance(t - h.now);
      h.s.enqueue(++id, 'f', 4, `4/${id}/0`);
      await h.resolve(id, ok);
      return h.s.stats.budget;
    };
    expect(await budgetAt(59_999)).toBe(40);
    expect(await budgetAt(60_000)).toBe(48);
    expect(await budgetAt(119_999)).toBe(48);
    expect(await budgetAt(120_000)).toBe(56);
    expect(await budgetAt(180_000)).toBe(64);
    expect(await budgetAt(240_000)).toBe(72);
    expect(await budgetAt(300_000)).toBe(80);
    expect(await budgetAt(360_000)).toBe(80); // the configured ceiling

    const low = harness({ budget: 30, maxInFlight: 1 });
    low.s.enqueue(1, 'f', 4, '4/0/0');
    await low.resolve(1, limited(1000));
    expect(low.s.stats.budget).toBe(20);
    await low.advance(1000);
    await low.resolve(1, limited(1000));
    expect(low.s.stats.budget).toBe(20);
  });

  it('retries errors with doubling back-off (capped at 5 min) and gives up after 10 attempts', async () => {
    for (const failure of [http502, netError]) {
      const h = harness({ budget: 100, maxInFlight: 1 });
      h.s.enqueue(1, 'f', 4, '4/0/0');
      await h.resolve(1, failure);
      for (const wait of [2, 4, 8, 16, 32, 64, 128, 256, 300].map((s) => s * 1000)) {
        await h.advance(wait - 1);
        expect(h.inFlightIds()).toEqual([]);
        await h.advance(1);
        await h.resolve(1, failure);
      }
      expect(h.started).toHaveLength(10);
      expect(h.results).toEqual([{ id: 1, kind: 'error' }]);
      expect(h.cooldowns).toEqual([]); // one tile's retries are no burst
    }
  });

  it('gives up on a terminal error (a 4xx) after three attempts', async () => {
    const h = harness({ budget: 100, maxInFlight: 1 });
    const denied: FetchOutcome = { kind: 'error', message: 'HTTP 403', terminal: true };
    h.s.enqueue(1, 'f', 4, '4/0/0');
    await h.resolve(1, denied);
    await h.advance(2000);
    await h.resolve(1, denied);
    await h.advance(4000);
    await h.resolve(1, denied);
    expect(h.startTimes).toEqual([0, 2000, 6000]);
    expect(h.results).toEqual([{ id: 1, kind: 'error' }]);
    await h.advance(10 * 60_000);
    expect(h.started).toHaveLength(3);
  });

  it('treats four network errors inside 10 s as rate limiting', async () => {
    const run = async (failure: FetchOutcome, lastAt: number) => {
      const h = harness({ budget: 100, maxInFlight: 1 });
      for (let i = 1; i <= 4; i++) h.s.enqueue(i, 'f', 4, `4/${i}/0`);
      for (const id of [1, 2, 3]) await h.resolve(id, failure); // each failure frees the slot for the next
      await h.advance(lastAt);
      await h.resolve(4, failure);
      return h;
    };
    const burst = await run(netError, 9_999);
    expect(burst.cooldowns).toEqual([9_999 + COOLDOWN_MIN_MS]);
    expect(burst.s.stats.budget).toBe(50);
    expect((await run(netError, 10_000)).cooldowns).toEqual([]); // spread over more than 10 s
    expect((await run(http502, 0)).cooldowns).toEqual([]); // the server answered: not a hidden 429
  });

  it('reports gone tiles without retrying', async () => {
    const h = harness();
    h.s.enqueue(1, 'f', 4, '4/0/0');
    await h.resolve(1, { kind: 'gone' });
    expect(h.results).toEqual([{ id: 1, kind: 'gone' }]);
    await h.advance(10 * 60_000);
    expect(h.started).toHaveLength(1);
  });

  it('stops retrying a job nobody wants any more', async () => {
    let wanted = true;
    const h = harness({ budget: 100, maxInFlight: 1, shouldRetry: () => wanted });
    h.s.enqueue(1, 'f', 4, '4/0/0');
    await h.resolve(1, http502);
    expect(h.results).toEqual([]); // still wanted: retried
    await h.advance(2000);
    wanted = false;
    await h.resolve(1, http502);
    expect(h.results).toEqual([{ id: 1, kind: 'error' }]);
    // Rate-limited and unwanted: finished at once, but everyone still waits out the cool-down.
    h.s.enqueue(2, 'f', 4, '4/1/0');
    await h.resolve(2, limited());
    expect(h.results).toEqual([
      { id: 1, kind: 'error' },
      { id: 2, kind: 'rate-limited' },
    ]);
    expect(h.s.stats).toEqual({ queued: 0, inFlight: 0, budget: 50, coolingDownMs: COOLDOWN_MIN_MS });
    await h.advance(10 * 60_000);
    expect(h.started).toHaveLength(3);
  });

  it('cancels queued jobs, including ones waiting to retry, but lets in-flight ones land', async () => {
    const h = harness({ budget: 100, maxInFlight: 1 });
    h.s.enqueue(1, 'f', 4, '4/0/0');
    h.s.enqueue(2, 'f', 4, '4/1/0');
    h.s.enqueue(3, 'f', 4, '4/2/0');
    expect(h.s.cancel(2)).toBe(true);
    expect(h.s.cancel(2)).toBe(false); // already dropped
    expect(h.s.cancel(1)).toBe(false); // in flight
    expect(h.s.cancel(99)).toBe(false);
    await h.resolve(1, ok);
    expect(h.results).toEqual([{ id: 1, kind: 'ok' }]);
    await h.resolve(3, http502);
    expect(h.s.stats).toEqual({ queued: 1, inFlight: 0, budget: 100, coolingDownMs: 0 });
    expect(h.s.cancel(3)).toBe(true);
    await h.advance(10 * 60_000);
    expect(h.started.map((j) => j.id)).toEqual([1, 3]);
    expect(h.results).toEqual([{ id: 1, kind: 'ok' }]);
    expect(h.s.stats).toEqual({ queued: 0, inFlight: 0, budget: 100, coolingDownMs: 0 });
  });

  it('counts other tabs against the shared budget and joins their cool-downs', async () => {
    const h = harness({ budget: 3, maxInFlight: 5 });
    h.s.noteExternalStart(0);
    h.s.noteExternalStart(0);
    for (let i = 1; i <= 3; i++) h.s.enqueue(i, 'f', 4, `4/${i}/0`);
    expect(h.started).toHaveLength(1);
    h.s.noteExternalCooldown(h.now + 30_000);
    expect(h.s.stats.coolingDownMs).toBe(30_000);
    await h.resolve(1, ok);
    await h.advance(59_999);
    expect(h.started).toHaveLength(1); // held by the other tab's cool-down, then by the shared budget
    await h.advance(1);
    expect(h.started.map((j) => j.id)).toEqual([1, 2, 3]);
    expect(h.startTimes).toEqual([0, 60_000, 60_000]); // only ours are reported
  });

  it("spends other tabs' requests in time order, whatever order they are reported in", async () => {
    const h = harness({ budget: 3, maxInFlight: 5 });
    await h.advance(100_000);
    h.s.noteExternalStart(90_000);
    h.s.noteExternalStart(50_000); // older, reported late: frees its slot first
    h.s.enqueue(1, 'f', 4, '4/1/0');
    h.s.enqueue(2, 'f', 4, '4/2/0');
    expect(h.started.map((j) => j.id)).toEqual([1]);
    await h.advance(9_999);
    expect(h.started).toHaveLength(1);
    await h.advance(1);
    expect(h.startTimes).toEqual([100_000, 110_000]);
  });
});
