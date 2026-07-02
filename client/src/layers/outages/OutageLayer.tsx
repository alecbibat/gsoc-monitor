import * as Cesium from 'cesium';
import { useEffect, useRef } from 'react';
import { useCesiumViewer } from '../../cesium/CesiumContext';
import { useLayersStore } from '../../store/layersStore';
import { attachPanelData } from '../../cesium/entityPanelLink';
import { useOutagesStatus } from './outagesStore';
import { fetchOutages, outageColor } from './outagesData';

// A lightning-bolt-in-ring marker, colored by outage type.
const iconCache = new Map<string, string>();
function outageIcon(color: string): string {
  const cached = iconCache.get(color);
  if (cached) return cached;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">` +
    `<circle cx="12" cy="12" r="10" fill="#0a0c10" stroke="${color}" stroke-width="2"/>` +
    `<path d="M13 4 L7 13 H11 L10.5 20 L17 11 H13 Z" fill="${color}" stroke="${color}" stroke-width="0.6" stroke-linejoin="round"/>` +
    `</svg>`;
  const url = `data:image/svg+xml,${encodeURIComponent(svg)}`;
  iconCache.set(color, url);
  return url;
}

function custLabel(n: number | null): string {
  if (n == null || n <= 0) return '';
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return String(n);
}

export function OutageLayer() {
  const viewer = useCesiumViewer();
  const active = useLayersStore((s) => s.active.outages);
  const dsRef = useRef<Cesium.CustomDataSource | null>(null);

  useEffect(() => {
    if (!viewer) return;
    const ds = new Cesium.CustomDataSource('outages');
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
      useOutagesStatus.getState().setStatus({ count: 0, customers: 0, states: 0, error: null });
      viewer.scene.requestRender();
      return;
    }

    let cancelled = false;
    let retry: ReturnType<typeof setTimeout> | null = null;

    const load = async () => {
      const { outages, error } = await fetchOutages();
      if (cancelled) return;
      // Server cold start: the aggregator answers instantly with "warming up"
      // while the first background refresh runs — retry shortly instead of
      // sitting empty until the next 5-minute poll.
      if (error === 'warming up') {
        retry = setTimeout(() => void load(), 20_000);
        return;
      }
      if (error && outages.length === 0) {
        console.error('Outage aggregator fetch failed', error);
        useOutagesStatus.getState().setStatus({ error: `Outage feed error: ${error}` });
        return;
      }

      ds.entities.removeAll();
      for (const o of outages) {
        const color = outageColor(o.type);
        const id = `outage-${o.id}`;
        const cust = custLabel(o.customers);
        const ent = ds.entities.add({
          id,
          position: Cesium.Cartesian3.fromDegrees(o.lon, o.lat),
          billboard: {
            image: outageIcon(color),
            width: 22,
            height: 22,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
            scaleByDistance: new Cesium.NearFarScalar(300_000, 1.1, 8_000_000, 0.55),
          },
          label: {
            text: cust ? `${o.utility} · ${cust}` : o.utility,
            font: '600 12px Inter, system-ui, sans-serif',
            fillColor: Cesium.Color.fromCssColorString(color),
            outlineColor: Cesium.Color.BLACK.withAlpha(0.85),
            outlineWidth: 3,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            verticalOrigin: Cesium.VerticalOrigin.TOP,
            pixelOffset: new Cesium.Cartesian2(0, 14),
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
            // Labels only when zoomed in (state-scale); markers always show.
            distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 1_500_000),
          },
        });
        attachPanelData(ent, {
          id,
          kind: 'outages',
          title: `${o.utility} outage`,
          subtitle: o.type
            ? `${o.type}${o.state ? ` · ${o.state}` : ''}`
            : (o.county ?? o.state ?? 'Power outage'),
          payload: { ...o },
        });
      }

      const customers = outages.reduce((sum, o) => sum + (o.customers ?? 0), 0);
      const states = new Set(outages.map((o) => o.state).filter(Boolean)).size;
      useOutagesStatus.getState().setStatus({ count: outages.length, customers, states, error: null });
      viewer.scene.requestRender();
    };

    load();
    const interval = setInterval(load, 5 * 60_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
      if (retry) clearTimeout(retry);
    };
  }, [viewer, active]);

  return null;
}
