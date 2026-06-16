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

// Cross-fade frame opacities: blend `from`→`to` by t∈[0,1]; hide all others.
// This is what makes playback read as a smooth morph instead of a hard cut.
function blendFrameAlphas(
  layers: Cesium.ImageryLayer[],
  from: number,
  to: number,
  t: number,
  baseAlpha: number
) {
  for (let i = 0; i < layers.length; i++) {
    let a = 0;
    if (i === from && i === to) a = baseAlpha;
    else if (i === from) a = baseAlpha * (1 - t);
    else if (i === to) a = baseAlpha * t;
    layers[i].alpha = a;
  }
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

  // While PAUSED, hard-set the single scrubbed frame. (During playback the
  // cross-fade player below owns the layer alphas, so this stays out of its way.)
  useEffect(() => {
    if (!viewer || playing) return;
    // 'combined' animates the radar layers; its satellite base keeps its own alpha.
    const layers = mode === 'satellite' ? satLayersRef.current : radarLayersRef.current;
    layers.forEach((l, i) => {
      l.alpha = i === currentIndex ? opacity : 0;
    });
    viewer.scene.requestRender();
  }, [viewer, currentIndex, opacity, mode, playing]);

  // Smooth cross-fade player. Instead of snapping between frames, it holds each
  // frame briefly then blends into the next over a short fade, driving renders
  // itself (the scene is in on-demand render mode). Pauses a beat on the newest
  // frame before looping back to the oldest.
  useEffect(() => {
    if (!viewer || !active || !playing) return;

    const DWELL_MS = 500; // hold a frame fully visible
    const FADE_MS = 420; // cross-fade into the next frame
    const END_PAUSE_MS = 900; // extra hold on the newest frame before looping

    let raf = 0;
    let from = Math.max(0, useRadarStore.getState().currentIndex);
    let segStart = performance.now();

    const tick = (now: number) => {
      // Read layers fresh each tick so a manifest refresh (which rebuilds the
      // layer stack) is picked up without a stale reference.
      const layers = mode === 'satellite' ? satLayersRef.current : radarLayersRef.current;
      const n = layers.length;
      if (n === 0) {
        raf = requestAnimationFrame(tick);
        return;
      }
      if (from >= n) from = n - 1;

      if (n === 1) {
        layers[0].alpha = opacity;
      } else {
        const to = (from + 1) % n;
        const isLast = from === n - 1;
        const dwell = DWELL_MS + (isLast ? END_PAUSE_MS : 0);
        const elapsed = now - segStart;

        if (elapsed < dwell) {
          blendFrameAlphas(layers, from, from, 0, opacity);
        } else if (elapsed < dwell + FADE_MS) {
          blendFrameAlphas(layers, from, to, (elapsed - dwell) / FADE_MS, opacity);
        } else {
          from = to;
          segStart = now;
          blendFrameAlphas(layers, from, from, 0, opacity);
          useRadarStore.getState().setCurrentIndex(from);
        }
      }

      viewer.scene.requestRender();
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // Restart cleanly whenever the layer stack is rebuilt.
  }, [viewer, active, playing, mode, opacity, frames, satelliteFrames, windowMinutes, colorScheme, host]);

  return null;
}
