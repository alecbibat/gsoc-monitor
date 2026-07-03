import * as Cesium from 'cesium';
import { useEffect, useRef } from 'react';
import { useCesiumViewer } from '../../cesium/CesiumContext';
import { useLayersStore } from '../../store/layersStore';
import { useXweatherStore, xwLayerCode } from './xweatherStore';

// Xweather (Vaisala NLDN) lightning raster overlay — the Dataminr-style strike
// map. Tiles come through our server proxy (/api/xweather/tiles) so the paid
// keys never reach the browser; the proxy 501s when no keys are configured and
// the sidebar shows a setup hint instead.
//
// Icon layers bill at a 10x multiplier per tile upstream, so the zoom ceiling
// is capped (the icons are pre-rendered and stay legible when upscaled) and
// the server caches tiles.

const MAX_LEVEL = 9;

export function XweatherLightningLayer() {
  const viewer = useCesiumViewer();
  const active = useLayersStore(
    (s) => (s.active as Record<string, boolean>).xweatherLightning ?? false
  );
  const configured = useXweatherStore((s) => s.configured);
  const mode = useXweatherStore((s) => s.mode);
  const window = useXweatherStore((s) => s.window);
  const time = useXweatherStore((s) => s.time);

  const layerRef = useRef<Cesium.ImageryLayer | null>(null);

  // One-time key check per activation, so the toggle can hint at setup.
  useEffect(() => {
    if (!active || configured !== null) return;
    let cancelled = false;
    fetch('/api/xweather/status')
      .then((r) => r.json())
      .then((j: { configured?: boolean }) => {
        if (!cancelled) useXweatherStore.getState().setConfigured(Boolean(j.configured));
      })
      .catch(() => {
        if (!cancelled) useXweatherStore.getState().setConfigured(false);
      });
    return () => {
      cancelled = true;
    };
  }, [active, configured]);

  useEffect(() => {
    if (!viewer) return;
    const v = viewer;

    if (layerRef.current) {
      v.imageryLayers.remove(layerRef.current, true);
      layerRef.current = null;
    }
    if (!active || !configured) {
      v.scene.requestRender();
      return;
    }

    const code = xwLayerCode(mode, window);
    const provider = new Cesium.UrlTemplateImageryProvider({
      url: `/api/xweather/tiles/${code}/{z}/{x}/{y}/${time}.png`,
      maximumLevel: MAX_LEVEL,
    });
    const layer = v.imageryLayers.addImageryProvider(provider);
    layer.alpha = 0.95;
    layerRef.current = layer;
    v.scene.requestRender();

    return () => {
      if (layerRef.current) {
        v.imageryLayers.remove(layerRef.current, true);
        layerRef.current = null;
        v.scene.requestRender();
      }
    };
  }, [viewer, active, configured, mode, window, time]);

  return null;
}
