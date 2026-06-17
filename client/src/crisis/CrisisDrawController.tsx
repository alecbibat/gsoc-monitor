import * as Cesium from 'cesium';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useCesiumViewer } from '../cesium/CesiumContext';
import { useCrisisStore, type DrawLayerPoint } from './crisisStore';

const PREVIEW_COLOR = Cesium.Color.fromCssColorString('#3ddcff');

function pickLngLat(viewer: Cesium.Viewer, pos: Cesium.Cartesian2): DrawLayerPoint | null {
  const cart = viewer.camera.pickEllipsoid(pos, viewer.scene.globe.ellipsoid);
  if (!cart) return null;
  const c = Cesium.Cartographic.fromCartesian(cart);
  return { lon: Cesium.Math.toDegrees(c.longitude), lat: Cesium.Math.toDegrees(c.latitude) };
}

export function CrisisDrawController() {
  const viewer = useCesiumViewer();
  const activeId = useCrisisStore((s) => s.activeDrawLayerId);
  const activeLayer = useCrisisStore((s) => s.drawLayers.find((l) => l.id === s.activeDrawLayerId));
  const { updateDrawLayer, setActiveDrawLayer } = useCrisisStore();

  const [points, setPoints] = useState<DrawLayerPoint[]>([]);
  const [hoverPt, setHoverPt] = useState<DrawLayerPoint | null>(null);
  const dsRef = useRef<Cesium.CustomDataSource | null>(null);
  const handlerRef = useRef<Cesium.ScreenSpaceEventHandler | null>(null);

  // Reset points when target layer changes
  useEffect(() => {
    setPoints([]);
    setHoverPt(null);
  }, [activeId]);

  // Install / uninstall Cesium handlers
  useEffect(() => {
    if (!viewer || !activeId) return;
    const v = viewer;

    const ds = new Cesium.CustomDataSource('crisis-draw-preview');
    dsRef.current = ds;
    v.dataSources.add(ds);

    v.screenSpaceEventHandler.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);

    const handler = new Cesium.ScreenSpaceEventHandler(v.scene.canvas);
    handlerRef.current = handler;

    handler.setInputAction((e: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
      const p = pickLngLat(v, e.position);
      if (p) setPoints((prev) => [...prev, p]);
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

    handler.setInputAction((e: Cesium.ScreenSpaceEventHandler.MotionEvent) => {
      setHoverPt(pickLngLat(v, e.endPosition));
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

    handler.setInputAction(() => {
      setPoints((prev) => {
        const pts = prev.slice(0, -1);
        if (pts.length >= 2) finish(pts, true);
        return pts;
      });
    }, Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);

    return () => {
      handler.destroy();
      handlerRef.current = null;
      v.dataSources.remove(ds, true);
      dsRef.current = null;
      v.scene.requestRender();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewer, activeId]);

  // Update preview entities
  useEffect(() => {
    const ds = dsRef.current;
    if (!ds || !viewer) return;
    ds.entities.removeAll();

    const chain = hoverPt ? [...points, hoverPt] : points;

    points.forEach((p, i) => {
      ds.entities.add({
        position: Cesium.Cartesian3.fromDegrees(p.lon, p.lat),
        point: {
          pixelSize: i === 0 ? 11 : 8,
          color: PREVIEW_COLOR,
          outlineColor: Cesium.Color.WHITE,
          outlineWidth: 1.5,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });
    });

    if (chain.length >= 2) {
      const positions = chain.map((p) => Cesium.Cartesian3.fromDegrees(p.lon, p.lat));
      ds.entities.add({
        polyline: {
          positions: [...positions, positions[0]],
          width: 2,
          material: PREVIEW_COLOR.withAlpha(0.8),
          clampToGround: true,
          arcType: Cesium.ArcType.GEODESIC,
        },
      });
      if (chain.length >= 3) {
        ds.entities.add({
          polygon: {
            hierarchy: new Cesium.PolygonHierarchy(positions),
            material: PREVIEW_COLOR.withAlpha(0.1),
            height: 0,
            arcType: Cesium.ArcType.GEODESIC,
          },
        });
      }
    }

    viewer.scene.requestRender();
  }, [viewer, points, hoverPt]);

  const finish = (pts: DrawLayerPoint[] = points, closed = true) => {
    if (pts.length < 2 || !activeId) return;
    updateDrawLayer(activeId, { positions: pts, closed });
    setActiveDrawLayer(null);
  };

  const cancel = () => {
    setActiveDrawLayer(null);
  };

  const undo = () => setPoints((prev) => prev.slice(0, -1));

  // Keyboard shortcuts
  useEffect(() => {
    if (!activeId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cancel();
      else if (e.key === 'Enter') finish();
      else if (e.key === 'Backspace') { e.preventDefault(); undo(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, points]);

  if (!activeId) return null;

  return createPortal(
    <div className="fixed bottom-24 left-1/2 z-[3000] -translate-x-1/2">
      <div className="flex items-center gap-2 rounded-lg border border-white/20 bg-ink-950/96 px-4 py-2.5 shadow-xl">
        <div className="mr-1">
          <p className="text-[9px] font-bold uppercase tracking-wider text-white/35">Drawing</p>
          <p className="text-[12px] font-semibold text-white/80">{activeLayer?.name ?? '—'}</p>
        </div>
        <div className="mx-2 h-6 w-px bg-white/10" />
        <p className="text-[10px] text-white/35">
          {points.length === 0
            ? 'Click on the map to start'
            : `${points.length} point${points.length !== 1 ? 's' : ''} · double-click to close`}
        </p>
        <div className="mx-2 h-6 w-px bg-white/10" />
        <button
          onClick={undo}
          disabled={points.length === 0}
          className="rounded px-2.5 py-1 text-[10px] text-white/45 transition hover:bg-white/8 hover:text-white/70 disabled:opacity-30"
        >
          Undo
        </button>
        <button
          onClick={() => finish()}
          disabled={points.length < 2}
          className="rounded bg-accent/20 px-2.5 py-1 text-[10px] text-accent transition hover:bg-accent/30 disabled:opacity-30"
        >
          Finish
        </button>
        <button
          onClick={cancel}
          className="rounded px-2.5 py-1 text-[10px] text-red-400/60 transition hover:bg-red-400/8 hover:text-red-400"
        >
          Cancel
        </button>
      </div>
    </div>,
    document.body
  );
}
