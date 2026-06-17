import * as Cesium from 'cesium';
import { useEffect, useRef } from 'react';
import { useCesiumViewer } from '../cesium/CesiumContext';
import { useCrisisStore, type DrawLayer } from './crisisStore';

function buildEntity(layer: DrawLayer): Cesium.Entity.ConstructorOptions | null {
  if (layer.positions.length < 2) return null;
  const color = Cesium.Color.fromCssColorString(layer.color);
  const positions = layer.positions.map((p) =>
    Cesium.Cartesian3.fromDegrees(p.lon, p.lat)
  );

  if (layer.closed && layer.positions.length >= 3) {
    return {
      id: `crisis-layer-${layer.id}`,
      polygon: {
        hierarchy: new Cesium.PolygonHierarchy(positions),
        material: color.withAlpha(0.22),
        outline: true,
        outlineColor: color.withAlpha(0.9),
        outlineWidth: 2.5,
        height: 0,
        arcType: Cesium.ArcType.GEODESIC,
      },
    };
  }

  return {
    id: `crisis-layer-${layer.id}`,
    polyline: {
      positions,
      width: 2.5,
      material: new Cesium.ColorMaterialProperty(color.withAlpha(0.9)),
      clampToGround: true,
      arcType: Cesium.ArcType.GEODESIC,
    },
  };
}

export function CrisisMapLayer() {
  const viewer = useCesiumViewer();
  const drawLayers = useCrisisStore((s) => s.drawLayers);
  const dsRef = useRef<Cesium.CustomDataSource | null>(null);

  useEffect(() => {
    if (!viewer) return;
    const ds = new Cesium.CustomDataSource('crisis-layers');
    dsRef.current = ds;
    viewer.dataSources.add(ds);
    return () => {
      viewer.dataSources.remove(ds, true);
      dsRef.current = null;
    };
  }, [viewer]);

  useEffect(() => {
    const ds = dsRef.current;
    if (!ds || !viewer) return;
    ds.entities.removeAll();

    drawLayers
      .filter((l) => l.visible && l.positions.length >= 2)
      .forEach((layer) => {
        const opts = buildEntity(layer);
        if (opts) ds.entities.add(opts);
      });

    viewer.scene.requestRender();
  }, [viewer, drawLayers]);

  return null;
}
