import * as Cesium from 'cesium';
import { useEffect, useRef } from 'react';
import { useCesiumViewer } from '../cesium/CesiumContext';
import { useMeasureStore, type LngLat } from './measureStore';

const LINE_COLOR = Cesium.Color.fromCssColorString('#3ddcff');
const FILL_COLOR = Cesium.Color.fromCssColorString('#3ddcff').withAlpha(0.16);
const VERTEX_COLOR = Cesium.Color.fromCssColorString('#ffffff');

// Screen pixel → lon/lat on the globe ellipsoid (ignores terrain height, which
// is irrelevant for surface distance/area). Returns null when pointed at space.
function pickLngLat(viewer: Cesium.Viewer, pos: Cesium.Cartesian2): LngLat | null {
  const cart = viewer.camera.pickEllipsoid(pos, viewer.scene.globe.ellipsoid);
  if (!cart) return null;
  const c = Cesium.Cartographic.fromCartesian(cart);
  return { lon: Cesium.Math.toDegrees(c.longitude), lat: Cesium.Math.toDegrees(c.latitude) };
}

export function MeasureController() {
  const viewer = useCesiumViewer();
  const active = useMeasureStore((s) => s.active);
  const mode = useMeasureStore((s) => s.mode);
  const points = useMeasureStore((s) => s.points);
  const hover = useMeasureStore((s) => s.hover);
  const finished = useMeasureStore((s) => s.finished);

  const dsRef = useRef<Cesium.CustomDataSource | null>(null);
  const handlerRef = useRef<Cesium.ScreenSpaceEventHandler | null>(null);

  // Create/destroy the data source + input handler with the tool's active state.
  useEffect(() => {
    if (!viewer || !active) return;
    const v = viewer;

    const ds = new Cesium.CustomDataSource('measure');
    dsRef.current = ds;
    v.dataSources.add(ds);

    // Cesium's default double-click tracks an entity; suppress it while measuring.
    v.screenSpaceEventHandler.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);

    const handler = new Cesium.ScreenSpaceEventHandler(v.scene.canvas);
    handlerRef.current = handler;
    const store = useMeasureStore.getState;

    handler.setInputAction((e: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
      const p = pickLngLat(v, e.position);
      if (p) {
        store().addPoint(p);
        v.scene.requestRender();
      }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

    handler.setInputAction((e: Cesium.ScreenSpaceEventHandler.MotionEvent) => {
      if (store().finished) return;
      const p = pickLngLat(v, e.endPosition);
      store().setHover(p);
      v.scene.requestRender();
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

    handler.setInputAction(() => {
      // The two clicks of a double-click already added a duplicate vertex; drop
      // it, then finish the shape.
      const s = store();
      if (s.points.length > 1) s.undo();
      s.finish();
      v.scene.requestRender();
    }, Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);

    return () => {
      handler.destroy();
      handlerRef.current = null;
      v.dataSources.remove(ds, true);
      dsRef.current = null;
      v.scene.requestRender();
    };
  }, [viewer, active]);

  // Redraw vertices + line/polygon whenever the geometry changes.
  useEffect(() => {
    const ds = dsRef.current;
    if (!viewer || !ds || !active) return;
    ds.entities.removeAll();

    // The chain we draw includes the live hover point until the shape is closed.
    const chain: LngLat[] = finished || !hover ? points : [...points, hover];

    // Vertices.
    points.forEach((p, i) => {
      ds.entities.add({
        position: Cesium.Cartesian3.fromDegrees(p.lon, p.lat),
        point: {
          pixelSize: i === 0 ? 11 : 9,
          color: VERTEX_COLOR,
          outlineColor: LINE_COLOR,
          outlineWidth: 2,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });
    });

    if (chain.length >= 2) {
      const positions = chain.map((p) => Cesium.Cartesian3.fromDegrees(p.lon, p.lat));
      if (mode === 'area') {
        // Close the ring back to the first point for the fill + outline.
        const ring = [...positions, positions[0]];
        ds.entities.add({
          polygon: {
            hierarchy: new Cesium.PolygonHierarchy(positions),
            material: FILL_COLOR,
            outline: false,
            arcType: Cesium.ArcType.GEODESIC,
            height: 0,
          },
          polyline: {
            positions: ring,
            width: 2.5,
            material: LINE_COLOR,
            clampToGround: false,
            arcType: Cesium.ArcType.GEODESIC,
          },
        });
      } else {
        ds.entities.add({
          polyline: {
            positions,
            width: 2.5,
            material: new Cesium.PolylineDashMaterialProperty({
              color: LINE_COLOR,
              dashLength: 14,
            }),
            clampToGround: false,
            arcType: Cesium.ArcType.GEODESIC,
          },
        });
      }
    }

    viewer.scene.requestRender();
  }, [viewer, active, mode, points, hover, finished]);

  // Keyboard shortcuts: Esc exits, Enter/Backspace finish/undo while drawing.
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      const s = useMeasureStore.getState();
      if (e.key === 'Escape') s.exit();
      else if (e.key === 'Enter') s.finish();
      else if (e.key === 'Backspace') {
        e.preventDefault();
        s.undo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active]);

  return null;
}
