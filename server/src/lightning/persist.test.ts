import { describe, expect, it } from 'vitest';
import { encodeRow } from './codec';
import { RETENTION_MS, ROWS_PER_INSERT, SEG_CAP } from './constants';
import { packStrikes } from './legacyCodec';
import { createPersistence } from './persist';
import { dqLat, dqLon, qLat, qLon } from './quant';
import { BASE_LEAD_TICKS, StrikeStore, packHi, packLo, recordAt } from './store';
import { FakeDb, type Rec, genStrikes } from './testkit';

const NOW = Date.UTC(2026, 8, 24, 12, 0, 0);
const H = 3_600_000;
const MIN = 60_000;

const mkStore = (writer: string, now = () => NOW) => new StrikeStore({ capacity: 50_000_000, selfWriter: writer, now });
const noSleep = async () => {};

function contents(s: StrikeStore): string[] {
  const snap = s.snapshot();
  const out: string[] = [];
  for (const { seg, n } of snap.segs) {
    for (let i = 0; i < n; i++) {
      const r = recordAt(seg.words, seg.baseTick, i);
      out.push(`${r.tick}:${r.latQ}:${r.lonQ}:${seg.weight}`);
    }
  }
  snap.release();
  return out.sort();
}
const keysOf = (recs: Rec[], w = 1) => recs.map((r) => `${r.tick}:${r.latQ}:${r.lonQ}:${w}`).sort();

/** A lightning_blocks row built by hand (exact control over writer, seq and contents). */
function block(writer: string, seq: number, recs: Rec[]) {
  const ticks = recs.map((r) => r.tick);
  const base = Math.max(...ticks) - BASE_LEAD_TICKS;
  const words = new Uint32Array(2 * recs.length);
  recs.forEach((r, i) => {
    words[2 * i] = packLo(r.latQ, r.tick - base);
    words[2 * i + 1] = packHi(r.lonQ, r.tick - base);
  });
  return {
    writer,
    seq,
    t_first: Math.min(...ticks) * 10,
    t_last: Math.max(...ticks) * 10,
    n: recs.length,
    base_tick: base,
    data: encodeRow(words, 0, recs.length),
  };
}

describe('save', () => {
  it('writes each new run of records once, with ON CONFLICT, and marks it saved only after the insert', async () => {
    const db = new FakeDb();
    const s = mkStore('A');
    const p = createPersistence({ db, store: s, writer: 'A', now: () => NOW });
    const recs = genStrikes({ n: SEG_CAP + 100, nowMs: NOW, spanMs: 10 * MIN, seed: 1 });
    for (const r of recs) s.appendLive(r.tick, r.latQ, r.lonQ);
    await p.save();
    const inserts = db.log.filter((l) => l.sql.startsWith('INSERT'));
    expect(inserts).toHaveLength(1);
    expect(inserts[0].sql).toContain('ON CONFLICT (writer, seq) DO NOTHING');
    expect(db.blocks.map((b) => [b.writer, b.seq, b.n])).toEqual([
      ['A', 0, SEG_CAP],
      ['A', 1, 100],
    ]);
    expect(s.ownSegments().map((g) => [g.savedN, g.queuedN, g.n])).toEqual([
      [SEG_CAP, SEG_CAP, SEG_CAP],
      [100, 100, 100],
    ]);
    // Nothing new → no insert. Then only the new tail.
    await p.save();
    expect(db.log.filter((l) => l.sql.startsWith('INSERT'))).toHaveLength(1);
    s.appendLive(NOW / 10, 1, 2);
    await p.save();
    expect(db.blocks.at(-1)).toMatchObject({ seq: 2, n: 1, t_first: NOW, t_last: NOW });
    // Pruning follows a successful save (at most every 10 min).
    expect(db.log.filter((l) => l.sql.startsWith('DELETE'))).toHaveLength(2);
    expect(p.status().pendingRecords).toBe(0);
    expect(p.status().lastSaveOk).toBe(true);
  });

  it('retries a failed insert with the SAME seqs, so a lost ack cannot duplicate rows', async () => {
    const db = new FakeDb();
    const s = mkStore('A');
    const p = createPersistence({ db, store: s, writer: 'A', now: () => NOW, log: () => {} });
    s.appendLive(NOW / 10 - 100, 5, 5);
    // The insert commits, but the ack is lost.
    db.failWhen = (sql) => (sql.startsWith('INSERT') ? { err: new Error('connection reset'), after: true } : null);
    await p.save();
    expect(p.status()).toMatchObject({ lastSaveOk: false, lastError: 'connection reset', pendingRecords: 1, pendingRows: 1 });
    expect(s.ownSegments()[0].savedN).toBe(0);
    expect(db.blocks).toHaveLength(1);
    db.failWhen = null;
    s.appendLive(NOW / 10 - 50, 6, 6);
    await p.save();
    const inserts = db.log.filter((l) => l.sql.startsWith('INSERT'));
    expect(inserts).toHaveLength(2);
    expect(inserts[1].params.filter((_, i) => i % 7 === 1)).toEqual([0, 1]); // seq 0 again, then 1
    expect(db.blocks.map((b) => b.seq)).toEqual([0, 1]); // no duplicate
    expect(s.ownSegments()[0].savedN).toBe(2);
    expect(p.status()).toMatchObject({ lastSaveOk: true, pendingRecords: 0, lastError: null });
  });

  it('never thins: 100k strikes queued through an outage are all saved, ≤ 20 rows per INSERT', async () => {
    const db = new FakeDb();
    const s = mkStore('A');
    const p = createPersistence({ db, store: s, writer: 'A', now: () => NOW, log: () => {} });
    db.failWhen = (sql) => (sql.startsWith('INSERT') ? { err: new Error('db down') } : null);
    const recs = genStrikes({ n: 100_000, nowMs: NOW, spanMs: 60 * MIN, seed: 2 });
    // 30 save ticks during the outage, each queueing new rows.
    for (let k = 0; k < 30; k++) {
      for (let i = k * 3_334; i < Math.min(recs.length, (k + 1) * 3_334); i++) s.appendLive(recs[i].tick, recs[i].latQ, recs[i].lonQ);
      await p.save();
    }
    expect(p.status().pendingRecords).toBe(100_000);
    expect(p.status().oldestPendingAgeS).toBeGreaterThan(0);
    db.failWhen = null;
    await p.save();
    expect(db.blocks.reduce((a, b) => a + b.n, 0)).toBe(100_000);
    const ok = db.log.filter((l) => l.sql.startsWith('INSERT')).slice(-3);
    for (const l of ok) expect(l.params.length / 7).toBeLessThanOrEqual(ROWS_PER_INSERT);
    expect(p.status()).toMatchObject({ pendingRecords: 0, droppedUnsaved: 0 });
    // The seqs are contiguous: nothing was re-cut or skipped.
    expect(db.blocks.map((b) => b.seq)).toEqual(db.blocks.map((_, i) => i));
  });

  it('bounds the queue through a long outage by dropping the OLDEST rows, and counts them', async () => {
    const db = new FakeDb();
    const s = mkStore('A');
    const logs: string[] = [];
    const p = createPersistence({ db, store: s, writer: 'A', now: () => NOW, log: (m) => logs.push(m), maxPendingBytes: 40_000 });
    db.failWhen = (sql) => (sql.startsWith('INSERT') ? { err: new Error('db down') } : null);
    const recs = genStrikes({ n: 20_000, nowMs: NOW, spanMs: 60 * MIN, seed: 3 });
    for (let k = 0; k < 10; k++) {
      for (const r of recs.slice(k * 2_000, (k + 1) * 2_000)) s.appendLive(r.tick, r.latQ, r.lonQ);
      await p.save();
    }
    const st = p.status();
    expect(st.droppedUnsaved).toBeGreaterThan(0);
    expect(st.pendingBytes).toBeLessThanOrEqual(40_000);
    expect(st.pendingRecords + st.droppedUnsaved).toBe(20_000);
    expect(logs.some((l) => l.includes('dropped the oldest'))).toBe(true);
    db.failWhen = null;
    await p.save();
    // What survived is the newest run of rows, in order.
    const seqs = db.blocks.map((b) => b.seq);
    const next = p.status().nextSeq;
    expect(seqs).toEqual(Array.from({ length: seqs.length }, (_, i) => next - seqs.length + i));
    expect(seqs.length).toBeLessThan(next);
    expect(db.blocks.reduce((a, b) => a + b.n, 0)).toBe(20_000 - st.droppedUnsaved);
  });

  it('a pending row does not hold on to its segment, so an evicted segment’s buffer can be freed', async () => {
    const db = new FakeDb();
    const s = mkStore('A');
    const p = createPersistence({ db, store: s, writer: 'A', now: () => NOW, log: () => {} });
    db.failWhen = (sql) => (sql.startsWith('INSERT') ? { err: new Error('db down') } : null);
    for (const r of genStrikes({ n: SEG_CAP + 100, nowMs: NOW, spanMs: 10 * MIN, seed: 31 })) s.appendLive(r.tick, r.latQ, r.lonQ);
    await p.save();
    const [first, open] = s.ownSegments();
    s.setCapacity(1_000);
    s.enforceCapacity(); // the memory guard evicts the full own segment while its row is pending
    expect(s.ownSegments()).toEqual([open]);
    /** Anything reachable from a pending row that is the evicted segment or its buffer. */
    const reaches = (v: unknown, depth = 0): boolean => {
      if (v === first || v === first.words || v === first.words.buffer) return true;
      if (depth > 3 || v === null || typeof v !== 'object' || Buffer.isBuffer(v)) return false;
      return Object.values(v).some((x) => reaches(x, depth + 1));
    };
    const pending = (p as unknown as { pending: object[] }).pending;
    expect(pending).toHaveLength(2);
    expect(pending.some((row) => reaches(row))).toBe(false);
    // The rows still carry their data, and only the segment still held is marked saved.
    db.failWhen = null;
    await p.save();
    expect(db.blocks.map((b) => b.n)).toEqual([SEG_CAP, 100]);
    expect(open.savedN).toBe(100);
    expect(first.savedN).toBe(0);
  });

  it('flushAll saves everything and is bounded when the database hangs', async () => {
    const db = new FakeDb();
    const s = mkStore('A');
    const p = createPersistence({ db, store: s, writer: 'A', now: () => NOW });
    s.appendLive(NOW / 10, 1, 1);
    expect(await p.flushAll(1_000)).toBe(true);
    s.appendLive(NOW / 10 + 1, 1, 1);
    db.hang = true;
    const t0 = Date.now();
    expect(await p.flushAll(100)).toBe(false);
    expect(Date.now() - t0).toBeLessThan(1_000);
  });
});

describe('restore', () => {
  /** Writer A's day, saved in `rows` separate saves (one row per save and segment). */
  async function writerDay(db: FakeDb, writer: string, recs: Rec[], rows: number): Promise<void> {
    const s = mkStore(writer);
    const p = createPersistence({ db, store: s, writer, now: () => NOW });
    const sorted = recs.slice().sort((a, b) => a.tick - b.tick);
    const per = Math.ceil(sorted.length / rows);
    for (let i = 0; i < sorted.length; i += per) {
      for (const r of sorted.slice(i, i + per)) s.appendLive(r.tick, r.latQ, r.lonQ);
      await p.save();
    }
  }

  it('pages newest first with a (t_last, id) cursor and restores every strike', async () => {
    const db = new FakeDb();
    const recs = genStrikes({ n: 30_000, nowMs: NOW, spanMs: 23 * H, seed: 4 });
    await writerDay(db, 'A', recs, 60);
    const c = mkStore('C');
    const p = createPersistence({ db, store: c, writer: 'C', now: () => NOW, sleep: noSleep, log: () => {} });
    await p.restore();
    const pages = db.log.filter((l) => l.sql.startsWith('SELECT id, writer'));
    expect(pages.length).toBeGreaterThanOrEqual(3);
    expect(pages[0].sql).not.toContain('(t_last, id) <');
    expect(pages[0].sql).toContain('ORDER BY t_last DESC, id DESC LIMIT 25');
    // Each later page continues from the previous page's last row.
    const sortedRows = db.blocks.slice().sort((a, b) => b.t_last - a.t_last || b.id - a.id);
    expect(pages[1].params.slice(2)).toEqual([sortedRows[24].t_last, sortedRows[24].id]);
    expect(pages[2].params.slice(2)).toEqual([sortedRows[49].t_last, sortedRows[49].id]);
    expect(contents(c)).toEqual(keysOf(recs));
    const rs = p.restoreStatus();
    expect(rs).toMatchObject({ state: 'done', progress: 1, rows: db.blocks.length, strikes: 30_000, dupes: 0, attempts: 1 });
    expect(rs.backToMs).toBe(NOW - RETENTION_MS);
    // Restored strikes are counted per minute like live ones.
    expect(c.countsWindow(NOW, 1440).sum).toBe(30_000);
  });

  it('retries forever from its cursor while live ingest continues', async () => {
    const db = new FakeDb();
    const recs = genStrikes({ n: 20_000, nowMs: NOW, spanMs: 20 * H, seed: 6 });
    await writerDay(db, 'A', recs, 80);
    const c = mkStore('C');
    const waits: number[] = [];
    let pageCalls = 0;
    db.failWhen = (sql) => {
      if (!sql.startsWith('SELECT id, writer')) return null;
      pageCalls++;
      // Page 1 works, then the database drops out for 4 attempts.
      return pageCalls >= 2 && pageCalls <= 5 ? { err: new Error(`outage ${pageCalls}`) } : null;
    };
    let live = 0;
    const p = createPersistence({
      db,
      store: c,
      writer: 'C',
      now: () => NOW,
      log: () => {},
      sleep: async (ms) => {
        waits.push(ms);
        expect(p.restoreStatus().state).toBe('retrying');
        c.appendLive(NOW / 10 + live, 1, ++live); // the collector keeps going
      },
    });
    await p.restore();
    expect(waits).toEqual([3_000, 6_000, 12_000, 24_000]);
    const rs = p.restoreStatus();
    expect(rs).toMatchObject({ state: 'done', attempts: 5, lastError: null, strikes: 20_000 });
    // Resumed from the cursor: page 2's query was retried with the same cursor, nothing loaded twice.
    const pages = db.log.filter((l) => l.sql.startsWith('SELECT id, writer'));
    expect(pages[1].params).toEqual(pages[5].params);
    expect(c.records).toBe(20_000 + live);
    expect(db.log.filter((l) => l.sql.startsWith('SELECT count(*) AS rows, COALESCE(sum(n), 0) AS strikes, min')).length).toBe(1);
  });

  it('keeps only the in-window part of a row that straddles the window start', async () => {
    const db = new FakeDb();
    const old = genStrikes({ n: 500, nowMs: NOW - RETENTION_MS, spanMs: 5 * MIN, seed: 8 }); // just before the cutoff
    const inside = genStrikes({ n: 700, nowMs: NOW - RETENTION_MS + 5 * MIN, spanMs: 4 * MIN, seed: 9 });
    db.addBlock(block('A', 0, [...old, ...inside]));
    const c = mkStore('C');
    const p = createPersistence({ db, store: c, writer: 'C', now: () => NOW, sleep: noSleep, log: () => {} });
    await p.restore();
    expect(contents(c)).toEqual(keysOf(inside));
    expect(p.restoreStatus()).toMatchObject({ strikes: 700, filtered: 500 });
  });

  it('dedupes minutes two writers both collected (restore and live), including a writer split over rows', async () => {
    const db = new FakeDb();
    const m = Math.floor((NOW - 2 * H) / MIN); // one minute two hours ago
    const r = (tq: number, lat: number): Rec => ({ tick: m * 6000 + tq, latQ: qLat(lat), lonQ: qLon(-97) });
    const [a1, a2, a3, b1, x1] = [r(100, 35.1), r(200, 35.2), r(300, 35.3), r(400, 35.4), r(500, 35.5)];
    // A's minute is split over two rows; B saw a2 too (overlap), and b1 alone.
    db.addBlock(block('A', 0, [a1, a2]));
    db.addBlock(block('B', 0, [a2, b1, x1]));
    db.addBlock(block('A', 1, [a3, x1]));
    // Whatever order the pages come in (t_last desc: A1, B0, A0), no identity is stored twice.
    const c = mkStore('C');
    c.appendLive(a3.tick, a3.latQ, a3.lonQ); // this dyno's own collector also caught a3
    const p = createPersistence({ db, store: c, writer: 'C', now: () => NOW, sleep: noSleep, log: () => {} });
    await p.restore();
    expect(contents(c)).toEqual(keysOf([a1, a2, a3, b1, x1]));
    expect(p.restoreStatus().dupes).toBe(3); // a3 (live), x1 (A vs B), a2 (B vs A)
    expect(c.minuteCount(m)).toBe(5);
  });

  it('dedupes a realistic two-dyno overlap exactly', async () => {
    const db = new FakeDb();
    const all = genStrikes({ n: 40_000, nowMs: NOW, spanMs: 6 * H, seed: 12 });
    const cut1 = Math.floor((NOW - 4 * H) / 10);
    const cut2 = Math.floor((NOW - 3.5 * H) / 10);
    // A collected until cut2, B from cut1: 30 minutes both saw.
    await writerDay(db, 'A', all.filter((x) => x.tick < cut2), 30);
    await writerDay(db, 'B', all.filter((x) => x.tick >= cut1), 30);
    const c = mkStore('C');
    const p = createPersistence({ db, store: c, writer: 'C', now: () => NOW, sleep: noSleep, log: () => {} });
    await p.restore();
    const overlap = all.filter((x) => x.tick >= cut1 && x.tick < cut2).length;
    expect(overlap).toBeGreaterThan(1_000);
    expect(contents(c)).toEqual(keysOf(all));
    expect(p.restoreStatus().dupes).toBe(overlap);
  });

  it('dedupes exactly even when the store evicts over capacity between restore pages', async () => {
    const db = new FakeDb();
    const all = genStrikes({ n: 120_000, nowMs: NOW, spanMs: 12 * H, seed: 33 });
    const cut1 = Math.floor((NOW - 8 * H) / 10);
    const cut2 = Math.floor((NOW - 7.5 * H) / 10);
    // Rows of ~40 s each, so one overlap minute's rows from A and B land in different pages.
    await writerDay(db, 'A', all.filter((x) => x.tick < cut2), 600);
    await writerDay(db, 'B', all.filter((x) => x.tick >= cut1), 600);
    // Capacity well under the day: every page end evicts the oldest segments,
    // including the one holding the page's (oldest) overlap strikes.
    const c = new StrikeStore({ capacity: 3 * SEG_CAP, selfWriter: 'C', now: () => NOW });
    const p = createPersistence({ db, store: c, writer: 'C', now: () => NOW, sleep: noSleep, log: () => {} });
    await p.restore();
    const overlap = all.filter((x) => x.tick >= cut1 && x.tick < cut2).length;
    expect(overlap).toBeGreaterThan(4_000);
    expect(c.stats().evictedRecords).toBeGreaterThan(50_000);
    expect(p.restoreStatus().dupes).toBe(overlap);
    expect(c.countsWindow(NOW, 1440).sum).toBe(all.length); // nothing counted twice
    for (let m = Math.floor(cut1 / 6_000); m <= Math.floor(cut2 / 6_000); m++) {
      expect(c.minuteCount(m)).toBe(all.filter((x) => Math.floor(x.tick / 6_000) === m).length);
    }
  });

  /** A pre-upgrade chunk: n strikes stepMs apart from startMs (lat varies, lon 20), and their stored times. */
  function chunk(startMs: number, n: number, stepMs: number) {
    const lat: number[] = [];
    const lon: number[] = [];
    const t: number[] = [];
    for (let i = 0; i < n; i++) {
      lat.push(10 + i * 0.01);
      lon.push(20);
      t.push(startMs + i * stepMs);
    }
    // The format keeps whole seconds.
    return { chunk_start: startMs, n, data: packStrikes(lat, lon, t), t: t.map((x) => Math.round(x / 1000) * 1000) };
  }
  const minuteOf = (ms: number) => Math.floor(ms / MIN);

  it('imports legacy chunks ×6 only into minutes no new-format writer covered', async () => {
    const db = new FakeDb();
    const v2 = genStrikes({ n: 1_000, nowMs: NOW, spanMs: 2 * H, seed: 13 }); // new rows cover the last 2 h
    await writerDay(db, 'A', v2, 4);
    const v2Minutes = new Set(v2.map((r) => minuteOf(r.tick * 10)));
    const oldestV2 = Math.min(...db.blocks.map((b) => b.t_first));
    const chunks = [
      chunk(NOW - 10 * H, 100, 3_000), // fully usable
      chunk(NOW - RETENTION_MS - 2 * MIN, 100, 3_000), // straddles the window start: 2 min are too old
      chunk(oldestV2 - 60_000, 100, 1_000), // straddles the first new row: only the minutes before it
      chunk(NOW - 30 * MIN, 50, 1_000), // inside new-format minutes: read, nothing imported
    ];
    for (const { t: _t, ...row } of chunks) db.addChunk(row);
    const imported = chunks.flatMap((ch) => ch.t).filter((t) => t >= NOW - RETENTION_MS && !v2Minutes.has(minuteOf(t)));
    const c = mkStore('C');
    const p = createPersistence({ db, store: c, writer: 'C', now: () => NOW, sleep: noSleep, log: () => {} });
    await p.restore();
    const rs = p.restoreStatus();
    expect(rs.legacyRows).toBe(4);
    expect(imported.length).toBeGreaterThan(160);
    expect(imported.length).toBeLessThan(220);
    expect(rs.legacyStrikes).toBe(imported.length);
    expect(imported.every((t) => t < oldestV2)).toBe(true);
    // The fidelity mark is the end of the newest minute actually filled from legacy history.
    expect(rs.legacyBeforeMs).toBe((minuteOf(Math.max(...imported)) + 1) * MIN);
    const legacy = c.segments().filter((g) => g.legacy);
    expect(legacy.reduce((a, g) => a + g.n, 0)).toBe(imported.length);
    expect(legacy.every((g) => g.weight === 6)).toBe(true);
    expect(c.countsWindow(NOW, 1440)).toEqual({ sum: 1_000 + 6 * imported.length, legacy: true });
    expect(c.countsWindow(NOW, 60).legacy).toBe(false);
    // Legacy coordinates were float32; quantizing them lands within a step.
    const one = recordAt(legacy[0].words, legacy[0].baseTick, 0);
    expect(Math.abs(dqLon(one.lonQ) - 20)).toBeLessThan(1e-3);
    expect(Math.abs(dqLat(one.latQ) - 10)).toBeLessThan(2);
  });

  it('fills a rollback: legacy chunks written between new-format hours are restored, not reported blind', async () => {
    const db = new FakeDb();
    // This release ran 20–10 h and 5–0 h ago; a rollback to the pre-upgrade
    // release wrote only lightning_chunks for 10–5 h ago.
    const before = genStrikes({ n: 3_000, nowMs: NOW - 10 * H, spanMs: 10 * H, seed: 41 });
    const after = genStrikes({ n: 3_000, nowMs: NOW, spanMs: 5 * H, seed: 42 });
    await writerDay(db, 'A', before, 20);
    await writerDay(db, 'B', after, 20);
    const chunks = Array.from({ length: 60 }, (_, k) => chunk(NOW - 10 * H + k * 5 * MIN, 30, 10_000));
    for (const { t: _t, ...row } of chunks) db.addChunk(row);
    const v2Minutes = new Set([...before, ...after].map((r) => minuteOf(r.tick * 10)));
    const imported = chunks.flatMap((ch) => ch.t).filter((t) => !v2Minutes.has(minuteOf(t)));
    const c = mkStore('C');
    const p = createPersistence({ db, store: c, writer: 'C', now: () => NOW, sleep: noSleep, log: () => {} });
    await p.restore();
    const rs = p.restoreStatus();
    expect(rs).toMatchObject({ legacyRows: 60, legacyStrikes: imported.length, strikes: 6_000 });
    expect(imported.length).toBeGreaterThan(1_750); // all but the minutes at the two edges
    expect(rs.legacyBeforeMs).toBe((minuteOf(Math.max(...imported)) + 1) * MIN);
    expect(rs.legacyBeforeMs).toBeLessThanOrEqual(NOW - 5 * H + MIN);
    expect(c.countsWindow(NOW, 1440)).toEqual({ sum: 6_000 + 6 * imported.length, legacy: true });
    expect(c.countsWindow(NOW, 4 * 60).legacy).toBe(false); // the last 4 h are all new-format: exact
    // Every minute of the rollback holds strikes: none of it reads as collector blind time.
    const blind = c.gaps(NOW, 1440, null).filter((g) => g.toMs > NOW - 10 * H + MIN && g.fromMs < NOW - 5 * H - MIN);
    expect(blind).toEqual([]);
  });

  it('catch-up loads rows an old dyno flushed after the restore passed, deduped against live', async () => {
    const db = new FakeDb();
    const boot = NOW;
    let now = boot;
    const old = genStrikes({ n: 2_000, nowMs: boot - 10 * MIN, spanMs: 3 * H, seed: 14 });
    await writerDay(db, 'A', old, 5);
    const c = mkStore('C', () => now);
    const p = createPersistence({ db, store: c, writer: 'C', now: () => now, bootMs: boot, sleep: noSleep, log: () => {} });
    await p.restore();
    expect(c.records).toBe(2_000);
    // A kept collecting for 30 s after C booted, and C's collector saw the same strikes.
    const tail = genStrikes({ n: 300, nowMs: boot + 30_000, spanMs: 40_000, seed: 15 });
    for (const x of tail) if (x.tick >= boot / 10) c.appendLive(x.tick, x.latQ, x.lonQ);
    const seenLive = tail.filter((x) => x.tick >= boot / 10).length;
    db.addBlock(block('A', 99, tail)); // A's final flush lands late
    now = boot + 90_000;
    const r = await p.catchUp();
    expect(r).toMatchObject({ rows: 1, strikes: 300 - seenLive, dupes: seenLive, error: null });
    expect(c.records).toBe(2_000 + 300);
    // A second catch-up finds nothing new.
    now = boot + 300_000;
    expect(await p.catchUp()).toMatchObject({ rows: 0, strikes: 0 });
    expect(p.restoreStatus().catchUps).toHaveLength(2);
  });

  it('measures the restart hole to this boot’s first live strike; a late final flush reaching past it closes it', async () => {
    const db = new FakeDb();
    const boot = NOW;
    let now = boot;
    // The old dyno's last saved strike is 50 s before boot, this boot's first 30 s after:
    // an 80 s hole across a minute boundary, both minutes holding strikes.
    await writerDay(db, 'A', genStrikes({ n: 2_000, nowMs: boot - 50_000, spanMs: 2 * H, seed: 51 }), 5);
    const aLast = Math.max(...db.blocks.map((b) => b.t_last));
    const c = mkStore('C', () => now);
    const p = createPersistence({ db, store: c, writer: 'C', now: () => now, bootMs: boot, sleep: noSleep, log: () => {} });
    const first = boot + 30_000;
    c.appendLive(first / 10, qLat(35), qLon(-97));
    expect(p.bootHole()).toBeNull(); // not before the restore is done
    await p.restore();
    expect(p.restoreStatus().bootHole).toEqual({ fromMs: aLast, toMs: first });
    expect(c.gaps(boot + 60_000, 10, null, null, [p.bootHole()!])).toEqual([{ fromMs: aLast, toMs: first }]);
    // A was still collecting (Heroku ran both dynos): its final flush, found by catch-up, covers the hole.
    now = boot + 90_000;
    db.addBlock(block('A', 99, genStrikes({ n: 200, nowMs: boot + 40_000, spanMs: 80_000, seed: 52 })));
    await p.catchUp();
    expect(p.bootHole()).toBeNull();
  });

  it('reports no restart hole when nothing precedes the boot, or another writer’s rows reach past its first strike', async () => {
    const empty = mkStore('C');
    const p = createPersistence({ db: new FakeDb(), store: empty, writer: 'C', now: () => NOW, sleep: noSleep, log: () => {} });
    empty.appendLive(NOW / 10 + 100, 1, 1);
    await p.restore();
    expect(p.bootHole()).toBeNull();
    // An overlapping writer whose rows began before this boot's first strike and end after it.
    const db = new FakeDb();
    db.addBlock(block('A', 0, genStrikes({ n: 500, nowMs: NOW + 20_000, spanMs: 5 * MIN, seed: 53 })));
    const c = mkStore('C2', () => NOW + 30_000);
    c.appendLive(NOW / 10 + 500, 2, 2);
    const q = createPersistence({ db, store: c, writer: 'C2', now: () => NOW + 30_000, bootMs: NOW, sleep: noSleep, log: () => {} });
    await q.restore();
    expect(q.bootHole()).toBeNull();
  });

  it('skips and counts a corrupt row instead of failing the restore', async () => {
    const db = new FakeDb();
    const good = genStrikes({ n: 100, nowMs: NOW, spanMs: H, seed: 16 });
    db.addBlock(block('A', 0, good));
    db.addBlock({ ...block('A', 1, good.slice(0, 10)), n: 11 }); // n disagrees with the payload
    const c = mkStore('C');
    const p = createPersistence({ db, store: c, writer: 'C', now: () => NOW, sleep: noSleep, log: () => {} });
    await p.restore();
    expect(p.restoreStatus()).toMatchObject({ state: 'done', corruptRows: 1, strikes: 100 });
  });
});
