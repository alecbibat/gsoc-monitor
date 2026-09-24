// A growable list of quantized strikes (tick, latQ, lonQ) and its wire
// encoding (LightningMarks: ascending ticks, delta-encoded).

import type { LightningMarks } from './types';

/** Growable (tick, latQ, lonQ) list. */
export class MarkList {
  n = 0;
  tick: Float64Array;
  la: Int32Array;
  lo: Int32Array;
  constructor(cap: number) {
    this.tick = new Float64Array(Math.max(16, cap));
    this.la = new Int32Array(this.tick.length);
    this.lo = new Int32Array(this.tick.length);
  }
  push(tick: number, latQ: number, lonQ: number): void {
    if (this.n === this.tick.length) {
      const grow = <T extends Float64Array | Int32Array>(a: T): T => {
        const b = new (a.constructor as { new (n: number): T })(a.length * 2);
        b.set(a);
        return b;
      };
      this.tick = grow(this.tick);
      this.la = grow(this.la);
      this.lo = grow(this.lo);
    }
    this.tick[this.n] = tick;
    this.la[this.n] = latQ;
    this.lo[this.n] = lonQ;
    this.n++;
  }
  /** Identity order: tick, then latQ, then lonQ (negative = i first). */
  cmp(i: number, j: number): number {
    return this.tick[i] - this.tick[j] || this.la[i] - this.la[j] || this.lo[i] - this.lo[j];
  }
  /** Indices in identity order (ascending tick). */
  order(): number[] {
    const idx = Array.from({ length: this.n }, (_, i) => i);
    const { tick, la, lo } = this;
    idx.sort((a, b) => tick[a] - tick[b] || la[a] - la[b] || lo[a] - lo[b]);
    return idx;
  }
  /** Delta-encoded marks for the given indices (already in ascending tick order). */
  encode(idx: number[]): LightningMarks {
    if (idx.length === 0) return { tick0: 0, dt: [], la: [], lo: [] };
    const tick0 = this.tick[idx[0]];
    const dt = new Array<number>(idx.length);
    const la = new Array<number>(idx.length);
    const lo = new Array<number>(idx.length);
    let prev = tick0;
    for (let k = 0; k < idx.length; k++) {
      const i = idx[k];
      dt[k] = this.tick[i] - prev;
      prev = this.tick[i];
      la[k] = this.la[i];
      lo[k] = this.lo[i];
    }
    return { tick0, dt, la, lo };
  }
}
