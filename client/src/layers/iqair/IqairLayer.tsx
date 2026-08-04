import * as Cesium from 'cesium';
import { useEffect, useRef } from 'react';
import { useCesiumViewer } from '../../cesium/CesiumContext';
import { useLayersStore } from '../../store/layersStore';
import { attachPanelData } from '../../cesium/entityPanelLink';
import { api } from '../../api/client';
import { startVisiblePolling } from '../../lib/poll';
import { useIqairStatus } from './iqairStore';
import { CATEGORY_COLOR, TEXT_COLOR, aqiCategory } from './aqiScale';
import type { IqairResponse } from '../../types';

// Rounded-square badge — deliberately a different silhouette from the round
// AirNow badges so the two AQI layers stay distinguishable where they overlap
// (both can be on at once over the US).
function makeBadgeSvg(aqi: number): string {
  const cat = aqiCategory(aqi);
  const fill = CATEGORY_COLOR[cat];
  const text = TEXT_COLOR[cat];
  const fontSize = aqi >= 100 ? 10 : 12;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">` +
    `<rect x="2" y="2" width="28" height="28" rx="8" fill="${fill}" stroke="#0a0e1a" stroke-width="2"/>` +
    `<text x="16" y="${16 + fontSize / 3}" text-anchor="middle" ` +
    `font-family="system-ui,sans-serif" font-size="${fontSize}" font-weight="bold" fill="${text}">${aqi}</text>` +
    `</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

const iconCache = new Map<number, string>();
function badgeIcon(aqi: number): string {
  if (!iconCache.has(aqi)) iconCache.set(aqi, makeBadgeSvg(aqi));
  return iconCache.get(aqi)!;
}

// 22px for Good up to 37px for Hazardous — the world's worst air should read
// at a glance on a spun-out globe.
function badgeSize(aqi: number): number {
  return 22 + (aqiCategory(aqi) - 1) * 3;
}

export function IqairLayer() {
  const viewer = useCesiumViewer();
  const active = useLayersStore((s) => s.active.iqair);

  const dsRef = useRef<Cesium.CustomDataSource | null>(null);

  useEffect(() => {
    if (!viewer) return;
    const ds = new Cesium.CustomDataSource('iqair');
    dsRef.current = ds;
    viewer.dataSources.add(ds);
    return () => {
      viewer.dataSources.remove(ds, true);
      dsRef.current = null;
    };
  }, [viewer]);

  useEffect(() => {
    if (!viewer) return;
    if (!active) {
      const ds = dsRef.current;
      if (ds) ds.entities.removeAll();
      useIqairStatus.getState().setStatus({ count: 0, worstAqi: 0, worstCity: '' });
      viewer.scene.requestRender();
      return;
    }
    let cancelled = false;

    const render = (data: IqairResponse) => {
      const ds = dsRef.current;
      if (!ds) return;
      ds.entities.removeAll();

      let worstAqi = 0;
      let worstCity = '';
      let count = 0;
      for (const c of data.cities) {
        if (!Number.isFinite(c.lon) || !Number.isFinite(c.lat)) continue;
        if (c.lat < -90 || c.lat > 90 || c.lon < -180 || c.lon > 180) continue;
        if (!Number.isFinite(c.aqi)) continue;

        const sz = badgeSize(c.aqi);
        const entity = ds.entities.add({
          id: c.id,
          position: Cesium.Cartesian3.fromDegrees(c.lon, c.lat, 0),
          billboard: {
            image: badgeIcon(c.aqi),
            width: sz,
            height: sz,
            verticalOrigin: Cesium.VerticalOrigin.CENTER,
            // These are world cities meant to be read at globe scale — shrink
            // only slightly when fully zoomed out (vs the CONUS layer's 0.3).
            scaleByDistance: new Cesium.NearFarScalar(1.0e6, 1.0, 2.0e7, 0.55),
          },
        });
        attachPanelData(entity, {
          id: c.id,
          kind: 'iqair',
          title: c.city,
          subtitle: `AQI ${c.aqi} · ${c.categoryName} · IQAir`,
          payload: c as unknown as Record<string, unknown>,
        });

        count++;
        if (c.aqi > worstAqi) {
          worstAqi = c.aqi;
          worstCity = c.country ? `${c.city}, ${c.country}` : c.city;
        }
      }

      useIqairStatus.getState().setStatus({
        count,
        worstAqi,
        worstCity,
        noKey: !!data.noKey,
        sweeping: !!data.sweeping,
        error: data.error ?? null,
      });
      viewer.scene.requestRender();
    };

    const load = async () => {
      let data: IqairResponse;
      try {
        data = await api.iqair();
      } catch (err) {
        if (cancelled) return;
        console.error('Failed to load IQAir data', err);
        useIqairStatus.getState().setStatus({ error: 'IQAir feed unavailable' });
        return;
      }
      if (cancelled) return;
      render(data);
    };

    // The server sweeps IQAir every ~6h, but a boot-time sweep fills in over
    // ~16 min — 5-min polling picks that progress up without meaningful cost
    // (it only ever hits our own snapshot endpoint).
    const stopPolling = startVisiblePolling(() => void load(), 5 * 60_000);
    return () => {
      cancelled = true;
      stopPolling();
    };
  }, [viewer, active]);

  return null;
}
