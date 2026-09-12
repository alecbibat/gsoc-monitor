import * as Cesium from 'cesium';
import { useEffect, useRef } from 'react';
import { useCesiumViewer } from '../../cesium/CesiumContext';
import { addImageryBelowLabels } from '../../cesium/labelOverlay';
import { useLayersStore } from '../../store/layersStore';
import { api } from '../../api/client';
import { startVisiblePolling } from '../../lib/poll';
import { useRadarStore } from './radarStore';
import { buildTimeline, clampIndex, nextIndex, nowIndex } from './radarTimeline';
import { makeRadarProvider } from './rainviewer';

// RainViewer publishes a frame every 10 minutes; polling a bit faster keeps
// the newest frame within a couple of minutes of publication.
const POLL_MS = 2 * 60_000;
// Playback cadence, with a longer hold on the final frame before looping so
// the eye can settle on the latest picture.
const FRAME_MS = 650;
const END_HOLD_MS = 1500;

// Animated precipitation radar: one imagery layer per timeline frame, all kept
// loaded, with only the current frame's alpha above zero. Cesium skips
// zero-alpha imagery when it draws, so resident frames cost nothing until
// they're stepped to — which is what makes scrubbing and playback instant.
export function RadarLayer() {
  const viewer = useCesiumViewer();
  const active = useLayersStore((s) => s.active.radar);
  const host = useRadarStore((s) => s.host);
  const past = useRadarStore((s) => s.past);
  const nowcast = useRadarStore((s) => s.nowcast);
  const windowMinutes = useRadarStore((s) => s.windowMinutes);
  const currentIndex = useRadarStore((s) => s.currentIndex);
  const playing = useRadarStore((s) => s.playing);
  const opacity = useRadarStore((s) => s.opacity);

  // Layers keyed by frame path, plus the timeline order of those paths. A
  // manifest refresh then only adds the new frame and drops the expired one —
  // the frame on screen is never torn down and re-downloaded.
  const layersRef = useRef(new Map<string, Cesium.ImageryLayer>());
  const orderRef = useRef<string[]>([]);

  const showFrame = (index: number, alpha: number) => {
    orderRef.current.forEach((path, i) => {
      const layer = layersRef.current.get(path);
      if (layer) layer.alpha = i === index ? alpha : 0;
    });
  };

  // Poll the manifest while the layer is on.
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const load = async () => {
      try {
        const manifest = await api.radarManifest();
        if (!cancelled) useRadarStore.getState().setManifest(manifest);
      } catch (err) {
        if (!cancelled) {
          useRadarStore.getState().setError(err instanceof Error ? err.message : String(err));
        }
      }
    };
    const stop = startVisiblePolling(() => void load(), POLL_MS);
    return () => {
      cancelled = true;
      stop();
    };
  }, [active]);

  // Drop every layer when the viewer goes away — on unmount, or when a WebGL
  // context loss rebuilds it (a destroyed viewer must not be touched; the
  // reconcile effect below repopulates the new one).
  useEffect(() => {
    const layers = layersRef.current;
    return () => {
      if (viewer && !viewer.isDestroyed()) {
        for (const layer of layers.values()) viewer.imageryLayers.remove(layer, true);
      }
      layers.clear();
      orderRef.current = [];
    };
  }, [viewer]);

  // Reconcile the layer stack with the current timeline.
  useEffect(() => {
    if (!viewer || viewer.isDestroyed()) return;
    const layers = layersRef.current;
    const timeline = active && host ? buildTimeline(past, nowcast, windowMinutes) : [];
    const wanted = new Set(timeline.map((t) => t.frame.path));
    for (const [path, layer] of layers) {
      if (!wanted.has(path)) {
        viewer.imageryLayers.remove(layer, true);
        layers.delete(path);
      }
    }
    for (const t of timeline) {
      if (!layers.has(t.frame.path)) {
        const layer = addImageryBelowLabels(viewer, makeRadarProvider(host, t.frame));
        layer.alpha = 0;
        layers.set(t.frame.path, layer);
      }
    }
    const hadFrames = orderRef.current.length > 0;
    orderRef.current = timeline.map((t) => t.frame.path);

    // First frames in: open on the newest observed picture (current
    // conditions) and let playback run forward from there. Later updates just
    // keep the index in range.
    const s = useRadarStore.getState();
    const index = hadFrames ? clampIndex(s.currentIndex, timeline.length) : nowIndex(timeline);
    if (index !== s.currentIndex) s.setCurrentIndex(index);
    showFrame(index, s.opacity);
    viewer.scene.requestRender();
  }, [viewer, active, host, past, nowcast, windowMinutes]);

  // Step the visible frame; apply opacity changes live.
  useEffect(() => {
    if (!viewer || viewer.isDestroyed()) return;
    showFrame(clampIndex(currentIndex, orderRef.current.length), opacity);
    viewer.scene.requestRender();
  }, [viewer, currentIndex, opacity]);

  // Playback.
  useEffect(() => {
    if (!active || !playing) return;
    let timer = 0;
    const tick = () => {
      const s = useRadarStore.getState();
      const length = buildTimeline(s.past, s.nowcast, s.windowMinutes).length;
      if (length > 1) s.setCurrentIndex(nextIndex(s.currentIndex, length));
      const atEnd = length > 1 && useRadarStore.getState().currentIndex === length - 1;
      timer = window.setTimeout(tick, atEnd ? END_HOLD_MS : FRAME_MS);
    };
    timer = window.setTimeout(tick, FRAME_MS);
    return () => window.clearTimeout(timer);
  }, [active, playing]);

  return null;
}
