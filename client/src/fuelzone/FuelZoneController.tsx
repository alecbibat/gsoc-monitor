import * as Cesium from 'cesium';
import { useEffect, useRef } from 'react';
import { useCesiumViewer } from '../cesium/CesiumContext';
import { usePanelStore } from '../panels/panelStore';
import { useFuelZoneStore, formatRadius } from './fuelZoneStore';
import { analyzeFuelZone, circleRing, distanceM, type LngLat } from './zonalStats';

// Bright cyan reads strongly against the warm orange/red/tan FBFM40 palette
// (and against dark ocean when the fuel layer is off). The dark casing keeps the
// ring legible even where it crosses a pale, high-value fuel class.
const LINE_COLOR = Cesium.Color.fromCssColorString('#2fe1ff');
const LINE_CASING = Cesium.Color.fromCssColorString('#04212e').withAlpha(0.9);
const FILL_COLOR = LINE_COLOR.withAlpha(0.1);
const CENTER_COLOR = Cesium.Color.fromCssColorString('#ffffff');
// The ellipse `outline` is rendered as GL_LINES and clamped to 1px on most GPUs,
// so we draw the perimeter as a polyline instead — those honor width and give a
// crisp, cased ring (same approach as the measure tool).
const RING_WIDTH = 4;

// Geodesic ring positions for the perimeter polyline, reusing the same circle
// geometry as the histogram query so the drawn outline matches what's analyzed.
function ringPositions(center: LngLat, radiusM: number): Cesium.Cartesian3[] {
  return circleRing(center, radiusM, 128).map(([lon, lat]) =>
    Cesium.Cartesian3.fromDegrees(lon, lat)
  );
}

// A draped circle: faint fill disc + a high-contrast cased polyline perimeter.
// Both the live preview and the committed (panel-pinned) circle use this so they
// look identical.
function circleGraphics(center: LngLat, radiusM: number): Cesium.Entity.ConstructorOptions {
  return {
    position: Cesium.Cartesian3.fromDegrees(center.lon, center.lat),
    ellipse: {
      semiMajorAxis: radiusM,
      semiMinorAxis: radiusM, // equal axes → circle
      material: FILL_COLOR,
      height: 0, // ellipsoid-draped; no classificationType / heightReference
    },
    polyline: {
      positions: ringPositions(center, radiusM),
      width: RING_WIDTH,
      material: new Cesium.PolylineOutlineMaterialProperty({
        color: LINE_COLOR,
        outlineColor: LINE_CASING,
        outlineWidth: 2,
      }),
      arcType: Cesium.ArcType.GEODESIC,
      clampToGround: false,
    },
  };
}

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
  // Persistent DS: holds committed circles that survive the draw tool exiting.
  // Each circle lives until its corresponding panel is closed.
  const persistDsRef = useRef<Cesium.CustomDataSource | null>(null);
  const entityMapRef = useRef<Map<string, Cesium.Entity>>(new Map());

  // Persistent data source — lives as long as the viewer, not the draw tool.
  // Subscribes to the panel store so circles are removed when their panel closes.
  useEffect(() => {
    if (!viewer) return;
    const v = viewer;

    const ds = new Cesium.CustomDataSource('fuel-zone-committed');
    persistDsRef.current = ds;
    v.dataSources.add(ds);

    const unsub = usePanelStore.subscribe((state, prevState) => {
      const closedIds = prevState.panels
        .filter((p) => p.kind === 'fuel-zone' && !state.panels.some((q) => q.id === p.id))
        .map((p) => p.id);
      for (const id of closedIds) {
        const entity = entityMapRef.current.get(id);
        if (entity && persistDsRef.current) {
          persistDsRef.current.entities.remove(entity);
        }
        entityMapRef.current.delete(id);
      }
      if (closedIds.length > 0) v.scene.requestRender();
    });

    return () => {
      unsub();
      v.dataSources.remove(ds, true);
      persistDsRef.current = null;
      entityMapRef.current.clear();
    };
  }, [viewer]);

  // Create the draw-preview data source + input handler while the tool is active.
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
        const panelId = `fuel-zone-${seq}`;
        usePanelStore.getState().open({
          id: panelId,
          kind: 'fuel-zone',
          title: 'Fuel breakdown',
          subtitle: `${formatRadius(radius)} radius`,
          payload: result as unknown as Record<string, unknown>,
        });
        // Persist the committed circle so it stays visible while the panel is open.
        // The circle is removed when the panel closes (see the subscriber above).
        if (persistDsRef.current) {
          const entity = persistDsRef.current.entities.add(circleGraphics(zoneCenter, radius));
          entityMapRef.current.set(panelId, entity);
        }
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
        ds.entities.add(circleGraphics(center, radiusM));
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
