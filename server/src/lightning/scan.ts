// Sliced scans over a store snapshot. A full 24 h scan touches ~8.6M records
// at 100/s — hundreds of milliseconds of CPU — and the dyno serves every other
// API, SSE stream and the live collector on the same event loop. So a scan
// hands the loop back (setImmediate) whenever it has run SLICE_MS, checking
// between segments: the longest block is SLICE_MS plus one segment's work
// (16384 records, ~1–2 ms), far under the 50 ms budget.

import { performance } from 'perf_hooks';
import type { Snapshot, SnapSeg } from './store';

export const SLICE_MS = 8;

export const yieldToLoop = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

/** Visit one segment's first n records. Return false to stop the scan early. */
export type SegVisitor = (
  words: Uint32Array,
  n: number,
  weight: number,
  baseTick: number,
  segIndex: number
) => void | boolean;

/**
 * Visit every segment of the snapshot (optionally only those `filter` keeps),
 * yielding to the event loop at least every SLICE_MS. Resolves false when the
 * visitor stopped the scan.
 */
export async function scanSnapshot(
  snap: Snapshot,
  visit: SegVisitor,
  filter?: (s: SnapSeg, segIndex: number) => boolean
): Promise<boolean> {
  let t0 = performance.now();
  for (let i = 0; i < snap.segs.length; i++) {
    const s = snap.segs[i];
    if (filter && !filter(s, i)) continue;
    if (visit(s.seg.words, s.n, s.seg.weight, s.seg.baseTick, i) === false) return false;
    if (performance.now() - t0 >= SLICE_MS) {
      await yieldToLoop();
      t0 = performance.now();
    }
  }
  return true;
}

/**
 * Admission control for scans: at most maxRunning at once and maxQueue
 * waiting. Callers check `full` first and degrade (stale body / 503) rather
 * than pile up — a burst of distinct views must not stack a dozen full scans.
 */
export class ScanGate {
  private running = 0;
  private waiting: (() => void)[] = [];
  constructor(
    readonly maxRunning: number,
    readonly maxQueue: number
  ) {}

  get full(): boolean {
    return this.running >= this.maxRunning && this.waiting.length >= this.maxQueue;
  }

  async acquire(): Promise<void> {
    if (this.running < this.maxRunning) {
      this.running++;
      return;
    }
    // release() hands its slot straight to us, so `running` never overshoots.
    await new Promise<void>((resolve) => this.waiting.push(resolve));
  }

  release(): void {
    const next = this.waiting.shift();
    if (next) next();
    else this.running--;
  }

  stats(): { running: number; waiting: number } {
    return { running: this.running, waiting: this.waiting.length };
  }
}

/**
 * For plain loops outside a snapshot scan (sorting candidates, thinning):
 * call tick() every iteration; it yields when the slice is used up.
 */
export function slicer(): { tick(): Promise<void> | null } {
  let t0 = performance.now();
  let i = 0;
  return {
    tick() {
      if ((++i & 1023) !== 0) return null;
      if (performance.now() - t0 < SLICE_MS) return null;
      return yieldToLoop().then(() => {
        t0 = performance.now();
      });
    },
  };
}
