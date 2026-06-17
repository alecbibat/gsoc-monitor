import * as Cesium from 'cesium';
import { useEffect, useRef } from 'react';
import { useCesiumViewer } from '../../cesium/CesiumContext';
import { useLayersStore } from '../../store/layersStore';
import { attachPanelData } from '../../cesium/entityPanelLink';
import { LOCATION_GROUPS } from './locations';
import { useScreensaverStore } from '../../screensaver/screensaverStore';

export function LocationsLayer() {
  const viewer = useCesiumViewer();
  const active = useLayersStore((s) => s.active);
  const dsRef = useRef<Cesium.CustomDataSource | null>(null);

  useEffect(() => {
    if (!viewer) return;
    const ds = new Cesium.CustomDataSource('locations');
    viewer.dataSources.add(ds);
    dsRef.current = ds;

    const pinBuilder = new Cesium.PinBuilder();

    for (const group of LOCATION_GROUPS) {
      const color = Cesium.Color.fromCssColorString(group.color);
      const pinCanvas = pinBuilder.fromColor(color, 36);
      const pinUrl = pinCanvas.toDataURL();

      for (const loc of group.locations) {
        const entity = ds.entities.add({
          position: Cesium.Cartesian3.fromDegrees(loc.lon, loc.lat),
          billboard: {
            image: pinUrl,
            verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
            // Clamp to terrain so pins sit on mountain surfaces (Yellowstone,
            // Grand Canyon, etc.) rather than appearing underground when World
            // Terrain or OSM buildings + terrain are active.
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
            width: 24,
            height: 32,
            scaleByDistance: new Cesium.NearFarScalar(1_500_000, 1.0, 8_000_000, 0.4),
            // While the pins screensaver is orbiting THIS pin, hide the flat
            // marker — it's replaced by the animated loot beam.
            show: new Cesium.CallbackProperty(() => {
              const { active, mode, currentPoi } = useScreensaverStore.getState();
              return !(
                active && mode === 'pins' && currentPoi?.category === 'pin' &&
                Math.abs(currentPoi.lat - loc.lat) < 1e-6 &&
                Math.abs(currentPoi.lon - loc.lon) < 1e-6
              );
            }, false),
          },
          label: {
            text: loc.name,
            font: 'bold 11px sans-serif',
            fillColor: Cesium.Color.WHITE,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            outlineWidth: 2,
            outlineColor: Cesium.Color.fromCssColorString('#0a0c10').withAlpha(0.9),
            verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            pixelOffset: new Cesium.Cartesian2(0, -36),
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
            distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 800_000),
            showBackground: true,
            backgroundColor: Cesium.Color.fromCssColorString('#0a0c10').withAlpha(0.7),
            backgroundPadding: new Cesium.Cartesian2(5, 3),
            scale: 1.0,
            show: new Cesium.CallbackProperty(() => {
              const { active, mode } = useScreensaverStore.getState();
              return !(active && mode === 'pins');
            }, false),
          },
        });

        attachPanelData(entity, {
          kind: 'locations',
          id: `location:${group.id}:${loc.name}`,
          title: loc.name,
          payload: {
            name: loc.name,
            group: group.name,
            groupId: group.id,
            lat: loc.lat,
            lon: loc.lon,
            altitudeM: loc.altitudeM ?? 30_000,
            color: group.color,
            icon: group.icon,
          },
        });
      }
    }

    viewer.scene.requestRender();
    return () => {
      viewer.dataSources.remove(ds, true);
      dsRef.current = null;
    };
  }, [viewer]);

  useEffect(() => {
    const ds = dsRef.current;
    if (!ds || !viewer) return;
    ds.show = (active as Record<string, boolean>).locations ?? true;
    viewer.scene.requestRender();
  }, [active, viewer]);

  return null;
}
