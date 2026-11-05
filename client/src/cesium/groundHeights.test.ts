import * as Cesium from 'cesium';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SAMPLE_BATCH, SAMPLE_BATCH_TIMEOUT_MS, sampleGroundHeights } from './groundHeights';

// A stand-in viewer: only what the sampler reads.
function fakeViewer() {
  const viewer = { terrainProvider: {} as Cesium.TerrainProvider, isDestroyed: () => false };
  return viewer as typeof viewer & Cesium.Viewer;
}

const points = (n: number) => Array.from({ length: n }, (_, i) => ({ lon: -112 + i * 0.01, lat: 36 }));

/** A terrain whose ground is 1,000 m plus the longitude's thousandths; counts calls and overlaps. */
function fakeTerrain() {
  const calls: number[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const sample = vi.fn(async (_t: Cesium.TerrainProvider, cartos: Cesium.Cartographic[]) => {
    calls.push(cartos.length);
    maxInFlight = Math.max(maxInFlight, ++inFlight);
    await new Promise((r) => setTimeout(r, 5));
    inFlight--;
    cartos.forEach((c) => (c.height = 1000 + Math.round((Cesium.Math.toDegrees(c.longitude) + 112) * 1000)));
    return cartos;
  });
  return { sample, calls, maxInFlight: () => maxInFlight };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('sampleGroundHeights', () => {
  it('samples in small batches and returns heights in point order', async () => {
    const t = fakeTerrain();
    const heights = await sampleGroundHeights(fakeViewer(), points(40), t.sample);
    expect(t.calls).toEqual([SAMPLE_BATCH, SAMPLE_BATCH, 40 - 2 * SAMPLE_BATCH]);
    expect(heights.slice(0, 3)).toEqual([1000, 1010, 1020]);
    expect(heights[39]).toBe(1390);
  });

  it('runs one sampling at a time, however many layers ask at once', async () => {
    const t = fakeTerrain();
    const viewer = fakeViewer();
    const [a, b, c] = await Promise.all([
      sampleGroundHeights(viewer, points(20), t.sample),
      sampleGroundHeights(viewer, points(20).map((p) => ({ ...p, lat: 37 })), t.sample),
      sampleGroundHeights(viewer, points(5).map((p) => ({ ...p, lat: 38 })), t.sample),
    ]);
    expect(t.maxInFlight()).toBe(1);
    expect([a.length, b.length, c.length]).toEqual([20, 20, 5]);
  });

  it('samples a point only once per terrain', async () => {
    const t = fakeTerrain();
    const viewer = fakeViewer();
    await sampleGroundHeights(viewer, points(3), t.sample);
    expect(await sampleGroundHeights(viewer, points(3), t.sample)).toEqual([1000, 1010, 1020]);
    expect(t.sample).toHaveBeenCalledTimes(1);
    viewer.terrainProvider = {} as Cesium.TerrainProvider;
    await sampleGroundHeights(viewer, points(3), t.sample);
    expect(t.sample).toHaveBeenCalledTimes(2);
  });

  it('gives up on a batch that hangs, leaving its points at 0 to be tried again later', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const viewer = fakeViewer();
    const hang = vi.fn(() => new Promise<Cesium.Cartographic[]>(() => {}));
    const pending = sampleGroundHeights(viewer, points(2), hang);
    await vi.advanceTimersByTimeAsync(SAMPLE_BATCH_TIMEOUT_MS + 1);
    expect(await pending).toEqual([0, 0]);
    vi.useRealTimers();
    const t = fakeTerrain();
    expect(await sampleGroundHeights(viewer, points(2), t.sample)).toEqual([1000, 1010]);
  });

  it('stops when the terrain is switched part-way', async () => {
    const viewer = fakeViewer();
    const first = viewer.terrainProvider;
    const t = fakeTerrain();
    const sample = vi.fn(async (terrain: Cesium.TerrainProvider, cartos: Cesium.Cartographic[]) => {
      const out = await t.sample(terrain, cartos);
      viewer.terrainProvider = {} as Cesium.TerrainProvider; // the user turns 3D off and on again
      return out;
    });
    const heights = await sampleGroundHeights(viewer, points(SAMPLE_BATCH + 4), sample);
    expect(sample).toHaveBeenCalledTimes(1);
    expect(heights.slice(SAMPLE_BATCH)).toEqual([0, 0, 0, 0]);
    expect(viewer.terrainProvider).not.toBe(first);
  });
});
