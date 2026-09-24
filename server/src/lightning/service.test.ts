import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SEG_CAP } from './constants';
import { CAPACITY_FLOOR, MemoryGuard } from './memoryGuard';
import { createLightningService, makeBootId } from './service';
import { StrikeStore } from './store';
import { FakeDb, FakeWs } from './testkit';

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

beforeEach(() => {
  vi.useFakeTimers();
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
    expect(store.countsWindow(now, 1440).sum).toBe(counted); // counts stay exact
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
