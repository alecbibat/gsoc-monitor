import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SEG_CAP } from './constants';
import { CAPACITY_FLOOR, MemoryGuard } from './memoryGuard';
import { createPersistence } from './persist';
import { createLightningService, makeBootId } from './service';
import { statusLite } from './status';
import { StrikeStore } from './store';
import { FakeDb, FakeWs, type Rec, genStrikes } from './testkit';

const T0 = Date.UTC(2026, 8, 24, 12, 0, 0);
const MB = 1_048_576;

function setup(db = new FakeDb()) {
  const sockets: FakeWs[] = [];
  const svc = createLightningService({
    db,
    wsFactory: (url) => {
      const ws = new FakeWs(url);
      sockets.push(ws);
      return ws;
    },
    now: () => Date.now(),
    log: () => {},
    memoryUsage: () => ({ rss: 100 * MB, heapUsed: 0, arrayBuffers: 0 }),
    capacity: 5_000_000,
    dyno: 'web.1',
  });
  return { svc, db, sockets, ws: () => sockets[sockets.length - 1] };
}

/** Let promise chains settle without advancing timers. */
async function settle(n = 20): Promise<void> {
  for (let i = 0; i < n; i++) await Promise.resolve();
}

/** A previous dyno ('old') that collected `recs` and saved them. */
async function previousDyno(db: FakeDb, recs: Rec[]) {
  const store = new StrikeStore({ capacity: 10_000_000, selfWriter: 'old', now: () => T0 });
  const persist = createPersistence({ db, store, writer: 'old', now: () => T0, log: () => {} });
  const add = async (more: Rec[]) => {
    for (const r of more.slice().sort((a, b) => a.tick - b.tick)) store.appendLive(r.tick, r.latQ, r.lonQ);
    await persist.save();
  };
  await add(recs);
  return { add };
}

/** Advance the fake clock in small steps (restore pages yield through timers) until `until` holds. */
async function advanceUntil(until: () => boolean, maxMs = 10_000): Promise<void> {
  for (let t = 0; t < maxMs && !until(); t += 50) await vi.advanceTimersByTimeAsync(50);
}

beforeEach(() => {
  // setImmediate stays real: sliced scans (scan.ts) time their slices with the
  // real perf_hooks clock and yield through setImmediate, so on a loaded
  // machine a /near scan yields mid-way — with a faked setImmediate that yield
  // would never fire under a bare `await`, and the test would hang.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  vi.setSystemTime(T0);
});
afterEach(() => {
  vi.useRealTimers();
});

describe('lightning service', () => {
  it('connects the collector before the restore even starts, and the restore never blocks it', async () => {
    const db = new FakeDb();
    db.hang = true; // the database never answers
    const { svc, sockets, ws } = setup(db);
    svc.start();
    expect(sockets).toHaveLength(1); // at init, synchronously
    expect(svc.ctx.persist.restoreStatus().state).toBe('pending');
    ws().open();
    ws().strike(35, -97);
    expect(svc.ctx.store.records).toBe(1);
    vi.advanceTimersByTime(2_000);
    await settle();
    expect(svc.ctx.persist.restoreStatus().state).toBe('loading'); // hung on its plan query
    ws().strike(36, -97);
    expect(svc.ctx.store.records).toBe(2);
    expect(svc.ctx.bootId).toMatch(/^web\.1:[0-9a-z]+:[0-9a-f]{6}$/);
  });

  it('shutdown phase 1 saves at once and keeps collecting; phase 2 saves what came after', async () => {
    const { svc, db, ws } = setup();
    svc.start();
    ws().open();
    ws().strike(35, -97);
    let closeServer!: () => void;
    const closed = new Promise<void>((resolve) => (closeServer = resolve));
    const done = svc.shutdown(closed);
    expect(svc.shutdown(closed)).toBe(done); // idempotent
    await settle();
    expect(db.blocks.reduce((a, b) => a + b.n, 0)).toBe(1); // phase 1 flushed immediately
    expect(svc.ctx.collector.status().connected).toBe(true); // …and still collecting
    vi.advanceTimersByTime(5_000);
    ws().strike(36, -97);
    ws().strike(37, -97);
    closeServer();
    await settle(50);
    await done;
    expect(svc.ctx.collector.status().connected).toBe(false);
    expect(db.blocks.reduce((a, b) => a + b.n, 0)).toBe(3);
    // After phase 2 nothing is collected any more.
    ws().strike(38, -97);
    expect(svc.ctx.store.records).toBe(3);
  });

  it('phase 2 starts at +20 s when the server never closes, and the final flush is bounded with a hung DB', async () => {
    const db = new FakeDb();
    const { svc, ws } = setup(db);
    svc.start();
    ws().open();
    ws().strike(35, -97);
    db.hang = true;
    let resolved = false;
    const done = svc.shutdown(new Promise<void>(() => {})).then(() => {
      resolved = true;
    });
    await settle();
    vi.advanceTimersByTime(19_999);
    await settle();
    expect(svc.ctx.collector.status().connected).toBe(true);
    vi.advanceTimersByTime(1);
    await settle();
    expect(svc.ctx.collector.status().connected).toBe(false);
    expect(resolved).toBe(false);
    vi.advanceTimersByTime(3_000);
    await settle(50);
    expect(resolved).toBe(true); // ~23 s in total, whatever the database does
    await done;
    expect(svc.ctx.persist.status().pendingRecords).toBe(1);
  });

  it('a near answer taken mid-restore is not served after it, and a catch-up drops the memo too', async () => {
    const db = new FakeDb();
    const storm = [{ lat: 35, lon: -97, sd: 0.1 }];
    const old = await previousDyno(db, genStrikes({ n: 5_000, nowMs: T0 - 60_000, spanMs: 6 * 3_600_000, seed: 81, cells: storm, isolatedShare: 0 }));
    const { svc } = setup(db);
    svc.start();
    const q = { lat: 35, lon: -97, radiusMi: 100, hours: 24, maxPoints: 100 };
    expect((await svc.ctx.near.get(q)).counts.inRadius).toBe(0); // the history is not back yet
    await advanceUntil(() => svc.ctx.persist.restoreStatus().state === 'done');
    expect(Date.now() - T0).toBeLessThan(30_000); // well inside the first answer's memo window
    const restored = await svc.ctx.near.get(q);
    expect(restored.counts.inRadius).toBe(5_000);
    // Memoized from here on; then the old dyno's final flush lands and the 90 s catch-up loads it.
    await vi.advanceTimersByTimeAsync(70_000 - (Date.now() - T0));
    const memo = await svc.ctx.near.get(q);
    expect(await svc.ctx.near.get(q)).toBe(memo);
    await old.add(genStrikes({ n: 300, nowMs: T0 + 20_000, spanMs: 60_000, seed: 82, cells: storm, isolatedShare: 0 }));
    await advanceUntil(() => svc.ctx.persist.restoreStatus().catchUps.length > 0, 30_000);
    expect(Date.now() - T0).toBeLessThan(100_000); // < 30 s after the memoized answer
    expect((await svc.ctx.near.get(q)).counts.inRadius).toBe(5_300);
  });

  it('flags the restart hole and a reconnect that straddle minute boundaries without emptying a minute', async () => {
    const db = new FakeDb();
    // The old dyno collected densely for 2 h; its last saved strike is 50 s before this boot (12:00:00).
    await previousDyno(db, genStrikes({ n: 20_000, nowMs: T0 - 50_000, spanMs: 2 * 3_600_000, seed: 83 }));
    const lastSaved = Math.max(...db.blocks.map((b) => b.t_last));
    expect(lastSaved).toBeGreaterThan(T0 - 51_000);
    const { svc, ws } = setup(db);
    svc.start();
    ws().open();
    await vi.advanceTimersByTimeAsync(30_000); // the restore is done by now; relays slow to deliver
    const strikeEvery5s = async (untilMs: number) => {
      while (Date.now() < untilMs) {
        ws().strike(35, -97);
        await vi.advanceTimersByTimeAsync(5_000);
      }
    };
    await strikeEvery5s(T0 + 155_000); // last strike 12:02:30
    // The relay goes quiet; the watchdog replaces it; the next socket's first strike ends the outage.
    while (!(ws().terminated === false && Date.now() >= T0 + 215_000)) await vi.advanceTimersByTimeAsync(1_000);
    ws().open();
    const back = Date.now();
    await strikeEvery5s(T0 + 300_000);
    const cov = statusLite(svc.ctx, Date.now()).coverage;
    expect(cov.restoring).toBe(false);
    expect(cov.gaps.filter((g) => g.toMs > T0 - 3_600_000)).toEqual([
      { fromMs: lastSaved, toMs: T0 + 30_000 }, // 11:59:10 → 12:00:30: no empty minute
      { fromMs: T0 + 150_000, toMs: back }, // 12:02:30 → 12:03:35+: no empty minute
    ]);
    // Every minute has strikes: the empty-minute rule alone saw none of this.
    expect(svc.ctx.store.gaps(Date.now(), 60, null)).toEqual([]);
  });

  it('makes distinct boot ids', () => {
    const a = makeBootId(undefined, T0);
    expect(a.startsWith(`local:${T0.toString(36)}:`)).toBe(true);
    expect(makeBootId('web.1', T0)).not.toBe(makeBootId('web.1', T0));
  });
});

describe('memory guard', () => {
  function fill(store: StrikeStore, segments: number) {
    const w = store.writerIdOf('x');
    for (let k = 0; k < segments; k++) {
      const t = (T0 - (20 - k) * 3_600_000) / 10;
      for (let i = 0; i < SEG_CAP; i++) store.appendImport(t + i, 1, 1, 1, w);
    }
  }

  it('shrinks the capacity by 15 % above the high mark (to a floor), evicting the oldest, and grows back after 10 quiet minutes', () => {
    let now = T0;
    let rss = 500 * MB;
    let shrinks = 0;
    const store = new StrikeStore({ capacity: 4_000_000, selfWriter: 's', now: () => now });
    fill(store, 200); // 3.28M records
    const counted = store.countsWindow(now, 1440).sum;
    const g = new MemoryGuard({ store, configured: 4_000_000, rss: () => rss, now: () => now, onShrink: () => shrinks++, log: () => {} });
    g.tick();
    expect(store.capacity).toBe(3_400_000);
    expect(store.records).toBe(200 * SEG_CAP); // still fits
    expect(g.pressure).toBe(true);
    expect(shrinks).toBe(1);
    g.tick();
    expect(store.capacity).toBe(CAPACITY_FLOOR); // 2.89M → the 3M floor
    expect(store.records).toBeLessThanOrEqual(CAPACITY_FLOOR);
    expect(store.evictedBeforeMs).not.toBeNull();
    expect(store.countsWindow(now, 1440).sum).toBe(counted); // the per-minute counts stay exact
    // Between the marks nothing changes; below the low mark for 10 min → +10 %.
    rss = 400 * MB;
    now += 20 * 60_000;
    g.tick();
    expect(store.capacity).toBe(CAPACITY_FLOOR);
    rss = 300 * MB;
    g.tick();
    now += 9 * 60_000;
    g.tick();
    expect(store.capacity).toBe(CAPACITY_FLOOR);
    now += 60_000;
    g.tick();
    expect(store.capacity).toBe(3_300_000);
    expect(g.pressure).toBe(true);
    for (let i = 0; i < 5; i++) {
      now += 10 * 60_000;
      g.tick();
    }
    expect(store.capacity).toBe(4_000_000); // never past the configured value
    expect(g.pressure).toBe(false);
  });
});
