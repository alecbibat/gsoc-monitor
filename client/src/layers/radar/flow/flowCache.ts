// Flow fields for frame pairs over a region, computed once and kept.
//
// Flow is per PAIR, not per displayed frame: a 13-frame loop has 12 pairs, and
// playback revisits all of them every few seconds. Recomputing on each pass
// would spend 30-60 ms of worker time per frame advance forever, for an answer
// that cannot change — the frames are historical.
//
// Assembling the input is the other half of the reason this caches. Tiles are
// hashed across workers so a tile's whole time series stays together, which
// means no single worker holds a complete region; the mosaic has to be gathered
// from every worker and merged before Lucas-Kanade can see it.

import type { CompositeRegion } from '../gl/composite';
import { computeFlowInWorker, mosaicPart, WORKER_SLOTS, type FlowResult } from '../worker/pool';

// LK runs on a few hundred pixels a side. Cost scales with area and the output
// grid is coarse, so more resolution buys precision the warp cannot use.
const FLOW_MAX_SIDE = 256;
const FLOW_COLS = 32;
const FLOW_ROWS = 32;

// A dozen pairs for the visible region, plus headroom for one region change
// mid-playback before older entries start falling out.
const MAX_ENTRIES = 32;

export interface RegionFlow extends FlowResult {
  /** The cache key — a stable identity for this exact field. See FlowGrid.key. */
  key: string;
  /** Fraction of the region's tiles that were decoded when this was computed. */
  coverage: number;
  /** Pixel scale of the plane LK ran on, relative to the region's full size. */
  planeWidth: number;
  planeHeight: number;
}

const entries = new Map<string, RegionFlow>();
const inFlight = new Map<string, Promise<RegionFlow | null>>();

function keyFor(region: CompositeRegion, a: string, b: string): string {
  return `${a}>${b}@${region.level}/${region.x0}/${region.y0}/${region.nx}/${region.ny}`;
}

export function cachedFlow(region: CompositeRegion, a: string, b: string): RegionFlow | undefined {
  return entries.get(keyFor(region, a, b));
}

export function flowCacheSize(): number {
  return entries.size;
}

export function clearFlowCache(): void {
  entries.clear();
  inFlight.clear();
}

// Compute (or return) the flow for one frame pair over a region.
//
// Resolves null when the region is not decoded enough to measure — better no
// motion than motion invented from holes, and the caller falls back to the
// plain dissolve, which is the permanent degradation path.
export function getFlow(
  region: CompositeRegion,
  a: string,
  b: string,
  minCoverage = 0.6
): Promise<RegionFlow | null> {
  const key = keyFor(region, a, b);
  const hit = entries.get(key);
  if (hit) return Promise.resolve(hit);
  const running = inFlight.get(key);
  if (running) return running;

  const work = (async (): Promise<RegionFlow | null> => {
    const [partsA, partsB] = await Promise.all([
      gather(region, a),
      gather(region, b),
    ]);
    if (!partsA || !partsB) return null;
    if (Math.min(partsA.coverage, partsB.coverage) < minCoverage) return null;

    // Worker 0 by convention — the planes are transferred, so which worker runs
    // the solve costs nothing, and pinning it keeps flow off whichever worker
    // is busy decoding.
    const result = await computeFlowInWorker(
      0,
      partsA.width,
      partsA.height,
      partsA.plane,
      partsB.plane,
      FLOW_COLS,
      FLOW_ROWS
    );
    const flow: RegionFlow = {
      ...result,
      key,
      coverage: Math.min(partsA.coverage, partsB.coverage),
      planeWidth: partsA.width,
      planeHeight: partsA.height,
    };
    entries.set(key, flow);
    // Map iterates in insertion order, so the first key is the oldest.
    while (entries.size > MAX_ENTRIES) {
      const oldest = entries.keys().next();
      if (oldest.done) break;
      entries.delete(oldest.value);
    }
    return flow;
  })().finally(() => inFlight.delete(key));

  inFlight.set(key, work);
  return work;
}

// Collect every worker's share of the region and merge them.
//
// The shares are disjoint — each worker only holds the tiles its hash claimed —
// and an absent tile reads as zero, which is also what empty sky decodes to. So
// a per-pixel maximum merges them without needing a coverage mask.
async function gather(
  region: CompositeRegion,
  framePath: string
): Promise<{ width: number; height: number; plane: Float32Array; coverage: number } | null> {
  const parts = await Promise.all(
    Array.from({ length: WORKER_SLOTS }, (_, w) =>
      mosaicPart(w, framePath, region.level, region.x0, region.y0, region.nx, region.ny, FLOW_MAX_SIDE)
    )
  );
  const first = parts[0];
  if (!first) return null;
  const merged = first.plane;
  let coverage = first.coverage;
  for (let i = 1; i < parts.length; i++) {
    const part = parts[i];
    if (part.width !== first.width || part.height !== first.height) return null;
    for (let p = 0; p < merged.length; p++) {
      if (part.plane[p] > merged[p]) merged[p] = part.plane[p];
    }
    coverage += part.coverage;
  }
  return {
    width: first.width,
    height: first.height,
    plane: merged,
    coverage: Math.min(1, coverage),
  };
}
