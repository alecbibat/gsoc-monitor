import * as Cesium from 'cesium';
import { useEffect, useRef } from 'react';
import { useCesiumViewer } from '../../cesium/CesiumContext';
import { useLayersStore } from '../../store/layersStore';
import { attachPanelData } from '../../cesium/entityPanelLink';
import { api } from '../../api/client';
import { startVisiblePolling } from '../../lib/poll';
import { useSmokeStatus } from './smokeStore';
import type { SmokePolygon } from '../../types';

// HMS density ordering for z-sort: Heavy on top of Medium on top of Light.
const DENSITY_RANK: Record<string, number> = { Light: 0, Medium: 1, Heavy: 2 };

// Semi-transparent smoke fill colors — yellowish-brown haze to dark plume.
const FILL_COLOR: Record<string, Cesium.Color> = {
  Light:  Cesium.Color.fromBytes(220, 200, 130, 55),  // pale straw, ~22% opacity
  Medium: Cesium.Color.fromBytes(190, 145, 60,  102), // amber-tan, ~40% opacity
  Heavy:  Cesium.Color.fromBytes(140, 80,  25,  153), // dark brown, ~60% opacity
};

const OUTLINE_COLOR: Record<string, Cesium.Color> = {
  Light:  Cesium.Color.fromBytes(220, 200, 130, 100),
  Medium: Cesium.Color.fromBytes(190, 145, 60,  140),
  Heavy:  Cesium.Color.fromBytes(140, 80,  25,  180),
};

// Drop consecutive duplicate vertices (including the closing point) and reject
// rings with fewer than 3 distinct points. Degenerate rings make Cesium's
// polygon triangulation produce invalid vertex/index counts, which surfaces as
// a "RangeError: Invalid array length" crash deep in the render loop.
function sanitizeRing(coords: number[][]): [number, number][] | null {
  const out: [number, number][] = [];
  for (const c of coords) {
    const lon = c[0];
    const lat = c[1];
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) continue;
    const prev = out[out.length - 1];
    if (prev && prev[0] === lon && prev[1] === lat) continue; // skip dup
    out.push([lon, lat]);
  }
  // A closed ring repeats its first point at the end — drop it before counting.
  if (out.length > 1) {
    const first = out[0];
    const last = out[out.length - 1];
    if (first[0] === last[0] && first[1] === last[1]) out.pop();
  }
  return out.length >= 3 ? out : null;
}

export function SmokeLayer() {
  const viewer = useCesiumViewer();
  const active = useLayersStore((s) => s.active.smoke);
  const dsRef = useRef<Cesium.CustomDataSource | null>(null);

  // Create / destroy data source.
  useEffect(() => {
    if (!viewer) return;
    const ds = new Cesium.CustomDataSource('smoke');
    dsRef.current = ds;
    viewer.dataSources.add(ds);
    return () => {
      viewer.dataSources.remove(ds, true);
      dsRef.current = null;
    };
  }, [viewer]);

  // Fetch + render.
  useEffect(() => {
    const ds = dsRef.current;
    if (!viewer || !ds) return;

    if (!active) {
      ds.entities.removeAll();
      viewer.scene.requestRender();
      useSmokeStatus.getState().setStatus({ count: 0, date: '' });
      return;
    }

    let cancelled = false;

    const load = async () => {
      let data;
      try {
        data = await api.smoke();
      } catch (err) {
        if (cancelled) return;
        console.error('Failed to load HMS smoke', err);
        useSmokeStatus.getState().setStatus({ error: 'HMS smoke unavailable' });
        return;
      }
      if (cancelled) return;

      if (data.error && data.polygons.length === 0) {
        useSmokeStatus.getState().setStatus({ error: data.error, count: 0, date: '' });
        return;
      }

      // Sort so heavier smoke is drawn on top.
      const sorted = [...data.polygons].sort(
        (a, b) => (DENSITY_RANK[a.density] ?? 0) - (DENSITY_RANK[b.density] ?? 0)
      );

      ds.entities.removeAll();
      let drawn = 0;
      for (const poly of sorted) {
        const ring = sanitizeRing(poly.coords);
        if (!ring) continue; // degenerate polygon — skip rather than crash

        const fill = FILL_COLOR[poly.density] ?? FILL_COLOR.Light;
        const outline = OUTLINE_COLOR[poly.density] ?? OUTLINE_COLOR.Light;
        const positions = Cesium.Cartesian3.fromDegreesArray(ring.flat());

        // Plain ellipsoid-draped polygon (same approach as the NWS Alerts
        // layer). NOT terrain-classified: ground primitives built from these
        // hand-drawn, concave smoke outlines were crashing Cesium's render loop.
        const entity = ds.entities.add({
          id: poly.id,
          polygon: {
            hierarchy: new Cesium.PolygonHierarchy(positions),
            material: new Cesium.ColorMaterialProperty(fill),
            outline: true,
            outlineColor: new Cesium.ConstantProperty(outline),
            outlineWidth: 1,
          },
        });

        attachPanelData(entity, {
          id: poly.id,
          kind: 'smoke',
          title: `${poly.density} Smoke`,
          subtitle: poly.satellite ?? 'NOAA HMS',
          payload: { ...poly, date: data.date } as unknown as Record<string, unknown>,
        });
        drawn++;
      }

      useSmokeStatus.getState().setStatus({
        count: drawn,
        date: data.date,
        error: data.error ?? null,
      });
      viewer.scene.requestRender();
    };

    // HMS updates once or twice a day; poll every 2 hours so a fresh product
    // appears without a manual reload.
    const stopPolling = startVisiblePolling(() => void load(), 2 * 60 * 60_000);
    return () => {
      cancelled = true;
      stopPolling();
    };
  }, [viewer, active]);

  return null;
}
