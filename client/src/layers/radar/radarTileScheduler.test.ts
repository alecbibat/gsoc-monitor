import { describe, expect, it } from 'vitest';
import { COOLDOWN_MIN_MS, TileScheduler, type FetchOutcome, type ScheduledJob } from './radarTileScheduler';

// A deterministic harness: virtual time, manual timers, and fetches that
// resolve when the test says so.
function harness(opts: { budget?: number; maxInFlight?: number } = {}) {
  let now = 0;
  const timers: Array<{ at: number; fn: () => void; id: number }> = [];
  let timerId = 0;
  const started: ScheduledJob[] = [];
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
    onCooldown: (until) => cooldowns.push(until),
  });
  const flush = () => new Promise<void>((r) => setTimeout(r, 0));
  return {
    s,
    started,
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
      pending.delete(id);
      fn?.(o);
      await flush();
    },
    inFlightIds: () => [...pending.keys()],
  };
}

const ok: FetchOutcome = { kind: 'ok', bytes: new Uint8Array([1]) };

describe('TileScheduler', () => {
  it('caps concurrency and the per-window budget', async () => {
    const h = harness({ budget: 3, maxInFlight: 2 });
    for (let i = 1; i <= 5; i++) h.s.enqueue(i, 'f', 4, `4/${i}/0`);
    expect(h.started.map((j) => j.id)).toEqual([1, 2]);
    await h.resolve(1, ok);
    expect(h.started.map((j) => j.id)).toEqual([1, 2, 3]);
    await h.resolve(2, ok);
    await h.resolve(3, ok);
    expect(h.started).toHaveLength(3); // budget spent for this minute
    await h.advance(60_000);
    expect(h.started.map((j) => j.id)).toEqual([1, 2, 3, 4, 5]);
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

  it('backs off once per 429 episode, however many requests were in flight', async () => {
    const h = harness({ budget: 100, maxInFlight: 4 });
    for (let i = 1; i <= 6; i++) h.s.enqueue(i, 'f', 4, `4/${i}/0`);
    expect(h.started).toHaveLength(4);
    for (const id of [1, 2, 3, 4]) await h.resolve(id, { kind: 'rate-limited', retryAfterMs: null });
    expect(h.cooldowns).toEqual([COOLDOWN_MIN_MS]); // one episode, not four doublings
    expect(h.s.stats.coolingDownMs).toBe(COOLDOWN_MIN_MS);
    expect(h.started).toHaveLength(4);
    // After the cool-down it restarts slowly: one request, then more as they succeed.
    await h.advance(COOLDOWN_MIN_MS);
    expect(h.started).toHaveLength(5);
    await h.resolve(h.inFlightIds()[0], ok);
    expect(h.inFlightIds()).toHaveLength(2);
    // Nothing failed for good: rate-limited jobs were requeued.
    expect(h.results.filter((r) => r.kind !== 'ok')).toEqual([]);
  });

  it('honours Retry-After, capped at a minute', async () => {
    const h = harness({ budget: 100, maxInFlight: 1 });
    h.s.enqueue(1, 'f', 4, '4/0/0');
    await h.resolve(1, { kind: 'rate-limited', retryAfterMs: 5 * 60_000 });
    expect(h.s.stats.coolingDownMs).toBe(60_000);
  });

  it('halves the budget after a 429 and recovers it in clean windows', async () => {
    const h = harness({ budget: 80, maxInFlight: 1 });
    h.s.enqueue(1, 'f', 4, '4/0/0');
    await h.resolve(1, { kind: 'rate-limited', retryAfterMs: 1000 });
    expect(h.s.stats.budget).toBe(40);
    await h.advance(1000);
    await h.resolve(h.inFlightIds()[0], ok);
    await h.advance(61_000);
    h.s.enqueue(2, 'f', 4, '4/1/0');
    await h.advance(61_000);
    h.s.enqueue(3, 'f', 4, '4/2/0');
    expect(h.s.stats.budget).toBeGreaterThan(40);
  });

  it('keeps retrying network errors instead of giving up', async () => {
    const h = harness({ budget: 100, maxInFlight: 1 });
    h.s.enqueue(1, 'f', 4, '4/0/0');
    for (let k = 0; k < 6; k++) {
      await h.resolve(1, { kind: 'error', message: 'HTTP 502' });
      await h.advance(5 * 60_000);
    }
    expect(h.results).toEqual([]);
    await h.resolve(1, ok);
    expect(h.results).toEqual([{ id: 1, kind: 'ok' }]);
  });

  it('reports gone tiles without retrying', async () => {
    const h = harness();
    h.s.enqueue(1, 'f', 4, '4/0/0');
    await h.resolve(1, { kind: 'gone' });
    expect(h.results).toEqual([{ id: 1, kind: 'gone' }]);
  });

  it('cancels queued jobs but lets in-flight ones land', async () => {
    const h = harness({ budget: 100, maxInFlight: 1 });
    h.s.enqueue(1, 'f', 4, '4/0/0');
    h.s.enqueue(2, 'f', 4, '4/1/0');
    expect(h.s.cancel(2)).toBe(true);
    expect(h.s.cancel(1)).toBe(false); // already in flight
    await h.resolve(1, ok);
    expect(h.started.map((j) => j.id)).toEqual([1]);
    expect(h.results).toEqual([{ id: 1, kind: 'ok' }]);
  });

  it('counts other tabs against the shared budget and joins their cool-downs', async () => {
    const h = harness({ budget: 3, maxInFlight: 5 });
    h.s.noteExternalStart(0);
    h.s.noteExternalStart(0);
    for (let i = 1; i <= 3; i++) h.s.enqueue(i, 'f', 4, `4/${i}/0`);
    expect(h.started).toHaveLength(1);
    h.s.noteExternalCooldown(h.now + 30_000);
    await h.resolve(1, ok);
    await h.advance(59_000);
    expect(h.started).toHaveLength(1); // held by the other tab's cool-down, then by the shared budget
    await h.advance(2000);
    expect(h.started.length).toBeGreaterThan(1);
  });
});
