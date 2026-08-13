// Flow fields for frame pairs over a region, computed once and kept.
//
// Flow is per PAIR, not per displayed frame: a 13-frame loop has 12 pairs, and
// playback revisits all of them every few seconds. Recomputing on each pass
// would spend 30-60 ms of worker time per frame advance forever, for an answer
// that cannot change once the region is fully decoded — the frames are
// historical. (An answer measured over a PARTIALLY decoded region CAN change:
// see the coverage upgrade in getFlow.)
//
// The gather below still fans out to every worker and merges. That dates from
// when tiles were hashed by coordinate and no single worker held a region;
// since PR 6 the hash is by zoom level, one worker owns the whole region, and
// the fan-out is redundant — the non-owner returns an empty share — but
// harmless, and it keeps the merge as a safety net should the hash change.

import { regionWarmth, type CompositeRegion } from '../gl/composite';
import { computeFlowInWorker, mosaicPart, WORKER_SLOTS, type FlowResult } from '../worker/pool';

// LK runs on a few hundred pixels a side. Cost scales with area and the output
// grid is coarse, so more resolution buys precision the warp cannot use.
const FLOW_MAX_SIDE = 256;
const FLOW_COLS = 32;
const FLOW_ROWS = 32;

// A dozen pairs for the visible region, plus headroom for one region change
// mid-playback before older entries start falling out.
const MAX_ENTRIES = 32;

// A flow measured over a partly-decoded region is cached like any other, but
// its input was not the real field: undecoded tiles read as zero, and a hole
// inside an echo puts a hard fake edge where LK will happily measure motion
// that is not there. Entries below this coverage are re-measured when the
// region has since warmed materially; at or above it the answer is treated as
// final — the frames are historical and cannot change.
const FLOW_FULL_COVERAGE = 0.95;
const FLOW_RECHECK_MARGIN = 0.15;

export interface RegionFlow extends FlowResult {
  /** The cache key — a stable identity for this exact field. See FlowGrid.key. */
  key: string;
  /** Fraction of the region's tiles that were decoded when this was computed. */
  coverage: number;
  /** Pixel scale of the plane LK ran on, relative to the region's full size. */
  planeWidth: number;
  planeHeight: number;
  /**
   * Set once a re-measure failed to improve on `coverage` — the region simply
   * is that warm — so the upgrade path stops re-solving on every request.
   */
  settled?: boolean;
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
  // A hit measured over a partial region is only returned as-is once it is
  // settled or good enough; if the region has warmed materially since, fall
  // through and re-measure — the fresh solve replaces the entry only if it
  // actually saw more of the field.
  if (hit) {
    const upgradeable =
      !hit.settled &&
      hit.coverage < FLOW_FULL_COVERAGE &&
      regionWarmth(region, [a, b]) >= hit.coverage + FLOW_RECHECK_MARGIN;
    if (!upgradeable) return Promise.resolve(hit);
  }
  const running = inFlight.get(key);
  if (running) return running;

  const work = (async (): Promise<RegionFlow | null> => {
    const [partsA, partsB] = await Promise.all([
      gather(region, a),
      gather(region, b),
    ]);
    if (!partsA || !partsB) return hit ?? null;
    if (Math.min(partsA.coverage, partsB.coverage) < minCoverage) return hit ?? null;
    if (hit && Math.min(partsA.coverage, partsB.coverage) <= hit.coverage + 0.05) {
      // The warmth hint promised more than the stitch delivered; stop
      // re-solving this pair for an improvement that is not coming.
      hit.settled = true;
      return hit;
    }

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
    const cov = Math.min(partsA.coverage, partsB.coverage);
    const flow: RegionFlow = {
      ...result,
      // Suffixed with the coverage it was measured at, so a re-measure over a
      // warmer region carries a DIFFERENT identity — the full-resolution
      // expansions downstream (resolveFlowTo) cache by this token, and the
      // upgraded field must not inherit the stale expansion.
      key: `${key}#c${Math.round(cov * 100)}`,
      coverage: cov,
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
