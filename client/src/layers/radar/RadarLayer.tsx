import * as Cesium from 'cesium';
import { useEffect, useRef } from 'react';
import { useCesiumViewer } from '../../cesium/CesiumContext';
import { useLayersStore } from '../../store/layersStore';
import { api } from '../../api/client';
import { useRadarStore, framesInWindow } from './radarStore';

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
const SAT_COLOR = 0;      // Classic IR (white = cold/high clouds)
const SAT_OPTIONS = '0';

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
  const satelliteFrames = useRadarStore((s) => s.satelliteFrames);
  const mode = useRadarStore((s) => s.mode);
  const windowMinutes = useRadarStore((s) => s.windowMinutes);
  const currentIndex = useRadarStore((s) => s.currentIndex);
  const opacity = useRadarStore((s) => s.opacity);
  const playing = useRadarStore((s) => s.playing);
  const colorScheme = useRadarStore((s) => s.colorScheme);
  const setCurrentIndex = useRadarStore((s) => s.setCurrentIndex);

  // Animated radar frames
  const radarLayersRef = useRef<Cesium.ImageryLayer[]>([]);
  // Static satellite base (used in 'combined' mode) or animated sat frames (satellite mode)
  const satLayersRef = useRef<Cesium.ImageryLayer[]>([]);

  // Fetch manifest periodically
  useEffect(() => {
    if (!active) return;
    let cancelled = false;

    const load = async () => {
      try {
        const manifest = await api.radarManifest();
        if (cancelled) return;
        useRadarStore.getState().setManifest(
          manifest.host,
          manifest.radar.past,
          manifest.satellite?.infrared ?? [],
        );
      } catch (err) {
        console.error('Failed to load radar manifest', err);
      }
    };

    load();
    const interval = setInterval(load, 2 * 60_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [active]);

  // Rebuild layer stacks when mode / frames / window changes
  useEffect(() => {
    if (!viewer) return;

    // Tear down everything first
    for (const l of [...satLayersRef.current, ...radarLayersRef.current]) {
      viewer.imageryLayers.remove(l, true);
    }
    satLayersRef.current = [];
    radarLayersRef.current = [];

    if (!active || !host) {
      viewer.scene.requestRender();
      return;
    }

    if (mode === 'radar' && frames.length > 0) {
      const windowed = framesInWindow(frames, windowMinutes);
      radarLayersRef.current = windowed.map((frame) => {
        const layer = viewer.imageryLayers.addImageryProvider(makeRadarProvider(host, frame, colorScheme));
        layer.alpha = 0;
        return layer;
      });
      setCurrentIndex(windowed.length - 1);

    } else if (mode === 'satellite' && satelliteFrames.length > 0) {
      // Animate satellite frames
      const windowed = framesInWindow(satelliteFrames, windowMinutes);
      satLayersRef.current = windowed.map((frame) => {
        const layer = viewer.imageryLayers.addImageryProvider(makeSatProvider(host, frame));
        layer.alpha = 0;
        return layer;
      });
      setCurrentIndex(windowed.length - 1);

    } else if (mode === 'combined') {
      // Static satellite base (latest frame)
      if (satelliteFrames.length > 0) {
        const latest = satelliteFrames[satelliteFrames.length - 1];
        const satLayer = viewer.imageryLayers.addImageryProvider(makeSatProvider(host, latest));
        satLayer.alpha = opacity * 0.45; // subdued base
        satLayersRef.current = [satLayer];
      }
      // Animated radar on top
      if (frames.length > 0) {
        const windowed = framesInWindow(frames, windowMinutes);
        radarLayersRef.current = windowed.map((frame) => {
          const layer = viewer.imageryLayers.addImageryProvider(makeRadarProvider(host, frame, colorScheme));
          layer.alpha = 0;
          return layer;
        });
        setCurrentIndex(windowed.length - 1);
      }
    }

    viewer.scene.requestRender();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewer, active, host, frames, satelliteFrames, mode, windowMinutes, colorScheme]);

  // Sync alpha with currentIndex / opacity
  useEffect(() => {
    if (!viewer) return;

    if (mode === 'radar') {
      radarLayersRef.current.forEach((l, i) => {
        l.alpha = i === currentIndex ? opacity : 0;
      });
    } else if (mode === 'satellite') {
      satLayersRef.current.forEach((l, i) => {
        l.alpha = i === currentIndex ? opacity : 0;
      });
    } else {
      // combined — satellite base stays at its fixed opacity; animate radar on top
      radarLayersRef.current.forEach((l, i) => {
        l.alpha = i === currentIndex ? opacity : 0;
      });
    }

    viewer.scene.requestRender();
  }, [viewer, currentIndex, opacity, mode]);

  // Animation ticker
  useEffect(() => {
    if (!viewer || !active || !playing) return;

    const interval = setInterval(() => {
      const state = useRadarStore.getState();
      const source = state.mode === 'satellite' ? state.satelliteFrames : state.frames;
      const windowed = framesInWindow(source, state.windowMinutes);
      if (windowed.length === 0) return;
      state.setCurrentIndex((state.currentIndex + 1) % windowed.length);
    }, 600);

    return () => clearInterval(interval);
  }, [viewer, active, playing]);

  return null;
}
