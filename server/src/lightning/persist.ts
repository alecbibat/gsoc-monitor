// Postgres persistence for the strike store: survive restarts and deploys
// (the dyno filesystem is wiped on both, and Heroku cycles the dyno daily).
//
// What the old chunk persistence got wrong, and what replaces it:
//   - It saved "every strike newer than the newest saved time" (a ≤ ms
//     high-water mark): strikes arriving out of order (Blitzortung's own
//     timestamps lag by seconds) behind the mark were never saved, and a failed
//     save re-derived a different chunk next time. Here rows are cut by
//     POSITION in the append-only own segments ([queuedN, n)), each with a
//     sequence number, and inserted with ON CONFLICT (writer, seq) DO NOTHING —
//     a retry after a lost ack is idempotent, and nothing is ever skipped.
//   - After an outage it stride-thinned the backlog silently. Here nothing is
//     thinned; the queue is bounded by bytes and anything dropped is counted.
//   - The boot load gave up after ~15 s, dropped chunks that straddled the
//     window start, and the socket only connected after it. Here the collector
//     is already running; the restore pages newest-first (the part of the map
//     people look at comes back first), retries forever from its cursor, trims
//     straddling rows per strike, and dedupes the minutes two dynos both
//     collected (Heroku can overlap the old and new dyno).
//
// Each boot is its own writer (the bootId), so two overlapping dynos never
// collide on (writer, seq).

import {
  DB_KEEP_MS,
  DB_PRUNE_EVERY_MS,
  MAX_PENDING_BYTES,
  RESTORE_PAGE_ROWS,
  RETENTION_MS,
  ROWS_PER_INSERT,
} from './constants';
import { CorruptRowError, decodeRow, encodeRow } from './codec';
import { unpackStrikes } from './legacyCodec';
import { qLat, qLon, tickOf } from './quant';
import { yieldToLoop } from './scan';
import type { Segment, StrikeStore } from './store';
import { MIXED_WRITER, TICKS_PER_MIN, identityKey, latQOf, lonQOf, tOffOf } from './store';

/** The slice of pg's Pool the persistence uses (a fake in tests). */
export interface Queryable {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query(text: string, params?: unknown[]): Promise<{ rows: any[] }>;
}

/** Strikes more than this far in the future of the clock are treated as corrupt, not stored. */
const MAX_FUTURE_MS = 10 * 60_000;
/** Catch-up looks for other writers' rows ending after boot minus this. */
const CATCH_UP_LOOKBACK_MS = 15 * 60_000;
/** Legacy chunks start with their first strike and span ~5 min; this bounds how far back a straddler is looked for. */
const LEGACY_STRADDLE_MS = 6 * 60 * 60_000;
/** Identity sets cached during a restore (restore pages are time-local, so a few minutes suffice). */
const ID_CACHE_MINUTES = 16;

interface PendingRow {
  seq: number;
  tFirst: number;
  tLast: number;
  n: number;
  baseTick: number;
  data: Buffer;
  seg: Segment;
  endN: number;
}

// pg returns BIGINT (and count/sum) as strings: always Number() them.
interface BlockRow {
  id: string | number;
  writer: string;
  t_last: string | number;
  n: string | number;
  base_tick: string | number;
  data: Buffer;
}
interface ChunkRow {
  id: string | number;
  chunk_start: string | number;
  n: string | number;
  data: Buffer;
}

export interface PersistStatus {
  lastSaveAt: number | null;
  lastSaveOk: boolean;
  lastError: string | null;
  pendingRecords: number;
  oldestPendingAgeS: number | null;
  pendingRows: number;
  pendingBytes: number;
  droppedUnsaved: number;
  rowsSaved: number;
  recordsSaved: number;
  nextSeq: number;
  lastPruneAt: number | null;
}

export type RestoreState = 'pending' | 'loading' | 'retrying' | 'done';

export interface RestoreStatus {
  state: RestoreState;
  progress: number;
  backToMs: number | null;
  attempts: number;
  lastError: string | null;
  rows: number;
  strikes: number;
  legacyRows: number;
  legacyStrikes: number;
  dupes: number;
  /** Strikes outside the window (straddling rows) or implausibly in the future. */
  filtered: number;
  corruptRows: number;
  ms: number | null;
  legacyBeforeMs: number | null;
  catchUps: { at: number; rows: number; strikes: number; dupes: number; error: string | null }[];
}

export interface PersistenceDeps {
  db: Queryable;
  store: StrikeStore;
  /** This boot's writer id (the bootId). */
  writer: string;
  now?: () => number;
  /** Process boot time (catch-up window, legacy fallback). Defaults to now(). */
  bootMs?: number;
  sleep?: (ms: number) => Promise<void>;
  log?: (msg: string) => void;
}

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    t.unref?.();
  });

const errMsg = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/**
 * Identity sets per minute for cross-writer dedupe. A cached set is only
 * trusted while the minute's count is what the restore expects: if live
 * ingest added strikes to the minute since (between restore pages), the set
 * is rebuilt, so a restored strike is also checked against those.
 */
class IdentityCache {
  private sets = new Map<number, { ids: Set<number>; expected: number }>();
  constructor(private store: StrikeStore) {}

  get(minute: number): Set<number> {
    const count = this.store.minuteCount(minute);
    let e = this.sets.get(minute);
    if (!e || e.expected !== count) {
      e = { ids: this.store.identitiesForMinute(minute), expected: count };
      this.sets.delete(minute);
      this.sets.set(minute, e);
      if (this.sets.size > ID_CACHE_MINUTES) this.sets.delete(this.sets.keys().next().value as number);
    }
    return e.ids;
  }

  /** The restore appended one weight-1 strike to a cached minute. */
  appended(minute: number): void {
    const e = this.sets.get(minute);
    if (e) e.expected += 1;
  }
}

export class Persistence {
  private readonly db: Queryable;
  private readonly store: StrikeStore;
  readonly writer: string;
  private readonly now: () => number;
  readonly bootMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly log: (msg: string) => void;

  // --- save state
  private pending: PendingRow[] = [];
  private pendingBytes = 0;
  private nextSeq = 0;
  private saving: Promise<void> | null = null;
  private lastFormAt: number | null = null;
  private lastSaveAt: number | null = null;
  private lastSaveOk = true;
  private lastError: string | null = null;
  private lastPruneAt: number | null = null;
  private droppedUnsaved = 0;
  private rowsSaved = 0;
  private recordsSaved = 0;

  // --- restore state
  private stopped = false;
  private restoreRun: Promise<void> | null = null;
  private loadedIds = new Set<number>();
  private legacyWid: number;
  private rs: RestoreStatus = {
    state: 'pending',
    progress: 0,
    backToMs: null,
    attempts: 0,
    lastError: null,
    rows: 0,
    strikes: 0,
    legacyRows: 0,
    legacyStrikes: 0,
    dupes: 0,
    filtered: 0,
    corruptRows: 0,
    ms: null,
    legacyBeforeMs: null,
    catchUps: [],
  };
  private progressNum = 0;
  private progressDen = 0;

  constructor(deps: PersistenceDeps) {
    this.db = deps.db;
    this.store = deps.store;
    this.writer = deps.writer;
    this.now = deps.now ?? Date.now;
    this.bootMs = deps.bootMs ?? this.now();
    this.sleep = deps.sleep ?? defaultSleep;
    this.log = deps.log ?? ((m) => console.log(m));
    this.legacyWid = this.store.writerIdOf('legacy:lightning_chunks');
  }

  // --- SAVE -----------------------------------------------------------------

  /** Cut every own segment's unqueued records into pending rows (with fresh seqs). */
  private formRows(): void {
    const now = this.now();
    this.lastFormAt = now;
    for (const seg of this.store.ownSegments()) {
      if (seg.queuedN >= seg.n) continue;
      const from = seg.queuedN;
      const to = seg.n;
      let minT = Infinity;
      let maxT = -Infinity;
      for (let i = from; i < to; i++) {
        const tick = seg.baseTick + tOffOf(seg.words[2 * i], seg.words[2 * i + 1]);
        if (tick < minT) minT = tick;
        if (tick > maxT) maxT = tick;
      }
      const data = encodeRow(seg.words, from, to);
      this.pending.push({
        seq: this.nextSeq++,
        tFirst: minT * 10,
        tLast: maxT * 10,
        n: to - from,
        baseTick: seg.baseTick,
        data,
        seg,
        endN: to,
      });
      this.pendingBytes += data.length;
      seg.queuedN = to;
    }
    // A long outage: bound memory, drop the OLDEST queued rows, and say so.
    let dropped = 0;
    while (this.pendingBytes > MAX_PENDING_BYTES && this.pending.length > 1) {
      const row = this.pending.shift()!;
      this.pendingBytes -= row.data.length;
      this.droppedUnsaved += row.n;
      dropped += row.n;
    }
    if (dropped > 0) {
      this.log(`[lightning] save backlog over ${MAX_PENDING_BYTES >> 20} MB — dropped ${dropped} unsaved strikes (${this.droppedUnsaved} total)`);
    }
  }

  /** One save tick: queue new records, then insert everything pending in order. Single-flight. */
  save(): Promise<void> {
    if (this.saving) return this.saving;
    this.saving = this.saveNow().finally(() => {
      this.saving = null;
    });
    return this.saving;
  }

  private async saveNow(): Promise<void> {
    this.formRows();
    while (this.pending.length > 0) {
      const batch = this.pending.slice(0, ROWS_PER_INSERT);
      const values: string[] = [];
      const params: unknown[] = [];
      batch.forEach((r, i) => {
        const b = i * 7;
        values.push(`($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7})`);
        params.push(this.writer, r.seq, r.tFirst, r.tLast, r.n, r.baseTick, r.data);
      });
      try {
        await this.db.query(
          `INSERT INTO lightning_blocks (writer, seq, t_first, t_last, n, base_tick, data) VALUES ${values.join(', ')} ` +
            'ON CONFLICT (writer, seq) DO NOTHING',
          params
        );
      } catch (err) {
        // The rows stay queued with the SAME seqs: if the insert actually
        // committed and only the ack was lost, the retry is a no-op.
        if (this.lastSaveOk || this.lastError !== errMsg(err)) {
          this.log(`[lightning] save failed (${this.pending.length} rows queued): ${errMsg(err)}`);
        }
        this.lastSaveOk = false;
        this.lastError = errMsg(err);
        return;
      }
      // Only formRows (inside this single-flight save) trims the queue, so the
      // head is still exactly this batch.
      this.pending.splice(0, batch.length);
      for (const r of batch) {
        this.pendingBytes -= r.data.length;
        if (r.endN > r.seg.savedN) r.seg.savedN = r.endN;
        this.rowsSaved++;
        this.recordsSaved += r.n;
      }
      this.lastSaveAt = this.now();
      this.lastSaveOk = true;
      this.lastError = null;
    }
    const now = this.now();
    if (this.lastSaveOk && this.lastSaveAt !== null && (this.lastPruneAt === null || now - this.lastPruneAt >= DB_PRUNE_EVERY_MS)) {
      await this.pruneDb(now);
    }
  }

  private async pruneDb(now: number): Promise<void> {
    const cutoff = now - DB_KEEP_MS;
    try {
      await this.db.query('DELETE FROM lightning_blocks WHERE t_last < $1', [cutoff]);
      await this.db.query('DELETE FROM lightning_chunks WHERE chunk_start < $1', [cutoff]);
      this.lastPruneAt = now;
    } catch (err) {
      this.log(`[lightning] prune failed: ${errMsg(err)}`);
    }
  }

  /**
   * Save everything unsaved (waiting for an in-flight save first), bounded by
   * timeoutMs. Resolves true when nothing is left pending.
   */
  async flushAll(timeoutMs: number): Promise<boolean> {
    const work = (async () => {
      if (this.saving) await this.saving;
      await this.save();
    })();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, timeoutMs);
      timer.unref?.();
    });
    await Promise.race([work, timeout]);
    if (timer) clearTimeout(timer);
    return this.pending.length === 0 && this.store.ownSegments().every((s) => s.queuedN >= s.n);
  }

  status(now = this.now()): PersistStatus {
    let unqueued = 0;
    for (const s of this.store.ownSegments()) unqueued += s.n - s.queuedN;
    let pendingRecords = unqueued;
    for (const r of this.pending) pendingRecords += r.n;
    let oldestPendingAgeS: number | null = null;
    if (this.pending.length > 0) oldestPendingAgeS = Math.max(0, Math.round((now - this.pending[0].tFirst) / 1000));
    else if (unqueued > 0 && this.lastFormAt !== null) oldestPendingAgeS = Math.round((now - this.lastFormAt) / 1000);
    return {
      lastSaveAt: this.lastSaveAt,
      lastSaveOk: this.lastSaveOk,
      lastError: this.lastError,
      pendingRecords,
      oldestPendingAgeS,
      pendingRows: this.pending.length,
      pendingBytes: this.pendingBytes,
      droppedUnsaved: this.droppedUnsaved,
      rowsSaved: this.rowsSaved,
      recordsSaved: this.recordsSaved,
      nextSeq: this.nextSeq,
      lastPruneAt: this.lastPruneAt,
    };
  }

  // --- RESTORE --------------------------------------------------------------

  /** Load the other writers' last 24 h, then legacy history. Retries forever; idempotent. */
  restore(): Promise<void> {
    if (!this.restoreRun) this.restoreRun = this.runRestore();
    return this.restoreRun;
  }

  /** Stop retry loops (shutdown). */
  stop(): void {
    this.stopped = true;
  }

  restoreStatus(): RestoreStatus {
    return { ...this.rs, catchUps: [...this.rs.catchUps] };
  }

  get legacyBeforeMs(): number | null {
    return this.rs.legacyBeforeMs;
  }

  private async runRestore(): Promise<void> {
    const t0 = this.now();
    const cutoff = t0 - RETENTION_MS;
    const cache = new IdentityCache(this.store);
    let phase: 'plan' | 'blocks' | 'legacyPlan' | 'legacy' = 'plan';
    let cursor: { tLast: number; id: number } | null = null;
    let legacyCursor: { start: number; id: number } | null = null;
    let oldestV2Ms = this.bootMs;
    let retry = 0;
    this.rs.state = 'loading';

    while (!this.stopped) {
      this.rs.attempts++;
      try {
        if (phase === 'plan') {
          const { rows } = await this.db.query(
            'SELECT count(*) AS rows, COALESCE(sum(n), 0) AS strikes, min(t_first) AS t_first ' +
              'FROM lightning_blocks WHERE t_last >= $1 AND writer <> $2',
            [cutoff, this.writer]
          );
          const plan = rows[0] ?? {};
          this.progressDen = Number(plan.strikes ?? 0);
          this.log(
            `[lightning] restore: ${Number(plan.rows ?? 0)} rows, ${this.progressDen} strikes` +
              (plan.t_first != null ? ` back to ${new Date(Number(plan.t_first)).toISOString()}` : '')
          );
          phase = 'blocks';
        }

        while (phase === 'blocks') {
          const params: unknown[] = [cutoff, this.writer];
          let sql =
            'SELECT id, writer, t_first, t_last, n, base_tick, data FROM lightning_blocks ' +
            'WHERE t_last >= $1 AND writer <> $2';
          if (cursor) {
            sql += ' AND (t_last, id) < ($3, $4)';
            params.push(cursor.tLast, cursor.id);
          }
          sql += ` ORDER BY t_last DESC, id DESC LIMIT ${RESTORE_PAGE_ROWS}`;
          const { rows } = (await this.db.query(sql, params)) as { rows: BlockRow[] };
          if (this.stopped) return;
          if (rows.length === 0) {
            phase = 'legacyPlan';
            break;
          }
          for (const row of rows) this.ingestBlock(row, cutoff, cache);
          const last = rows[rows.length - 1];
          cursor = { tLast: Number(last.t_last), id: Number(last.id) };
          this.rs.backToMs = Math.max(cutoff, Math.min(this.rs.backToMs ?? Infinity, cursor.tLast));
          this.updateProgress();
          retry = 0;
          await yieldToLoop();
        }

        if (phase === 'legacyPlan') {
          // Legacy history only fills time the new table does not cover.
          const { rows } = await this.db.query('SELECT min(t_first) AS t_first FROM lightning_blocks WHERE t_last >= $1', [
            cutoff,
          ]);
          const minFirst = rows[0]?.t_first;
          oldestV2Ms = minFirst != null ? Math.min(Number(minFirst), this.bootMs) : this.bootMs;
          const { rows: lp } = await this.db.query(
            'SELECT count(*) AS rows, COALESCE(sum(n), 0) AS strikes FROM lightning_chunks ' +
              'WHERE chunk_start < $1 AND chunk_start >= $2',
            [oldestV2Ms, cutoff - LEGACY_STRADDLE_MS]
          );
          this.progressDen += Number(lp[0]?.strikes ?? 0);
          phase = 'legacy';
        }

        while (phase === 'legacy') {
          const params: unknown[] = [oldestV2Ms, cutoff - LEGACY_STRADDLE_MS];
          let sql = 'SELECT id, chunk_start, n, data FROM lightning_chunks WHERE chunk_start < $1 AND chunk_start >= $2';
          if (legacyCursor) {
            sql += ' AND (chunk_start, id) < ($3, $4)';
            params.push(legacyCursor.start, legacyCursor.id);
          }
          sql += ` ORDER BY chunk_start DESC, id DESC LIMIT ${RESTORE_PAGE_ROWS}`;
          const { rows } = (await this.db.query(sql, params)) as { rows: ChunkRow[] };
          if (this.stopped) return;
          if (rows.length === 0) break;
          for (const row of rows) this.ingestLegacy(row, cutoff, oldestV2Ms);
          const last = rows[rows.length - 1];
          legacyCursor = { start: Number(last.chunk_start), id: Number(last.id) };
          this.rs.backToMs = Math.max(cutoff, Math.min(this.rs.backToMs ?? Infinity, legacyCursor.start));
          this.updateProgress();
          retry = 0;
          await yieldToLoop();
        }

        if (this.rs.legacyStrikes > 0) this.rs.legacyBeforeMs = oldestV2Ms;
        this.rs.state = 'done';
        this.rs.progress = 1;
        this.rs.backToMs = cutoff;
        this.rs.lastError = null;
        this.rs.ms = this.now() - t0;
        this.log(
          `[lightning] restore done in ${(this.rs.ms / 1000).toFixed(1)} s: ${this.rs.rows} rows, ${this.rs.strikes} strikes` +
            ` (${this.rs.dupes} overlap dupes, ${this.rs.filtered} outside the window, ${this.rs.corruptRows} corrupt rows)` +
            (this.rs.legacyRows ? `; legacy ${this.rs.legacyRows} chunks → ${this.rs.legacyStrikes} strikes ×6` : '')
        );
        return;
      } catch (err) {
        this.rs.lastError = errMsg(err);
        this.rs.state = 'retrying';
        const wait = Math.min(60_000, 3_000 * 2 ** retry);
        retry++;
        this.log(`[lightning] restore attempt ${this.rs.attempts} failed (${this.rs.lastError}); retrying in ${wait / 1000} s`);
        await this.sleep(wait);
        if (!this.stopped) this.rs.state = 'loading';
      }
    }
  }

  private updateProgress(): void {
    const p = this.progressDen > 0 ? Math.min(0.99, this.progressNum / this.progressDen) : 0;
    this.rs.progress = Math.max(this.rs.progress, Math.round(p * 1000) / 1000);
  }

  /**
   * One lightning_blocks row into the store: skip it if already loaded, drop
   * strikes outside the window, and dedupe minutes another writer already
   * covered. A writer never repeats itself, so a minute only one writer has
   * touched needs no check; the first cross-writer strike marks the minute
   * MIXED, after which every strike into it is checked.
   */
  private ingestBlock(row: BlockRow, cutoff: number, cache: IdentityCache): void {
    const id = Number(row.id);
    if (this.loadedIds.has(id)) return;
    this.loadedIds.add(id);
    const n = Number(row.n);
    this.progressNum += n;
    let words: Uint32Array;
    try {
      words = decodeRow(row.data, n);
    } catch (err) {
      if (!(err instanceof CorruptRowError)) throw err;
      this.rs.corruptRows++;
      this.log(`[lightning] skipping corrupt row ${id}: ${err.message}`);
      return;
    }
    this.rs.rows++;
    const store = this.store;
    const wid = store.writerIdOf(String(row.writer));
    const base = Number(row.base_tick);
    const minTick = Math.ceil(cutoff / 10);
    const maxTick = Math.floor((this.now() + MAX_FUTURE_MS) / 10);
    for (let i = 0; i < n; i++) {
      const lo = words[2 * i];
      const hi = words[2 * i + 1];
      const tick = base + tOffOf(lo, hi);
      if (tick < minTick || tick > maxTick) {
        this.rs.filtered++;
        continue;
      }
      const latQ = latQOf(lo);
      const lonQ = lonQOf(hi);
      const minute = Math.floor(tick / TICKS_PER_MIN);
      const mark = store.writerMark(minute);
      if (mark !== 0 && mark !== wid) {
        const ids = cache.get(minute);
        const key = identityKey(tick - minute * TICKS_PER_MIN, latQ, lonQ);
        if (ids.has(key)) {
          this.rs.dupes++;
          continue;
        }
        if (mark !== MIXED_WRITER) store.setWriterMark(minute, MIXED_WRITER);
        store.appendImport(tick, latQ, lonQ, 1, wid);
        ids.add(key);
        cache.appended(minute);
      } else {
        if (mark === 0) store.setWriterMark(minute, wid);
        store.appendImport(tick, latQ, lonQ, 1, wid);
      }
      this.rs.strikes++;
    }
  }

  /** One pre-upgrade chunk: only strikes in [cutoff, oldestV2Ms), stored ×6 and flagged legacy. */
  private ingestLegacy(row: ChunkRow, cutoff: number, oldestV2Ms: number): void {
    const n = Number(row.n);
    this.progressNum += n;
    let s: { lat: Float32Array; lon: Float32Array; tMs: Float64Array };
    try {
      s = unpackStrikes(row.data, n);
    } catch (err) {
      this.rs.corruptRows++;
      this.log(`[lightning] skipping corrupt legacy chunk ${String(row.id)}: ${errMsg(err)}`);
      return;
    }
    this.rs.legacyRows++;
    for (let i = 0; i < n; i++) {
      const t = s.tMs[i];
      if (t < cutoff || t >= oldestV2Ms) continue;
      this.store.appendImport(tickOf(t), qLat(s.lat[i]), qLon(s.lon[i]), 6, this.legacyWid);
      this.rs.legacyStrikes++;
    }
  }

  // --- CATCH-UP -------------------------------------------------------------

  /**
   * Load other writers' rows that ended after boot − 15 min and were not
   * loaded yet: an old dyno's final flush lands after this dyno's restore has
   * passed that point when Heroku overlaps the two. Same dedupe path.
   */
  async catchUp(): Promise<{ rows: number; strikes: number; dupes: number }> {
    const at = this.now();
    const before = { rows: this.rs.rows, strikes: this.rs.strikes, dupes: this.rs.dupes };
    const record = (error: string | null) => {
      const r = {
        at,
        rows: this.rs.rows - before.rows,
        strikes: this.rs.strikes - before.strikes,
        dupes: this.rs.dupes - before.dupes,
        error,
      };
      this.rs.catchUps.push(r);
      if (this.rs.catchUps.length > 8) this.rs.catchUps.shift();
      return r;
    };
    try {
      const { rows } = await this.db.query('SELECT id FROM lightning_blocks WHERE t_last >= $1 AND writer <> $2', [
        this.bootMs - CATCH_UP_LOOKBACK_MS,
        this.writer,
      ]);
      const missing = rows.map((r: { id: string | number }) => Number(r.id)).filter((id: number) => !this.loadedIds.has(id));
      const cache = new IdentityCache(this.store);
      for (let i = 0; i < missing.length && !this.stopped; i += RESTORE_PAGE_ROWS) {
        const { rows: page } = (await this.db.query(
          'SELECT id, writer, t_first, t_last, n, base_tick, data FROM lightning_blocks WHERE id = ANY($1::bigint[]) ' +
            'ORDER BY t_last DESC, id DESC',
          [missing.slice(i, i + RESTORE_PAGE_ROWS)]
        )) as { rows: BlockRow[] };
        const cutoff = this.now() - RETENTION_MS;
        for (const row of page) this.ingestBlock(row, cutoff, cache);
        await yieldToLoop();
      }
      const r = record(null);
      this.log(`[lightning] catch-up: ${r.rows} new rows from other writers, ${r.strikes} strikes, ${r.dupes} overlap dupes`);
      return r;
    } catch (err) {
      const r = record(errMsg(err));
      this.log(`[lightning] catch-up failed: ${errMsg(err)}`);
      return r;
    }
  }
}

export function createPersistence(deps: PersistenceDeps): Persistence {
  return new Persistence(deps);
}
