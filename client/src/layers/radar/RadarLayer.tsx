import * as Cesium from 'cesium';
import { useEffect, useRef } from 'react';
import { useCesiumViewer } from '../../cesium/CesiumContext';
import { useLayersStore } from '../../store/layersStore';
import { api } from '../../api/client';
import { useRadarStore, framesInWindow } from './radarStore';

const TILE_SIZE = 256;
const COLOR_SCHEME = 2; // RainViewer "Universal Blue" palette
const TILE_OPTIONS = '1_1'; // smooth + snow shown separately

export function RadarLayer() {
  const viewer = useCesiumViewer();
  const active = useLayersStore((s) => s.active.radar);
  const host = useRadarStore((s) => s.host);
  const frames = useRadarStore((s) => s.frames);
  const windowMinutes = useRadarStore((s) => s.windowMinutes);
  const currentIndex = useRadarStore((s) => s.currentIndex);
  const opacity = useRadarStore((s) => s.opacity);
  const playing = useRadarStore((s) => s.playing);
  const setCurrentIndex = useRadarStore((s) => s.setCurrentIndex);
  const layersRef = useRef<Cesium.ImageryLayer[]>([]);

  // Pull the frame manifest periodically while the layer is active.
  useEffect(() => {
    if (!active) return;
    let cancelled = false;

    const load = async () => {
      try {
        const manifest = await api.radarManifest();
        if (cancelled) return;
        useRadarStore.getState().setManifest(manifest.host, manifest.radar.past);
      } catch (err) {
        console.error('Failed to load radar manifest', err);
      }
    }

    load();
    const interval = setInterval(load, 2 * 60_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [active]);

  // Rebuild the imagery layer stack whenever the layer is toggled or the
  // available frames / selected timeframe window changes.
  useEffect(() => {
    if (!viewer) return;

    if (active && host && frames.length > 0) {
      const windowed = framesInWindow(frames, windowMinutes);
      layersRef.current = windowed.map((frame) => {
        const provider = new Cesium.UrlTemplateImageryProvider({
          url: `${host}${frame.path}/${TILE_SIZE}/{z}/{x}/{y}/${COLOR_SCHEME}/${TILE_OPTIONS}.png`,
          maximumLevel: 12,
        });
        const layer = viewer.imageryLayers.addImageryProvider(provider);
        layer.alpha = 0;
        return layer;
      });
      setCurrentIndex(windowed.length - 1);
      viewer.scene.requestRender();
    }

    return () => {
      for (const layer of layersRef.current) {
        viewer.imageryLayers.remove(layer, true);
      }
      layersRef.current = [];
      viewer.scene.requestRender();
    };
  }, [viewer, active, host, frames, windowMinutes, setCurrentIndex]);

  // Keep imagery layer alphas in sync with the current frame / opacity.
  useEffect(() => {
    if (!viewer) return;
    layersRef.current.forEach((layer, idx) => {
      layer.alpha = idx === currentIndex ? opacity : 0;
    });
    viewer.scene.requestRender();
  }, [viewer, currentIndex, opacity]);

  // Advance the animation while playing.
  useEffect(() => {
    if (!viewer || !active || !playing) return;
    const interval = setInterval(() => {
      const state = useRadarStore.getState();
      const windowed = framesInWindow(state.frames, state.windowMinutes);
      if (windowed.length === 0) return;
      state.setCurrentIndex((state.currentIndex + 1) % windowed.length);
    }, 600);
    return () => clearInterval(interval);
  }, [viewer, active, playing]);

  return null;
}
