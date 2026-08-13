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

import * as Cesium from 'cesium';
import { useEffect } from 'react';
import { useCesiumViewer } from '../../../cesium/CesiumContext';
import { useLayersStore } from '../../../store/layersStore';
import { getFlow } from '../flow/flowCache';
import { planWarmRegion, regionKey, regionWarmth, type CompositeRegion } from '../gl/composite';
import { forecastDecay } from '../nowcast/forecast';
import { buildTimeline, framePairAt, nowIndex, useRadarStore } from '../radarStore';
import { RADAR_MAX_LEVEL } from '../RainViewerImagery';
import { nowcastRegion, warpRegion } from '../worker/pool';
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

// Below this fraction of the block actually stitched (per frame — the reply's
// coverage is the minimum across the pair), the warp is mostly empty sky where
// the warmth hints promised weather. Presenting it would dim the real tiles
// away behind a hollow image — the blank-but-successful failure this engine
// has been bitten by once already — so motion stands down instead.
const MOTION_MIN_COVERAGE = 0.6;

// Whether a region still overlaps what the camera is looking at. The held
// region is kept while its tiles stay warm, and worker-cache warmth does not
// expire just because the camera left — so without an explicit check, a pan
// leaves motion faithfully warping a rectangle nobody can see while the tile
// path underneath is dimmed to zero everywhere else.
function regionInView(viewer: Cesium.Viewer, region: CompositeRegion): boolean {
  try {
    const view = viewer.camera.computeViewRectangle();
    // No computable view rectangle (horizon-grazing tilt) says nothing about
    // overlap — keep what is working rather than tearing it down blind.
    if (!view) return true;
    return Cesium.Rectangle.intersection(view, region.rectangle) !== undefined;
  } catch {
    return true;
  }
}

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
  /** Whether the last render was an extrapolation rather than an observation. */
  forecast: boolean;
  leadMinutes: number;
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
  forecast: false,
  leadMinutes: 0,
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
    let hideRaf: number | null = null;
    // Set by moveEnd; the pump then re-checks whether the held region is still
    // on screen. Camera moves change no store state, so without this flag the
    // early-out gate below never lets a pan reach the region logic.
    let viewCheckDue = false;

    const alive = () => !disposed && !viewer.isDestroyed();

    const cancelHide = () => {
      if (hideRaf != null) cancelAnimationFrame(hideRaf);
      hideRaf = null;
    };

    // Ordering matters in both directions, and it is always "overlap, never
    // gap": show the warp before dimming the tiles, restore the tiles before
    // hiding the warp. A frame where both draw is a momentary brightening of
    // the same weather; a frame where neither draws is a hole in it.
    const reveal = () => {
      cancelHide();
      layer?.setAlpha(useRadarStore.getState().opacity);
      useRadarStore.getState().setMotionDim(0);
      stats = { ...stats, showing: true, standDown: null };
    };
    const standDown = (why: string) => {
      useRadarStore.getState().setMotionDim(1);
      // Nothing is drawn in the forecast zone while motion is down — the tile
      // path renders forecast frames empty by design — so the timeline must
      // not keep advertising an available forecast. The next successful
      // forecast present sets it true again.
      useRadarStore.getState().setForecastAvailable(false);
      // The tile path's alpha comes back through a React effect (RadarLayerV2
      // reads motionDim), which can flush after the next paint. Hiding the
      // warp synchronously would paint a frame with NEITHER path drawn — a
      // hole in the weather, which the handover rule forbids. Hold the warp
      // for two frames instead; the brief double-draw is the allowed overlap.
      if (hideRaf == null) {
        const hiding = layer;
        hideRaf = requestAnimationFrame(() => {
          hideRaf = requestAnimationFrame(() => {
            hideRaf = null;
            if (!disposed) hiding?.setAlpha(0);
          });
        });
      }
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
            //
            // lastAttempt is cleared so a release back onto the very same
            // snapped position re-engages: with it held, a paused release
            // within the retry window hit the early-out gate below with
            // nothing left to ever wake the pump again.
            lastAttempt = '';
            standDown('scrubbing — snapped to keyframes');
            return;
          }
          if (!pair || pair.a.frame.path === pair.b.frame.path) {
            standDown('no frame pair to interpolate');
            return;
          }

          // The opacity slider must keep working while the playhead is parked
          // on a rendered warp — nothing else touches the layer's alpha until
          // the next present, and the early-out gate below never lets an
          // opacity-only store write reach it.
          if (stats.showing && layer) layer.setAlpha(s.opacity);

          // A pan is invisible to the store, so it arrives as this flag from
          // moveEnd rather than as a changed target.
          if (viewCheckDue) {
            viewCheckDue = false;
            if (layer && !regionInView(viewer, layer.region)) {
              standDown('region left the view');
              dropLayer();
              lastAttempt = '';
            }
          }

          // ONE rule decides observed from forecast, and it is the clock, not
          // the frame index: where is the playhead in TIME relative to the
          // newest observation? Before it, two real frames bracket the moment
          // and the warp interpolates between them. After it, there is no
          // second frame to reach toward and the only honest thing to draw is
          // an extrapolation of the last one.
          //
          // Deriving it from time rather than from which frames the pair
          // happens to name keeps the boundary continuous: the last observed
          // frame is lead 0, and the playhead slides off the end of the record
          // into the forecast without a seam.
          const nIdx = nowIndex(timeline);
          const observedNow = timeline[nIdx];
          const targetTime = pair.a.time + (pair.b.time - pair.a.time) * pair.t;
          const forecast = targetTime > observedNow.time;

          // The flow the whole thing runs on. Observed positions measure it
          // across the pair they sit between; a forecast measures it across the
          // last two observations, because that is the most recent thing the
          // atmosphere has actually told us.
          const previous = timeline[nIdx - 1];
          if (forecast && !previous) {
            standDown('only one observed frame — nothing to measure motion from');
            return;
          }
          const flowA = forecast ? previous.frame.path : pair.a.frame.path;
          const flowB = forecast ? observedNow.frame.path : pair.b.frame.path;

          // Lead time, in multiples of the interval the flow was measured over.
          const interval = forecast ? observedNow.time - previous.time : 0;
          if (forecast && interval <= 0) {
            standDown('observed frames carry no usable interval');
            return;
          }
          const leadSeconds = forecast ? targetTime - observedNow.time : 0;
          const rawStep = forecast ? leadSeconds / interval : pair.t;
          const step = Math.round(rawStep * T_STEPS) / T_STEPS;

          // Settle what to draw before doing any work to find out whether it
          // can be drawn. Planning a region walks every recently-requested tile
          // coordinate, and at 60 playhead updates a second that is not free.
          const target = `${forecast ? 'fc' : 'ob'}:${flowA}>${flowB}@${step}@${s.palette}`;
          if (target === lastAttempt && (stats.showing || performance.now() < retryAfter)) return;
          lastAttempt = target;

          // Prefer the region already built over the best one available. Which
          // level is warm differs from pair to pair, so re-planning freshly on
          // every pair flips the region back and forth while the camera sits
          // perfectly still — each flip a layer teardown and rebuild.
          const held = layer?.region;
          const region =
            held && regionWarmth(held, [flowA, flowB]) >= REGION_KEEP_COVERAGE
              ? held
              : planWarmRegion(RADAR_MAX_LEVEL, [flowA, flowB]);
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

          const flow = await getFlow(region, flowA, flowB);
          if (!alive()) return;
          if (!flow) {
            // Observed positions degrade to the dissolve, which is fine — the
            // frames either side are real. A forecast has nothing to degrade
            // TO: with no measured motion there is no basis for saying where
            // the weather goes, so it renders nothing rather than persisting
            // the current field in place and calling that a prediction.
            standDown(
              forecast
                ? 'no measurable motion — no basis for a forecast'
                : 'no flow for this pair — dissolve fallback'
            );
            if (forecast) useRadarStore.getState().setForecastAvailable(false);
            return;
          }

          const key = `${target}@${regionKey(region)}`;
          // Already on screen; wait for the playhead to move rather than
          // re-warping an identical image.
          if (key === shown) return;

          // confidence travels with the grid: the nowcast densifies the field
          // before advecting and weights the spread by it. Without it every
          // vector densifies to NaN and the forecast renders empty.
          const grid = {
            cols: flow.cols,
            rows: flow.rows,
            u: flow.u,
            v: flow.v,
            confidence: flow.confidence,
            key: flow.key,
          };
          const flowScale = region.widthPx / flow.planeWidth;
          const warped = forecast
            ? await nowcastRegion(
                observedNow.frame.path,
                region.level,
                region.x0,
                region.y0,
                region.nx,
                region.ny,
                step,
                forecastDecay(leadSeconds / 60),
                s.palette,
                grid,
                flowScale
              )
            : await warpRegion(
                flowA,
                flowB,
                region.level,
                region.x0,
                region.y0,
                region.nx,
                region.ny,
                step,
                s.palette,
                grid,
                flowScale
              );
          if (!alive() || !layer) {
            warped.bitmap.close();
            return;
          }
          // The reply's coverage is ground truth from the stitch, where the
          // warmth hints that approved this region are only optimistic — the
          // worker's LRU may have rotated the fields out since. A hollow
          // block must stand down, not present: revealing it dims the real
          // tiles away behind mostly-empty sky while every status field
          // reports success.
          if (warped.coverage < MOTION_MIN_COVERAGE) {
            warped.bitmap.close();
            standDown(
              `region only ${Math.round(warped.coverage * 100)}% stitched for this ` +
                `${forecast ? 'forecast' : 'pair'} — cache evicted under it`
            );
            return;
          }
          totalMs += warped.ms;
          count++;
          stats = {
            ...stats,
            forecast,
            leadMinutes: forecast ? Math.round(leadSeconds / 60) : 0,
            region: regionKey(region),
            pair: forecast ? `${observedNow.frame.path} +${step.toFixed(2)}` : `${flowA} > ${flowB}`,
            t: step,
            frames: count,
            meanMs: Math.round(totalMs / count),
            regionChanges,
          };

          // `present` resolves once the globe has actually taken the image, so
          // this loop paces itself to what the device sustains instead of
          // queueing warps faster than they can be drawn.
          const served = await layer.present(warped.bitmap);
          if (!alive()) return;
          stats = { ...stats, serveTimeouts: layer.serveTimeouts };
          if (!served) {
            // The serve valve expired: the globe never asked for the region's
            // tile. Revealing anyway would dim the real tiles behind a frame
            // nothing is drawing — the timeout and the serve must not share
            // an outcome.
            standDown('globe never took the frame — region off screen or renderer stalled');
            return;
          }
          shown = key;
          reveal();
          if (forecast) useRadarStore.getState().setForecastAvailable(true);
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
    // Camera moves change nothing in the store, so they need their own wake —
    // the held region has to be re-checked against the view it may have left.
    const onMoveEnd = () => {
      viewCheckDue = true;
      void pump();
    };
    viewer.camera.moveEnd.addEventListener(onMoveEnd);
    void pump();

    return () => {
      disposed = true;
      unsubscribe();
      cancelHide();
      // Context loss destroys the viewer before this cleanup runs; touching a
      // destroyed viewer's camera would throw mid-recovery.
      if (!viewer.isDestroyed()) viewer.camera.moveEnd.removeEventListener(onMoveEnd);
      // Restore the tile path BEFORE the layer goes, so teardown never leaves
      // the radar dimmed with nothing drawn over it. StrictMode's double-mount
      // runs this between the two mounts, so it has to be exactly reversible.
      useRadarStore.getState().setMotionDim(1);
      useRadarStore.getState().setForecastAvailable(false);
      dropLayer();
      stats = { ...stats, showing: false, standDown: 'unmounted' };
    };
  }, [viewer, active, host]);

  return null;
}
