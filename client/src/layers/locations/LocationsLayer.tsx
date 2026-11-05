import * as Cesium from 'cesium';
import { useEffect, useRef } from 'react';
import { useCesiumViewer } from '../../cesium/CesiumContext';
import { useLayersStore } from '../../store/layersStore';
import { attachPanelData } from '../../cesium/entityPanelLink';
import { LOCATION_GROUPS } from './locations';
import { makePinIcon } from './pinIcon';
import { useScreensaverStore } from '../../screensaver/screensaverStore';
import { TERRAIN_MARKERS_ON_TOP_M, useGroundHeights } from '../../cesium/groundHeights';

const ALL_LOCATIONS = LOCATION_GROUPS.flatMap((g) => g.locations);
const LOCATIONS_KEY = ALL_LOCATIONS.map((l) => `${l.lon},${l.lat}`).join(';');

export function LocationsLayer() {
  const viewer = useCesiumViewer();
  const active = useLayersStore((s) => s.active);
  const dsRef = useRef<Cesium.CustomDataSource | null>(null);
  // One entity per location, in ALL_LOCATIONS order, so terrain heights can move them.
  const entitiesRef = useRef<Cesium.Entity[]>([]);
  const { terrain, heights } = useGroundHeights(viewer, ALL_LOCATIONS, LOCATIONS_KEY);

  useEffect(() => {
    if (!viewer) return;
    const ds = new Cesium.CustomDataSource('locations');
    viewer.dataSources.add(ds);
    dsRef.current = ds;
    entitiesRef.current = [];

    for (const group of LOCATION_GROUPS) {
      const pin = makePinIcon(group.color);

      for (const loc of group.locations) {
        const entity = ds.entities.add({
          // Anchored on the ellipsoid surface with the DEFAULT depth test — the
          // same pattern as the share-globe pins (commit 1cff6ec). Clamping
          // (heightReference: CLAMP_TO_GROUND) must NOT be used here: clamped
          // billboards skip the globe-occlusion depth path whenever
          // depthTestAgainstTerrain is false (which this app always is), so
          // far-side pins rendered straight through the planet. With 3D
          // terrain on, the effect below stands each pin on the sampled ground
          // instead (see cesium/groundHeights.ts).
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

        entitiesRef.current.push(entity);
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
      entitiesRef.current = [];
    };
  }, [viewer]);

  // Real terrain on: draw each pin over buildings from close range, and stand
  // it on the ground under it once that's sampled. Flat globe: back to height
  // 0 and the default depth test.
  useEffect(() => {
    if (!viewer) return;
    const onTop = terrain ? TERRAIN_MARKERS_ON_TOP_M : undefined;
    entitiesRef.current.forEach((entity, i) => {
      const loc = ALL_LOCATIONS[i];
      entity.position = new Cesium.ConstantPositionProperty(
        Cesium.Cartesian3.fromDegrees(loc.lon, loc.lat, heights?.[i] ?? 0)
      );
      if (entity.billboard) entity.billboard.disableDepthTestDistance = new Cesium.ConstantProperty(onTop);
      if (entity.label) entity.label.disableDepthTestDistance = new Cesium.ConstantProperty(onTop);
    });
    viewer.scene.requestRender();
  }, [viewer, terrain, heights]);

  useEffect(() => {
    const ds = dsRef.current;
    if (!ds || !viewer) return;
    ds.show = (active as Record<string, boolean>).locations ?? true;
    viewer.scene.requestRender();
  }, [active, viewer]);

  return null;
}
