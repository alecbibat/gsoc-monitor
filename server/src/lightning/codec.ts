// Row codec for lightning_blocks. A row is a contiguous run of one own
// segment's records, stored exactly as the store packs them (see store.ts), so
// saving and restoring never re-quantizes anything:
//
//   payload = gzip(level 6) of
//     [fmt = 1] · 8 byte planes of n records:
//       byte 0 of every lo word, byte 1 of every lo word, … byte 3 of every hi word
//
// Splitting the words into byte planes groups the slowly varying bytes (the
// high tOff bits, the coarse lat/lon bytes of a storm) together, which gzip
// compresses far better than interleaved words. The row's base_tick column
// turns the packed tOff values back into absolute ticks.

import zlib from 'zlib';
import { SEG_CAP } from './constants';
import { QMAX } from './quant';
import { latQOf, lonQOf } from './store';

export const ROW_FMT = 1;

/** A row that cannot be decoded. The loader skips it (and counts it) instead of failing the restore. */
export class CorruptRowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CorruptRowError';
  }
}

/** Encode records [from, to) of a segment's interleaved words. */
export function encodeRow(words: Uint32Array, from: number, to: number): Buffer {
  const n = to - from;
  const raw = Buffer.allocUnsafe(1 + 8 * n);
  raw[0] = ROW_FMT;
  for (let i = 0; i < n; i++) {
    const lo = words[2 * (from + i)];
    const hi = words[2 * (from + i) + 1];
    const o = 1 + i;
    raw[o] = lo & 0xff;
    raw[o + n] = (lo >>> 8) & 0xff;
    raw[o + 2 * n] = (lo >>> 16) & 0xff;
    raw[o + 3 * n] = lo >>> 24;
    raw[o + 4 * n] = hi & 0xff;
    raw[o + 5 * n] = (hi >>> 8) & 0xff;
    raw[o + 6 * n] = (hi >>> 16) & 0xff;
    raw[o + 7 * n] = hi >>> 24;
  }
  return zlib.gzipSync(raw, { level: 6 });
}

/** Decode a row back to interleaved [lo, hi] words. Throws CorruptRowError on anything inconsistent. */
export function decodeRow(data: Buffer, n: number): Uint32Array {
  if (!Number.isInteger(n) || n < 0 || n > 4 * SEG_CAP) throw new CorruptRowError(`bad record count ${n}`);
  let raw: Buffer;
  try {
    // Bound the output: a corrupt row must not inflate into something huge.
    raw = zlib.gunzipSync(data, { maxOutputLength: 1 + 8 * n + 1 });
  } catch (err) {
    throw new CorruptRowError(`gunzip failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (raw.length !== 1 + 8 * n) throw new CorruptRowError(`length ${raw.length} != ${1 + 8 * n}`);
  if (raw[0] !== ROW_FMT) throw new CorruptRowError(`unknown format ${raw[0]}`);
  const words = new Uint32Array(2 * n);
  for (let i = 0; i < n; i++) {
    const o = 1 + i;
    const lo = (raw[o] | (raw[o + n] << 8) | (raw[o + 2 * n] << 16) | (raw[o + 3 * n] << 24)) >>> 0;
    const hi = (raw[o + 4 * n] | (raw[o + 5 * n] << 8) | (raw[o + 6 * n] << 16) | (raw[o + 7 * n] << 24)) >>> 0;
    // 20-bit fields cannot exceed QMAX today; the check guards a future QMAX change.
    if (latQOf(lo) > QMAX || lonQOf(hi) > QMAX) throw new CorruptRowError(`coordinate out of range at ${i}`);
    words[2 * i] = lo;
    words[2 * i + 1] = hi;
  }
  return words;
}
