import * as Cesium from 'cesium';
import { useEffect, useRef } from 'react';
import { useCesiumViewer } from '../../cesium/CesiumContext';
import { useLayersStore } from '../../store/layersStore';
import { attachPanelData } from '../../cesium/entityPanelLink';
import { api } from '../../api/client';
import { startVisiblePolling } from '../../lib/poll';
import { useIntelStore, CATEGORY_META } from './intelStore';
import type { IntelItem } from '../../types';

const REFRESH_MS = 90_000;

// A category-tinted teardrop pin. Urgent items get a bright ring so shootings /
// structure fires / evacuations read at a glance among the routine dispatch.
function pinIcon(fill: string, urgent: boolean): string {
  const ring = urgent ? `<circle cx="32" cy="26" r="20" fill="none" stroke="#fca5a5" stroke-width="3"/>` : '';
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">` +
    ring +
    `<circle cx="32" cy="26" r="14" fill="${fill}" stroke="#0a0e1a" stroke-width="3"/>` +
    `<circle cx="32" cy="26" r="5" fill="#0a0e1a"/>` +
    `</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

// Precompute one icon per (category, urgent) pair — cheap and avoids rebuilding
// data URIs for every entity on every render.
const ICONS: Record<string, string> = {};
function iconFor(item: IntelItem): string {
  const urgent = item.severity === 'urgent';
  const key = `${item.category}:${urgent}`;
  if (!ICONS[key]) ICONS[key] = pinIcon(CATEGORY_META[item.category].color, urgent);
  return ICONS[key];
}

export function IntelLayer() {
  const viewer = useCesiumViewer();
  const active = useLayersStore((s) => (s.active as Record<string, boolean>).intel ?? false);
  const items = useIntelStore((s) => s.items);
  const categories = useIntelStore((s) => s.categories);
  const dsRef = useRef<Cesium.CustomDataSource | null>(null);

  // Create / destroy the data source.
  useEffect(() => {
    if (!viewer) return;
    const ds = new Cesium.CustomDataSource('intel');
    dsRef.current = ds;
    viewer.dataSources.add(ds);
    return () => {
      viewer.dataSources.remove(ds, true);
      dsRef.current = null;
    };
  }, [viewer]);

  // Fetch + poll while the layer is active. Writes into the shared store; the
  // render effect below turns items into entities.
  useEffect(() => {
    if (!viewer || !active) return;
    let cancelled = false;
    const load = async () => {
      useIntelStore.getState().setLoading(true);
      try {
        const data = await api.intel();
        if (cancelled) return;
        useIntelStore.getState().setData(data.items, data.updated, data.sourceCount, data.errors);
      } catch (err) {
        if (cancelled) return;
        console.error('Failed to load intel feed', err);
        useIntelStore.getState().setError('Intel feed unavailable');
      }
    };
    const stopPolling = startVisiblePolling(() => void load(), REFRESH_MS);
    return () => {
      cancelled = true;
      stopPolling();
    };
  }, [viewer, active]);

  // Render: (re)build entities from the current items + category filter.
  useEffect(() => {
    const ds = dsRef.current;
    if (!viewer || !ds) return;

    ds.entities.removeAll();
    if (!active) {
      viewer.scene.requestRender();
      return;
    }

    const filterOn = categories.size > 0;
    const seen = new Set<string>(); // a duplicate id would make ds.entities.add throw mid-loop
    for (const item of items) {
      if (item.lat == null || item.lon == null) continue; // feed-only, not mappable
      if (filterOn && !categories.has(item.category)) continue;
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      const entity = ds.entities.add({
        id: `intel-${item.id}`,
        position: Cesium.Cartesian3.fromDegrees(item.lon, item.lat, 0),
        billboard: {
          image: iconFor(item),
          width: item.severity === 'urgent' ? 30 : 24,
          height: item.severity === 'urgent' ? 30 : 24,
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          scaleByDistance: new Cesium.NearFarScalar(3.0e5, 1.0, 8.0e6, 0.4),
        },
      });
      attachPanelData(entity, {
        id: `intel-${item.id}`,
        kind: 'intel',
        title: item.title,
        subtitle: `${CATEGORY_META[item.category].label} · ${item.source}`,
        payload: { ...item } as unknown as Record<string, unknown>,
      });
    }

    viewer.scene.requestRender();
  }, [viewer, active, items, categories]);

  return null;
}
