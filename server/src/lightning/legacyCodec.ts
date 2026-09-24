// Pre-upgrade lightning_chunks codec, moved verbatim from the old
// routes/lightning.ts. Nothing writes this format any more; it is only read to
// import the old table's history (kept 1-in-6, so imported ×6) until those
// rows age out. Drop it together with the lightning_chunks table.

import zlib from 'zlib';

// Chunk codec: gzip(Float32 lat[] · Float32 lon[] · Uint32 tSec[]). Exported for
// tests. Uint32 epoch-seconds is plenty — the display buckets by hour.
export function packStrikes(lat: number[], lon: number[], tMs: number[]): Buffer {
  const n = lat.length;
  const la = new Float32Array(n);
  const lo = new Float32Array(n);
  const ts = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    la[i] = lat[i];
    lo[i] = lon[i];
    ts[i] = Math.round(tMs[i] / 1000);
  }
  return zlib.gzipSync(
    Buffer.concat([Buffer.from(la.buffer), Buffer.from(lo.buffer), Buffer.from(ts.buffer)])
  );
}
export function unpackStrikes(data: Buffer, n: number): { lat: Float32Array; lon: Float32Array; tMs: Float64Array } {
  const raw = zlib.gunzipSync(data);
  if (raw.length < n * 12) throw new Error(`chunk too short: ${raw.length} < ${n * 12}`);
  // Copy out of the Buffer pool region before viewing as typed arrays (the
  // underlying ArrayBuffer may be shared and misaligned).
  const own = new Uint8Array(raw).slice().buffer;
  const lat = new Float32Array(own, 0, n);
  const lon = new Float32Array(own, n * 4, n);
  const tSec = new Uint32Array(own, n * 8, n);
  const tMs = new Float64Array(n);
  for (let i = 0; i < n; i++) tMs[i] = tSec[i] * 1000;
  return { lat, lon, tMs };
}
