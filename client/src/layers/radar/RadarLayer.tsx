import * as Cesium from 'cesium';
import { useEffect, useRef } from 'react';
import { useCesiumViewer } from '../../cesium/CesiumContext';
import { addImageryBelowLabels } from '../../cesium/imageryOrder';
import { useLayersStore } from '../../store/layersStore';
import { api } from '../../api/client';
import { startVisiblePolling } from '../../lib/poll';
import type { RadarFrame } from '../../types';
import { useRadarStore, buildTimeline, nowIndex } from './radarStore';
import { makeCloudProvider, makeRadarProvider } from './RainViewerImagery';

// Frame dwell during playback (ms), and the crossfade between frames. The
// fade is what turns stepping through 10-minute snapshots into something that
// reads as motion instead of a slideshow.
const FRAME_MS = 500;
const FADE_MS = 240;
// Clouds sit dimmer than radar in combined mode so precipitation stays the
// subject of the composition.
const CLOUD_ALPHA = 0.7;

// Index of the satellite frame nearest in time to `time`, or -1 when nothing
// is within tolerance. Radar and IR frames are both ~10-minute cadences but
// not perfectly aligned, so playback pairs each radar frame with its closest
// cloud snapshot (nowcast frames just reuse the latest clouds).
function nearestFrameIndex(frames: RadarFrame[], time: number, maxDeltaSec = 3600): number {
  let best = -1;
  let bestDelta = maxDeltaSec + 1;
  for (let i = 0; i < frames.length; i++) {
    const d = Math.abs(frames[i].time - time);
    if (d < bestDelta) {
      bestDelta = d;
      best = i;
    }
  }
  return best;
}

function easeInOut(t: number): number {
  return t * t * (3 - 2 * t);
}

export function RadarLayer() {
  const viewer = useCesiumViewer();
  const active = useLayersStore((s) => s.active.radar);
  const host = useRadarStore((s) => s.host);
  const frames = useRadarStore((s) => s.frames);
  const nowcastFrames = useRadarStore((s) => s.nowcastFrames);
  const satelliteFrames = useRadarStore((s) => s.satelliteFrames);
  const mode = useRadarStore((s) => s.mode);
  const windowMinutes = useRadarStore((s) => s.windowMinutes);
  const currentIndex = useRadarStore((s) => s.currentIndex);
  const opacity = useRadarStore((s) => s.opacity);
  const playing = useRadarStore((s) => s.playing);
  const palette = useRadarStore((s) => s.palette);
  const setCurrentIndex = useRadarStore((s) => s.setCurrentIndex);

  // One imagery layer per timeline frame (radar, or clouds in satellite
  // mode); playback crossfades their alphas.
  const animLayersRef = useRef<Cesium.ImageryLayer[]>([]);
  // Combined mode only: keyed-cloud layers under the radar, one per distinct
  // satellite frame the timeline maps onto.
  const cloudLayersRef = useRef<Cesium.ImageryLayer[]>([]);
  // timeline index → index into cloudLayersRef (-1 = no clouds for frame).
  const cloudMapRef = useRef<number[]>([]);
  // Which timeline index is currently displayed, and the in-flight fade.
  const shownIndexRef = useRef<number | null>(null);
  const fadeRafRef = useRef<number | null>(null);

  // Fetch manifest periodically.
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const load = async () => {
      try {
        const manifest = await api.radarManifest();
        if (cancelled) return;
        useRadarStore
          .getState()
          .setManifest(
            manifest.host,
            manifest.radar.past,
            manifest.radar.nowcast ?? [],
            manifest.satellite?.infrared ?? []
          );
      } catch (err) {
        console.error('Failed to load radar manifest', err);
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
  };

  // Target alphas for the current mode/opacity (per-pixel translucency lives
  // in the palette; these only scale it).
  const targets = () => {
    const s = useRadarStore.getState();
    return {
      anim: s.opacity,
      cloud: s.opacity * CLOUD_ALPHA,
    };
  };

  // Snap every layer to a frame with no fade (initial display, scrubbing
  // resets, opacity changes).
  const applyInstant = (idx: number) => {
    const t = targets();
    animLayersRef.current.forEach((l, i) => {
      l.alpha = i === idx ? t.anim : 0;
    });
    const cloudIdx = cloudMapRef.current[idx] ?? -1;
    cloudLayersRef.current.forEach((l, i) => {
      l.alpha = i === cloudIdx ? t.cloud : 0;
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

    const timeline = buildTimeline({
      mode,
      frames,
      nowcastFrames,
      satelliteFrames,
      windowMinutes,
    });
    if (timeline.length === 0) {
      viewer.scene.requestRender();
      return;
    }

    // Combined mode: animated keyed-cloud layers below the radar, each radar
    // frame paired with its nearest-in-time IR snapshot so clouds move with
    // the precipitation (added first so they stack under the radar).
    if (mode === 'combined' && satelliteFrames.length > 0) {
      const satIdxPerFrame = timeline.map((t) => nearestFrameIndex(satelliteFrames, t.time));
      const layerBySatIdx = new Map<number, number>();
      for (const satIdx of satIdxPerFrame) {
        if (satIdx >= 0 && !layerBySatIdx.has(satIdx)) {
          const layer = addImageryBelowLabels(
            viewer,
            makeCloudProvider(host, satelliteFrames[satIdx])
          );
          layer.alpha = 0;
          layerBySatIdx.set(satIdx, cloudLayersRef.current.length);
          cloudLayersRef.current.push(layer);
        }
      }
      cloudMapRef.current = satIdxPerFrame.map((satIdx) => layerBySatIdx.get(satIdx) ?? -1);
    } else {
      cloudMapRef.current = [];
    }

    const makeProvider =
      mode === 'satellite'
        ? (f: RadarFrame) => makeCloudProvider(host, f)
        : (f: RadarFrame) => makeRadarProvider(host, f, palette);

    animLayersRef.current = timeline.map((t) => {
      const layer = addImageryBelowLabels(viewer, makeProvider(t.frame));
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
        for (const l of [...cloudLayersRef.current, ...animLayersRef.current]) {
          viewer.imageryLayers.remove(l, true);
        }
      }
      cloudLayersRef.current = [];
      animLayersRef.current = [];
      cloudMapRef.current = [];
      shownIndexRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewer, active, host, frames, nowcastFrames, satelliteFrames, mode, windowMinutes, palette]);

  // Crossfade to the current frame whenever the index moves.
  useEffect(() => {
    if (!viewer || viewer.isDestroyed()) return;
    const layers = animLayersRef.current;
    if (layers.length === 0) return;
    const to = Math.min(Math.max(0, currentIndex), layers.length - 1);
    const from = shownIndexRef.current;
    cancelFade();
    if (from == null || from === to) {
      applyInstant(to);
      viewer.scene.requestRender();
      return;
    }
    const t0 = performance.now();
    const fromCloud = cloudMapRef.current[from] ?? -1;
    const toCloud = cloudMapRef.current[to] ?? -1;
    const tick = () => {
      if (viewer.isDestroyed()) {
        fadeRafRef.current = null;
        return;
      }
      const t = Math.min(1, (performance.now() - t0) / FADE_MS);
      const e = easeInOut(t);
      const tgt = targets();
      layers.forEach((l, i) => {
        l.alpha = i === to ? tgt.anim * e : i === from ? tgt.anim * (1 - e) : 0;
      });
      cloudLayersRef.current.forEach((l, i) => {
        if (fromCloud === toCloud) {
          l.alpha = i === toCloud ? tgt.cloud : 0;
        } else {
          l.alpha = i === toCloud ? tgt.cloud * e : i === fromCloud ? tgt.cloud * (1 - e) : 0;
        }
      });
      viewer.scene.requestRender();
      if (t < 1) {
        fadeRafRef.current = requestAnimationFrame(tick);
      } else {
        fadeRafRef.current = null;
        shownIndexRef.current = to;
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
