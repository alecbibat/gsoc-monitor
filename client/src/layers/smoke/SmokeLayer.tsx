import * as Cesium from 'cesium';
import { useEffect, useRef } from 'react';
import { useCesiumViewer } from '../../cesium/CesiumContext';
import { useLayersStore } from '../../store/layersStore';
import { attachPanelData } from '../../cesium/entityPanelLink';
import { api } from '../../api/client';
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
      for (const poly of sorted) {
        const fill = FILL_COLOR[poly.density] ?? FILL_COLOR.Light;
        const outline = OUTLINE_COLOR[poly.density] ?? OUTLINE_COLOR.Light;
        const positions = Cesium.Cartesian3.fromDegreesArray(
          (poly.coords as [number, number][]).flat()
        );

        const entity = ds.entities.add({
          id: poly.id,
          polygon: {
            hierarchy: new Cesium.PolygonHierarchy(positions),
            material: new Cesium.ColorMaterialProperty(fill),
            outline: true,
            outlineColor: new Cesium.ConstantProperty(outline),
            outlineWidth: 1,
            // Clamp to globe surface so terrain doesn't occlude it.
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            classificationType: Cesium.ClassificationType.TERRAIN,
          },
        });

        attachPanelData(entity, {
          id: poly.id,
          kind: 'smoke',
          title: `${poly.density} Smoke`,
          subtitle: poly.satellite ?? 'NOAA HMS',
          payload: { ...poly, date: data.date } as unknown as Record<string, unknown>,
        });
      }

      useSmokeStatus.getState().setStatus({
        count: sorted.length,
        date: data.date,
        error: data.error ?? null,
      });
      viewer.scene.requestRender();
    };

    load();
    // HMS updates once or twice a day; poll every 2 hours so a fresh product
    // appears without a manual reload.
    const interval = setInterval(load, 2 * 60 * 60_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [viewer, active]);

  return null;
}
