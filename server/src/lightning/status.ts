// Collector health, exact counts, coverage and persistence state, shaped
// exactly as types.ts describes (/status, the `status` block of /field, and
// /debug). Everything here is read from counters and the per-minute ring, so
// it is cheap enough to attach to every /field response.

import type { CollectorStatus } from './collector';
import type { PersistStatus, RestoreStatus } from './persist';
import type { StrikeStore } from './store';
import type {
  LightningCollector,
  LightningCounts,
  LightningCoverage,
  LightningFidelity,
  LightningRestore,
  LightningStatusLite,
  LightningStatusResponse,
} from './types';

export interface StatusSources {
  store: StrikeStore;
  collector: { status(now?: number): CollectorStatus };
  persist: { status(now?: number): PersistStatus; restoreStatus(): RestoreStatus; readonly legacyBeforeMs: number | null };
  bootId: string;
  bootMs: number;
  mem: () => { rss: number; heapUsed: number; arrayBuffers: number };
  pressure: () => boolean;
}

const round2 = (v: number): number => Math.round(v * 100) / 100;

export function collectorLite(c: CollectorStatus, now: number): LightningCollector {
  return {
    connected: c.connected,
    downSince: c.downSince,
    lastStrikeAgeS: c.lastStrikeAt === null ? null : Math.max(0, Math.round((now - c.lastStrikeAt) / 1000)),
    ratePerMin: c.ratePerMin,
  };
}

/**
 * Coverage of the trailing window. While the restore runs, time before what it
 * has reached (or before boot, if it has not started) is unknown rather than a
 * gap; the collector's own time since boot is always known.
 */
export function coverage(src: StatusSources, now: number, windowMin: number, c?: CollectorStatus): LightningCoverage {
  const rs = src.persist.restoreStatus();
  const col = c ?? src.collector.status(now);
  const restoring = rs.state !== 'done';
  const unknownBeforeMs = restoring ? Math.min(src.bootMs, rs.backToMs ?? src.bootMs) : null;
  const gaps = src.store.gaps(now, windowMin, unknownBeforeMs, col.downSince);
  const winStart = now - windowMin * 60_000;
  let blindMs = 0;
  for (const g of gaps) blindMs += g.toMs - g.fromMs;
  const unknownMs = unknownBeforeMs === null ? 0 : Math.max(0, Math.min(unknownBeforeMs, now) - winStart);
  return {
    windowMin,
    coveredMin: Math.max(0, Math.round((windowMin * 60_000 - blindMs - unknownMs) / 60_000)),
    gaps,
    restoring,
    restoredBackToMs: rs.backToMs,
  };
}

export function counts(store: StrikeStore, now: number): LightningCounts {
  const day = store.countsWindow(now, 1_440);
  return {
    m60: store.countsWindow(now, 60).sum,
    m360: store.countsWindow(now, 360).sum,
    m720: store.countsWindow(now, 720).sum,
    m1440: day.sum,
    exact: !day.legacy,
  };
}

export function fidelity(src: StatusSources): LightningFidelity {
  return { legacyBeforeMs: src.persist.legacyBeforeMs, evictedBeforeMs: src.store.evictedBeforeMs };
}

export function restoreLite(rs: RestoreStatus): LightningRestore {
  return { state: rs.state, progress: rs.progress, backToMs: rs.backToMs };
}

export function statusLite(src: StatusSources, now: number): LightningStatusLite {
  const c = src.collector.status(now);
  return {
    now,
    collector: collectorLite(c, now),
    counts: counts(src.store, now),
    coverage: coverage(src, now, 1_440, c),
    fidelity: fidelity(src),
    restore: restoreLite(src.persist.restoreStatus()),
  };
}

export function statusFull(src: StatusSources, now: number): LightningStatusResponse {
  const c = src.collector.status(now);
  const rs = src.persist.restoreStatus();
  const ps = src.persist.status(now);
  const perMinute = src.store.perMinute(now, 60);
  const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
  const st = src.store.stats();
  const mem = src.mem();
  return {
    v: 1,
    bootId: src.bootId,
    ...statusLite(src, now),
    rates: {
      perSec: round2(c.ratePerMin / 60),
      per15mPerSec: round2(sum(perMinute.slice(-15)) / 900),
      per1hPerSec: round2(sum(perMinute) / 3_600),
      peak1hPerSec: round2(Math.max(0, ...perMinute) / 60),
    },
    perMinute,
    collectorDetail: {
      relay: c.relay,
      connectedSince: c.connectedSince,
      reconnects24h: c.reconnects24h,
      networkTimePct: c.networkTimePct,
      rejected: c.rejected,
      dupes: c.dupes,
    },
    persist: {
      lastSaveAt: ps.lastSaveAt,
      lastSaveOk: ps.lastSaveOk,
      lastError: ps.lastError,
      pendingRecords: ps.pendingRecords,
      oldestPendingAgeS: ps.oldestPendingAgeS,
    },
    restoreDetail: {
      attempts: rs.attempts,
      lastError: rs.lastError,
      rows: rs.rows,
      strikes: rs.strikes,
      legacyRows: rs.legacyRows,
      dupes: rs.dupes,
      ms: rs.ms,
    },
    store: { records: st.records, segments: st.segments, capacity: st.capacity, bytes: st.bytes },
    mem: { rss: mem.rss, heapUsed: mem.heapUsed, arrayBuffers: mem.arrayBuffers, pressure: src.pressure() },
  };
}

/** /debug: the full status plus everything behind it, down to each segment. */
export function debugInfo(src: StatusSources, now: number, extra: Record<string, unknown> = {}) {
  const store = src.store;
  return {
    ...statusFull(src, now),
    collectorAll: src.collector.status(now),
    persistAll: src.persist.status(now),
    restoreAll: src.persist.restoreStatus(),
    storeAll: store.stats(),
    ...extra,
    segments: store.segments().map((s) => ({
      id: s.id,
      n: s.n,
      weight: s.weight,
      own: s.own,
      legacy: s.legacy,
      writer: store.writerName(s.writerId),
      fromMs: s.n ? s.minTick * 10 : null,
      toMs: s.n ? s.maxTick * 10 : null,
      savedN: s.savedN,
      queuedN: s.queuedN,
    })),
  };
}
