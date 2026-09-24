// Persistence against a real Postgres. Skipped unless LIGHTNING_PG_TEST_URL is
// set (CI runs `npm test` without a database). Locally:
//   PGPASSWORD=gsoc createdb -h localhost -U gsoc gsoc_lightning_test
//   LIGHTNING_PG_TEST_URL=postgres://gsoc:gsoc@localhost:5432/gsoc_lightning_test npm test -w server
// It runs the app's real migration first, then only touches the lightning tables.

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import { RETENTION_MS } from './constants';
import { packStrikes } from './legacyCodec';
import { createPersistence } from './persist';
import { StrikeStore, recordAt } from './store';
import { type Rec, genStrikes } from './testkit';

const URL = process.env.LIGHTNING_PG_TEST_URL;
const NOW = Date.now();
const H = 3_600_000;

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
const keysOf = (recs: Rec[]) => recs.map((r) => `${r.tick}:${r.latQ}:${r.lonQ}:1`).sort();
const mkStore = (w: string) => new StrikeStore({ capacity: 50_000_000, selfWriter: w, now: () => NOW });

describe.skipIf(!URL)('persistence on Postgres', () => {
  let pool: Pool;

  beforeAll(async () => {
    process.env.DATABASE_URL = URL;
    vi.resetModules();
    ({ pool } = await import('../db'));
    const { migrate } = await import('../migrate');
    await migrate();
    await migrate(); // idempotent
    await pool.query('DELETE FROM lightning_blocks');
    await pool.query('DELETE FROM lightning_chunks');
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
  });

  /** A writer collecting `recs` live and saving every `per` strikes (one row per save). */
  async function collect(writer: string, recs: Rec[], per: number) {
    const s = mkStore(writer);
    const p = createPersistence({ db: pool, store: s, writer, now: () => NOW, log: () => {} });
    const sorted = recs.slice().sort((a, b) => a.tick - b.tick);
    for (let i = 0; i < sorted.length; i += per) {
      for (const r of sorted.slice(i, i + per)) s.appendLive(r.tick, r.latQ, r.lonQ);
      await p.save();
    }
    return { s, p };
  }

  it('save → a new store → restore gives back exactly the same strikes', async () => {
    const recs = genStrikes({ n: 60_000, nowMs: NOW, spanMs: 20 * H, seed: 21 });
    const { p } = await collect('pg-A', recs, 5_000);
    expect(p.status()).toMatchObject({ lastSaveOk: true, pendingRecords: 0 });
    const { rows } = await pool.query("SELECT count(*) AS n, sum(n) AS strikes FROM lightning_blocks WHERE writer = 'pg-A'");
    expect(Number(rows[0].strikes)).toBe(60_000);
    // A retried batch after a lost ack is a no-op on the real unique constraint.
    await pool.query(
      "INSERT INTO lightning_blocks (writer, seq, t_first, t_last, n, base_tick, data) " +
        "SELECT writer, seq, t_first, t_last, n, base_tick, data FROM lightning_blocks WHERE writer = 'pg-A' " +
        'ON CONFLICT (writer, seq) DO NOTHING'
    );
    const again = await pool.query("SELECT count(*) AS n FROM lightning_blocks WHERE writer = 'pg-A'");
    expect(again.rows[0].n).toBe(rows[0].n);

    const b = mkStore('pg-B');
    const pb = createPersistence({ db: pool, store: b, writer: 'pg-B', now: () => NOW, log: () => {} });
    await pb.restore();
    expect(pb.restoreStatus()).toMatchObject({ state: 'done', strikes: 60_000, dupes: 0, corruptRows: 0 });
    expect(contents(b)).toEqual(keysOf(recs));
  }, 60_000);

  it('a restart with two overlapping writers restores the union once, plus the late final flush', async () => {
    await pool.query('DELETE FROM lightning_blocks');
    const all = genStrikes({ n: 50_000, nowMs: NOW - 5 * 60_000, spanMs: 8 * H, seed: 22 });
    const cutA = Math.floor((NOW - 3 * H) / 10); // old dyno A collected until here…
    const cutB = Math.floor((NOW - 3.5 * H) / 10); // …new dyno B from here (30 min overlap)
    await collect('pg-old', all.filter((r) => r.tick < cutA), 4_000);
    const { s: bStore, p: bPersist } = await collect('pg-new', all.filter((r) => r.tick >= cutB), 4_000);

    // The next boot, C, restores while B is still running (Heroku overlap).
    const c = mkStore('pg-next');
    const pc = createPersistence({ db: pool, store: c, writer: 'pg-next', now: () => NOW, bootMs: NOW, log: () => {} });
    await pc.restore();
    const overlap = all.filter((r) => r.tick >= cutB && r.tick < cutA).length;
    expect(pc.restoreStatus().dupes).toBe(overlap);
    expect(contents(c)).toEqual(keysOf(all));

    // B's final flush lands after C's restore; C also saw those strikes live.
    const tail = genStrikes({ n: 500, nowMs: NOW + 20_000, spanMs: 20_000, seed: 23 });
    for (const r of tail) {
      bStore.appendLive(r.tick, r.latQ, r.lonQ);
      c.appendLive(r.tick, r.latQ, r.lonQ);
    }
    expect(await bPersist.flushAll(5_000)).toBe(true);
    const cu = await pc.catchUp();
    expect(cu).toMatchObject({ rows: 1, strikes: 0, dupes: 500, error: null });
    expect(c.records).toBe(all.length + 500);
  }, 60_000);

  it('imports legacy chunks ×6 and prunes both tables', async () => {
    await pool.query('DELETE FROM lightning_blocks');
    const t = Array.from({ length: 100 }, (_, i) => NOW - 10 * H + i * 1_000);
    await pool.query('INSERT INTO lightning_chunks (chunk_start, n, data) VALUES ($1, $2, $3)', [
      t[0],
      100,
      packStrikes(t.map(() => 35), t.map(() => -97), t),
    ]);
    await pool.query('INSERT INTO lightning_chunks (chunk_start, n, data) VALUES ($1, $2, $3)', [
      NOW - 26 * H,
      1,
      packStrikes([1], [1], [NOW - 26 * H]),
    ]);
    const s = mkStore('pg-legacy');
    const p = createPersistence({ db: pool, store: s, writer: 'pg-legacy', now: () => NOW, bootMs: NOW, log: () => {} });
    await p.restore();
    // Both chunks are read (the old one could straddle), only the in-window strikes are kept.
    expect(p.restoreStatus()).toMatchObject({ legacyRows: 2, legacyStrikes: 100, legacyBeforeMs: NOW });
    expect(s.countsWindow(NOW, 1440)).toEqual({ sum: 600, legacy: true });
    // A save prunes rows past 25 h from both tables.
    await pool.query(
      "INSERT INTO lightning_blocks (writer, seq, t_first, t_last, n, base_tick, data) VALUES ('ancient', 0, $1, $1, 0, 0, '\\x00')",
      [NOW - RETENTION_MS - 2 * H]
    );
    s.appendLive(Math.floor(NOW / 10), 1, 1);
    await p.save();
    const left = await pool.query("SELECT count(*) AS n FROM lightning_blocks WHERE writer = 'ancient'");
    expect(Number(left.rows[0].n)).toBe(0);
    const chunks = await pool.query('SELECT count(*) AS n FROM lightning_chunks');
    expect(Number(chunks.rows[0].n)).toBe(1);
  }, 60_000);
});
