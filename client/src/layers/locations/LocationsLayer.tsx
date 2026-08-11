import * as Cesium from 'cesium';
import { useEffect, useRef } from 'react';
import { useCesiumViewer } from '../../cesium/CesiumContext';
import { useLayersStore } from '../../store/layersStore';
import { attachPanelData } from '../../cesium/entityPanelLink';
import { LOCATION_GROUPS } from './locations';
import { makePinIcon } from './pinIcon';
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

    for (const group of LOCATION_GROUPS) {
      const pin = makePinIcon(group.color);

      for (const loc of group.locations) {
        const entity = ds.entities.add({
          // Anchored on the ellipsoid surface with the DEFAULT depth test — the
          // same pattern as the share-globe pins (commit 1cff6ec). Clamping
          // (heightReference: CLAMP_TO_GROUND) must NOT be used here: clamped
          // billboards skip the globe-occlusion depth path whenever
          // depthTestAgainstTerrain is false (which this app always is), so
          // far-side pins rendered straight through the planet. Trade-off:
          // while the OSM-buildings layer swaps in world terrain, pins anchor
          // at ellipsoid height rather than the mountain surface — but terrain
          // depth is cleared in that mode too, so they stay visible.
          position: Cesium.Cartesian3.fromDegrees(loc.lon, loc.lat, 0),
          billboard: {
            image: pin.url,
            verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
            width: pin.width,
            height: pin.height,
            // Stay prominent when zoomed out: the old ramp shrank pins to 40%
            // (near-invisible at continental zoom). Hold ~0.8× even at globe
            // distance so the markers read as pins, not specks.
            scaleByDistance: new Cesium.NearFarScalar(600_000, 1.0, 16_000_000, 0.8),
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
            pixelOffset: new Cesium.Cartesian2(0, -54),
            // Default depth test, no clamping — far-side labels hide behind
            // the globe (see the billboard comment above).
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
