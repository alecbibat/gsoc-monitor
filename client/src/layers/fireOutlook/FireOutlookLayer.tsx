import * as Cesium from 'cesium';
import { useCallback, useEffect, useRef } from 'react';
import { useCesiumViewer } from '../../cesium/CesiumContext';
import { useLayersStore } from '../../store/layersStore';
import { attachPanelData } from '../../cesium/entityPanelLink';
import { api } from '../../api/client';
import type { FireOutlookResponse } from '../../types';
import { useFireOutlookStore } from './fireOutlookStore';
import { outlookStyle } from './fireOutlookMeta';

// Outlook is reissued ~daily; refresh occasionally (the server caches anyway).
const POLL_MS = 30 * 60_000;

const OUTLINE_FAINT = Cesium.Color.WHITE.withAlpha(0.16);

export function FireOutlookLayer() {
  const viewer = useCesiumViewer();
  const active = useLayersStore((s) => s.active.fireOutlook);
  const day = useFireOutlookStore((s) => s.day);

  const dsRef = useRef<Cesium.CustomDataSource | null>(null);
  const dataRef = useRef<FireOutlookResponse | null>(null);

  // Draw the selected day's PSA polygons. Kept separate from the fetch so
  // switching days re-renders instantly off the cached payload.
  const render = useCallback(() => {
    const ds = dsRef.current;
    if (!viewer || !ds) return;
    ds.entities.removeAll();
    const data = dataRef.current;
    if (!data) {
      viewer.scene.requestRender();
      return;
    }
    for (const psa of data.psas) {
      const code = psa.days[day];
      if (!code) continue;
      const style = outlookStyle(code.dryness, code.type);
      const base = Cesium.Color.fromCssColorString(style.hex);
      const fill = base.withAlpha(style.sig ? 0.5 : 0.4);
      const outline = style.sig ? base.withAlpha(0.95) : OUTLINE_FAINT;
      for (const ring of psa.rings) {
        if (ring.length < 3) continue;
        const ent = ds.entities.add({
          polygon: {
            hierarchy: new Cesium.PolygonHierarchy(Cesium.Cartesian3.fromDegreesArray(ring.flat())),
            material: fill,
            outline: true,
            outlineColor: outline,
            outlineWidth: style.sig ? 2 : 1,
            height: 0, // draped on the ellipsoid
          },
        });
        attachPanelData(ent, {
          id: `fireoutlook-${psa.code}`,
          kind: 'fireOutlook',
          title: `${psa.code} fire potential`,
          subtitle: `${psa.gacc} · ${style.label}`,
          payload: {
            code: psa.code,
            gacc: psa.gacc,
            date: data.dates[day],
            dayNum: day + 1,
            dryness: code.dryness,
            type: code.type,
          },
        });
      }
    }
    useFireOutlookStore.getState().setStatus({ count: data.psas.length, dates: data.dates, error: null });
    viewer.scene.requestRender();
  }, [viewer, day]);

  const renderRef = useRef(render);
  renderRef.current = render;

  // Data source lifecycle.
  useEffect(() => {
    if (!viewer) return;
    const ds = new Cesium.CustomDataSource('fire-outlook');
    dsRef.current = ds;
    viewer.dataSources.add(ds);
    return () => {
      viewer.dataSources.remove(ds, true);
      dsRef.current = null;
    };
  }, [viewer]);

  // Fetch + poll while active.
  useEffect(() => {
    if (!viewer) return;
    if (!active) {
      const ds = dsRef.current;
      if (ds) ds.entities.removeAll();
      viewer.scene.requestRender();
      return;
    }
    let cancelled = false;
    const load = async () => {
      try {
        const data = await api.fireOutlook();
        if (cancelled) return;
        dataRef.current = data;
        renderRef.current();
      } catch {
        if (!cancelled)
          useFireOutlookStore.getState().setStatus({ error: 'Fire potential outlook unavailable' });
      }
    };
    load();
    const timer = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [viewer, active]);

  // Re-render (no refetch) when the day changes.
  useEffect(() => {
    renderRef.current();
  }, [day]);

  return null;
}
