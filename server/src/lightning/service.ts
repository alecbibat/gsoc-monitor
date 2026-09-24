// Wires the lightning pieces together: store ← collector (live), store ⇄
// persistence (Postgres), display/near services, memory guard, timers and the
// two-phase shutdown. index.ts holds the process singleton; tests build their
// own service with a fake database and socket factory.

import { randomBytes } from 'crypto';
import { MAX_RECORDS, SAVE_INTERVAL_MS } from './constants';
import { Collector, type WsFactory } from './collector';
import { FieldService } from './display';
import { MemoryGuard } from './memoryGuard';
import { NearService } from './near';
import { type Queryable, createPersistence } from './persist';
import type { LightningContext } from './routes';
import { StrikeStore } from './store';

const RESTORE_DELAY_MS = 2_000;
const CATCH_UP_AT_MS = [90_000, 300_000];
const PRUNE_EVERY_MS = 30_000;
const GUARD_EVERY_MS = 60_000;
const SUMMARY_EVERY_MS = 15 * 60_000;
/** Shutdown phase 2 starts when the HTTP server has closed, or at this point at the latest. */
const PHASE2_AFTER_MS = 20_000;
const FINAL_FLUSH_MS = 3_000;

export interface ServiceDeps {
  db: Queryable;
  wsFactory?: WsFactory;
  now?: () => number;
  memoryUsage?: () => { rss: number; heapUsed: number; arrayBuffers: number };
  capacity?: number;
  syntheticRate?: number | null;
  dyno?: string;
  log?: (msg: string) => void;
}

export interface LightningService {
  ctx: LightningContext;
  start(): void;
  shutdown(serverClosed: Promise<void>): Promise<void>;
}

export function makeBootId(dyno: string | undefined, now: number): string {
  return `${dyno || 'local'}:${now.toString(36)}:${randomBytes(3).toString('hex')}`;
}

export function createLightningService(deps: ServiceDeps): LightningService {
  const now = deps.now ?? Date.now;
  const log = deps.log ?? ((m: string) => console.log(m));
  const mem = deps.memoryUsage ?? (() => process.memoryUsage());
  const capacity = deps.capacity ?? MAX_RECORDS;
  const bootMs = now();
  const bootId = makeBootId(deps.dyno ?? process.env.DYNO, bootMs);

  const store = new StrikeStore({ capacity, selfWriter: bootId, now });
  const collector = new Collector({
    onStrike: (tick, latQ, lonQ) => store.appendLive(tick, latQ, lonQ),
    wsFactory: deps.wsFactory,
    now,
    log,
    syntheticRate: deps.syntheticRate ?? null,
  });
  const persist = createPersistence({ db: deps.db, store, writer: bootId, now, bootMs, log });
  const field = new FieldService(store, now);
  const near = new NearService(
    store,
    () => ({ legacyBeforeMs: persist.legacyBeforeMs, evictedBeforeMs: store.evictedBeforeMs }),
    now
  );
  const guard = new MemoryGuard({
    store,
    configured: capacity,
    rss: () => mem().rss,
    now,
    onShrink: () => {
      field.clear();
      near.clear();
    },
    log,
  });

  const ctx: LightningContext = {
    store,
    collector,
    persist,
    bootId,
    bootMs,
    mem,
    pressure: () => guard.pressure,
    field,
    near,
    now,
    debugExtra: () => ({ fieldService: field.stats(), capacityConfigured: capacity }),
  };

  const timers: ReturnType<typeof setTimeout>[] = [];
  const later = (ms: number, fn: () => void) => {
    const t = setTimeout(fn, ms);
    t.unref?.();
    timers.push(t);
  };
  const every = (ms: number, fn: () => void) => {
    const t = setInterval(fn, ms);
    t.unref?.();
    timers.push(t);
  };

  function summary(): string {
    const t = now();
    const c = collector.status(t);
    const st = store.stats();
    const ps = persist.status(t);
    const rs = persist.restoreStatus();
    const saved = ps.lastSaveAt === null ? 'never' : `${Math.round((t - ps.lastSaveAt) / 1000)} s ago`;
    return (
      `[lightning] ${(c.ratePerMin / 60).toFixed(1)}/s${c.connected ? '' : ' (collector DOWN)'} · ` +
      `${(st.records / 1e6).toFixed(2)}M strikes in ${st.segments} segments (${Math.round(st.bytes / 1_048_576)} MB) · ` +
      `rss ${Math.round(mem().rss / 1_048_576)} MB · last save ${saved}${ps.lastSaveOk ? '' : ` FAILING (${ps.lastError})`}` +
      `${ps.pendingRecords ? `, ${ps.pendingRecords} pending` : ''} · restore ${rs.state}`
    );
  }

  let started = false;
  function start(): void {
    if (started) return;
    started = true;
    log(`[lightning] boot ${bootId}; collecting now, restoring history in the background`);
    // Collect first: the restore runs alongside, never in front of, ingest.
    collector.start();
    later(RESTORE_DELAY_MS, () => void persist.restore());
    for (const at of CATCH_UP_AT_MS) later(at, () => void persist.catchUp());
    every(SAVE_INTERVAL_MS, () => void persist.save());
    every(PRUNE_EVERY_MS, () => {
      store.prune(now());
      store.enforceCapacity();
    });
    every(GUARD_EVERY_MS, () => guard.tick());
    every(SUMMARY_EVERY_MS, () => log(summary()));
  }

  let shutting: Promise<void> | null = null;
  function shutdown(serverClosed: Promise<void>): Promise<void> {
    if (shutting) return shutting;
    shutting = (async () => {
      // Phase 1: persist everything so far right away, but keep collecting —
      // the replacement dyno may not be up yet, and every second counted here
      // is a second it does not have to have seen.
      log('[lightning] shutdown: flushing, still collecting');
      void persist.flushAll(PHASE2_AFTER_MS).catch(() => false);
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        serverClosed.catch(() => undefined),
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, PHASE2_AFTER_MS);
          timer.unref?.();
        }),
      ]);
      if (timer) clearTimeout(timer);
      // Phase 2: stop collecting, then one bounded final flush of the tail.
      collector.stop();
      persist.stop();
      for (const t of timers) clearTimeout(t);
      // Waits for a phase-1 save still in flight, then saves what is left.
      const ok = await persist.flushAll(FINAL_FLUSH_MS);
      const ps = persist.status();
      log(
        ok
          ? `[lightning] shutdown: all strikes saved (${ps.rowsSaved} rows this boot)`
          : `[lightning] shutdown: ${ps.pendingRecords} strikes NOT saved (${ps.lastError ?? 'database slow'})`
      );
    })();
    return shutting;
  }

  return { ctx, start, shutdown };
}
