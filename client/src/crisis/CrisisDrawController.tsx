import * as Cesium from 'cesium';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useCesiumViewer } from '../cesium/CesiumContext';
import { useCrisisStore, type DrawLayerPoint, type DrawGeometry } from './crisisStore';
import { uploadImage } from '../lib/cloudinary';

const PREVIEW = Cesium.Color.fromCssColorString('#3ddcff');

function pickLngLat(viewer: Cesium.Viewer, pos: Cesium.Cartesian2): DrawLayerPoint | null {
  const cart = viewer.camera.pickEllipsoid(pos, viewer.scene.globe.ellipsoid);
  if (!cart) return null;
  const c = Cesium.Cartographic.fromCartesian(cart);
  return { lon: Cesium.Math.toDegrees(c.longitude), lat: Cesium.Math.toDegrees(c.latitude) };
}

const minPoints = (g: DrawGeometry) => (g === 'point' ? 1 : g === 'line' ? 2 : 3);

export function CrisisDrawController() {
  const viewer = useCesiumViewer();
  const activeId = useCrisisStore((s) => s.activeDrawLayerId);
  const activeLayer = useCrisisStore((s) => {
    if (!s.activeDrawLayerId) return undefined;
    for (const inc of s.incidents) {
      const l = inc.drawLayers.find((ly) => ly.id === s.activeDrawLayerId);
      if (l) return l;
    }
    return undefined;
  });
  const updateDrawLayer = useCrisisStore((s) => s.updateDrawLayer);
  const setActiveDrawLayer = useCrisisStore((s) => s.setActiveDrawLayer);
  const setOpen = useCrisisStore((s) => s.setOpen);

  const geometry: DrawGeometry = activeLayer?.geometry ?? 'polygon';
  const directional = geometry === 'line' && !!activeLayer?.directional;
  const geomRef = useRef(geometry);
  useEffect(() => { geomRef.current = geometry; }, [geometry]);

  const [points, setPoints] = useState<DrawLayerPoint[]>([]);
  const [hoverPt, setHoverPt] = useState<DrawLayerPoint | null>(null);
  const pointsRef = useRef(points);
  pointsRef.current = points;

  const dsRef = useRef<Cesium.CustomDataSource | null>(null);
  const idRef = useRef<string | null>(null);
  idRef.current = activeId;

  useEffect(() => { setPoints([]); setHoverPt(null); }, [activeId]);

  const endDrawing = () => {
    setActiveDrawLayer(null);
    setOpen(true); // return to the incident editor
  };

  const commit = (pts: DrawLayerPoint[]) => {
    if (!idRef.current) return;
    if (pts.length < minPoints(geomRef.current)) return;
    // Capture the thumbnail synchronously (canvas read must happen in the same
    // task as viewer.render() — no await). Then upload to Cloudinary async so
    // the layer appears immediately and the thumbnail populates after upload.
    // preserveDrawingBuffer is deliberately OFF (see note at top of file).
    let dataUrl: string | undefined;
    if (viewer) {
      try {
        viewer.render();
        const src = viewer.canvas;
        const maxW = 640, maxH = 360;
        const scale = Math.min(maxW / src.width, maxH / src.height, 1);
        const w = Math.round(src.width * scale);
        const h = Math.round(src.height * scale);
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        c.getContext('2d')!.drawImage(src, 0, 0, w, h);
        dataUrl = c.toDataURL('image/jpeg', 0.75);
      } catch { /* capture unavailable — thumbnail is optional */ }
    }
    const layerId = idRef.current;
    updateDrawLayer(layerId, { positions: pts });
    endDrawing();
    if (dataUrl) {
      uploadImage(dataUrl)
        .then((url) => updateDrawLayer(layerId, { thumbnail: url }))
        .catch(() => { /* thumbnail is optional — omit on failure */ });
    }
  };

  // Install Cesium handlers while a layer is being drawn
  useEffect(() => {
    if (!viewer || !activeId) return;
    const v = viewer;

    const ds = new Cesium.CustomDataSource('crisis-draw-preview');
    dsRef.current = ds;
    v.dataSources.add(ds);
    v.screenSpaceEventHandler.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);

    const handler = new Cesium.ScreenSpaceEventHandler(v.scene.canvas);

    handler.setInputAction((e: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
      const p = pickLngLat(v, e.position);
      if (!p) return;
      if (geomRef.current === 'point') {
        commit([p]); // single click places the marker and finishes
      } else {
        setPoints((prev) => [...prev, p]);
      }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

    handler.setInputAction((e: Cesium.ScreenSpaceEventHandler.MotionEvent) => {
      setHoverPt(pickLngLat(v, e.endPosition));
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

    handler.setInputAction(() => {
      // Double-click adds a duplicate vertex — drop it, then finish.
      const pts = pointsRef.current.slice(0, -1);
      commit(pts);
    }, Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);

    return () => {
      handler.destroy();
      v.dataSources.remove(ds, true);
      dsRef.current = null;
      v.scene.requestRender();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewer, activeId]);

  // Draw preview geometry
  useEffect(() => {
    const ds = dsRef.current;
    if (!ds || !viewer) return;
    ds.entities.removeAll();

    const chain = hoverPt ? [...points, hoverPt] : points;

    points.forEach((p, i) => {
      ds.entities.add({
        // Surface anchor + default depth test — placed vertices hide behind
        // the globe if the operator rotates it mid-draw. (The cursor-tracking
        // hover marker below stays always-on-top: pickEllipsoid only ever
        // returns near-side positions, so it can't be on the far side.)
        position: Cesium.Cartesian3.fromDegrees(p.lon, p.lat, 0),
        point: {
          pixelSize: i === 0 ? 11 : 8,
          color: PREVIEW,
          outlineColor: Cesium.Color.WHITE,
          outlineWidth: 1.5,
        },
      });
    });

    // hover marker for point mode
    if (geometry === 'point' && hoverPt) {
      ds.entities.add({
        position: Cesium.Cartesian3.fromDegrees(hoverPt.lon, hoverPt.lat),
        point: {
          pixelSize: 12, color: PREVIEW.withAlpha(0.6),
          outlineColor: Cesium.Color.WHITE, outlineWidth: 1.5,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });
    }

    if (geometry !== 'point' && chain.length >= 2) {
      const linePos = chain.map((p) => Cesium.Cartesian3.fromDegrees(p.lon, p.lat));
      ds.entities.add({
        polyline: {
          positions: geometry === 'polygon' ? [...linePos, linePos[0]] : linePos,
          // Directional lines preview with the same arrow material they render
          // with, so the operator sees which way it points while drawing.
          width: directional ? 12 : 2.5,
          material: directional
            ? new Cesium.PolylineArrowMaterialProperty(PREVIEW.withAlpha(0.85))
            : PREVIEW.withAlpha(0.85),
          clampToGround: !directional,
          arcType: Cesium.ArcType.GEODESIC,
        },
      });
      if (geometry === 'polygon' && chain.length >= 3) {
        ds.entities.add({
          polygon: {
            hierarchy: new Cesium.PolygonHierarchy(chain.map((p) => Cesium.Cartesian3.fromDegrees(p.lon, p.lat))),
            material: PREVIEW.withAlpha(0.1),
            height: 0,
            arcType: Cesium.ArcType.GEODESIC,
          },
        });
      }
    }

    viewer.scene.requestRender();
  }, [viewer, points, hoverPt, geometry, directional]);

  // Keyboard shortcuts
  useEffect(() => {
    if (!activeId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') endDrawing();
      else if (e.key === 'Enter') commit(points);
      else if (e.key === 'Backspace') { e.preventDefault(); setPoints((prev) => prev.slice(0, -1)); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, points]);

  if (!activeId) return null;

  const instruction =
    geometry === 'point' ? 'Click on the map to place the marker'
    : points.length === 0 ? (directional ? 'Click on the map to start — the arrow will point toward your last click' : 'Click on the map to start')
    : geometry === 'line' ? `${points.length} point${points.length !== 1 ? 's' : ''} · double-click to finish${directional ? ' · arrow points to last point' : ''}`
    : `${points.length} point${points.length !== 1 ? 's' : ''} · double-click to close area`;

  return createPortal(
    <div className="fixed bottom-24 left-1/2 z-[3000] -translate-x-1/2">
      <div className="flex items-center gap-2 rounded-lg border border-white/20 bg-ink-950/95 px-4 py-2.5 shadow-xl">
        <div className="mr-1">
          <p className="text-[9px] font-bold uppercase tracking-wider text-white/35">
            Drawing {directional ? 'directional line' : geometry}
          </p>
          <p className="text-[12px] font-semibold text-white/80">{activeLayer?.name ?? '—'}</p>
        </div>
        <div className="mx-2 h-6 w-px bg-white/10" />
        <p className="text-[10px] text-white/40">{instruction}</p>
        <div className="mx-2 h-6 w-px bg-white/10" />
        {geometry !== 'point' && (
          <>
            <button
              onClick={() => setPoints((prev) => prev.slice(0, -1))}
              disabled={points.length === 0}
              className="rounded px-2.5 py-1 text-[10px] text-white/45 transition hover:bg-white/8 hover:text-white/70 disabled:opacity-30"
            >
              Undo
            </button>
            <button
              onClick={() => commit(points)}
              disabled={points.length < minPoints(geometry)}
              className="rounded bg-accent/20 px-2.5 py-1 text-[10px] text-accent transition hover:bg-accent/30 disabled:opacity-30"
            >
              Finish
            </button>
          </>
        )}
        <button
          onClick={endDrawing}
          className="rounded px-2.5 py-1 text-[10px] text-red-400/60 transition hover:bg-red-400/8 hover:text-red-400"
        >
          {geometry === 'point' ? 'Cancel' : 'Cancel'}
        </button>
      </div>
    </div>,
    document.body
  );
}
