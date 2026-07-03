import * as Cesium from 'cesium';
import { useEffect, useRef, useState } from 'react';
import { useCesiumViewer } from '../../cesium/CesiumContext';
import { useXweatherStore } from './xweatherStore';

// Shared machinery for the Xweather raster overlays (lightning, storm cells).
// Tiles come through our server proxy (/api/xweather/tiles) so the paid keys
// never reach the browser; the proxy 501s when no keys are configured and the
// sidebar shows a setup hint instead. Zoom is capped (icon/cell markers are
// pre-rendered and stay legible upscaled) to bound metered tile spend.

const MAX_LEVEL = 9;
// While showing "current", bump a cache-buster every 5 minutes (the layers'
// update cadence) so the view stays live; historical times are immutable.
const REFRESH_MS = 5 * 60_000;

// One-time key check per app session, shared by every Xweather layer.
export function useXwConfigured(active: boolean): boolean | null {
  const configured = useXweatherStore((s) => s.configured);
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
  return configured;
}

export function XwTileLayer({ active, code, time }: { active: boolean; code: string; time: string }) {
  const viewer = useCesiumViewer();
  const configured = useXwConfigured(active);
  const layerRef = useRef<Cesium.ImageryLayer | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  // Live view: re-fetch tiles on the update cadence. The ?v= cache-buster only
  // changes the URL — the server proxy caches by tile+time, so a refresh costs
  // at most one upstream fetch per visible tile.
  useEffect(() => {
    if (!active || time !== 'current') return;
    const t = setInterval(() => setRefreshTick((n) => n + 1), REFRESH_MS);
    return () => clearInterval(t);
  }, [active, time]);

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

    const buster = time === 'current' ? `?v=${refreshTick}` : '';
    const provider = new Cesium.UrlTemplateImageryProvider({
      url: `/api/xweather/tiles/${code}/{z}/{x}/{y}/${time}.png${buster}`,
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
  }, [viewer, active, configured, code, time, refreshTick]);

  return null;
}
