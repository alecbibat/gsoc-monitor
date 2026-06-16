import * as Cesium from 'cesium';
import { useEffect, useRef } from 'react';
import { useCesiumViewer } from '../../cesium/CesiumContext';
import { useLayersStore } from '../../store/layersStore';
import { api } from '../../api/client';
import { attachPanelData } from '../../cesium/entityPanelLink';
import type { EarthquakeFeature } from '../../types';

function magnitudeColor(mag: number): Cesium.Color {
  if (mag >= 6) return Cesium.Color.fromCssColorString('#ff5d5d');
  if (mag >= 4.5) return Cesium.Color.fromCssColorString('#ffb84d');
  if (mag >= 2.5) return Cesium.Color.fromCssColorString('#ffe14d');
  return Cesium.Color.fromCssColorString('#52e3a4');
}

export function EarthquakeLayer() {
  const viewer = useCesiumViewer();
  const active = useLayersStore((s) => s.active.earthquakes);
  const magnitude = useLayersStore((s) => s.earthquakeMagnitude);
  const period = useLayersStore((s) => s.earthquakePeriod);
  const dsRef = useRef<Cesium.CustomDataSource | null>(null);

  useEffect(() => {
    if (!viewer) return;
    const ds = new Cesium.CustomDataSource('earthquakes');
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
        const data = await api.earthquakes(magnitude, period);
        if (cancelled) return;
        ds.entities.removeAll();
        for (const feature of data.features as unknown as EarthquakeFeature[]) {
          const [lon, lat, depthKm] = feature.geometry.coordinates;
          const mag = feature.properties.mag ?? 0;
          const entity = ds.entities.add({
            id: `eq-${feature.id}`,
            position: Cesium.Cartesian3.fromDegrees(lon, lat),
            point: {
              pixelSize: 6 + Math.max(0, mag) * 3,
              color: magnitudeColor(mag).withAlpha(0.85),
              outlineColor: Cesium.Color.BLACK.withAlpha(0.6),
              outlineWidth: 1,
            },
          });
          attachPanelData(entity, {
            id: `eq-${feature.id}`,
            kind: 'earthquakes',
            title: `M${mag.toFixed(1)} Earthquake`,
            subtitle: feature.properties.place,
            payload: {
              mag,
              place: feature.properties.place,
              time: feature.properties.time,
              depthKm,
              url: feature.properties.url,
              felt: feature.properties.felt,
              tsunami: feature.properties.tsunami,
              status: feature.properties.status,
            },
          });
        }
        viewer.scene.requestRender();
      } catch (err) {
        console.error('Failed to load earthquakes', err);
      }
    }

    load();
    const interval = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [viewer, active, magnitude, period]);

  return null;
}
