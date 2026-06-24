import * as Cesium from 'cesium';
import { useEffect, useRef } from 'react';
import { useCesiumViewer } from '../../cesium/CesiumContext';
import { useLayersStore } from '../../store/layersStore';
import { attachPanelData } from '../../cesium/entityPanelLink';
import { api } from '../../api/client';
import { useAqiStatus } from './aqiStore';
import type { AqiStation } from '../../types';

// Official EPA AQI color scale.
const CATEGORY_COLOR: Record<number, string> = {
  1: '#00e400', // Good
  2: '#ffff00', // Moderate
  3: '#ff7e00', // Unhealthy for Sensitive Groups
  4: '#ff0000', // Unhealthy
  5: '#8f3f97', // Very Unhealthy
  6: '#7e0023', // Hazardous
};

// Text color: dark text on light backgrounds (Good/Moderate), white elsewhere.
const TEXT_COLOR: Record<number, string> = {
  1: '#003300',
  2: '#555500',
  3: '#ffffff',
  4: '#ffffff',
  5: '#ffffff',
  6: '#ffffff',
};

function makeAqiSvg(aqi: number, categoryNum: number): string {
  const fill = CATEGORY_COLOR[categoryNum] ?? '#888888';
  const text = TEXT_COLOR[categoryNum] ?? '#ffffff';
  const fontSize = aqi >= 100 ? 10 : 12;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">` +
    `<circle cx="16" cy="16" r="14" fill="${fill}" stroke="#0a0e1a" stroke-width="2"/>` +
    `<text x="16" y="${16 + fontSize / 3}" text-anchor="middle" ` +
    `font-family="system-ui,sans-serif" font-size="${fontSize}" font-weight="bold" fill="${text}">${aqi}</text>` +
    `</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

const iconCache = new Map<string, string>();
function aqiIcon(station: AqiStation): string {
  const key = `${station.aqi}-${station.categoryNum}`;
  if (!iconCache.has(key)) iconCache.set(key, makeAqiSvg(station.aqi, station.categoryNum));
  return iconCache.get(key)!;
}

// Billboard size: 24px for Good, scaling up to 36px for Hazardous.
function iconSize(categoryNum: number): number {
  return 22 + (categoryNum - 1) * 3;
}

export function AqiLayer() {
  const viewer = useCesiumViewer();
  const active = useLayersStore((s) => s.active.aqi);
  const dsRef = useRef<Cesium.CustomDataSource | null>(null);

  useEffect(() => {
    if (!viewer) return;
    const ds = new Cesium.CustomDataSource('aqi');
    dsRef.current = ds;
    viewer.dataSources.add(ds);
    return () => {
      viewer.dataSources.remove(ds, true);
      dsRef.current = null;
    };
  }, [viewer]);

  useEffect(() => {
    const ds = dsRef.current;
    if (!viewer || !ds) return;

    if (!active) {
      ds.entities.removeAll();
      viewer.scene.requestRender();
      useAqiStatus.getState().setStatus({ count: 0, worstAqi: 0, worstCategory: '' });
      return;
    }

    let cancelled = false;

    const load = async () => {
      let data;
      try {
        data = await api.aqi();
      } catch (err) {
        if (cancelled) return;
        console.error('Failed to load AQI data', err);
        useAqiStatus.getState().setStatus({ error: 'AirNow feed unavailable' });
        return;
      }
      if (cancelled) return;

      if (data.noKey) {
        useAqiStatus.getState().setStatus({ noKey: true });
        return;
      }
      if (data.error) {
        useAqiStatus.getState().setStatus({ error: data.error });
        return;
      }

      ds.entities.removeAll();
      let worstAqi = 0;
      let worstCategory = '';

      for (const s of data.stations) {
        const sz = iconSize(s.categoryNum);
        const entity = ds.entities.add({
          id: s.id,
          position: Cesium.Cartesian3.fromDegrees(s.lon, s.lat, 0),
          billboard: {
            image: aqiIcon(s),
            width: sz,
            height: sz,
            verticalOrigin: Cesium.VerticalOrigin.CENTER,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
            // Fade out at globe scale so the map isn't a wall of dots.
            scaleByDistance: new Cesium.NearFarScalar(1.0e5, 1.0, 6.0e6, 0.3),
          },
        });
        attachPanelData(entity, {
          id: s.id,
          kind: 'aqi',
          title: s.reportingArea,
          subtitle: `AQI ${s.aqi} · ${s.categoryName}`,
          payload: s as unknown as Record<string, unknown>,
        });

        if (s.aqi > worstAqi) {
          worstAqi = s.aqi;
          worstCategory = s.categoryName;
        }
      }

      useAqiStatus.getState().setStatus({
        count: data.stations.length,
        worstAqi,
        worstCategory,
        error: null,
        noKey: false,
      });
      viewer.scene.requestRender();
    };

    load();
    // AirNow updates every hour; poll slightly less often to avoid hitting the
    // cache on the nose.
    const interval = setInterval(load, 65 * 60_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [viewer, active]);

  return null;
}
