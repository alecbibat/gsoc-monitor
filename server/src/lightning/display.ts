// The display field: a deterministic, stable, spatially fair sample of a view
// box's last 24 h, at most `budget` marks.
//
// What the old history layer got wrong, and what each piece here fixes:
//   - It strided every Nth strike from the newest one, so every poll picked a
//     different sample (the map "reshuffled" every 30 s). Here a strike is kept
//     or not by its own hash (quant.ts strikeHash), which depends only on its
//     identity: the same strike gets the same answer on every poll, after a
//     restore, and on any dyno.
//   - Uniform thinning erased isolated strikes (a lone strike 1-in-50 sampled
//     is gone). Here every active lattice cell keeps one representative (its
//     lowest-hash strike) per age stratum, so a lone strike always shows.
//   - It had one budget for all ages, so busy recent storms crowded out old
//     ones. Here each age stratum (≈ colour stage) gets its own share.
//
// Per stratum s (STRATA_ENDS_S, budget C_s = budget · share_s):
//   1. reps: the min-hash strike of every active cell of an absolute lattice
//      (fixed to -90/-180, so zooming never re-grids). If there are more than
//      C_s/2, cells merge 2×2 (parent = row>>1, col>>1; the parent's rep is the
//      min of its children's, so a coarser level keeps a SUBSET of the finer
//      reps) until they fit, else the lowest-hash reps are kept.
//   2. hash sample: every strike with hash < p_s, where p_s is the largest
//      histogram edge whose count fits the rest of C_s.
//   3. p_s never increases with age (s ≥ 2): as a strike ages into the next
//      stratum it can only disappear, never pop in.
// Because both parts are functions of strike identity and a fixed lattice,
// zooming into a sub-box keeps the parent's marks, a new poll keeps the old
// ones, and output order/insertion order never matter.

import {
  FIELD_BUCKET_MS,
  FRESH_S,
  LADDER_DEG,
  RETENTION_MS,
  SEG_CAP,
  STAGE_ENDS_S,
  STRATA_ENDS_S,
  STRATA_SHARE,
} from './constants';
import { fmix32, qLat, qLon, strikeHash } from './quant';
import { ScanGate, scanSnapshot, yieldToLoop } from './scan';
import { MarkList } from './marks';
import type { Snapshot, StrikeStore } from './store';
import { latQOf, lonQOf, tOffOf } from './store';
import type { LightningFieldResponse, LightningMarks } from './types';

/** [west, south, east, north] in degrees; west > east crosses the antimeridian. */
export type BBox = [number, number, number, number];

const DAY_TICKS = RETENTION_MS / 10;
const STRATA_TICKS = STRATA_ENDS_S.map((s) => s * 100);
const NSTRATA = STRATA_TICKS.length;
const FRESH_TICKS = FRESH_S * 100;
const HIST_BINS = 4096; // h >>> 20
const BIN_WIDTH = 1_048_576;

// Finest lattice (0.05°): 3600 rows × 7200 cols. Cells are computed once at
// this level and shifted right for coarser ones, so every level nests exactly.
// (latQ·3600/2^20 = latQ·225 >>> 16, lonQ·7200/2^20 = lonQ·225 >>> 15, exact in 32 bits.)
const FINE_ROWS = 3_600;
const FINE_COLS = 7_200;
const fineRow = (latQ: number): number => (latQ * 225) >>> 16;
const fineCol = (lonQ: number): number => (lonQ * 225) >>> 15;
const rowsAt = (level: number): number => ((FINE_ROWS - 1) >> level) + 1;
const colsAt = (level: number): number => ((FINE_COLS - 1) >> level) + 1;
/** Parent-cell key while coarsening (cols < 8192). */
const cellKey = (row: number, col: number): number => row * 8_192 + col;

// Rep table: typed open addressing, preallocated once per concurrent scan.
const REP_SIZE = 1 << 19;
const REP_MASK = REP_SIZE - 1;
/** Past ~70 % load, probing degrades; restart pass 1 one lattice level coarser instead. */
const REP_MAX_LOAD = Math.floor(REP_SIZE * 0.7);

interface RepTable {
  keys: Int32Array;
  hs: Uint32Array;
  refs: Int32Array;
}
const freeTables: RepTable[] = [];
function takeTable(): RepTable {
  const t = freeTables.pop() ?? {
    keys: new Int32Array(REP_SIZE),
    hs: new Uint32Array(REP_SIZE),
    refs: new Int32Array(REP_SIZE),
  };
  t.keys.fill(-1);
  return t;
}
function giveTable(t: RepTable): void {
  if (freeTables.length < 2) freeTables.push(t);
}

/** The view box in quantized space. */
interface QBox {
  latMin: number;
  latMax: number;
  lonMin: number;
  lonMax: number;
  /** Crosses the antimeridian: lon ≥ lonMin OR lon ≤ lonMax. */
  wrap: boolean;
}
export function qbox(bbox: BBox | null): QBox {
  if (!bbox) return { latMin: 0, latMax: 0xfffff, lonMin: 0, lonMax: 0xfffff, wrap: false };
  const [w, s, e, n] = bbox;
  return { latMin: qLat(s), latMax: qLat(n), lonMin: qLon(w), lonMax: qLon(e), wrap: w > e };
}
const lonOut = (b: QBox, lonQ: number): boolean =>
  b.wrap ? lonQ < b.lonMin && lonQ > b.lonMax : lonQ < b.lonMin || lonQ > b.lonMax;

/** The base lattice level: the first LADDER_DEG ≥ span / 400. */
export function baseLevelFor(bbox: BBox | null): number {
  let span = 360;
  if (bbox) {
    const [w, s, e, n] = bbox;
    const lonExt = w <= e ? e - w : 360 - (w - e);
    span = Math.max(n - s, lonExt);
  }
  const i = LADDER_DEG.findIndex((d) => d >= span / 400);
  return i < 0 ? LADDER_DEG.length - 1 : i;
}

const stratumOf = (age: number): number => {
  if (age < 0) return 0; // clock skew / network time slightly ahead: newest
  let s = 0;
  while (age >= STRATA_TICKS[s]) s++;
  return s;
};

/** Identity order: tick, then latQ, then lonQ. The only tie-break anywhere, so results never depend on storage order. */
function refLess(snap: Snapshot, a: number, b: number): boolean {
  const sa = snap.segs[Math.floor(a / SEG_CAP)].seg;
  const sb = snap.segs[Math.floor(b / SEG_CAP)].seg;
  const ia = (a % SEG_CAP) * 2;
  const ib = (b % SEG_CAP) * 2;
  const ta = sa.baseTick + tOffOf(sa.words[ia], sa.words[ia + 1]);
  const tb = sb.baseTick + tOffOf(sb.words[ib], sb.words[ib + 1]);
  if (ta !== tb) return ta < tb;
  const la = latQOf(sa.words[ia]);
  const lb = latQOf(sb.words[ib]);
  if (la !== lb) return la < lb;
  return lonQOf(sa.words[ia + 1]) < lonQOf(sb.words[ib + 1]);
}

export interface FieldView {
  bbox: BBox | null;
  budget: number;
  cellDeg: number;
  total: number;
}
export interface FieldResult {
  view: FieldView;
  field: LightningMarks;
  /** JSON of `field`, serialized once and reused by every response in the bucket. */
  fieldJson: string;
  builtAt: number;
}

/** The sampled 24 h field for a view. Sliced: yields to the event loop during both passes. */
export async function computeField(
  store: StrikeStore,
  q: { bbox: BBox | null; budget: number },
  now: number
): Promise<FieldResult> {
  const snap = store.snapshot();
  const table = takeTable();
  try {
    return await sampleSnapshot(snap, table, q, now);
  } finally {
    giveTable(table);
    snap.release();
  }
}

async function sampleSnapshot(
  snap: Snapshot,
  table: RepTable,
  q: { bbox: BBox | null; budget: number },
  now: number
): Promise<FieldResult> {
  const { latMin, latMax, lonMin, lonMax, wrap } = qbox(q.bbox);
  const nowTick = Math.floor(now / 10);
  const C = STRATA_SHARE.map((share) => Math.floor(q.budget * share));
  const repCap = C.map((c) => Math.floor(c / 2));
  const hist = new Uint32Array(NSTRATA * HIST_BINS);
  const inBox = new Uint8Array(snap.segs.length);
  const { keys, hs, refs } = table;
  // Segments whose newest record is already past 24 h hold nothing drawable.
  const live = (_: unknown, i: number) => snap.segs[i].seg.maxTick > nowTick - DAY_TICKS;

  // --- Pass 1: histograms, total, and the min-hash rep of every (stratum, cell).
  let level = baseLevelFor(q.bbox);
  let total = 0;
  for (;;) {
    const cols = colsAt(level);
    const cellsPer = rowsAt(level) * cols;
    let used = 0;
    total = 0;
    const complete = await scanSnapshot(
      snap,
      (words, n, weight, baseTick, si) => {
        for (let i = 0; i < n; i++) {
          const lo = words[2 * i];
          const latQ = lo & 0xfffff;
          if (latQ < latMin || latQ > latMax) continue;
          const hi = words[2 * i + 1];
          const lonQ = hi & 0xfffff;
          if (wrap ? lonQ < lonMin && lonQ > lonMax : lonQ < lonMin || lonQ > lonMax) continue;
          const tick = baseTick + ((lo >>> 20) | ((hi >>> 20) << 12));
          const age = nowTick - tick;
          if (age >= DAY_TICKS) continue;
          const s = stratumOf(age);
          const h = strikeHash(tick, latQ, lonQ);
          hist[s * HIST_BINS + (h >>> 20)]++;
          total += weight;
          inBox[si] = 1;
          const key = s * cellsPer + (fineRow(latQ) >> level) * cols + (fineCol(lonQ) >> level);
          const ref = si * SEG_CAP + i;
          let slot = fmix32(key) & REP_MASK;
          for (;;) {
            const k = keys[slot];
            if (k === -1) {
              if (used >= REP_MAX_LOAD) return false;
              keys[slot] = key;
              hs[slot] = h;
              refs[slot] = ref;
              used++;
              break;
            }
            if (k === key) {
              const cur = hs[slot];
              if (h < cur || (h === cur && refLess(snap, ref, refs[slot]))) {
                hs[slot] = h;
                refs[slot] = ref;
              }
              break;
            }
            slot = (slot + 1) & REP_MASK;
          }
        }
      },
      live
    );
    // (The coarsest level has 7 × 15 × 29 cells, so it always completes.)
    if (complete || level >= LADDER_DEG.length - 1) break;
    // Too many active cells to index at this level: start over one level coarser.
    level++;
    keys.fill(-1);
    hist.fill(0);
  }
  const baseLevel = level;
  const cellsPer = rowsAt(baseLevel) * colsAt(baseLevel);
  const cols0 = colsAt(baseLevel);

  // --- Per stratum: reps (coarsened to fit), then the hash threshold.
  const counts = new Int32Array(NSTRATA);
  for (let slot = 0; slot < REP_SIZE; slot++) {
    if (keys[slot] !== -1) counts[Math.floor(keys[slot] / cellsPer)]++;
  }
  const repH: Uint32Array[] = [];
  const repRef: Int32Array[] = [];
  const p: number[] = [];
  for (let s = 0; s < NSTRATA; s++) {
    const rows = new Int32Array(counts[s]);
    const colsArr = new Int32Array(counts[s]);
    let rh = new Uint32Array(counts[s]);
    let rr = new Int32Array(counts[s]);
    let cnt = 0;
    for (let slot = 0; slot < REP_SIZE; slot++) {
      const k = keys[slot];
      if (k === -1 || Math.floor(k / cellsPer) !== s) continue;
      const cell = k - s * cellsPer;
      rows[cnt] = Math.floor(cell / cols0);
      colsArr[cnt] = cell % cols0;
      rh[cnt] = hs[slot];
      rr[cnt] = refs[slot];
      cnt++;
    }
    let lvl = baseLevel;
    while (cnt > repCap[s] && lvl < LADDER_DEG.length - 1) {
      lvl++;
      cnt = coarsen(snap, rows, colsArr, rh, rr, cnt);
    }
    if (cnt > repCap[s]) {
      // Even the coarsest lattice has more active cells than the budget allows:
      // keep the lowest-hash reps (still identity-deterministic).
      const idx = Array.from({ length: cnt }, (_, i) => i);
      idx.sort((a, b) => rh[a] - rh[b] || (refLess(snap, rr[a], rr[b]) ? -1 : refLess(snap, rr[b], rr[a]) ? 1 : 0));
      const keep = idx.slice(0, repCap[s]);
      rh = Uint32Array.from(keep, (i) => rh[i]);
      rr = Int32Array.from(keep, (i) => rr[i]);
      cnt = keep.length;
    }
    repH.push(rh.subarray(0, cnt));
    repRef.push(rr.subarray(0, cnt));

    // The threshold: the largest bin edge whose hash sample fits what the reps
    // leave of C_s. Reps are each cell's MIN hash, so many of them fall inside
    // the sample anyway; those are counted once, not twice (output = sample +
    // reps above the edge ≤ C_s). Counting them twice would let a zoomed-in
    // view's finer reps squeeze out marks the wider view showed.
    const repHist = new Uint32Array(HIST_BINS);
    for (let i = 0; i < cnt; i++) repHist[rh[i] >>> 20]++;
    let sample = 0;
    let above = cnt; // reps with h ≥ the current edge
    let k = 0;
    while (k < HIST_BINS) {
      const nextSample = sample + hist[s * HIST_BINS + k];
      const nextAbove = above - repHist[k];
      if (nextSample + nextAbove > C[s]) break;
      sample = nextSample;
      above = nextAbove;
      k++;
    }
    let ps = k * BIN_WIDTH; // keep h < ps; k = 4096 → 2^32 = everything
    if (s >= 2) ps = Math.min(ps, p[s - 1]);
    p.push(ps);
    await yieldToLoop();
  }

  // --- Pass 2: emit the hash sample (same snapshot, same now), then the reps it missed.
  const out = new MarkList(q.budget);
  await scanSnapshot(
    snap,
    (words, n, _weight, baseTick) => {
      for (let i = 0; i < n; i++) {
        const lo = words[2 * i];
        const latQ = lo & 0xfffff;
        if (latQ < latMin || latQ > latMax) continue;
        const hi = words[2 * i + 1];
        const lonQ = hi & 0xfffff;
        if (wrap ? lonQ < lonMin && lonQ > lonMax : lonQ < lonMin || lonQ > lonMax) continue;
        const tick = baseTick + ((lo >>> 20) | ((hi >>> 20) << 12));
        const age = nowTick - tick;
        if (age >= DAY_TICKS) continue;
        if (strikeHash(tick, latQ, lonQ) < p[stratumOf(age)]) out.push(tick, latQ, lonQ);
      }
    },
    (_s, i) => inBox[i] === 1
  );
  for (let s = 0; s < NSTRATA; s++) {
    const rh = repH[s];
    const rr = repRef[s];
    for (let i = 0; i < rh.length; i++) {
      if (rh[i] < p[s]) continue; // already emitted by the hash sample
      const ref = rr[i];
      const seg = snap.segs[Math.floor(ref / SEG_CAP)].seg;
      const j = (ref % SEG_CAP) * 2;
      out.push(seg.baseTick + tOffOf(seg.words[j], seg.words[j + 1]), latQOf(seg.words[j]), lonQOf(seg.words[j + 1]));
    }
  }

  const field = out.encode(out.order());
  return {
    view: { bbox: q.bbox, budget: q.budget, cellDeg: LADDER_DEG[baseLevel], total },
    field,
    fieldJson: JSON.stringify(field),
    builtAt: now,
  };
}

/**
 * Merge reps into their parent cells (one lattice level coarser), keeping the
 * min hash. Compacts the arrays in place and returns the new count. A typed
 * open-addressing table keeps this a few ms even for ~10^5 cells.
 */
function coarsen(
  snap: Snapshot,
  rows: Int32Array,
  cols: Int32Array,
  rh: Uint32Array,
  rr: Int32Array,
  cnt: number
): number {
  let size = 16;
  while (size < cnt * 2) size <<= 1;
  const mask = size - 1;
  const tk = new Int32Array(size).fill(-1);
  const ti = new Int32Array(size);
  let out = 0;
  for (let i = 0; i < cnt; i++) {
    const r = rows[i] >> 1;
    const c = cols[i] >> 1;
    const pk = cellKey(r, c);
    let slot = fmix32(pk) & mask;
    for (;;) {
      if (tk[slot] === -1) {
        tk[slot] = pk;
        ti[slot] = out;
        rows[out] = r;
        cols[out] = c;
        rh[out] = rh[i];
        rr[out] = rr[i];
        out++;
        break;
      }
      if (tk[slot] === pk) {
        const j = ti[slot];
        if (rh[i] < rh[j] || (rh[i] === rh[j] && refLess(snap, rr[i], rr[j]))) {
          rh[j] = rh[i];
          rr[j] = rr[i];
        }
        break;
      }
      slot = (slot + 1) & mask;
    }
  }
  return out;
}

/**
 * Every strike in the box younger than FRESH_S (negative ages included), the
 * newest `fresh` kept, ascending. Only segments that reach into the window are
 * read; it is small and synchronous, so each response gets a current list.
 */
export function freshMarks(store: StrikeStore, bbox: BBox | null, fresh: number, now: number): LightningMarks {
  const list = new MarkList(Math.min(fresh, 4_096));
  if (fresh > 0) {
    const box = qbox(bbox);
    const nowTick = Math.floor(now / 10);
    const oldest = nowTick - FRESH_TICKS; // keep tick > oldest
    for (const seg of store.segments()) {
      if (seg.n === 0 || seg.maxTick <= oldest) continue;
      const w = seg.words;
      for (let i = 0; i < seg.n; i++) {
        const lo = w[2 * i];
        const hi = w[2 * i + 1];
        const tick = seg.baseTick + tOffOf(lo, hi);
        if (tick <= oldest) continue;
        const latQ = latQOf(lo);
        if (latQ < box.latMin || latQ > box.latMax) continue;
        const lonQ = lonQOf(hi);
        if (lonOut(box, lonQ)) continue;
        list.push(tick, latQ, lonQ);
      }
    }
  }
  let idx = list.order();
  if (idx.length > fresh) idx = idx.slice(idx.length - fresh);
  return list.encode(idx);
}

/** The /field body minus `status` (the route adds it). */
export async function fieldQuery(
  store: StrikeStore,
  q: { bbox: BBox | null; budget: number; fresh: number },
  now: number
): Promise<Omit<LightningFieldResponse, 'status'>> {
  const r = await computeField(store, q, now);
  return {
    v: 1,
    now,
    stageEndsS: [...STAGE_ENDS_S],
    view: { ...r.view, degraded: null },
    field: r.field,
    fresh: freshMarks(store, q.bbox, q.fresh, now),
  };
}

/** 5 decimals (~1 m) — the client rounds the same way, so equivalent views share a key. */
export function bboxKey(bbox: BBox | null): string {
  return bbox ? bbox.map((v) => Math.round(v * 1e5) / 1e5).join(',') : 'global';
}

const MEMO_KEYS = 64;
const STALE_MAX_MS = 5 * 60_000;

/**
 * Memoized, admission-controlled field computation. One result per (view,
 * budget) per FIELD_BUCKET_MS bucket; concurrent requests for a key share one
 * scan; at most 2 scans run and 8 wait. Past that the key's last result is
 * served as 'stale' (≤ 5 min old), else the caller answers 503 busy.
 */
export class FieldService {
  private memo = new Map<string, FieldResult>();
  private last = new Map<string, FieldResult>();
  private inflight = new Map<string, Promise<FieldResult>>();
  readonly gate = new ScanGate(2, 8);

  constructor(
    private store: StrikeStore,
    private now: () => number = Date.now
  ) {}

  async get(bbox: BBox | null, budget: number): Promise<{ result: FieldResult; degraded: null | 'stale' } | null> {
    const key = `${bboxKey(bbox)}|${budget}`;
    const now = this.now();
    const memo = this.memo.get(key);
    if (memo && Math.floor(memo.builtAt / FIELD_BUCKET_MS) === Math.floor(now / FIELD_BUCKET_MS)) {
      return { result: memo, degraded: null };
    }
    let p = this.inflight.get(key);
    if (!p) {
      if (this.gate.full) {
        const last = this.last.get(key);
        if (last && now - last.builtAt <= STALE_MAX_MS) return { result: last, degraded: 'stale' };
        return null;
      }
      p = this.run(key, bbox, budget);
      this.inflight.set(key, p);
    }
    return { result: await p, degraded: null };
  }

  private async run(key: string, bbox: BBox | null, budget: number): Promise<FieldResult> {
    await this.gate.acquire();
    try {
      const result = await computeField(this.store, { bbox, budget }, this.now());
      remember(this.memo, key, result);
      remember(this.last, key, result);
      return result;
    } finally {
      this.gate.release();
      this.inflight.delete(key);
    }
  }

  /** Drop cached results (memory pressure). */
  clear(): void {
    this.memo.clear();
    this.last.clear();
  }

  stats(): { memoKeys: number; running: number; waiting: number } {
    return { memoKeys: this.memo.size, ...this.gate.stats() };
  }
}

function remember<V>(map: Map<string, V>, key: string, value: V): void {
  map.delete(key); // re-insert so Map order is recency order
  map.set(key, value);
  while (map.size > MEMO_KEYS) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) break;
    map.delete(oldest);
  }
}
