// Engine v1 radar rendering: one Cesium imagery layer per timeline frame, with
// playback crossfading their alphas, and tiles recolored synchronously on the
// main thread.
//
// Superseded by engine v2 (PingPongLayers + the worker pipeline); kept for one
// release as the kill switch, reachable with `?radar=v1`.
import * as Cesium from 'cesium';
import { useEffect, useRef } from 'react';
import { useCesiumViewer } from '../../cesium/CesiumContext';
import { addImageryBelowLabels } from '../../cesium/imageryOrder';
import { useLayersStore } from '../../store/layersStore';
import { useRadarStore, buildTimeline, nowIndex } from './radarStore';
import { CLIENT_RECOLOR, makeRadarProvider } from './RainViewerImagery';
import { FADE_MS, FRAME_MS } from './timing';
import { useRadarManifest } from './useRadarManifest';

export function RadarLayerV1() {
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
  const setCurrentIndex = useRadarStore((s) => s.setCurrentIndex);

  // One imagery layer per timeline frame; playback crossfades their alphas.
  const animLayersRef = useRef<Cesium.ImageryLayer[]>([]);
  // Which timeline index is currently displayed, the in-flight fade, and the
  // frame that fade is heading toward (used to finalize a superseded fade).
  const shownIndexRef = useRef<number | null>(null);
  const fadeRafRef = useRef<number | null>(null);
  const fadeTargetRef = useRef<number | null>(null);

  useRadarManifest(active);

  const cancelFade = () => {
    if (fadeRafRef.current != null) {
      cancelAnimationFrame(fadeRafRef.current);
      fadeRafRef.current = null;
    }
    fadeTargetRef.current = null;
  };

  // Target alphas for the current mode/opacity. With client recoloring the
  // per-pixel translucency lives in the palette and the layer runs at full
  // strength; pass-through server tiles are solid colors, so cap the layer
  // alpha to keep the basemap readable underneath.
  const targets = () => {
    const s = useRadarStore.getState();
    return { anim: s.opacity * (CLIENT_RECOLOR ? 1 : 0.8) };
  };

  // Snap every layer to a frame with no fade (initial display, scrubbing
  // resets, opacity changes).
  const applyInstant = (idx: number) => {
    const t = targets();
    animLayersRef.current.forEach((l, i) => {
      l.alpha = i === idx ? t.anim : 0;
    });
    shownIndexRef.current = idx;
  };

  // Rebuild the layer stack when the mode / frames / window / palette change.
  useEffect(() => {
    // A WebGL context loss destroys the viewer before the context value flips
    // to the rebuilt one, so a stale-but-destroyed viewer can reach both this
    // body (via e.g. a manifest update) and the cleanup below. Touching a
    // destroyed viewer's imageryLayers throws and would blank the whole app —
    // exactly during the recovery path.
    if (!viewer || viewer.isDestroyed()) return;

    if (!active || !host) {
      viewer.scene.requestRender();
      return;
    }

    const timeline = buildTimeline({ frames, nowcastFrames, windowMinutes });
    if (timeline.length === 0) {
      viewer.scene.requestRender();
      return;
    }

    animLayersRef.current = timeline.map((t) => {
      const layer = addImageryBelowLabels(viewer, makeRadarProvider(host, t.frame, palette));
      layer.alpha = 0;
      return layer;
    });

    // Start paused on "now" (latest observed) so the first thing shown is the
    // current conditions; playback runs forward into the forecast then loops.
    const startIdx = nowIndex(timeline);
    applyInstant(startIdx);
    setCurrentIndex(startIdx);
    viewer.scene.requestRender();

    return () => {
      cancelFade();
      if (!viewer.isDestroyed()) {
        for (const l of animLayersRef.current) viewer.imageryLayers.remove(l, true);
      }
      animLayersRef.current = [];
      shownIndexRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewer, active, host, frames, nowcastFrames, windowMinutes, palette]);

  // Dissolve to the current frame whenever the index moves.
  useEffect(() => {
    if (!viewer || viewer.isDestroyed()) return;
    const layers = animLayersRef.current;
    if (layers.length === 0) return;
    const to = Math.min(Math.max(0, currentIndex), layers.length - 1);
    // A dissolve still in flight when the next index arrives finalizes to its
    // own target first, so the new dissolve starts from what is (nearly) on
    // screen instead of a stale origin.
    if (fadeRafRef.current != null && fadeTargetRef.current != null) {
      shownIndexRef.current = fadeTargetRef.current;
    }
    const from = shownIndexRef.current;
    cancelFade();
    // Dissolve only during playback. Scrubbing pauses playback and moves the
    // index faster than any fade — snap instantly so the frame under the
    // handle is always the one displayed.
    if (from == null || from === to || !useRadarStore.getState().playing) {
      applyInstant(to);
      viewer.scene.requestRender();
      return;
    }
    const t0 = performance.now();
    // Layers are stacked in timeline order, so during forward playback the
    // incoming frame sits ABOVE the held one: ramping it in on top never dips
    // combined coverage (zoom.earth's rolling dissolve). On the loop wrap the
    // incoming frame is below — hold it at target and fade the old one out to
    // reveal it, which is equally dip-free at full opacity.
    const forward = to > from;
    fadeTargetRef.current = to;
    const tick = () => {
      if (viewer.isDestroyed()) {
        fadeRafRef.current = null;
        return;
      }
      const t = Math.min(1, (performance.now() - t0) / FADE_MS);
      const tgt = targets();
      layers.forEach((l, i) => {
        if (i === to) l.alpha = forward ? tgt.anim * t : tgt.anim;
        else if (i === from) l.alpha = forward ? tgt.anim : tgt.anim * (1 - t);
        else l.alpha = 0;
      });
      viewer.scene.requestRender();
      if (t < 1) {
        fadeRafRef.current = requestAnimationFrame(tick);
      } else {
        fadeRafRef.current = null;
        fadeTargetRef.current = null;
        shownIndexRef.current = to;
        applyInstant(to);
        viewer.scene.requestRender();
      }
    };
    fadeRafRef.current = requestAnimationFrame(tick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewer, currentIndex]);

  // Re-apply alphas when opacity moves (mid-fade the ticker reads the store
  // itself, so only the settled state needs a nudge).
  useEffect(() => {
    if (!viewer || viewer.isDestroyed()) return;
    if (fadeRafRef.current == null && shownIndexRef.current != null) {
      applyInstant(shownIndexRef.current);
      viewer.scene.requestRender();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewer, opacity]);

  // Playback ticker.
  useEffect(() => {
    if (!viewer || !active || !playing) return;
    const interval = setInterval(() => {
      const s = useRadarStore.getState();
      const tl = buildTimeline(s);
      if (tl.length === 0) return;
      s.setCurrentIndex((s.currentIndex + 1) % tl.length);
    }, FRAME_MS);
    return () => clearInterval(interval);
  }, [viewer, active, playing]);

  return null;
}
