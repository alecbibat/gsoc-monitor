import * as Cesium from 'cesium';
import { useEffect } from 'react';
import { useCesiumViewer } from '../../cesium/CesiumContext';
import { useLayersStore } from '../../store/layersStore';
import { useLightningStatus } from './lightningStore';
import { api } from '../../api/client';
import { startVisiblePolling } from '../../lib/poll';

// How often to refresh the windowed history from the server. Strikes age slowly
// relative to the windows (1–24h), so a 30 s cadence keeps the field current
// without much traffic (the payload is capped server-side).
const REFRESH_MS = 30_000;

// The live layer (LightningLayer) owns the freshest strikes with its animated
// crosshairs over a 10-minute lifetime; the history point cloud renders the
// older tail only, so the two never double-mark the same strike.
const LIVE_MS = 10 * 60_000;

const hex = (s: string) => Cesium.Color.fromCssColorString(s);
// Age buckets aligned to the selectable windows (1h / 6h / 12h / 24h). Newer =
// brighter and warmer; older fades and cools so the recency reads at a glance.
const AGE_COLORS = {
  h1: hex('#ffd84d').withAlpha(0.95),
  h6: hex('#ff9d2e').withAlpha(0.82),
  h12: hex('#ff5a3c').withAlpha(0.64),
  h24: hex('#d8466e').withAlpha(0.46),
};
function ageColor(ageMs: number): Cesium.Color {
  const h = ageMs / 3_600_000;
  if (h < 1) return AGE_COLORS.h1;
  if (h < 6) return AGE_COLORS.h6;
  if (h < 12) return AGE_COLORS.h12;
  return AGE_COLORS.h24;
}

// Server-backed historical strike field. Renders the selected time window
// (minus the live ~10 min) as a lightweight PointPrimitiveCollection — cheap
// enough for the ~20k-point cap even on a weak GPU.
export function LightningHistoryLayer() {
  const viewer = useCesiumViewer();
  const active = useLayersStore((s) => s.active.lightning);
  const windowMinutes = useLightningStatus((s) => s.windowMinutes);

  useEffect(() => {
    if (!viewer || !active) return;
    const v = viewer;

    const points = new Cesium.PointPrimitiveCollection();
    v.scene.primitives.add(points);

    let cancelled = false;
    const setHistory = useLightningStatus.getState().setHistory;

    const render = (lat: number[], lon: number[], t: number[]) => {
      points.removeAll();
      const now = Date.now();
      for (let i = 0; i < t.length; i++) {
        const ageMs = now - t[i] * 1000;
        if (ageMs < LIVE_MS) continue; // leave the freshest to the live layer
        points.add({
          position: Cesium.Cartesian3.fromDegrees(lon[i], lat[i]),
          pixelSize: 5,
          color: ageColor(ageMs),
          // Default depth test (no disableDepthTestDistance) so strikes on the
          // far side of the globe stay hidden behind it.
        });
      }
      v.scene.requestRender();
    };

    const load = async () => {
      setHistory({ loading: true });
      try {
        const resp = await api.lightningHistory(windowMinutes);
        if (cancelled) return;
        render(resp.lat, resp.lon, resp.t);
        setHistory({
          loading: false,
          error: false,
          count: resp.totalInWindow,
          coverageMin: resp.coverageMin,
          thinned: resp.thinned,
        });
      } catch {
        if (!cancelled) setHistory({ loading: false, error: true });
      }
    };

    const stopPolling = startVisiblePolling(() => void load(), REFRESH_MS);

    return () => {
      cancelled = true;
      stopPolling();
      // remove() destroys the collection and its GPU resources.
      v.scene.primitives.remove(points);
      v.scene.requestRender();
    };
  }, [viewer, active, windowMinutes]);

  return null;
}
