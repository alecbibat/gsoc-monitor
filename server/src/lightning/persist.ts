// Postgres persistence for the strike store: survive restarts and deploys
// (the dyno filesystem is wiped on both, and Heroku cycles the dyno daily).
// What a boot restores is what earlier boots saved; the time no collector ran
// (the restart hole) is lost, and bootHole() measures it so coverage flags it.
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
//     collected (Heroku can overlap the old and new dyno) — with identity sets
//     of its own for those minutes, so evicting over capacity mid-restore
//     cannot hide a strike's first copy from the check.
//
// Each boot is its own writer (the bootId), so two overlapping dynos never
// collide on (writer, seq).

import { performance } from 'perf_hooks';
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
import { SLICE_MS, yieldToLoop } from './scan';
import type { StrikeStore } from './store';
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
const MIN_MS = 60_000;

interface PendingRow {
  seq: number;
  tFirst: number;
  tLast: number;
  n: number;
  baseTick: number;
  data: Buffer;
  /**
   * The segment's id, not the segment: a row can stay pending through a long
   * outage, and a reference would pin an evicted segment's 128 KB buffer.
   */
  segId: number;
  endN: number;
}

// pg returns BIGINT (and count/sum) as strings: always Number() them.
interface BlockRow {
  id: string | number;
  writer: string;
  t_first: string | number;
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
  /** End of the newest minute filled from pre-upgrade history (strikes before it may be ×6 estimates). */
  legacyBeforeMs: number | null;
  catchUps: { at: number; rows: number; strikes: number; dupes: number; error: string | null }[];
  /** The restart hole this boot left, once the restore is done (see bootHole()). */
  bootHole: { fromMs: number; toMs: number } | null;
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
  /** Bound on queued-but-unsaved row bytes (tests lower it). */
  maxPendingBytes?: number;
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
 *
 * Rebuilding reads the store, which the restore keeps inside its capacity by
 * evicting the oldest records at every page end. So for the minutes where two
 * writers overlap (known up front from each writer's span) the sets are
 * PINNED instead: built at the first strike restored into the minute, filled
 * with every strike restored after it, only ever added to from the store, and
 * dropped once the restore's cursor has passed the minute.
 */
class IdentityCache {
  private sets = new Map<number, { ids: Set<number>; expected: number }>();
  private pinned = new Map<number, { ids: Set<number>; expected: number }>();
  private pins = new Set<number>();
  private pinLo = Infinity;
  private pinHi = -Infinity;
  constructor(private store: StrikeStore) {}

  pin(minutes: Set<number>): void {
    this.pins = minutes;
    for (const m of minutes) {
      if (m < this.pinLo) this.pinLo = m;
      if (m > this.pinHi) this.pinHi = m;
    }
  }

  /** Does [m0, m1] hold a pinned minute? (Checked once per row, so the per-strike path stays cheap.) */
  touchesPinned(m0: number, m1: number): boolean {
    if (m1 < this.pinLo || m0 > this.pinHi) return false;
    for (let m = Math.max(m0, this.pinLo); m <= Math.min(m1, this.pinHi); m++) if (this.pins.has(m)) return true;
    return false;
  }

  isPinned(minute: number): boolean {
    return this.pins.has(minute);
  }

  get(minute: number): Set<number> {
    const count = this.store.minuteCount(minute);
    if (this.pins.has(minute)) {
      let p = this.pinned.get(minute);
      if (!p) {
        p = { ids: this.store.identitiesForMinute(minute), expected: count };
        this.pinned.set(minute, p);
      } else if (p.expected !== count) {
        // Live ingest added strikes: take them in, but keep every identity
        // restored earlier, even one whose record has been evicted since.
        for (const id of this.store.identitiesForMinute(minute)) p.ids.add(id);
        p.expected = count;
      }
      return p.ids;
    }
    let e = this.sets.get(minute);
    if (!e || e.expected !== count) {
      e = { ids: this.store.identitiesForMinute(minute), expected: count };
      this.sets.delete(minute);
      this.sets.set(minute, e);
      if (this.sets.size > ID_CACHE_MINUTES) this.sets.delete(this.sets.keys().next().value as number);
    }
    return e.ids;
  }

  /** The restore appended one weight-1 strike (identity `key`) to a minute. */
  appended(minute: number, key: number): void {
    if (this.pins.has(minute) && !this.pinned.has(minute)) {
      this.get(minute); // the first strike restored into a pinned minute: the store holds it
      return;
    }
    const e = this.pinned.get(minute) ?? this.sets.get(minute);
    if (e) {
      e.ids.add(key);
      e.expected += 1;
    }
  }

  /** The restore's cursor is at tLastMs: no row still to come holds a strike in a later minute. */
  passed(tLastMs: number): void {
    for (const m of this.pinned.keys()) if (m * MIN_MS > tLastMs) this.pinned.delete(m);
  }
}

/**
 * Minutes in which two writers' spans overlap (inclusive, by minute): the
 * minutes where the restore's dedupe actually compares identities.
 */
export function overlapMinutes(spans: { fromMs: number; toMs: number }[]): Set<number> {
  const out = new Set<number>();
  for (let i = 0; i < spans.length; i++) {
    for (let j = i + 1; j < spans.length; j++) {
      const a = Math.max(spans[i].fromMs, spans[j].fromMs);
      const b = Math.min(spans[i].toMs, spans[j].toMs);
      for (let m = Math.floor(a / MIN_MS); m <= Math.floor(b / MIN_MS); m++) out.add(m);
    }
  }
  return out;
}

export class Persistence {
  private readonly db: Queryable;
  private readonly store: StrikeStore;
  readonly writer: string;
  private readonly now: () => number;
  readonly bootMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly maxPendingBytes: number;
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
  /** Newest minute filled from legacy chunks (-1: none). */
  private newestLegacyMinute = -1;
  /** Newest strike another writer saved (or the pre-upgrade collector kept) before this boot's first live strike. */
  private otherEndMs: number | null = null;
  private rs: Omit<RestoreStatus, 'bootHole'> = {
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
    this.maxPendingBytes = deps.maxPendingBytes ?? MAX_PENDING_BYTES;
    this.log = deps.log ?? ((m) => console.log(m));
    this.legacyWid = this.store.writerIdOf('legacy:lightning_chunks');
    // Until the first save, unsaved strikes are as old as the boot.
    this.lastFormAt = this.bootMs;
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
        segId: seg.id,
        endN: to,
      });
      this.pendingBytes += data.length;
      seg.queuedN = to;
    }
    // A long outage: bound memory, drop the OLDEST queued rows, and say so.
    let dropped = 0;
    while (this.pendingBytes > this.maxPendingBytes && this.pending.length > 1) {
      const row = this.pending.shift()!;
      this.pendingBytes -= row.data.length;
      this.droppedUnsaved += row.n;
      dropped += row.n;
    }
    if (dropped > 0) {
      this.log(
        `[lightning] save backlog over ${Math.round(this.maxPendingBytes / 1_048_576)} MB — ` +
          `dropped the oldest ${dropped} unsaved strikes (${this.droppedUnsaved} this boot)`
      );
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
      const own = new Map(this.store.ownSegments().map((g) => [g.id, g]));
      for (const r of batch) {
        this.pendingBytes -= r.data.length;
        const seg = own.get(r.segId); // gone if evicted meanwhile
        if (seg && r.endN > seg.savedN) seg.savedN = r.endN;
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
    return { ...this.rs, catchUps: [...this.rs.catchUps], bootHole: this.bootHole() };
  }

  /**
   * The restart hole: from the newest strike any earlier writer saved before
   * this process's first live strike, to that strike. Nobody collected in
   * between (a dyno overlapping this one saved rows reaching past it, which
   * closes the hole — a late final flush found by catch-up does so too).
   * Known once the restore is done; null when there is none, or when no
   * history at all precedes this boot (the empty minutes say that already).
   */
  bootHole(): { fromMs: number; toMs: number } | null {
    const first = this.store.firstLiveMs;
    if (this.rs.state !== 'done' || first === null || this.otherEndMs === null || this.otherEndMs >= first) return null;
    return { fromMs: this.otherEndMs, toMs: first };
  }

  /** A row or legacy strike of another writer spanning [fromMs, toMs]: it covered up to toMs. */
  private covered(fromMs: number, toMs: number): void {
    const first = this.store.firstLiveMs;
    // Only what began before this boot's own coverage: an overlapping dyno's
    // later rows say nothing about a hole behind this boot's first strike.
    if (first !== null && fromMs >= first) return;
    if (this.otherEndMs === null || toMs > this.otherEndMs) this.otherEndMs = toMs;
  }

  get legacyBeforeMs(): number | null {
    return this.rs.legacyBeforeMs;
  }

  private async runRestore(): Promise<void> {
    const t0 = this.now();
    let cutoff = t0 - RETENTION_MS;
    const cache = new IdentityCache(this.store);
    let phase: 'plan' | 'blocks' | 'legacyPlan' | 'legacy' = 'plan';
    let cursor: { tLast: number; id: number } | null = null;
    let legacyCursor: { start: number; id: number } | null = null;
    let retry = 0;
    this.rs.state = 'loading';

    while (!this.stopped) {
      this.rs.attempts++;
      // A restore that spent a long outage retrying should not load what has since expired.
      cutoff = Math.max(cutoff, this.now() - RETENTION_MS);
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
          // Where writers overlap (a restart Heroku ran both dynos through,
          // and this boot's own live strikes), identities are compared.
          const { rows: spans } = await this.db.query(
            'SELECT writer, min(t_first) AS t_first, max(t_last) AS t_last FROM lightning_blocks ' +
              'WHERE t_last >= $1 AND writer <> $2 GROUP BY writer',
            [cutoff, this.writer]
          );
          const selfFrom = Math.min(this.bootMs, this.store.firstLiveMs ?? Infinity) - MIN_MS;
          cache.pin(
            overlapMinutes([
              ...spans.map((r: { t_first: string | number; t_last: string | number }) => ({
                fromMs: Number(r.t_first),
                toMs: Number(r.t_last),
              })),
              { fromMs: selfFrom, toMs: Infinity },
            ])
          );
          phase = 'blocks';
          this.rs.state = 'loading';
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
          await this.eachSliced(rows, (row) => this.ingestBlock(row, cutoff, cache));
          const last = rows[rows.length - 1];
          cursor = { tLast: Number(last.t_last), id: Number(last.id) };
          cache.passed(cursor.tLast);
          this.rs.backToMs = Math.max(cutoff, Math.min(this.rs.backToMs ?? Infinity, cursor.tLast));
          this.updateProgress();
          this.rs.state = 'loading';
          retry = 0;
        }

        if (phase === 'legacyPlan') {
          // Legacy history only fills minutes the new table does not cover —
          // wherever they are: a rollback to the pre-upgrade release writes
          // chunks between new-format hours.
          const { rows: lp } = await this.db.query(
            'SELECT count(*) AS rows, COALESCE(sum(n), 0) AS strikes FROM lightning_chunks ' +
              'WHERE chunk_start < $1 AND chunk_start >= $2',
            [this.bootMs, cutoff - LEGACY_STRADDLE_MS]
          );
          this.progressDen += Number(lp[0]?.strikes ?? 0);
          phase = 'legacy';
        }

        while (phase === 'legacy') {
          const params: unknown[] = [this.bootMs, cutoff - LEGACY_STRADDLE_MS];
          let sql = 'SELECT id, chunk_start, n, data FROM lightning_chunks WHERE chunk_start < $1 AND chunk_start >= $2';
          if (legacyCursor) {
            sql += ' AND (chunk_start, id) < ($3, $4)';
            params.push(legacyCursor.start, legacyCursor.id);
          }
          sql += ` ORDER BY chunk_start DESC, id DESC LIMIT ${RESTORE_PAGE_ROWS}`;
          const { rows } = (await this.db.query(sql, params)) as { rows: ChunkRow[] };
          if (this.stopped) return;
          if (rows.length === 0) break;
          await this.eachSliced(rows, (row) => this.ingestLegacy(row, cutoff));
          const last = rows[rows.length - 1];
          legacyCursor = { start: Number(last.chunk_start), id: Number(last.id) };
          this.rs.backToMs = Math.max(cutoff, Math.min(this.rs.backToMs ?? Infinity, legacyCursor.start));
          this.updateProgress();
          this.rs.state = 'loading';
          retry = 0;
        }

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
        // Stay 'retrying' through the next attempt: flipping back to 'loading'
        // before it succeeds made every status poll during a database outage
        // alternate between "unavailable" and "loading 0%".
        await this.sleep(wait);
      }
    }
  }

  /**
   * Ingest a page row by row, handing the event loop back whenever a slice is
   * used up (a page of dense rows is ~300k strikes at 200/s), and keep the
   * store inside its capacity as history arrives. Rows are atomic: the dedupe
   * state never sees half a row.
   */
  private async eachSliced<T>(rows: T[], ingest: (row: T) => void): Promise<void> {
    let t0 = performance.now();
    for (const row of rows) {
      ingest(row);
      if (performance.now() - t0 >= SLICE_MS) {
        await yieldToLoop();
        t0 = performance.now();
      }
    }
    // Restoring runs newest → oldest, so anything over capacity is the oldest
    // just restored; it is evicted but stays in the per-minute counts (the
    // ring keeps it), and the pinned identity sets keep the dedupe exact.
    this.store.enforceCapacity();
    await yieldToLoop();
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
    this.covered(Number(row.t_first), Number(row.t_last));
    const store = this.store;
    const wid = store.writerIdOf(String(row.writer));
    const base = Number(row.base_tick);
    const minTick = Math.ceil(cutoff / 10);
    const maxTick = Math.floor((this.now() + MAX_FUTURE_MS) / 10);
    const pinRow = cache.touchesPinned(Math.floor(Number(row.t_first) / MIN_MS), Math.floor(Number(row.t_last) / MIN_MS));
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
        cache.appended(minute, key);
      } else {
        if (mark === 0) store.setWriterMark(minute, wid);
        store.appendImport(tick, latQ, lonQ, 1, wid);
        // The first writer into an overlap minute: remember its identities
        // for the other writer's rows, which may come after an eviction.
        if (pinRow && cache.isPinned(minute)) cache.appended(minute, identityKey(tick - minute * TICKS_PER_MIN, latQ, lonQ));
      }
      this.rs.strikes++;
    }
  }

  /**
   * One pre-upgrade chunk: only strikes in [cutoff, boot) whose minute no
   * new-format writer covered (live and restored strikes mark their minute,
   * legacy imports do not), stored ×6 and flagged legacy.
   */
  private ingestLegacy(row: ChunkRow, cutoff: number): void {
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
      if (t < cutoff || t >= this.bootMs) continue;
      this.covered(t, t);
      const tick = tickOf(t);
      const minute = Math.floor(tick / TICKS_PER_MIN);
      if (this.store.writerMark(minute) !== 0) continue;
      this.store.appendImport(tick, qLat(s.lat[i]), qLon(s.lon[i]), 6, this.legacyWid);
      this.rs.legacyStrikes++;
      if (minute > this.newestLegacyMinute) this.newestLegacyMinute = minute;
    }
    if (this.newestLegacyMinute >= 0) this.rs.legacyBeforeMs = (this.newestLegacyMinute + 1) * MIN_MS;
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
        await this.eachSliced(page, (row) => this.ingestBlock(row, cutoff, cache));
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
