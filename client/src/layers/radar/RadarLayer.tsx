import * as Cesium from 'cesium';
import { useEffect, useRef } from 'react';
import { useCesiumViewer } from '../../cesium/CesiumContext';
import { useLayersStore } from '../../store/layersStore';
import { api } from '../../api/client';
import type { RadarFrame } from '../../types';
import { useRadarStore, buildTimeline, nowIndex } from './radarStore';

// 512px tiles render noticeably smoother than 256 at the same zoom.
const TILE_SIZE = 512;
// smooth=1 turns on RainViewer's server-side bilinear interpolation; snow=0
// keeps everything in one clean reflectivity gradient instead of painting snow
// in a separate blue/purple palette (which looks patchy).
const RADAR_SMOOTH = 1;
const RADAR_SNOW = 0;
// Cap the radar overlay a few levels below the basemap. The underlying radar
// data is coarse, so requesting native high-zoom tiles just yields blocky
// pixels — letting Cesium smoothly upscale a level-9 tile looks far cleaner
// (this is the trick zoom.earth uses).
const RADAR_MAX_LEVEL = 9;
const SAT_COLOR = 0; // Classic IR (white = cold/high clouds)
const SAT_OPTIONS = '0';
// Frame dwell during playback (ms). A touch quicker than real-time for a fluid
// "play" feel without blowing past frames.
const FRAME_MS = 500;

function makeRadarProvider(host: string, frame: { path: string }, colorScheme: number) {
  return new Cesium.UrlTemplateImageryProvider({
    url: `${host}${frame.path}/${TILE_SIZE}/{z}/{x}/{y}/${colorScheme}/${RADAR_SMOOTH}_${RADAR_SNOW}.png`,
    maximumLevel: RADAR_MAX_LEVEL,
  });
}

function makeSatProvider(host: string, frame: { path: string }) {
  return new Cesium.UrlTemplateImageryProvider({
    url: `${host}${frame.path}/${TILE_SIZE}/{z}/{x}/{y}/${SAT_COLOR}/${SAT_OPTIONS}.png`,
    maximumLevel: 6,
  });
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
  const colorScheme = useRadarStore((s) => s.colorScheme);
  const setCurrentIndex = useRadarStore((s) => s.setCurrentIndex);

  // One imagery layer per timeline frame; we cross-fade by toggling alpha.
  const animLayersRef = useRef<Cesium.ImageryLayer[]>([]);
  // Static satellite base used only in 'combined' mode.
  const baseLayersRef = useRef<Cesium.ImageryLayer[]>([]);

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
    load();
    const interval = setInterval(load, 2 * 60_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [active]);

  // Rebuild the layer stack when the mode / frames / window / palette change.
  useEffect(() => {
    if (!viewer) return;

    for (const l of [...baseLayersRef.current, ...animLayersRef.current]) {
      viewer.imageryLayers.remove(l, true);
    }
    baseLayersRef.current = [];
    animLayersRef.current = [];

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

    // Combined mode: a subdued static satellite base under the animated radar.
    if (mode === 'combined' && satelliteFrames.length > 0) {
      const latest = satelliteFrames[satelliteFrames.length - 1];
      const base = viewer.imageryLayers.addImageryProvider(makeSatProvider(host, latest));
      base.alpha = opacity * 0.45;
      baseLayersRef.current = [base];
    }

    const makeProvider =
      mode === 'satellite'
        ? (f: RadarFrame) => makeSatProvider(host, f)
        : (f: RadarFrame) => makeRadarProvider(host, f, colorScheme);

    animLayersRef.current = timeline.map((t) => {
      const layer = viewer.imageryLayers.addImageryProvider(makeProvider(t.frame));
      layer.alpha = 0;
      return layer;
    });

    // Start paused on "now" (latest observed) so the first thing shown is the
    // current conditions; playback runs forward into the forecast then loops.
    setCurrentIndex(nowIndex(timeline));
    viewer.scene.requestRender();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewer, active, host, frames, nowcastFrames, satelliteFrames, mode, windowMinutes, colorScheme]);

  // Sync alpha with the current frame / opacity.
  useEffect(() => {
    if (!viewer) return;
    animLayersRef.current.forEach((l, i) => {
      l.alpha = i === currentIndex ? opacity : 0;
    });
    baseLayersRef.current.forEach((l) => {
      l.alpha = opacity * 0.45;
    });
    viewer.scene.requestRender();
  }, [viewer, currentIndex, opacity, mode]);

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
