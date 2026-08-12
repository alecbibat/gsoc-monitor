import * as Cesium from 'cesium';
import { useEffect, useRef } from 'react';
import { useCesiumViewer } from '../../cesium/CesiumContext';
import { addImageryAboveBase } from '../../cesium/imageryOrder';
import { useLayersStore } from '../../store/layersStore';
import { api } from '../../api/client';
import { startVisiblePolling } from '../../lib/poll';
import { useGoesStore, goesFramesInWindow, GOES_SATS } from './goesStore';
import { makeGoesProvider } from './GoesImagery';

// Same playback rhythm as the radar layer: the dissolve occupies almost the
// whole frame interval so the loop reads as continuous motion.
const FRAME_MS = 800;
const FADE_MS = 720;

// Live GOES-East / GOES-West / Himawari GeoColor mosaic, animated over the
// last 1–3 hours. One frame = one 10-minute scan time = three imagery layers
// (one per satellite slice); playback crossfades whole frame groups, exactly
// the RadarLayer scheme with a group of layers standing in for each single
// layer.
export function GoesLayer() {
  const viewer = useCesiumViewer();
  const active = useLayersStore((s) => s.active.goes);
  const frames = useGoesStore((s) => s.frames);
  const windowMinutes = useGoesStore((s) => s.windowMinutes);
  const currentIndex = useGoesStore((s) => s.currentIndex);
  const playing = useGoesStore((s) => s.playing);
  const opacity = useGoesStore((s) => s.opacity);
  const setCurrentIndex = useGoesStore((s) => s.setCurrentIndex);

  // frameLayersRef[timelineIdx] = the three per-satellite imagery layers for
  // that scan time. Fade bookkeeping mirrors RadarLayer.
  const frameLayersRef = useRef<Cesium.ImageryLayer[][]>([]);
  const shownIndexRef = useRef<number | null>(null);
  const fadeRafRef = useRef<number | null>(null);
  const fadeTargetRef = useRef<number | null>(null);

  // Fetch the frame-time manifest periodically while active.
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const load = async () => {
      try {
        const manifest = await api.goesManifest();
        if (cancelled) return;
        useGoesStore.getState().setManifest(manifest.frames, manifest.source);
      } catch (err) {
        console.error('Failed to load GOES time index', err);
        if (!cancelled) useGoesStore.getState().setError('Satellite time index unavailable');
      }
    };
    const stopPolling = startVisiblePolling(() => void load(), 2 * 60_000);
    return () => {
      cancelled = true;
      stopPolling();
    };
  }, [active]);

  const cancelFade = () => {
    if (fadeRafRef.current != null) {
      cancelAnimationFrame(fadeRafRef.current);
      fadeRafRef.current = null;
    }
    fadeTargetRef.current = null;
  };

  const setGroupAlpha = (group: Cesium.ImageryLayer[] | undefined, alpha: number) => {
    if (!group) return;
    for (const l of group) l.alpha = alpha;
  };

  // Snap every frame group to an index with no fade (initial display,
  // scrubbing, opacity changes).
  const applyInstant = (idx: number) => {
    const target = useGoesStore.getState().opacity;
    frameLayersRef.current.forEach((group, i) => setGroupAlpha(group, i === idx ? target : 0));
    shownIndexRef.current = idx;
  };

  // Rebuild the layer stack when the frame list or window changes.
  useEffect(() => {
    // Guard against the WebGL-context-loss recovery window, where a destroyed
    // viewer can still reach this effect (see RadarLayer for the full story).
    if (!viewer || viewer.isDestroyed()) return;

    if (!active || frames.length === 0) {
      viewer.scene.requestRender();
      return;
    }

    const timeline = goesFramesInWindow(frames, windowMinutes);

    // addImageryAboveBase inserts every layer at the same stack slot (just
    // above the basemap), so each insertion pushes the previous ones up —
    // building NEWEST-first leaves the stack in timeline order, oldest at the
    // bottom. The dissolve below relies on that: during forward playback the
    // incoming frame sits above the held one, so fading it in on top never
    // dips coverage (the RadarLayer/zoom.earth rolling dissolve).
    const groups: Cesium.ImageryLayer[][] = new Array(timeline.length);
    for (let i = timeline.length - 1; i >= 0; i--) {
      groups[i] = GOES_SATS.map((sat) => {
        const layer = addImageryAboveBase(viewer, makeGoesProvider(sat, timeline[i]));
        layer.alpha = 0;
        return layer;
      });
    }
    frameLayersRef.current = groups;

    // Show the newest scan first — current conditions — then loop.
    const startIdx = timeline.length - 1;
    applyInstant(startIdx);
    setCurrentIndex(startIdx);
    viewer.scene.requestRender();

    return () => {
      cancelFade();
      if (!viewer.isDestroyed()) {
        for (const group of frameLayersRef.current) {
          for (const l of group) viewer.imageryLayers.remove(l, true);
        }
      }
      frameLayersRef.current = [];
      shownIndexRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewer, active, frames, windowMinutes]);

  // Dissolve to the current frame whenever the index moves.
  useEffect(() => {
    if (!viewer || viewer.isDestroyed()) return;
    const groups = frameLayersRef.current;
    if (groups.length === 0) return;
    const to = Math.min(Math.max(0, currentIndex), groups.length - 1);
    // Finalize any in-flight dissolve to its own target first, so the new one
    // starts from what is (nearly) on screen.
    if (fadeRafRef.current != null && fadeTargetRef.current != null) {
      shownIndexRef.current = fadeTargetRef.current;
    }
    const from = shownIndexRef.current;
    cancelFade();
    // Dissolve only during playback; scrubbing snaps (see RadarLayer).
    if (from == null || from === to || !useGoesStore.getState().playing) {
      applyInstant(to);
      viewer.scene.requestRender();
      return;
    }
    const t0 = performance.now();
    // Forward playback: incoming frame is higher in the stack — ramp it in on
    // top. Loop wrap: incoming is below — hold it at target and fade the old
    // frame out to reveal it. Both directions are dip-free at full opacity.
    const forward = to > from;
    fadeTargetRef.current = to;
    const tick = () => {
      if (viewer.isDestroyed()) {
        fadeRafRef.current = null;
        return;
      }
      const t = Math.min(1, (performance.now() - t0) / FADE_MS);
      const target = useGoesStore.getState().opacity;
      groups.forEach((group, i) => {
        if (i === to) setGroupAlpha(group, forward ? target * t : target);
        else if (i === from) setGroupAlpha(group, forward ? target : target * (1 - t));
        else setGroupAlpha(group, 0);
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
      const s = useGoesStore.getState();
      const n = goesFramesInWindow(s.frames, s.windowMinutes).length;
      if (n === 0) return;
      s.setCurrentIndex((s.currentIndex + 1) % n);
    }, FRAME_MS);
    return () => clearInterval(interval);
  }, [viewer, active, playing]);

  return null;
}
