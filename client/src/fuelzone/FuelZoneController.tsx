import * as Cesium from 'cesium';
import { useCallback, useEffect, useRef } from 'react';
import { useCesiumViewer } from '../cesium/CesiumContext';
import { usePanelStore } from '../panels/panelStore';
import { useFuelZoneStore, formatRadius } from './fuelZoneStore';
import {
  analyzeFuelZone,
  analyzeFuelPolygon,
  circleRing,
  polygonRing,
  distanceM,
  type LngLat,
} from './zonalStats';

// Bright cyan reads strongly against the warm orange/red/tan FBFM40 palette
// (and against dark ocean when the fuel layer is off). The dark casing keeps the
// outline legible even where it crosses a pale, high-value fuel class.
const LINE_COLOR = Cesium.Color.fromCssColorString('#2fe1ff');
const LINE_CASING = Cesium.Color.fromCssColorString('#04212e').withAlpha(0.9);
const FILL_COLOR = LINE_COLOR.withAlpha(0.1);
const CENTER_COLOR = Cesium.Color.fromCssColorString('#ffffff');
// The ellipse/polygon `outline` is rendered as GL_LINES and clamped to 1px on
// most GPUs, so we draw perimeters as polylines instead — those honor width and
// give a crisp, cased outline (same approach as the measure tool).
const RING_WIDTH = 4;

// Polygon drawing pixel thresholds.
const CLOSE_PX = 14; // click within this of the first vertex → close the ring
const DEDUP_PX = 8; // ignore a click this close to the last vertex (double-click jitter)

// Geodesic ring positions for the perimeter polyline, reusing the same circle
// geometry as the histogram query so the drawn outline matches what's analyzed.
function ringPositions(center: LngLat, radiusM: number): Cesium.Cartesian3[] {
  return circleRing(center, radiusM, 128).map(([lon, lat]) =>
    Cesium.Cartesian3.fromDegrees(lon, lat)
  );
}

function ringToPositions(ring: number[][]): Cesium.Cartesian3[] {
  return ring.map(([lon, lat]) => Cesium.Cartesian3.fromDegrees(lon, lat));
}

const perimeterMaterial = () =>
  new Cesium.PolylineOutlineMaterialProperty({
    color: LINE_COLOR,
    outlineColor: LINE_CASING,
    outlineWidth: 2,
  });

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
      material: perimeterMaterial(),
      arcType: Cesium.ArcType.GEODESIC,
      clampToGround: false,
    },
  };
}

// A draped polygon: faint fill + cased perimeter, built from a closed ring.
function polygonGraphics(ring: number[][]): Cesium.Entity.ConstructorOptions {
  const positions = ringToPositions(ring);
  return {
    polygon: {
      hierarchy: new Cesium.PolygonHierarchy(positions),
      material: FILL_COLOR,
      height: 0,
    },
    polyline: {
      positions,
      width: RING_WIDTH,
      material: perimeterMaterial(),
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
  const mode = useFuelZoneStore((s) => s.mode);
  const center = useFuelZoneStore((s) => s.center);
  const radiusM = useFuelZoneStore((s) => s.radiusM);
  const vertices = useFuelZoneStore((s) => s.vertices);
  const cursor = useFuelZoneStore((s) => s.cursor);
  const pendingFinish = useFuelZoneStore((s) => s.pendingFinish);

  const dsRef = useRef<Cesium.CustomDataSource | null>(null);
  // Persistent DS: holds committed zones that survive the draw tool exiting.
  // Each zone lives until its corresponding panel is closed.
  const persistDsRef = useRef<Cesium.CustomDataSource | null>(null);
  const entityMapRef = useRef<Map<string, Cesium.Entity>>(new Map());

  // Persistent data source — lives as long as the viewer, not the draw tool.
  // Subscribes to the panel store so zones are removed when their panel closes.
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

  // Open the result panel and pin the committed zone outline. Shared tail of
  // both finalize paths.
  const commit = useCallback(
    (
      v: Cesium.Viewer,
      result: Awaited<ReturnType<typeof analyzeFuelZone>>,
      subtitle: string,
      graphics: Cesium.Entity.ConstructorOptions
    ) => {
      const store = useFuelZoneStore.getState;
      const seq = store().seq + 1;
      store().bumpSeq();
      const panelId = `fuel-zone-${seq}`;
      usePanelStore.getState().open({
        id: panelId,
        kind: 'fuel-zone',
        title: 'Fuel breakdown',
        subtitle,
        payload: result as unknown as Record<string, unknown>,
      });
      // Persist the committed outline so it stays visible while the panel is
      // open; it's removed when the panel closes (see the subscriber above).
      if (persistDsRef.current) {
        const entity = persistDsRef.current.entities.add(graphics);
        entityMapRef.current.set(panelId, entity);
      }
      store().exit();
      v.scene.requestRender();
    },
    []
  );

  const finalizeCircle = useCallback(
    async (zoneCenter: LngLat, rawRadius: number) => {
      if (!viewer) return;
      const v = viewer;
      const store = useFuelZoneStore.getState;
      const radius = Math.min(MAX_RADIUS_M, rawRadius);
      store().setBusy(true);
      try {
        const result = await analyzeFuelZone(zoneCenter, radius);
        commit(v, result, `${formatRadius(radius)} radius`, circleGraphics(zoneCenter, radius));
      } catch (err) {
        store().setError(err instanceof Error ? err.message : String(err));
        v.scene.requestRender();
      }
    },
    [viewer, commit]
  );

  const finalizePolygon = useCallback(
    async (verts: LngLat[]) => {
      if (!viewer || verts.length < 3) return;
      const v = viewer;
      const store = useFuelZoneStore.getState;
      store().setBusy(true);
      try {
        const result = await analyzeFuelPolygon(verts);
        commit(
          v,
          result,
          `${verts.length}-point area`,
          polygonGraphics(polygonRing(verts))
        );
      } catch (err) {
        store().setError(err instanceof Error ? err.message : String(err));
        v.scene.requestRender();
      }
    },
    [viewer, commit]
  );

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
    const winScratch = new Cesium.Cartesian2();
    const winOf = (p: LngLat): Cesium.Cartesian2 | undefined =>
      Cesium.SceneTransforms.worldToWindowCoordinates(
        v.scene,
        Cesium.Cartesian3.fromDegrees(p.lon, p.lat),
        winScratch
      );

    handler.setInputAction((e: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
      const s = store();
      if (s.busy) return;
      const p = pickLngLat(v, e.position);
      if (!p) return;

      if (s.mode === 'circle') {
        if (!s.hasCenter || s.error) {
          // First click (or restart after an error) sets the center.
          s.begin(p);
        } else {
          const radius = distanceM(s.center!, p);
          if (radius < MIN_RADIUS_M) return; // too small — keep sizing
          void finalizeCircle(s.center!, radius);
        }
      } else {
        // Polygon: a click after an error restarts cleanly.
        if (s.error) {
          s.reset();
          s.addVertex(p);
          v.scene.requestRender();
          return;
        }
        const verts = s.vertices;
        // Click near the first vertex closes the ring (needs a real triangle).
        if (verts.length >= 3) {
          const fw = winOf(verts[0]);
          if (fw && Cesium.Cartesian2.distance(fw, e.position) < CLOSE_PX) {
            void finalizePolygon(verts);
            return;
          }
        }
        // Ignore a click landing on the previous vertex (double-click jitter).
        if (verts.length > 0) {
          const lw = winOf(verts[verts.length - 1]);
          if (lw && Cesium.Cartesian2.distance(lw, e.position) < DEDUP_PX) return;
        }
        s.addVertex(p);
      }
      v.scene.requestRender();
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

    handler.setInputAction((e: Cesium.ScreenSpaceEventHandler.MotionEvent) => {
      const s = store();
      if (s.busy) return;
      const p = pickLngLat(v, e.endPosition);
      if (s.mode === 'circle') {
        if (!s.hasCenter || s.error || !p) return;
        s.setRadius(distanceM(s.center!, p));
      } else {
        if (s.error) return;
        s.setCursor(p); // p may be null off-globe → clears the rubber band
      }
      v.scene.requestRender();
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

    // Double-click finishes a polygon (the two single clicks already fired; the
    // near-last-vertex dedup above keeps the duplicate out).
    handler.setInputAction(() => {
      const s = store();
      if (s.busy || s.mode !== 'polygon') return;
      if (s.vertices.length >= 3) void finalizePolygon(s.vertices);
    }, Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);

    return () => {
      handler.destroy();
      v.dataSources.remove(ds, true);
      dsRef.current = null;
      v.scene.requestRender();
    };
  }, [viewer, active, finalizeCircle, finalizePolygon]);

  // The overlay's "Finish" button bumps pendingFinish → close the polygon.
  useEffect(() => {
    if (pendingFinish === 0) return;
    const s = useFuelZoneStore.getState();
    if (!s.active || s.mode !== 'polygon' || s.busy || s.vertices.length < 3) return;
    void finalizePolygon(s.vertices);
  }, [pendingFinish, finalizePolygon]);

  // Redraw the live preview whenever the geometry changes.
  useEffect(() => {
    const ds = dsRef.current;
    if (!viewer || !ds || !active) return;
    ds.entities.removeAll();

    if (mode === 'circle') {
      if (center) {
        ds.entities.add({
          // Surface anchor + default depth test — the marker hides behind the
          // globe if the user rotates it mid-draw.
          position: Cesium.Cartesian3.fromDegrees(center.lon, center.lat, 0),
          point: {
            pixelSize: 8,
            color: CENTER_COLOR,
            outlineColor: LINE_COLOR,
            outlineWidth: 2,
          },
        });
        if (radiusM > 0) ds.entities.add(circleGraphics(center, radiusM));
      }
    } else {
      // Faint fill once the in-progress shape (vertices + rubber-band cursor)
      // has at least three corners.
      const fillPts = cursor ? [...vertices, cursor] : vertices;
      if (fillPts.length >= 3) {
        ds.entities.add({
          polygon: {
            hierarchy: new Cesium.PolygonHierarchy(
              fillPts.map((p) => Cesium.Cartesian3.fromDegrees(p.lon, p.lat))
            ),
            material: FILL_COLOR,
            height: 0,
          },
        });
      }
      if (vertices.length > 0) {
        // Open polyline through the placed vertices, then out to the cursor.
        const linePts = vertices.map((p) => Cesium.Cartesian3.fromDegrees(p.lon, p.lat));
        if (cursor) linePts.push(Cesium.Cartesian3.fromDegrees(cursor.lon, cursor.lat));
        ds.entities.add({
          polyline: {
            positions: linePts,
            width: RING_WIDTH,
            material: perimeterMaterial(),
            arcType: Cesium.ArcType.GEODESIC,
            clampToGround: false,
          },
        });
        // Dashed "closing" hint from the cursor (or last vertex) back to the first.
        if (vertices.length >= 2) {
          const from = cursor
            ? Cesium.Cartesian3.fromDegrees(cursor.lon, cursor.lat)
            : linePts[linePts.length - 1];
          ds.entities.add({
            polyline: {
              positions: [from, Cesium.Cartesian3.fromDegrees(vertices[0].lon, vertices[0].lat)],
              width: 2,
              material: new Cesium.PolylineDashMaterialProperty({
                color: LINE_COLOR.withAlpha(0.55),
                dashLength: 12,
              }),
              arcType: Cesium.ArcType.GEODESIC,
              clampToGround: false,
            },
          });
        }
      }
      // Vertex markers; the first is enlarged as the "click here to close" target.
      vertices.forEach((p, i) => {
        ds.entities.add({
          // Surface anchor + default depth test — far-side vertices hide
          // behind the globe.
          position: Cesium.Cartesian3.fromDegrees(p.lon, p.lat, 0),
          point: {
            pixelSize: i === 0 ? 11 : 8,
            color: i === 0 ? LINE_COLOR : CENTER_COLOR,
            outlineColor: i === 0 ? CENTER_COLOR : LINE_COLOR,
            outlineWidth: 2,
          },
        });
      });
    }

    viewer.scene.requestRender();
  }, [viewer, active, mode, center, radiusM, vertices, cursor]);

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
