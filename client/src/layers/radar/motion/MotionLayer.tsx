// Stage C PR 7: the thing that makes the radar move.
//
// The playhead is a float now, so between any two frames there is a real
// position to render. This watches it, warps the current pair to that position
// in the worker, and shows the result on a single region-sized layer while
// dimming the tile path out from under it.
//
// It is built to STAND DOWN, not to be relied upon. Motion needs a decoded
// region, a measurable flow, and a block small enough to re-upload as a texture
// several times a second. Whenever any of that is missing — a fast pan, a cold
// cache, a scrub, a device that cannot keep up — this hides and the Stage A
// tile path is already showing the nearest keyframe underneath. There is no
// failure mode where the radar disappears; the worst case is that it steps
// instead of sliding, which is exactly what it did before Stage C.

import { useEffect } from 'react';
import { useCesiumViewer } from '../../../cesium/CesiumContext';
import { useLayersStore } from '../../../store/layersStore';
import { getFlow } from '../flow/flowCache';
import { planWarmRegion, regionKey, regionWarmth } from '../gl/composite';
import { buildTimeline, framePairAt, useRadarStore } from '../radarStore';
import { RADAR_MAX_LEVEL } from '../RainViewerImagery';
import { warpRegion } from '../worker/pool';
import { WarpRegionLayer } from './WarpRegionLayer';

// A warped frame is re-uploaded as a whole texture every time it changes, so
// the block size is a per-frame bandwidth cost rather than a one-off. Four
// tiles a side is 2048² RGBA — 16 MB an upload, which a normal view stays well
// inside. Bigger blocks (a very wide view, a long pan's trail of coordinates)
// stand down rather than stutter.
const MOTION_MAX_TILES_PER_AXIS = 4;

// Positions are snapped to this fraction of an interval before warping. Without
// it every mouse-move and every animation frame is a distinct `t` and the
// worker is asked for images nobody will ever see. At 1/16 of an 800 ms
// interval this tops out around 20 renders a second, and the serve-wait in
// WarpRegionLayer paces it down to whatever the device actually sustains.
const T_STEPS = 16;

// While standing down, how long to wait before re-testing whether motion has
// become possible. Every store write wakes this component — playback moves the
// playhead 60 times a second — and re-planning the region on each one would
// spend real work discovering the same "not yet" over and over.
const RETRY_MS = 250;

// Keep the region already in use while at least this much of it is decoded for
// the new pair, even if a deeper level has since become available. Rebuilding
// means a new rectangle, a new tiling scheme and a new layer, and doing that
// mid-loop is visible. Slightly coarser weather that holds still beats sharper
// weather that flickers.
const REGION_KEEP_COVERAGE = 0.6;

export function motionEnabled(): boolean {
  try {
    // Kill switch, and an opt-out for anyone who has asked the OS for less
    // animation — the whole feature is motion.
    if (new URLSearchParams(window.location.search).get('radarmotion') === '0') return false;
    return !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return true;
  }
}

interface MotionStats {
  showing: boolean;
  region: string | null;
  pair: string | null;
  t: number;
  frames: number;
  meanMs: number;
  /**
   * Total imagery layers on the globe. Stage A's invariant is that radar costs
   * two of them however long the timeline is; motion adds exactly one more, and
   * a number that climbs is a leak.
   */
  imageryLayers: number;
  /** Presents that the globe never took — see WarpRegionLayer.waitForServe. */
  serveTimeouts: number;
  /**
   * Layer rebuilds. Expected on a camera move; a number that climbs while the
   * camera is still means the region is flipping between levels.
   */
  regionChanges: number;
  standDown: string | null;
}

let stats: MotionStats = {
  showing: false,
  region: null,
  pair: null,
  t: 0,
  frames: 0,
  meanMs: 0,
  imageryLayers: 0,
  serveTimeouts: 0,
  regionChanges: 0,
  standDown: 'not started',
};

export function MotionLayer() {
  const viewer = useCesiumViewer();
  const active = useLayersStore((s) => s.active.radar);
  const host = useRadarStore((s) => s.host);

  useEffect(() => {
    if (!viewer || viewer.isDestroyed() || !active || !host) return;
    (globalThis as unknown as Record<string, unknown>).__radarMotion = () => ({
      ...stats,
      imageryLayers: viewer.isDestroyed() ? 0 : viewer.imageryLayers.length,
    });

    let disposed = false;
    let layer: WarpRegionLayer | null = null;
    let busy = false;
    let shown = '';
    let lastAttempt = '';
    let retryAfter = 0;
    let totalMs = 0;
    let count = 0;
    let regionChanges = 0;

    const alive = () => !disposed && !viewer.isDestroyed();

    // Ordering matters in both directions, and it is always "overlap, never
    // gap": show the warp before dimming the tiles, restore the tiles before
    // hiding the warp. A frame where both draw is a momentary brightening of
    // the same weather; a frame where neither draws is a hole in it.
    const reveal = () => {
      layer?.setAlpha(useRadarStore.getState().opacity);
      useRadarStore.getState().setMotionDim(0);
      stats = { ...stats, showing: true, standDown: null };
    };
    const standDown = (why: string) => {
      useRadarStore.getState().setMotionDim(1);
      layer?.setAlpha(0);
      shown = '';
      retryAfter = performance.now() + RETRY_MS;
      stats = { ...stats, showing: false, standDown: why };
    };

    const dropLayer = () => {
      layer?.destroy();
      layer = null;
    };

    const pump = async (): Promise<void> => {
      if (busy || !alive()) return;
      busy = true;
      try {
        // Loops because the playhead keeps moving while a warp is in flight;
        // on finishing one it re-reads the store rather than rendering a
        // position that has already gone stale.
        while (alive()) {
          const s = useRadarStore.getState();
          const timeline = buildTimeline(s);
          const pair = framePairAt(timeline, s.position);

          if (s.scrubbing) {
            // The house rule is that the frame under the handle is the frame
            // on screen, immediately. A warp costs tens of milliseconds, so a
            // drag hands rendering back to the cached tiles.
            standDown('scrubbing — snapped to keyframes');
            return;
          }
          if (!pair || pair.a.frame.path === pair.b.frame.path) {
            standDown('no frame pair to interpolate');
            return;
          }

          const a = pair.a.frame.path;
          const b = pair.b.frame.path;
          const step = Math.round(pair.t * T_STEPS) / T_STEPS;
          // Settle what to draw before doing any work to find out whether it
          // can be drawn. Planning a region walks every recently-requested tile
          // coordinate, and at 60 playhead updates a second that is not free.
          const target = `${a}>${b}@${step}@${s.palette}`;
          if (target === lastAttempt && (stats.showing || performance.now() < retryAfter)) return;
          lastAttempt = target;

          // Prefer the region already built over the best one available. Which
          // level is warm differs from pair to pair, so re-planning freshly on
          // every pair flips the region back and forth while the camera sits
          // perfectly still — each flip a layer teardown and rebuild.
          const held = layer?.region;
          const region =
            held && regionWarmth(held, [a, b]) >= REGION_KEEP_COVERAGE
              ? held
              : planWarmRegion(RADAR_MAX_LEVEL, [a, b]);
          if (!region) {
            standDown('no region decoded for this pair');
            return;
          }
          if (region.nx > MOTION_MAX_TILES_PER_AXIS || region.ny > MOTION_MAX_TILES_PER_AXIS) {
            standDown(`region ${region.nx}x${region.ny} too large to re-upload per frame`);
            return;
          }

          // A region change means a different rectangle, which means a
          // different layer — the tiling scheme is built around its bounds.
          if (layer && regionKey(layer.region) !== regionKey(region)) {
            regionChanges++;
            standDown('region changed');
            dropLayer();
          }
          if (!layer) layer = new WarpRegionLayer(viewer, region);

          const flow = await getFlow(region, a, b);
          if (!alive()) return;
          if (!flow) {
            standDown('no flow for this pair — dissolve fallback');
            return;
          }

          const key = `${target}@${regionKey(region)}`;
          // Already on screen; wait for the playhead to move rather than
          // re-warping an identical image.
          if (key === shown) return;

          const warped = await warpRegion(
            a,
            b,
            region.level,
            region.x0,
            region.y0,
            region.nx,
            region.ny,
            step,
            s.palette,
            { cols: flow.cols, rows: flow.rows, u: flow.u, v: flow.v },
            region.widthPx / flow.planeWidth
          );
          if (!alive() || !layer) {
            warped.bitmap.close();
            return;
          }
          totalMs += warped.ms;
          count++;
          stats = {
            ...stats,
            region: regionKey(region),
            pair: `${a} > ${b}`,
            t: step,
            frames: count,
            meanMs: Math.round(totalMs / count),
            regionChanges,
          };

          // `present` resolves once the globe has actually taken the image, so
          // this loop paces itself to what the device sustains instead of
          // queueing warps faster than they can be drawn.
          await layer.present(warped.bitmap);
          if (!alive()) return;
          stats = { ...stats, serveTimeouts: layer.serveTimeouts };
          shown = key;
          reveal();
        }
      } catch (err) {
        // Motion is the enhancement, never the thing that breaks the radar.
        standDown(`warp failed: ${String(err).slice(0, 140)}`);
      } finally {
        busy = false;
      }
    };

    // Driven by store changes rather than an animation frame of its own: the
    // playhead only moves when playback advances it or someone drags it, and a
    // permanent rAF would keep the tab awake for a layer that is usually idle.
    const unsubscribe = useRadarStore.subscribe(() => {
      void pump();
    });
    void pump();

    return () => {
      disposed = true;
      unsubscribe();
      // Restore the tile path BEFORE the layer goes, so teardown never leaves
      // the radar dimmed with nothing drawn over it. StrictMode's double-mount
      // runs this between the two mounts, so it has to be exactly reversible.
      useRadarStore.getState().setMotionDim(1);
      dropLayer();
      stats = { ...stats, showing: false, standDown: 'unmounted' };
    };
  }, [viewer, active, host]);

  return null;
}
