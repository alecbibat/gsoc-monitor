// Engine v2 radar rendering: a thin orchestrator over PingPongLayers.
//
// All the imagery work lives in PingPongLayers (two layers, swapped in place)
// and the worker pool (decode, blur, palette). What is left here is wiring:
// keep the manifest fresh, create the pair once, and translate store changes
// into frame / palette / opacity calls.
//
// The pair is created on [viewer, active, host] ONLY. Frames rotating, the
// window changing and the palette changing all flow through the existing pair —
// which is what makes a manifest rotation produce no teardown and no refetch.

import * as Cesium from 'cesium';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useCesiumViewer } from '../../cesium/CesiumContext';
import { useLayersStore } from '../../store/layersStore';
import { PingPongLayers } from './PingPongLayers';
import { RadarPrefetcher } from './prefetch';
import { RadarFrameProvider } from './RainViewerImagery';
import { buildTimeline, LOOP_READY_THRESHOLD, nowIndex, useRadarStore } from './radarStore';
import { FADE_MS, FRAME_MS } from './timing';
import { useRadarManifest } from './useRadarManifest';
import { clearVisibleTiles } from './visibleTiles';

// Camera moves change which tiles matter; re-plan once the move settles rather
// than on every frame of a drag.
const MOVE_DEBOUNCE_MS = 400;

// Playback waits for a warm loop, but never indefinitely. If warming is slow or
// wedged — a flaky CDN, a device where decoding cannot keep up — a radar that
// refuses to play is a worse failure than one that plays while still filling
// in, which is exactly what v1 did anyway.
const WARM_WAIT_MS = 8000;

// The whole point of v2 is that radar costs exactly two imagery layers no
// matter how long the timeline is. StrictMode double-mounts every effect in
// dev, so a setup/teardown that is not perfectly idempotent shows up here as a
// third layer rather than as a subtle leak in production.
function assertTwoRadarLayers(viewer: Cesium.Viewer): void {
  const layers = viewer.imageryLayers;
  let n = 0;
  for (let i = 0; i < layers.length; i++) {
    if (layers.get(i).imageryProvider instanceof RadarFrameProvider) n++;
  }
  if (n > 2) console.error(`[radar] expected at most 2 radar imagery layers, found ${n}`);
}

export function RadarLayerV2() {
  const viewer = useCesiumViewer();
  const active = useLayersStore((s) => s.active.radar);
  const host = useRadarStore((s) => s.host);
  const frames = useRadarStore((s) => s.frames);
  const nowcastFrames = useRadarStore((s) => s.nowcastFrames);
  const windowMinutes = useRadarStore((s) => s.windowMinutes);
  const currentIndex = useRadarStore((s) => s.currentIndex);
  const opacity = useRadarStore((s) => s.opacity);
  const playing = useRadarStore((s) => s.playing);
  const palette = useRadarStore((s) => s.palette);

  useRadarManifest(active);

  const timeline = useMemo(
    () => buildTimeline({ frames, nowcastFrames, windowMinutes }),
    [frames, nowcastFrames, windowMinutes]
  );
  // The creation effect must not re-run when the timeline changes, but it needs
  // the current one to pick its opening frame.
  const timelineRef = useRef(timeline);
  timelineRef.current = timeline;

  const pairRef = useRef<PingPongLayers | null>(null);
  const prefetcherRef = useRef<RadarPrefetcher | null>(null);
  const ready = active && !!host && timeline.length > 0;
  const loopReady = useRadarStore((s) => s.loopReady);
  const [warmWaitElapsed, setWarmWaitElapsed] = useState(false);

  // Re-plan warming against the current timeline and playhead. Held in a ref so
  // the creation effect can call it without taking the timeline as a dependency.
  const replanRef = useRef<() => void>(() => {});
  replanRef.current = () => {
    prefetcherRef.current?.update(
      timelineRef.current.map((t) => t.frame),
      Math.min(Math.max(0, currentIndex), Math.max(0, timelineRef.current.length - 1))
    );
  };
  const replan = () => replanRef.current();

  // Create / destroy the layer pair. A WebGL context loss destroys the viewer
  // before the context value flips to the rebuilt one, so a stale-but-destroyed
  // viewer can reach both this body and the cleanup; touching its imageryLayers
  // would throw and blank the app during the recovery path.
  useEffect(() => {
    if (!viewer || viewer.isDestroyed() || !ready) return;
    const tl = timelineRef.current;
    const startIdx = nowIndex(tl);
    const pair = new PingPongLayers(
      viewer,
      useRadarStore.getState().host,
      tl[startIdx].frame,
      useRadarStore.getState().palette,
      useRadarStore.getState().opacity,
      FADE_MS
    );
    pairRef.current = pair;
    // Open paused on "now" (latest observed) so the first thing shown is
    // current conditions; playback runs forward into the forecast then loops.
    useRadarStore.getState().setCurrentIndex(startIdx);
    const prefetcher = new RadarPrefetcher({
      host: useRadarStore.getState().host,
      palette: () => useRadarStore.getState().palette,
      busy: () => pair.loading,
      onProgress: (r) => useRadarStore.getState().setLoopReady(r),
    });
    prefetcherRef.current = prefetcher;

    // The visible tile set changes with the camera, so re-plan once the move
    // settles rather than on every frame of a drag.
    let moveTimer: number | null = null;
    const onMoveEnd = () => {
      if (moveTimer != null) clearTimeout(moveTimer);
      moveTimer = setTimeout(() => {
        moveTimer = null;
        replan();
      }, MOVE_DEBOUNCE_MS) as unknown as number;
    };
    viewer.camera.moveEnd.addEventListener(onMoveEnd);

    if (import.meta.env.DEV) assertTwoRadarLayers(viewer);
    return () => {
      viewer.camera.moveEnd.removeEventListener(onMoveEnd);
      if (moveTimer != null) clearTimeout(moveTimer);
      prefetcher.destroy();
      prefetcherRef.current = null;
      pair.destroy();
      pairRef.current = null;
      clearVisibleTiles();
      useRadarStore.getState().setLoopReady(0);
    };
  }, [viewer, ready, host]);

  // Follow the playhead. Dissolve during playback; snap while scrubbing, where
  // the frame under the handle must always be the one on screen.
  useEffect(() => {
    const pair = pairRef.current;
    if (!pair || timeline.length === 0) return;
    const idx = Math.min(Math.max(0, currentIndex), timeline.length - 1);
    pair.showFrame(timeline[idx].frame, useRadarStore.getState().playing);
  }, [currentIndex, timeline]);

  // Warming follows the playhead and the timeline.
  useEffect(() => {
    replanRef.current();
  }, [timeline, currentIndex]);

  useEffect(() => {
    pairRef.current?.setPalette(palette);
  }, [palette]);

  useEffect(() => {
    pairRef.current?.setOpacity(opacity);
  }, [opacity]);

  // Give warming a bounded head start, then play regardless.
  useEffect(() => {
    if (!ready) return;
    setWarmWaitElapsed(false);
    const t = setTimeout(() => setWarmWaitElapsed(true), WARM_WAIT_MS);
    return () => clearTimeout(t);
  }, [ready]);

  // Playback ticker. Held until the loop is warm enough to play through
  // without stopping to download every frame.
  const warmEnough = loopReady >= LOOP_READY_THRESHOLD || warmWaitElapsed;
  useEffect(() => {
    if (!viewer || !active || !playing || !warmEnough) return;
    const interval = setInterval(() => {
      const s = useRadarStore.getState();
      const tl = buildTimeline(s);
      if (tl.length === 0) return;
      s.setCurrentIndex((s.currentIndex + 1) % tl.length);
    }, FRAME_MS);
    return () => clearInterval(interval);
  }, [viewer, active, playing, warmEnough]);

  return null;
}
