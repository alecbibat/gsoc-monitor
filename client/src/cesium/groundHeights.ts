import * as Cesium from 'cesium';
import { useEffect, useState } from 'react';

// ── Markers on real terrain ──────────────────────────────────────────────────
// Markers sit at height 0 on the ellipsoid, which is right on the flat globe.
// With 3D Buildings & Terrain on, the ground in the parks is 1,500–3,000 m
// above that, so a height-0 marker is underground: OSM buildings then hide it
// as the camera comes in, and from an oblique view it draws well off to one
// side of where it really is (often off the screen). So while real terrain is
// on, a layer draws its markers over buildings from close range at once, and
// asks for the ground height under each marker (sampled once, cached per
// terrain) to stand it on.
//
// Clamping (heightReference: CLAMP_TO_GROUND) would do that too, but clamped
// billboards skip the globe's occlusion while depthTestAgainstTerrain is off
// (as it always is here) and show through the planet — see LocationsLayer.

/** Within this camera distance, a marker on real terrain draws over buildings and terrain. */
export const TERRAIN_MARKERS_ON_TOP_M = 50_000;

/** Markers per sampling call. */
export const SAMPLE_BATCH = 16;
/** A sampling call that takes longer is given up on; its markers stay at height 0. */
export const SAMPLE_BATCH_TIMEOUT_MS = 30_000;

export function hasRealTerrain(viewer: Cesium.Viewer): boolean {
  return !(viewer.terrainProvider instanceof Cesium.EllipsoidTerrainProvider);
}

type SampleFn = (terrain: Cesium.TerrainProvider, positions: Cesium.Cartographic[]) => Promise<Cesium.Cartographic[]>;

const cacheByTerrain = new WeakMap<Cesium.TerrainProvider, Map<string, number>>();
const keyOf = (lon: number, lat: number) => `${lon.toFixed(5)},${lat.toFixed(5)}`;

// One sampling at a time across all the layers, in small batches. A sampling
// call fires all its tile requests at once, and the layers' 150-odd markers
// together can swamp the browser: it starts refusing requests, and the
// sampling never finishes.
let queue: Promise<unknown> = Promise.resolve();

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`terrain sampling took over ${ms / 1000} s`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

/**
 * Ground heights (m) under the points on the viewer's terrain. Points it
 * can't sample read 0, and are tried again on a later call.
 */
export function sampleGroundHeights(
  viewer: Cesium.Viewer,
  points: readonly { lon: number; lat: number }[],
  sample: SampleFn = Cesium.sampleTerrainMostDetailed
): Promise<number[]> {
  const run = queue.then(() => sampleInTurn(viewer, points, sample));
  queue = run.catch(() => undefined);
  return run;
}

async function sampleInTurn(
  viewer: Cesium.Viewer,
  points: readonly { lon: number; lat: number }[],
  sample: SampleFn
): Promise<number[]> {
  const terrain = viewer.terrainProvider;
  let cache = cacheByTerrain.get(terrain);
  if (!cache) cacheByTerrain.set(terrain, (cache = new Map()));
  const known = cache;
  const missing = [...new Set(points.map((p) => keyOf(p.lon, p.lat)))].filter((k) => !known.has(k));
  for (let i = 0; i < missing.length; i += SAMPLE_BATCH) {
    // The terrain was switched (or the globe torn down) meanwhile: the rest are for nobody.
    if (viewer.isDestroyed() || viewer.terrainProvider !== terrain) break;
    const keys = missing.slice(i, i + SAMPLE_BATCH);
    const cartos = keys.map((k) => {
      const [lon, lat] = k.split(',').map(Number);
      return Cesium.Cartographic.fromDegrees(lon, lat);
    });
    let sampled: Cesium.Cartographic[] | null = null;
    try {
      sampled = await withTimeout(sample(terrain, cartos), SAMPLE_BATCH_TIMEOUT_MS);
    } catch (err) {
      console.warn('[terrain] ground heights unavailable for some markers:', err);
    }
    keys.forEach((k, j) => {
      const h = sampled?.[j]?.height;
      if (typeof h === 'number' && Number.isFinite(h)) known.set(k, h);
    });
  }
  return points.map((p) => known.get(keyOf(p.lon, p.lat)) ?? 0);
}

export interface GroundHeights {
  /** Real terrain is on: draw the markers over buildings from close range. */
  terrain: boolean;
  /** The ground height (m) under each point, once sampled; null on the flat globe or until then. */
  heights: number[] | null;
}

/**
 * Whether real terrain is on, and the ground height under each point once
 * sampled. `key` names the point set, so it is only re-sampled when the points
 * or the terrain change.
 */
export function useGroundHeights(
  viewer: Cesium.Viewer | null,
  points: readonly { lon: number; lat: number }[],
  key: string
): GroundHeights {
  const [terrainVersion, setTerrainVersion] = useState(0);
  const [result, setResult] = useState<{ key: string; version: number; heights: number[] } | null>(null);

  useEffect(() => {
    if (!viewer) return;
    return viewer.scene.terrainProviderChanged.addEventListener(() => setTerrainVersion((v) => v + 1));
  }, [viewer]);

  useEffect(() => {
    if (!viewer || viewer.isDestroyed() || !hasRealTerrain(viewer) || points.length === 0) return;
    let cancelled = false;
    sampleGroundHeights(viewer, points)
      .then((heights) => {
        if (!cancelled) setResult({ key, version: terrainVersion, heights });
      })
      .catch((err) => console.warn('[terrain] ground heights unavailable:', err));
    return () => {
      cancelled = true;
    };
    // `points` is named by `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewer, key, terrainVersion]);

  const terrain = !!viewer && !viewer.isDestroyed() && hasRealTerrain(viewer);
  const heights = terrain && result && result.key === key && result.version === terrainVersion ? result.heights : null;
  return { terrain, heights };
}
