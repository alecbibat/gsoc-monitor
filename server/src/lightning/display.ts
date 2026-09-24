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
//      hash at which the sample plus the reps it does not already contain
//      still fit C_s. Pass 1's histogram finds the 2^20-wide bin p_s lies in;
//      pass 2 sets that bin's strikes aside and cuts inside it to the strike.
//      (Cutting at a bin edge moved ~1/4096 of the stratum at once — for a
//      busy 12–24 h stratum, up to half its marks in one poll.)
//   3. p_s never increases with age (s ≥ 2): as a strike ages into the next
//      stratum it can only disappear, never pop in.
// Because both parts are functions of strike identity and a fixed lattice,
// insertion order never matters. A new poll keeps the old marks except at the
// margins: when a stratum's population changes by x %, its p_s moves so that
// about x % of its sample changes, and a cell's rep changes when its min-hash
// strike arrives or ages out. Zooming into a sub-box keeps the parent's marks
// inside it (all of them in practice; only when the sub-box holds nearly all
// of the parent's strikes can its finer reps displace a few % of the parent's
// hash sample).

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
  // Split the table into per-stratum (row, col, h, ref) arrays: two passes over it.
  const counts = new Int32Array(NSTRATA);
  for (let slot = 0; slot < REP_SIZE; slot++) {
    if (keys[slot] !== -1) counts[Math.floor(keys[slot] / cellsPer)]++;
  }
  const byStratum = Array.from(counts, (c) => ({
    rows: new Int32Array(c),
    cols: new Int32Array(c),
    rh: new Uint32Array(c),
    rr: new Int32Array(c),
    cnt: 0,
  }));
  for (let slot = 0; slot < REP_SIZE; slot++) {
    const k = keys[slot];
    if (k === -1) continue;
    const s = Math.floor(k / cellsPer);
    const cell = k - s * cellsPer;
    const b = byStratum[s];
    b.rows[b.cnt] = Math.floor(cell / cols0);
    b.cols[b.cnt] = cell % cols0;
    b.rh[b.cnt] = hs[slot];
    b.rr[b.cnt] = refs[slot];
    b.cnt++;
  }
  await yieldToLoop();
  const repH: Uint32Array[] = [];
  const repRef: Int32Array[] = [];
  // Per stratum: the bin its threshold lies in (HIST_BINS = everything fits),
  // the sample below that bin, and the reps at or above it.
  const kBin: number[] = [];
  const kSample: number[] = [];
  const kAbove: number[] = [];
  for (let s = 0; s < NSTRATA; s++) {
    const { rows, cols: colsArr } = byStratum[s];
    let { rh, rr, cnt } = byStratum[s];
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

    // The threshold's bin: the last one whose whole hash sample fits what the
    // reps leave of C_s. Reps are each cell's MIN hash, so many of them fall
    // inside the sample anyway; those are counted once, not twice (output =
    // sample + reps above the threshold ≤ C_s). Counting them twice would let
    // a zoomed-in view's finer reps squeeze out marks the wider view showed.
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
    kBin.push(k);
    kSample.push(sample);
    kAbove.push(above);
    await yieldToLoop();
  }
  // p_s ≤ p_{s-1} (s ≥ 2), so a stratum's threshold may lie in a younger
  // stratum's lower bin: that is the bin whose strikes pass 2 sets aside.
  const eBin = kBin.slice();
  for (let s = 2; s < NSTRATA; s++) eBin[s] = Math.min(eBin[s], eBin[s - 1]);
  const lowEdge = eBin.map((e) => e * BIN_WIDTH); // e = 4096 → 2^32 = everything
  const highEdge = eBin.map((e) => (e >= HIST_BINS ? e * BIN_WIDTH : (e + 1) * BIN_WIDTH));

  // --- Pass 2: emit the hash sample below each boundary bin (same snapshot,
  // same now) and set the boundary bin's strikes aside.
  const out = new MarkList(q.budget);
  const aside = Array.from({ length: NSTRATA }, () => ({ marks: new MarkList(64), h: [] as number[] }));
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
        const s = stratumOf(age);
        const h = strikeHash(tick, latQ, lonQ);
        if (h < lowEdge[s]) out.push(tick, latQ, lonQ);
        else if (h < highEdge[s]) {
          aside[s].marks.push(tick, latQ, lonQ);
          aside[s].h.push(h);
        }
      }
    },
    (_s, i) => inBox[i] === 1
  );

  // --- The exact thresholds, then the set-aside strikes below them and the reps they missed.
  const p: number[] = [];
  for (let s = 0; s < NSTRATA; s++) {
    let ps: number;
    if (eBin[s] >= HIST_BINS) ps = 2 ** 32;
    else if (kBin[s] > eBin[s]) ps = p[s - 1]; // its own bin is past the younger stratum's threshold
    else {
      ps = cutInBin(kBin[s], kSample[s], kAbove[s], C[s], aside[s].h, repH[s]);
      if (s >= 2) ps = Math.min(ps, p[s - 1]);
    }
    p.push(ps);
    const { marks, h } = aside[s];
    for (let i = 0; i < marks.n; i++) if (h[i] < ps) out.push(marks.tick[i], marks.la[i], marks.lo[i]);
  }
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
 * The exact threshold inside bin k: the largest p (one past a strike's hash)
 * with sample(h < p) + reps(h ≥ p) ≤ cap, starting from the bin's lower edge
 * (sample and above as the histogram left them there). Strikes sharing a hash
 * are taken together, so the answer never depends on scan order. A rep in the
 * bin is also one of its strikes: passing it moves it from `above` to the sample.
 */
function cutInBin(k: number, sample: number, above: number, cap: number, binH: number[], repHs: Uint32Array): number {
  const hs = Uint32Array.from(binH).sort();
  const reps = Uint32Array.from(repHs.filter((h) => h >>> 20 === k)).sort();
  let p = k * BIN_WIDTH;
  let ri = 0;
  for (let i = 0; i < hs.length; ) {
    const h = hs[i];
    let j = i + 1;
    while (j < hs.length && hs[j] === h) j++;
    let r = 0;
    while (ri + r < reps.length && reps[ri + r] <= h) r++;
    if (sample + (j - i) + above - r > cap) break;
    sample += j - i;
    above -= r;
    ri += r;
    p = h + 1;
    i = j;
  }
  return p;
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
 * served as 'stale' (≤ 5 min old), else the caller answers 503 busy. Results
 * that can no longer be served either way are swept, not kept until 64 keys
 * push them out.
 */
export class FieldService {
  private memo = new Map<string, FieldResult>();
  private last = new Map<string, FieldResult>();
  private inflight = new Map<string, Promise<FieldResult>>();
  private generation = 0;
  readonly gate = new ScanGate(2, 8);

  constructor(
    private store: StrikeStore,
    private now: () => number = Date.now
  ) {}

  async get(bbox: BBox | null, budget: number): Promise<{ result: FieldResult; degraded: null | 'stale' } | null> {
    const key = `${bboxKey(bbox)}|${budget}`;
    const now = this.now();
    this.sweep(now);
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
      const gen = this.generation;
      const result = await computeField(this.store, { bbox, budget }, this.now());
      // Not if clear() ran meanwhile: the history changed under this scan.
      if (gen === this.generation) {
        remember(this.memo, key, result);
        remember(this.last, key, result);
      }
      return result;
    } finally {
      this.gate.release();
      this.inflight.delete(key);
    }
  }

  /** Drop results no request can be served any more: memo from past buckets, `last` past STALE_MAX_MS. */
  sweep(now = this.now()): void {
    const bucket = Math.floor(now / FIELD_BUCKET_MS);
    for (const [k, v] of this.memo) if (Math.floor(v.builtAt / FIELD_BUCKET_MS) !== bucket) this.memo.delete(k);
    for (const [k, v] of this.last) if (now - v.builtAt > STALE_MAX_MS) this.last.delete(k);
  }

  /** Drop cached results (memory pressure, or the restore finished). */
  clear(): void {
    this.memo.clear();
    this.last.clear();
    this.generation++;
  }

  stats(): { memoKeys: number; lastKeys: number; running: number; waiting: number } {
    return { memoKeys: this.memo.size, lastKeys: this.last.size, ...this.gate.stats() };
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
