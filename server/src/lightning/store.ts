// The in-memory strike log: every strike of the last 24 h at full fidelity.
//
// The old collector kept 1 strike in 6 in a Float32/Float64 ring (16 bytes a
// strike) so 24 h would fit; every count built on it was ~1/6 of reality. This
// store keeps them all in 8 bytes each by packing the quantized identity
// (see quant.ts) relative to a per-segment base tick:
//
//   lo = latQ | (tOff & 0xFFF) << 20        (20 + 12 bits)
//   hi = lonQ | (tOff >>> 12) << 20         (20 + 12 bits)
//   tick = baseTick + tOff,  0 ≤ tOff < 2^24 (10 ms units, ~46.6 h)
//
// Records live in fixed-size segments (SEG_CAP records in one Uint32Array).
// Live strikes append to the open "own" segment (the only ones persistence
// writes); restored, legacy and catch-up strikes append to one open import
// segment per weight, so restored history is as densely packed as live data.
// Segments are append-only: a scan snapshots (segment, n) pairs and reads a
// consistent view while ingest continues, and a dropped segment's buffer is
// only recycled once no scan can still be reading it.
//
// A per-minute ring keeps exact (weighted) counts for every minute of the
// last 25 h. Counts, rates and collector gaps come from it, so they stay
// exact even when the memory guard evicts old records.

import { PRUNE_GRACE_MS, RETENTION_MS, SEG_CAP } from './constants';
import type { LightningGap } from './types';

export const TICKS_PER_MIN = 6_000;
/** tOff must be < 2^24 ticks (~46.6 h). */
export const TOFF_LIMIT = 1 << 24;
/**
 * A segment's base sits 30 h before its first record. Live segments append
 * forward from there; import segments are filled newest-first by the restore,
 * so their later records are up to ~24 h OLDER than the first — the lead
 * makes both fit, with ~16 h of room ahead for late live strikes.
 */
export const BASE_LEAD_TICKS = 30 * 3_600 * 100;
/** Per-minute ring: 25 h of minutes. */
export const RING_MINUTES = 1_500;
/** Writer mark for a minute that more than one writer contributed to. */
export const MIXED_WRITER = 0xffff;
/** Buffers kept for reuse after segments are dropped. */
const POOL_MAX = 32;

const POW20 = 1_048_576;
const POW40 = 1_099_511_627_776;

export interface Segment {
  /** Debug id, increasing in creation order. */
  id: number;
  /** Interleaved [lo, hi] words, 2 × SEG_CAP. Only the first n records are valid. */
  words: Uint32Array;
  n: number;
  baseTick: number;
  minTick: number;
  maxTick: number;
  /** Strikes each record stands for: 1, or 6 for imported pre-upgrade history (kept 1-in-6). */
  weight: number;
  /** Writer of the segment's first record. Import segments can mix writers; the per-minute marks are what dedupe uses. */
  writerId: number;
  /** Collected live by this process (the only segments persistence writes). */
  own: boolean;
  legacy: boolean;
  /** Records [0, savedN) are confirmed in the database. */
  savedN: number;
  /** Records [0, queuedN) have been formed into pending rows. */
  queuedN: number;
}

export interface SnapSeg {
  seg: Segment;
  /** Record count when the snapshot was taken; the scan reads exactly [0, n). */
  n: number;
}

export interface Snapshot {
  segs: SnapSeg[];
  release(): void;
}

export const packLo = (latQ: number, tOff: number): number => (latQ | ((tOff & 0xfff) << 20)) >>> 0;
export const packHi = (lonQ: number, tOff: number): number => (lonQ | ((tOff >>> 12) << 20)) >>> 0;
export const latQOf = (lo: number): number => lo & 0xfffff;
export const lonQOf = (hi: number): number => hi & 0xfffff;
export const tOffOf = (lo: number, hi: number): number => (lo >>> 20) | ((hi >>> 20) << 12);

/** A strike's identity within its minute, exact in 53 bits: tq·2^40 + latQ·2^20 + lonQ (tq < 6000). */
export const identityKey = (tq: number, latQ: number, lonQ: number): number => tq * POW40 + latQ * POW20 + lonQ;

export interface StoreStats {
  records: number;
  segments: number;
  capacity: number;
  bytes: number;
  ownSegments: number;
  importSegments: number;
  legacySegments: number;
  pooledBuffers: number;
  pendingFree: number;
  activeScans: number;
  evictedBeforeMs: number | null;
  evictedRecords: number;
}

export class StrikeStore {
  private segs: Segment[] = [];
  private openOwn: Segment | null = null;
  private openImport = new Map<number, Segment>();
  private nextSegId = 1;
  private recordCount = 0;
  private cap: number;

  private pool: Uint32Array[] = [];
  private pendingFree: Uint32Array[] = [];
  private activeScans = 0;

  private writerIds = new Map<string, number>();
  private writerNames: string[] = [''];
  readonly selfId: number;

  /** Strikes before this time are no longer held (memory cap); null when nothing was evicted. */
  evictedBeforeMs: number | null = null;
  evictedRecords = 0;

  private ringStamp = new Int32Array(RING_MINUTES).fill(-1);
  private ringCount = new Float64Array(RING_MINUTES);
  private ringLegacy = new Uint8Array(RING_MINUTES);
  private ringMark = new Uint16Array(RING_MINUTES);

  private now: () => number;

  constructor(opts: { capacity: number; selfWriter: string; now?: () => number }) {
    this.cap = opts.capacity;
    this.now = opts.now ?? Date.now;
    this.selfId = this.writerIdOf(opts.selfWriter);
  }

  get capacity(): number {
    return this.cap;
  }
  get records(): number {
    return this.recordCount;
  }

  /** Small integer id for a writer (a dyno boot); ids are only meaningful inside this process. */
  writerIdOf(writer: string): number {
    let id = this.writerIds.get(writer);
    if (id === undefined) {
      // 0 = "no writer", MIXED_WRITER is reserved. A process sees a few dozen writers a day.
      id = Math.min(this.writerNames.length, MIXED_WRITER - 1);
      this.writerIds.set(writer, id);
      this.writerNames.push(writer);
    }
    return id;
  }
  writerName(id: number): string {
    return id === MIXED_WRITER ? 'mixed' : (this.writerNames[id] ?? '?');
  }

  // --- Ingest -----------------------------------------------------------------

  /** A strike the collector just received. The hot path: no dedupe, no allocation (except a new segment). */
  appendLive(tick: number, latQ: number, lonQ: number): void {
    let seg = this.openOwn;
    if (!seg || !this.fits(seg, tick)) {
      seg = this.openSegment(tick, 1, this.selfId, true, false);
      this.openOwn = seg;
    }
    this.put(seg, tick, latQ, lonQ);
    const slot = this.ringSlot(Math.floor(tick / TICKS_PER_MIN), true);
    if (slot >= 0) {
      this.ringCount[slot] += 1;
      const mark = this.ringMark[slot];
      if (mark === 0) this.ringMark[slot] = this.selfId;
      // Another writer's history already covers this minute (a restore got
      // there first): later imports into it must check identities, not trust marks.
      else if (mark !== this.selfId) this.ringMark[slot] = MIXED_WRITER;
    }
  }

  /**
   * A restored, catch-up or legacy strike. The caller has already filtered it
   * to the window and decided it is not a duplicate; writer marks are the
   * caller's (see persist.ts), counts and the legacy flag are updated here.
   */
  appendImport(tick: number, latQ: number, lonQ: number, weight: number, writerId: number): void {
    let seg = this.openImport.get(weight);
    if (!seg || !this.fits(seg, tick)) {
      seg = this.openSegment(tick, weight, writerId, false, weight !== 1);
      this.openImport.set(weight, seg);
    }
    this.put(seg, tick, latQ, lonQ);
    const slot = this.ringSlot(Math.floor(tick / TICKS_PER_MIN), true);
    if (slot >= 0) {
      this.ringCount[slot] += weight;
      if (weight !== 1) this.ringLegacy[slot] = 1;
    }
  }

  private fits(seg: Segment, tick: number): boolean {
    if (seg.n >= SEG_CAP) return false;
    const tOff = tick - seg.baseTick;
    return tOff >= 0 && tOff < TOFF_LIMIT;
  }

  private put(seg: Segment, tick: number, latQ: number, lonQ: number): void {
    const tOff = tick - seg.baseTick;
    const i = seg.n << 1;
    seg.words[i] = packLo(latQ, tOff);
    seg.words[i + 1] = packHi(lonQ, tOff);
    seg.n++;
    if (tick < seg.minTick) seg.minTick = tick;
    if (tick > seg.maxTick) seg.maxTick = tick;
    this.recordCount++;
  }

  private openSegment(firstTick: number, weight: number, writerId: number, own: boolean, legacy: boolean): Segment {
    const seg: Segment = {
      id: this.nextSegId++,
      words: this.pool.pop() ?? new Uint32Array(2 * SEG_CAP),
      n: 0,
      baseTick: firstTick - BASE_LEAD_TICKS,
      minTick: Infinity,
      maxTick: -Infinity,
      weight,
      writerId,
      own,
      legacy,
      savedN: 0,
      queuedN: 0,
    };
    this.segs.push(seg);
    return seg;
  }

  // --- Retention and capacity -------------------------------------------------

  /** Drop segments whose newest record is past the window (plus grace). Returns the number dropped. */
  prune(nowMs: number): number {
    const cutoffTick = Math.floor((nowMs - RETENTION_MS - PRUNE_GRACE_MS) / 10);
    return this.drop((s) => s.n > 0 && s.maxTick < cutoffTick);
  }

  setCapacity(records: number): void {
    this.cap = Math.max(0, Math.floor(records));
  }

  /**
   * Evict whole segments, oldest newest-record first, until the store fits
   * its capacity. The per-minute counts are deliberately left alone, so
   * counts stay exact; evictedBeforeMs tells readers the points are gone.
   */
  enforceCapacity(): number {
    if (this.recordCount <= this.cap) return 0;
    const victims = this.segs
      .filter((s) => s.n > 0 && s !== this.openOwn)
      .sort((a, b) => a.maxTick - b.maxTick);
    const evict = new Set<Segment>();
    let over = this.recordCount - this.cap;
    for (const s of victims) {
      if (over <= 0) break;
      evict.add(s);
      over -= s.n;
      const endMs = (s.maxTick + 1) * 10;
      if (this.evictedBeforeMs === null || endMs > this.evictedBeforeMs) this.evictedBeforeMs = endMs;
      this.evictedRecords += s.n;
    }
    return this.drop((s) => evict.has(s));
  }

  private drop(pred: (s: Segment) => boolean): number {
    let dropped = 0;
    const keep: Segment[] = [];
    for (const s of this.segs) {
      if (!pred(s)) {
        keep.push(s);
        continue;
      }
      dropped++;
      this.recordCount -= s.n;
      if (s === this.openOwn) this.openOwn = null;
      for (const [w, open] of this.openImport) if (open === s) this.openImport.delete(w);
      // A scan may still be reading this buffer; it is recycled only when none is active.
      if (this.activeScans > 0) this.pendingFree.push(s.words);
      else if (this.pool.length < POOL_MAX) this.pool.push(s.words);
    }
    this.segs = keep;
    return dropped;
  }

  // --- Reading ----------------------------------------------------------------

  /** A consistent view for a (possibly sliced, async) scan. Always release() it. */
  snapshot(): Snapshot {
    this.activeScans++;
    const segs = this.segs.filter((s) => s.n > 0).map((seg) => ({ seg, n: seg.n }));
    let released = false;
    return {
      segs,
      release: () => {
        if (released) return;
        released = true;
        this.activeScans--;
        if (this.activeScans === 0) {
          for (const buf of this.pendingFree) {
            if (this.pool.length >= POOL_MAX) break;
            this.pool.push(buf);
          }
          this.pendingFree = [];
        }
      },
    };
  }

  /** Every live segment in creation order (read synchronously — persistence and debug). */
  segments(): readonly Segment[] {
    return this.segs;
  }

  ownSegments(): Segment[] {
    return this.segs.filter((s) => s.own);
  }

  // --- Per-minute ring ----------------------------------------------------------

  private ringSlot(minute: number, create: boolean): number {
    const s = minute % RING_MINUTES;
    if (this.ringStamp[s] === minute) return s;
    if (!create) return -1;
    // Only minutes inside the ring's span relative to the clock: a stray old
    // (or absurdly future) record must never overwrite a current minute.
    const nowMin = Math.floor(this.now() / 60_000);
    if (minute <= nowMin - RING_MINUTES || minute > nowMin + 60) return -1;
    if (this.ringStamp[s] > minute) return -1; // the slot already holds a newer minute
    this.ringStamp[s] = minute;
    this.ringCount[s] = 0;
    this.ringLegacy[s] = 0;
    this.ringMark[s] = 0;
    return s;
  }

  /** Weighted strike count for one epoch minute (0 when unknown). */
  minuteCount(minute: number): number {
    const s = this.ringSlot(minute, false);
    return s < 0 ? 0 : this.ringCount[s];
  }

  /** First writer seen for a minute (0 = none, MIXED_WRITER = several). */
  writerMark(minute: number): number {
    const s = this.ringSlot(minute, false);
    return s < 0 ? 0 : this.ringMark[s];
  }

  setWriterMark(minute: number, writerId: number): void {
    const s = this.ringSlot(minute, true);
    if (s >= 0) this.ringMark[s] = writerId;
  }

  /**
   * Weighted count over [now − minutes, now], by minute bucket: every bucket
   * that overlaps the window counts in full, so the count is exact when now is
   * on a minute boundary and at most one minute's worth over otherwise.
   * legacy = some bucket holds pre-upgrade (×6) history.
   */
  countsWindow(nowMs: number, minutes: number): { sum: number; legacy: boolean } {
    const cur = Math.floor(nowMs / 60_000);
    let sum = 0;
    let legacy = false;
    for (let m = Math.floor((nowMs - minutes * 60_000) / 60_000); m <= cur; m++) {
      const s = this.ringSlot(m, false);
      if (s < 0) continue;
      sum += this.ringCount[s];
      if (this.ringLegacy[s]) legacy = true;
    }
    return { sum, legacy };
  }

  /** Counts for the last `minutes` COMPLETED minutes, oldest → newest. */
  perMinute(nowMs: number, minutes: number): number[] {
    const cur = Math.floor(nowMs / 60_000);
    const out: number[] = [];
    for (let m = cur - minutes; m < cur; m++) out.push(this.minuteCount(m));
    return out;
  }

  /**
   * Collector blind spots inside the trailing window: runs of ≥ 1 completed
   * minute with no strike at all (the global stream never has an empty
   * minute), plus the current partial minute while the collector is down.
   * Time before unknownBeforeMs (history still being restored) is unknown, not
   * a gap, and is left out.
   */
  gaps(nowMs: number, windowMin: number, unknownBeforeMs: number | null, downSinceMs: number | null = null): LightningGap[] {
    const cur = Math.floor(nowMs / 60_000);
    const winStart = nowMs - windowMin * 60_000;
    const floorMs = Math.max(winStart, unknownBeforeMs ?? -Infinity);
    const raw: LightningGap[] = [];
    let runStart = -1;
    for (let m = Math.floor(winStart / 60_000); m < cur; m++) {
      if (this.minuteCount(m) === 0) {
        if (runStart < 0) runStart = m;
      } else if (runStart >= 0) {
        raw.push({ fromMs: runStart * 60_000, toMs: m * 60_000 });
        runStart = -1;
      }
    }
    if (downSinceMs !== null) {
      raw.push({ fromMs: runStart >= 0 ? runStart * 60_000 : Math.max(cur * 60_000, downSinceMs), toMs: nowMs });
    } else if (runStart >= 0) {
      raw.push({ fromMs: runStart * 60_000, toMs: cur * 60_000 });
    }
    const out: LightningGap[] = [];
    for (const g of raw) {
      const fromMs = Math.max(g.fromMs, floorMs);
      const toMs = Math.min(g.toMs, nowMs);
      if (toMs > fromMs) out.push({ fromMs, toMs });
    }
    return out;
  }

  /**
   * Every identity (identityKey) stored for one minute. Only segments whose
   * tick range covers the minute are scanned. Used by the restore's
   * cross-writer dedupe; synchronous, so it sees a consistent state.
   */
  identitiesForMinute(minute: number): Set<number> {
    const t0 = minute * TICKS_PER_MIN;
    const t1 = t0 + TICKS_PER_MIN;
    const out = new Set<number>();
    for (const seg of this.segs) {
      if (seg.n === 0 || seg.maxTick < t0 || seg.minTick >= t1) continue;
      const w = seg.words;
      const base = seg.baseTick;
      for (let i = 0; i < seg.n; i++) {
        const lo = w[2 * i];
        const hi = w[2 * i + 1];
        const tick = base + tOffOf(lo, hi);
        if (tick < t0 || tick >= t1) continue;
        out.add(identityKey(tick - t0, latQOf(lo), lonQOf(hi)));
      }
    }
    return out;
  }

  stats(): StoreStats {
    let own = 0;
    let imp = 0;
    let legacy = 0;
    for (const s of this.segs) {
      if (s.own) own++;
      else imp++;
      if (s.legacy) legacy++;
    }
    return {
      records: this.recordCount,
      segments: this.segs.length,
      capacity: this.cap,
      bytes: this.segs.length * SEG_CAP * 8,
      ownSegments: own,
      importSegments: imp,
      legacySegments: legacy,
      pooledBuffers: this.pool.length,
      pendingFree: this.pendingFree.length,
      activeScans: this.activeScans,
      evictedBeforeMs: this.evictedBeforeMs,
      evictedRecords: this.evictedRecords,
    };
  }
}

/** Decode record i of a segment's words (tests, debug and rare tie-breaks; hot loops inline this). */
export function recordAt(words: Uint32Array, baseTick: number, i: number): { tick: number; latQ: number; lonQ: number } {
  const lo = words[2 * i];
  const hi = words[2 * i + 1];
  return { tick: baseTick + tOffOf(lo, hi), latQ: latQOf(lo), lonQ: lonQOf(hi) };
}
