import * as Cesium from 'cesium';
import { useEffect, useRef } from 'react';
import { useCesiumViewer } from '../../cesium/CesiumContext';
import { useLayersStore } from '../../store/layersStore';
import { api } from '../../api/client';
import { attachPanelData } from '../../cesium/entityPanelLink';
import type { NwsAlertFeature } from '../../types';

function severityColor(severity: string): Cesium.Color {
  switch (severity) {
    case 'Extreme':
      return Cesium.Color.fromCssColorString('#ff3b3b');
    case 'Severe':
      return Cesium.Color.fromCssColorString('#ff8a3d');
    case 'Moderate':
      return Cesium.Color.fromCssColorString('#ffe14d');
    case 'Minor':
      return Cesium.Color.fromCssColorString('#52a9ff');
    default:
      return Cesium.Color.fromCssColorString('#9aa5b1');
  }
}

function extractRings(geometry: GeoJSON.Geometry | null): number[][][] {
  if (!geometry) return [];
  if (geometry.type === 'Polygon') {
    return [geometry.coordinates[0] as number[][]];
  }
  if (geometry.type === 'MultiPolygon') {
    return geometry.coordinates.map((poly) => poly[0] as number[][]);
  }
  return [];
}

export function AlertsLayer() {
  const viewer = useCesiumViewer();
  const active = useLayersStore((s) => s.active.alerts);
  const dsRef = useRef<Cesium.CustomDataSource | null>(null);

  useEffect(() => {
    if (!viewer) return;
    const ds = new Cesium.CustomDataSource('alerts');
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
      return;
    }

    let cancelled = false;

    const load = async () => {
      try {
        const data = await api.alerts();
        if (cancelled) return;
        ds.entities.removeAll();
        for (const feature of data.features as unknown as NwsAlertFeature[]) {
          const rings = extractRings(feature.geometry);
          if (rings.length === 0) continue;
          const color = severityColor(feature.properties.severity);

          rings.forEach((ring, idx) => {
            const positions = Cesium.Cartesian3.fromDegreesArray(ring.flat());
            const entity = ds.entities.add({
              id: `alert-${feature.properties.id}-${idx}`,
              polygon: {
                hierarchy: new Cesium.PolygonHierarchy(positions),
                material: color.withAlpha(0.3),
                outline: true,
                outlineColor: color,
                outlineWidth: 2,
              },
            });
            attachPanelData(entity, {
              id: `alert-${feature.properties.id}`,
              kind: 'alerts',
              title: feature.properties.event,
              subtitle: feature.properties.areaDesc,
              payload: {
                event: feature.properties.event,
                headline: feature.properties.headline,
                description: feature.properties.description,
                instruction: feature.properties.instruction,
                severity: feature.properties.severity,
                urgency: feature.properties.urgency,
                certainty: feature.properties.certainty,
                senderName: feature.properties.senderName,
                effective: feature.properties.effective,
                expires: feature.properties.expires,
                areaDesc: feature.properties.areaDesc,
              },
            });
          });
        }
        viewer.scene.requestRender();
      } catch (err) {
        console.error('Failed to load NWS alerts', err);
      }
    }

    load();
    const interval = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [viewer, active]);

  return null;
}
