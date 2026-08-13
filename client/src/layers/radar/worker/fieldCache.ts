// Byte-budgeted LRU of decoded radar fields, held inside a worker.
//
// Caching the field rather than the finished RGBA is the whole point: a
// palette switch re-runs the LUT over cached fields with zero network and zero
// decode, and Stage C's optical flow consumes exactly this representation.
// Fields are stored POST-blur — the blur radius is a pure function of the
// tile's zoom level, which is already part of the key, so there is nothing to
// recompute per palette.

import { fieldBytes, type RadarField } from '../radarField';

export class FieldCache {
  // Map iterates in insertion order, so re-inserting on read makes the first
  // key the least recently used.
  private readonly entries = new Map<string, RadarField>();
  private used = 0;

  constructor(private readonly budgetBytes: number) {}

  get bytes(): number {
    return this.used;
  }

  get size(): number {
    return this.entries.size;
  }

  get(key: string): RadarField | undefined {
    const field = this.entries.get(key);
    if (!field) return undefined;
    this.entries.delete(key);
    this.entries.set(key, field);
    return field;
  }

  /**
   * Store a field, returning the keys evicted to make room. The caller must
   * surface those to the main thread: its warm-tile hints otherwise only ever
   * grow, and a loop bigger than this budget turns every consumer of the hint
   * into a liar (see the `evicted` message in protocol.ts).
   */
  set(key: string, field: RadarField): string[] {
    const existing = this.entries.get(key);
    if (existing) this.used -= fieldBytes(existing);
    this.entries.set(key, field);
    this.used += fieldBytes(field);
    return this.evictToBudget();
  }

  private evictToBudget(): string[] {
    const evicted: string[] = [];
    // Never evict the entry just inserted, even if it alone exceeds the
    // budget — dropping it would make the request that produced it useless.
    while (this.used > this.budgetBytes && this.entries.size > 1) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      const field = this.entries.get(oldest.value);
      this.entries.delete(oldest.value);
      if (field) this.used -= fieldBytes(field);
      evicted.push(oldest.value);
    }
    return evicted;
  }
}
