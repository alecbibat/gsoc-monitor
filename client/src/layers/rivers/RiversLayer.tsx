import * as Cesium from 'cesium';
import { useCallback, useEffect, useRef } from 'react';
import { useCesiumViewer } from '../../cesium/CesiumContext';
import { useLayersStore } from '../../store/layersStore';
import { usePanelStore } from '../../panels/panelStore';
import { api } from '../../api/client';
import type { RiverGauge } from '../../types';
import { useRiversStatus } from './riversStore';
import { CAT, catLabel, catSev, FILTER_MIN_SEV } from './riverMeta';
import { useMeasureStore } from '../../measure/measureStore';
import { useFuelZoneStore } from '../../fuelzone/fuelZoneStore';
import { useHoverStore } from '../../screensaver/hoverStore';

// NWPS observations refresh ~hourly; the server caches, so a 15-min client poll
// keeps the national field current cheaply.
const POLL_MS = 15 * 60_000;

// Precomputed Cesium colors per tier (avoids re-parsing per point on every
// render of ~11k points).
const COLOR: Record<string, Cesium.Color> = Object.fromEntries(
  Object.entries(CAT).map(([k, m]) => [k, Cesium.Color.fromCssColorString(m.color)])
);
const OUTLINE_DARK = Cesium.Color.fromCssColorString('#0a0e1a');
const OUTLINE_FCST = Cesium.Color.fromCssColorString('#ffffff');
const OUTLINE_NONE = Cesium.Color.TRANSPARENT;
// Shrink points toward the global view so a national field of dots stays legible.
const SCALE = new Cesium.NearFarScalar(1.0e5, 1.0, 1.2e7, 0.45);

interface RiverPointId {
  __river: true;
  gauge: RiverGauge;
}

export function RiversLayer() {
  const viewer = useCesiumViewer();
  const active = useLayersStore((s) => s.active.rivers);
  const filter = useRiversStatus((s) => s.filter);
  const showForecast = useRiversStatus((s) => s.showForecast);

  const pointsRef = useRef<Cesium.PointPrimitiveCollection | null>(null);
  const dataRef = useRef<RiverGauge[] | null>(null);

  // Render the cached gauges honoring the flood filter + forecast highlight.
  // Separate from the fetch so changing the filter re-renders instantly.
  const render = useCallback(() => {
    const points = pointsRef.current;
    if (!viewer || !points) return;
    points.removeAll();
    const gauges = dataRef.current;
    if (!gauges) {
      viewer.scene.requestRender();
      return;
    }
    const minSev = FILTER_MIN_SEV[filter];
    let total = 0;
    for (const g of gauges) {
      const sev = catSev(g.cat);
      // A gauge forecast to climb into a flood tier above where it sits now.
      const worsening = catSev(g.fcat) > sev && catSev(g.fcat) >= 1;
      if (sev < minSev && !(showForecast && worsening)) continue;
      const meta = CAT[g.cat];
      const highlight = showForecast && worsening;
      points.add({
        position: Cesium.Cartesian3.fromDegrees(g.lon, g.lat),
        color: COLOR[g.cat] ?? COLOR.none,
        pixelSize: highlight ? meta.size + 3 : meta.size,
        outlineColor: highlight ? OUTLINE_FCST : sev >= 1 ? OUTLINE_DARK : OUTLINE_NONE,
        outlineWidth: highlight ? 2 : sev >= 1 ? 1 : 0,
        scaleByDistance: SCALE,
        id: { __river: true, gauge: g } as RiverPointId,
      });
      total++;
    }
    useRiversStatus.getState().setStatus({ total });
    viewer.scene.requestRender();
  }, [viewer, filter, showForecast]);

  const renderRef = useRef(render);
  renderRef.current = render;

  // Create the collection + a self-contained click handler while active.
  useEffect(() => {
    if (!viewer || !active) return;
    const v = viewer;
    const points = new Cesium.PointPrimitiveCollection();
    v.scene.primitives.add(points);
    pointsRef.current = points;

    // Own LEFT_CLICK handler (a separate ScreenSpaceEventHandler instance — it
    // coexists with the globe's entity click handler, which ignores our
    // non-entity point picks).
    const handler = new Cesium.ScreenSpaceEventHandler(v.scene.canvas);
    handler.setInputAction((e: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
      // Defer to the cursor-owning draw tools (same guards as the globe's own
      // click handler) so a click meant for measuring/drawing doesn't also pop
      // a gauge panel.
      if (
        useMeasureStore.getState().active ||
        useFuelZoneStore.getState().active ||
        useHoverStore.getState().picking
      )
        return;
      const picked = v.scene.pick(e.position) as { id?: RiverPointId } | undefined;
      const g = picked?.id?.__river ? picked.id.gauge : null;
      if (!g) return;
      usePanelStore.getState().open({
        id: `river-${g.lid}`,
        kind: 'rivers',
        title: g.name || g.lid,
        subtitle: `${g.state ? g.state + ' · ' : ''}${catLabel(g.cat)}`,
        payload: {
          lid: g.lid,
          name: g.name,
          state: g.state,
          cat: g.cat,
          stage: g.stage,
          unit: g.unit,
          flow: g.flow,
          flowUnit: g.flowUnit,
          isFlow: g.isFlow,
        },
      });
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

    renderRef.current(); // draw whatever is already cached

    return () => {
      handler.destroy();
      v.scene.primitives.remove(points); // destroys the collection
      pointsRef.current = null;
      v.scene.requestRender();
    };
  }, [viewer, active]);

  // Fetch + poll, self-scheduling so we can back off / retry adaptively: the
  // server warms its big national snapshot in the background and answers
  // `warming` until it's ready, so we just retry soon rather than erroring.
  useEffect(() => {
    if (!viewer || !active) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      let delay = POLL_MS;
      try {
        const data = await api.rivers();
        if (cancelled) return;
        if (data.warming || data.gauges.length === 0) {
          useRiversStatus.getState().setStatus({ loading: true, error: null });
          delay = 12_000; // server still warming — check back shortly
        } else {
          dataRef.current = data.gauges;
          useRiversStatus.getState().setStatus({ counts: data.counts, loading: false, error: null });
          renderRef.current();
        }
      } catch {
        if (!cancelled) {
          useRiversStatus.getState().setStatus({ loading: false, error: 'River gauge feed unavailable' });
          delay = 30_000;
        }
      }
      if (!cancelled) timer = setTimeout(load, delay);
    };
    load();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [viewer, active]);

  // Re-render (no refetch) when the filter / forecast toggle changes.
  useEffect(() => {
    renderRef.current();
  }, [filter, showForecast]);

  return null;
}
