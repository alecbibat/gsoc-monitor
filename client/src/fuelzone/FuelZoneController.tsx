import * as Cesium from 'cesium';
import { useEffect, useRef } from 'react';
import { useCesiumViewer } from '../cesium/CesiumContext';
import { usePanelStore } from '../panels/panelStore';
import { useFuelZoneStore, formatRadius } from './fuelZoneStore';
import { analyzeFuelZone, distanceM, type LngLat } from './zonalStats';

const LINE_COLOR = Cesium.Color.fromCssColorString('#ff9d3c'); // warm amber — fuel/fire theme
const FILL_COLOR = LINE_COLOR.withAlpha(0.14);
const CENTER_COLOR = Cesium.Color.fromCssColorString('#ffffff');

// Below this the second click reads as an accidental double-click on the center;
// keep waiting for a real radius. Above the max we'd be asking LANDFIRE to
// histogram an absurd area — clamp it.
const MIN_RADIUS_M = 150;
const MAX_RADIUS_M = 250_000;

// Screen pixel → lon/lat on the globe ellipsoid (ignores terrain height — the
// FBFM40 raster is draped on the surface anyway). Null when pointed at space.
function pickLngLat(viewer: Cesium.Viewer, pos: Cesium.Cartesian2): LngLat | null {
  const cart = viewer.camera.pickEllipsoid(pos, viewer.scene.globe.ellipsoid);
  if (!cart) return null;
  const c = Cesium.Cartographic.fromCartesian(cart);
  return { lon: Cesium.Math.toDegrees(c.longitude), lat: Cesium.Math.toDegrees(c.latitude) };
}

export function FuelZoneController() {
  const viewer = useCesiumViewer();
  const active = useFuelZoneStore((s) => s.active);
  const center = useFuelZoneStore((s) => s.center);
  const radiusM = useFuelZoneStore((s) => s.radiusM);

  const dsRef = useRef<Cesium.CustomDataSource | null>(null);

  // Create the data source + input handler while the tool is active.
  useEffect(() => {
    if (!viewer || !active) return;
    const v = viewer;

    const ds = new Cesium.CustomDataSource('fuel-zone');
    dsRef.current = ds;
    v.dataSources.add(ds);

    // Suppress Cesium's default double-click entity-tracking while drawing.
    v.screenSpaceEventHandler.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);

    const handler = new Cesium.ScreenSpaceEventHandler(v.scene.canvas);
    const store = useFuelZoneStore.getState;

    const finalize = async (zoneCenter: LngLat, rawRadius: number) => {
      const radius = Math.min(MAX_RADIUS_M, rawRadius);
      const s = store();
      s.setBusy(true);
      try {
        const result = await analyzeFuelZone(zoneCenter, radius);
        const seq = store().seq + 1;
        store().bumpSeq();
        usePanelStore.getState().open({
          id: `fuel-zone-${seq}`,
          kind: 'fuel-zone',
          title: 'Fuel breakdown',
          subtitle: `${formatRadius(radius)} radius`,
          payload: result as unknown as Record<string, unknown>,
        });
        store().exit();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        store().setError(msg);
      }
      v.scene.requestRender();
    };

    handler.setInputAction((e: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
      const s = store();
      if (s.busy) return;
      const p = pickLngLat(v, e.position);
      if (!p) return;
      if (!s.hasCenter || s.error) {
        // First click (or restart after an error) sets the center.
        s.begin(p);
      } else {
        const radius = distanceM(s.center!, p);
        if (radius < MIN_RADIUS_M) return; // too small — keep sizing
        void finalize(s.center!, radius);
      }
      v.scene.requestRender();
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

    handler.setInputAction((e: Cesium.ScreenSpaceEventHandler.MotionEvent) => {
      const s = store();
      if (!s.hasCenter || s.busy || s.error) return;
      const p = pickLngLat(v, e.endPosition);
      if (!p) return;
      s.setRadius(distanceM(s.center!, p));
      v.scene.requestRender();
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

    return () => {
      handler.destroy();
      v.dataSources.remove(ds, true);
      dsRef.current = null;
      v.scene.requestRender();
    };
  }, [viewer, active]);

  // Redraw the preview center + circle whenever the geometry changes.
  useEffect(() => {
    const ds = dsRef.current;
    if (!viewer || !ds || !active) return;
    ds.entities.removeAll();

    if (center) {
      ds.entities.add({
        position: Cesium.Cartesian3.fromDegrees(center.lon, center.lat),
        point: {
          pixelSize: 8,
          color: CENTER_COLOR,
          outlineColor: LINE_COLOR,
          outlineWidth: 2,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });
      if (radiusM > 0) {
        ds.entities.add({
          position: Cesium.Cartesian3.fromDegrees(center.lon, center.lat),
          ellipse: {
            semiMajorAxis: radiusM,
            semiMinorAxis: radiusM, // equal axes → circle
            material: FILL_COLOR,
            outline: true,
            outlineColor: LINE_COLOR,
            outlineWidth: 2,
            height: 0, // ellipsoid-draped; no classificationType / heightReference
          },
        });
      }
    }

    viewer.scene.requestRender();
  }, [viewer, active, center, radiusM]);

  // Esc cancels the tool.
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') useFuelZoneStore.getState().exit();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active]);

  return null;
}
