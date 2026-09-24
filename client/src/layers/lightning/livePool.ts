// The live pool: every individual strike younger than LIVE_HOLD_S, from the
// browser's own socket or from a /field response's `fresh` list, merged by
// strike key. It is the "white X" layer — each entry is drawn at stage 0 until
// it retires at the hold, when the server's stable 24 h sample takes over.
//
// The global stream runs at 10–200 strikes/s, so two minutes of it is 1,200 to
// 24,000 strikes — more than we want as billboards. The pool is therefore
// capped, and the cap is spent on what the operator can see:
//   - `near` is inView() at insertion (the bolt animator's horizon + view test);
//   - far-side strikes may hold at most `caps.far` slots, and a far arrival only
//     ever evicts another far strike;
//   - when the whole pool is full, the oldest far strike goes first, then the
//     oldest near one. So a flood from the other hemisphere can never push a
//     visible strike off the map.
// Generic over the handle (a Cesium billboard in the layer) so the eviction
// rules are unit-testable without WebGL.

export interface LivePoolCaps {
  /** Most strikes held in all; in-view strikes may use every slot. */
  near: number;
  /** Most far-side strikes held — a sub-cap within `near`. */
  far: number;
}

export interface LiveEntry<H> {
  key: string;
  /** Epoch ms of the strike (Blitzortung's own time when known). */
  tMs: number;
  /** In view when it was inserted. */
  near: boolean;
  /** Set by the caller right after an admitting add(). */
  handle: H | null;
}

export interface LiveAddResult<H> {
  /** The new entry, or null when it was not admitted (it would have been the first evicted). */
  entry: LiveEntry<H> | null;
  /** Entries pushed out to make room; the caller recycles their handles. */
  evicted: LiveEntry<H>[];
}

// Insert keeping the list ascending by time (ties keep arrival order). Live
// strikes arrive nearly in order, so the fast path is a push.
function insertSorted<H>(list: LiveEntry<H>[], e: LiveEntry<H>): void {
  const n = list.length;
  if (n === 0 || list[n - 1].tMs <= e.tMs) {
    list.push(e);
    return;
  }
  let lo = 0;
  let hi = n;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (list[mid].tMs <= e.tMs) lo = mid + 1;
    else hi = mid;
  }
  list.splice(lo, 0, e);
}

export class LivePool<H> {
  private readonly byKey = new Map<string, LiveEntry<H>>();
  // Each class ascending by tMs, so its oldest entry is at the front and
  // retirement only ever trims a prefix.
  private readonly nearList: LiveEntry<H>[] = [];
  private readonly farList: LiveEntry<H>[] = [];
  private readonly total: number;
  private readonly farCap: number;

  constructor(caps: LivePoolCaps) {
    this.total = Math.max(0, Math.floor(caps.near));
    this.farCap = Math.max(0, Math.min(this.total, Math.floor(caps.far)));
  }

  get size(): number {
    return this.byKey.size;
  }
  get nearCount(): number {
    return this.nearList.length;
  }
  get farCount(): number {
    return this.farList.length;
  }

  has(key: string): boolean {
    return this.byKey.has(key);
  }

  get(key: string): LiveEntry<H> | undefined {
    return this.byKey.get(key);
  }

  values(): IterableIterator<LiveEntry<H>> {
    return this.byKey.values();
  }

  /**
   * Insert a strike (a no-op returning { entry: null } for a key already held).
   * Evictions follow the rules above; an arrival older than everything it
   * would displace is simply not admitted.
   */
  add(key: string, tMs: number, near: boolean): LiveAddResult<H> {
    const evicted: LiveEntry<H>[] = [];
    if (this.byKey.has(key)) return { entry: null, evicted };
    const entry: LiveEntry<H> = { key, tMs, near, handle: null };
    insertSorted(near ? this.nearList : this.farList, entry);
    this.byKey.set(key, entry);

    let admitted = true;
    const drop = (list: LiveEntry<H>[]) => {
      const victim = list.shift()!;
      this.byKey.delete(victim.key);
      if (victim === entry) admitted = false;
      else evicted.push(victim);
    };
    // Far strikes only compete with each other for their sub-cap…
    while (this.farList.length > this.farCap) drop(this.farList);
    // …and when the whole pool is full, far goes first. A far arrival at a
    // pool full of near strikes evicts itself (not admitted).
    while (this.byKey.size > this.total) drop(this.farList.length ? this.farList : this.nearList);

    return { entry: admitted ? entry : null, evicted };
  }

  /** Remove and return every entry whose age at `nowMs` has reached `holdMs`. */
  retire(nowMs: number, holdMs: number): LiveEntry<H>[] {
    const cutoff = nowMs - holdMs; // age >= hold  ⇔  tMs <= cutoff
    const out: LiveEntry<H>[] = [];
    for (const list of [this.nearList, this.farList]) {
      let k = 0;
      while (k < list.length && list[k].tMs <= cutoff) k++;
      if (k === 0) continue;
      for (const e of list.splice(0, k)) {
        this.byKey.delete(e.key);
        out.push(e);
      }
    }
    return out;
  }

  /** Empty the pool, returning everything it held. */
  clear(): LiveEntry<H>[] {
    const all = [...this.byKey.values()];
    this.byKey.clear();
    this.nearList.length = 0;
    this.farList.length = 0;
    return all;
  }
}
