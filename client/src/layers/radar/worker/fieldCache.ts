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

  set(key: string, field: RadarField): void {
    const existing = this.entries.get(key);
    if (existing) this.used -= fieldBytes(existing);
    this.entries.set(key, field);
    this.used += fieldBytes(field);
    this.evictToBudget();
  }

  private evictToBudget(): void {
    // Never evict the entry just inserted, even if it alone exceeds the
    // budget — dropping it would make the request that produced it useless.
    while (this.used > this.budgetBytes && this.entries.size > 1) {
      const oldest = this.entries.keys().next();
      if (oldest.done) return;
      const field = this.entries.get(oldest.value);
      this.entries.delete(oldest.value);
      if (field) this.used -= fieldBytes(field);
    }
  }
}
