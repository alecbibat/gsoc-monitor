// Test helpers shared by the lightning tests (excluded from the build, see
// tsconfig.json): a seeded PRNG, synthetic strike fields, an in-memory fake of
// the two lightning tables that answers exactly the SQL persist.ts sends, and
// a fake WebSocket.

import { EventEmitter } from 'events';
import type { Queryable } from './persist';
import { QMAX } from './quant';

/** mulberry32: small, fast, deterministic. */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Rec {
  tick: number;
  latQ: number;
  lonQ: number;
}

/**
 * Synthetic strikes over [now - spanMs, now): gaussian storm cells plus
 * scattered singletons. Deterministic for a seed.
 */
export function genStrikes(opts: {
  n: number;
  nowMs: number;
  spanMs: number;
  seed?: number;
  cells?: { lat: number; lon: number; sd: number }[];
  isolatedShare?: number;
}): Rec[] {
  const rnd = prng(opts.seed ?? 1);
  const gauss = () => Math.sqrt(-2 * Math.log(Math.max(1e-12, rnd()))) * Math.cos(2 * Math.PI * rnd());
  const cells =
    opts.cells ??
    Array.from({ length: 20 }, () => ({ lat: -40 + rnd() * 90, lon: -180 + rnd() * 360, sd: 0.1 + rnd() * 0.5 }));
  const out: Rec[] = [];
  const nowTick = Math.floor(opts.nowMs / 10);
  const spanTicks = Math.floor(opts.spanMs / 10);
  for (let i = 0; i < opts.n; i++) {
    let lat: number;
    let lon: number;
    if (rnd() < (opts.isolatedShare ?? 0.02)) {
      lat = -60 + rnd() * 120;
      lon = -180 + rnd() * 360;
    } else {
      const c = cells[Math.floor(rnd() * cells.length)];
      lat = c.lat + gauss() * c.sd;
      lon = c.lon + gauss() * c.sd;
    }
    lat = Math.max(-90, Math.min(90, lat));
    lon = ((((lon + 180) % 360) + 360) % 360) - 180;
    out.push({
      tick: nowTick - 1 - Math.floor(rnd() * spanTicks),
      latQ: Math.round(((lat + 90) / 180) * QMAX),
      lonQ: Math.round(((lon + 180) / 360) * QMAX),
    });
  }
  return out;
}

/** Fisher–Yates with a seed. */
export function shuffled<T>(arr: T[], seed: number): T[] {
  const a = arr.slice();
  const rnd = prng(seed);
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export interface FakeBlock {
  id: number;
  writer: string;
  seq: number;
  t_first: number;
  t_last: number;
  n: number;
  base_tick: number;
  data: Buffer;
}
export interface FakeChunk {
  id: number;
  chunk_start: number;
  n: number;
  data: Buffer;
}

/**
 * In-memory lightning_blocks / lightning_chunks that understands the
 * statements persist.ts issues. BIGINT columns come back as strings, like pg.
 * `failWhen` injects errors; `hang` makes every query hang forever.
 */
export class FakeDb implements Queryable {
  blocks: FakeBlock[] = [];
  chunks: FakeChunk[] = [];
  log: { sql: string; params: unknown[] }[] = [];
  private nextId = 1;
  /** Return an Error to fail a statement. `after: true` applies it AFTER the statement took effect (a lost ack). */
  failWhen: ((sql: string) => { err: Error; after?: boolean } | null) | null = null;
  hang = false;

  addBlock(b: Omit<FakeBlock, 'id'>): FakeBlock {
    const row = { ...b, id: this.nextId++ };
    this.blocks.push(row);
    return row;
  }
  addChunk(c: Omit<FakeChunk, 'id'>): FakeChunk {
    const row = { ...c, id: this.nextId++ };
    this.chunks.push(row);
    return row;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async query(sql: string, params: unknown[] = []): Promise<{ rows: any[] }> {
    this.log.push({ sql, params });
    if (this.hang) return new Promise(() => {});
    const fail = this.failWhen?.(sql) ?? null;
    if (fail && !fail.after) throw fail.err;
    const rows = this.exec(sql, params);
    if (fail?.after) throw fail.err;
    return { rows };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private exec(sql: string, p: unknown[]): any[] {
    const num = (v: unknown) => Number(v);
    const blockOut = (b: FakeBlock) => ({
      id: String(b.id),
      writer: b.writer,
      t_first: String(b.t_first),
      t_last: String(b.t_last),
      n: b.n,
      base_tick: String(b.base_tick),
      data: b.data,
    });
    const desc = (a: FakeBlock, b: FakeBlock) => b.t_last - a.t_last || b.id - a.id;
    if (sql.startsWith('INSERT INTO lightning_blocks')) {
      for (let i = 0; i < p.length; i += 7) {
        const writer = String(p[i]);
        const seq = num(p[i + 1]);
        if (this.blocks.some((b) => b.writer === writer && b.seq === seq)) continue; // ON CONFLICT DO NOTHING
        this.addBlock({
          writer,
          seq,
          t_first: num(p[i + 2]),
          t_last: num(p[i + 3]),
          n: num(p[i + 4]),
          base_tick: num(p[i + 5]),
          data: p[i + 6] as Buffer,
        });
      }
      return [];
    }
    if (sql.startsWith('DELETE FROM lightning_blocks WHERE t_last < $1')) {
      this.blocks = this.blocks.filter((b) => b.t_last >= num(p[0]));
      return [];
    }
    if (sql.startsWith('DELETE FROM lightning_chunks WHERE chunk_start < $1')) {
      this.chunks = this.chunks.filter((c) => c.chunk_start >= num(p[0]));
      return [];
    }
    if (sql.startsWith('SELECT count(*) AS rows, COALESCE(sum(n), 0) AS strikes, min(t_first)')) {
      const rs = this.blocks.filter((b) => b.t_last >= num(p[0]) && b.writer !== p[1]);
      return [
        {
          rows: String(rs.length),
          strikes: String(rs.reduce((a, b) => a + b.n, 0)),
          t_first: rs.length ? String(Math.min(...rs.map((b) => b.t_first))) : null,
        },
      ];
    }
    if (sql.startsWith('SELECT id, writer, t_first, t_last, n, base_tick, data FROM lightning_blocks WHERE id = ANY')) {
      const ids = new Set((p[0] as number[]).map(Number));
      return this.blocks.filter((b) => ids.has(b.id)).sort(desc).map(blockOut);
    }
    if (sql.startsWith('SELECT id, writer, t_first, t_last, n, base_tick, data FROM lightning_blocks')) {
      let rs = this.blocks.filter((b) => b.t_last >= num(p[0]) && b.writer !== p[1]);
      if (sql.includes('(t_last, id) < ($3, $4)')) {
        const tl = num(p[2]);
        const id = num(p[3]);
        rs = rs.filter((b) => b.t_last < tl || (b.t_last === tl && b.id < id));
      }
      const limit = Number(/LIMIT (\d+)/.exec(sql)?.[1] ?? 1e9);
      return rs.sort(desc).slice(0, limit).map(blockOut);
    }
    if (sql.startsWith('SELECT min(t_first) AS t_first FROM lightning_blocks')) {
      const rs = this.blocks.filter((b) => b.t_last >= num(p[0]));
      return [{ t_first: rs.length ? String(Math.min(...rs.map((b) => b.t_first))) : null }];
    }
    if (sql.startsWith('SELECT id FROM lightning_blocks')) {
      return this.blocks.filter((b) => b.t_last >= num(p[0]) && b.writer !== p[1]).map((b) => ({ id: String(b.id) }));
    }
    if (sql.startsWith('SELECT count(*) AS rows, COALESCE(sum(n), 0) AS strikes FROM lightning_chunks')) {
      const rs = this.chunks.filter((c) => c.chunk_start < num(p[0]) && c.chunk_start >= num(p[1]));
      return [{ rows: String(rs.length), strikes: String(rs.reduce((a, c) => a + c.n, 0)) }];
    }
    if (sql.startsWith('SELECT id, chunk_start, n, data FROM lightning_chunks')) {
      let rs = this.chunks.filter((c) => c.chunk_start < num(p[0]) && c.chunk_start >= num(p[1]));
      if (sql.includes('(chunk_start, id) < ($3, $4)')) {
        const cs = num(p[2]);
        const id = num(p[3]);
        rs = rs.filter((c) => c.chunk_start < cs || (c.chunk_start === cs && c.id < id));
      }
      const limit = Number(/LIMIT (\d+)/.exec(sql)?.[1] ?? 1e9);
      return rs
        .sort((a, b) => b.chunk_start - a.chunk_start || b.id - a.id)
        .slice(0, limit)
        .map((c) => ({ id: String(c.id), chunk_start: String(c.chunk_start), n: c.n, data: c.data }));
    }
    throw new Error(`FakeDb: unexpected SQL: ${sql}`);
  }
}

/** A WebSocket stand-in the collector drives through the same events. */
export class FakeWs extends EventEmitter {
  sent: string[] = [];
  terminated = false;
  constructor(readonly url: string) {
    super();
  }
  send(data: string): void {
    this.sent.push(data);
  }
  terminate(): void {
    if (this.terminated) return;
    this.terminated = true;
    queueMicrotask(() => this.emit('close'));
  }
  open(): void {
    this.emit('open');
  }
  /** Deliver a strike frame (plain JSON; the collector also accepts LZW). */
  strike(lat: number, lon: number, timeNs?: number): void {
    this.emit('message', Buffer.from(JSON.stringify({ lat, lon, time: timeNs })));
  }
}
