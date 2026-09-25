import * as Cesium from 'cesium';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useCesiumViewer } from '../cesium/CesiumContext';
import { useCrisisStore, type DrawLayer, type DrawLayerPoint, type DrawGeometry } from './crisisStore';
import { uploadImage } from '../lib/cloudinary';
import { usePickChooserStore } from '../panels/pickChooserStore';
import { useMeasureStore } from '../measure/measureStore';
import { useFuelZoneStore } from '../fuelzone/fuelZoneStore';
import { addLayerEntities, hideLayerEntity } from './CrisisMapLayer';
import { classifyDrawClick, discardPrompt, drawKeyAction, minPoints, samePositions } from './drawInput';

const PREVIEW = Cesium.Color.fromCssColorString('#3ddcff');

function pickLngLat(viewer: Cesium.Viewer, pos: Cesium.Cartesian2): DrawLayerPoint | null {
  const cart = viewer.camera.pickEllipsoid(pos, viewer.scene.globe.ellipsoid);
  if (!cart) return null;
  const c = Cesium.Cartographic.fromCartesian(cart);
  return { lon: Cesium.Math.toDegrees(c.longitude), lat: Cesium.Math.toDegrees(c.latitude) };
}

function findLayer(layerId: string | null): DrawLayer | undefined {
  if (!layerId) return undefined;
  for (const inc of useCrisisStore.getState().incidents) {
    const l = inc.drawLayers.find((ly) => ly.id === layerId);
    if (l) return l;
  }
  return undefined;
}

// Snapshot the globe for the layer's thumbnail (after-action report, share
// page). Must stay synchronous: preserveDrawingBuffer is deliberately OFF (see
// CesiumGlobe), so the canvas can only be read in the same task as the render
// that drew it — no await anywhere in here.
//
// What the snapshot shows is the in-progress preview in its cyan draft style —
// new polygon/polyline geometry is built asynchronously, so the finished styling
// can't be drawn in time for a synchronous capture. Around that:
//  - the layer's committed shape is hidden for the capture, so a Redraw shows
//    only the new shape, not old and new on top of each other;
//  - a marker IS drawn in its finished style: its point is built synchronously
//    (its name label may miss the snapshot — glyphs load asynchronously), and
//    the preview's translucent cursor marker (at the last hover position, not
//    the click) must not stand in for it;
//  - the rubber band to the cursor is gone by the time Finish is clicked
//    (pointerleave clears it — see the handler effect).
function captureThumbnail(
  viewer: Cesium.Viewer,
  layer: DrawLayer | undefined,
  pts: DrawLayerPoint[],
  preview: Cesium.CustomDataSource | null
): string | undefined {
  const restore = layer ? hideLayerEntity(viewer, layer.id) : () => {};
  try {
    if (preview && layer?.geometry === 'point') {
      preview.entities.removeAll();
      addLayerEntities(preview, { ...layer, positions: pts });
    }
    // The globe runs in requestRenderMode: render() draws nothing unless a
    // frame is pending, and the canvas then reads back blank (verified in
    // headless Chromium — the usual case when Finish is clicked off the map).
    viewer.scene.requestRender();
    viewer.render();
    const src = viewer.canvas;
    const maxW = 640, maxH = 360;
    const scale = Math.min(maxW / src.width, maxH / src.height, 1);
    const w = Math.round(src.width * scale);
    const h = Math.round(src.height * scale);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d')!.drawImage(src, 0, 0, w, h);
    return c.toDataURL('image/jpeg', 0.75);
  } catch {
    return undefined; // capture unavailable — the thumbnail is optional
  } finally {
    restore();
    viewer.scene.requestRender();
  }
}

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

  useEffect(() => {
    setPoints([]);
    setHoverPt(null);
    if (!activeId) return;
    // The map is the drawing surface now. A pick chooser left open would sit
    // over it, its full-screen click catcher swallowing the first vertex; a
    // layer popup would cover part of it; and a measure or fuel-zone tool
    // still running would take every vertex click as its own point too.
    usePickChooserStore.getState().hide();
    useCrisisStore.getState().setPickedLayer(null);
    if (useMeasureStore.getState().active) useMeasureStore.getState().exit();
    if (useFuelZoneStore.getState().active) useFuelZoneStore.getState().exit();
  }, [activeId]);

  const endDrawing = () => {
    setActiveDrawLayer(null);
    setOpen(true); // return to the incident editor
  };

  // Cancel (Esc or the Cancel button). A drawing is a shared, recorded
  // artifact, and Esc is often pressed out of habit, so a drawing with real
  // work in it asks first. The saved shape is untouched either way.
  const cancelDrawing = () => {
    const prompt = discardPrompt(
      pointsRef.current.length,
      (findLayer(idRef.current)?.positions.length ?? 0) > 0
    );
    if (prompt && !window.confirm(prompt)) return;
    endDrawing();
  };

  const commit = (pts: DrawLayerPoint[]) => {
    const layerId = idRef.current;
    if (!layerId) return;
    if (pts.length < minPoints(geomRef.current)) return;
    const dataUrl = viewer ? captureThumbnail(viewer, findLayer(layerId), pts, dsRef.current) : undefined;
    // The old thumbnail pictures the old shape: drop it together with the new
    // positions, so a Redraw whose upload fails (offline, Cloudinary down) or
    // is still in flight never leaves the report and share page showing a
    // shape that contradicts the measurements printed beside it. The layer
    // appears at once; the new thumbnail fills in when the upload lands.
    updateDrawLayer(layerId, { positions: pts, thumbnail: undefined });
    endDrawing();
    if (dataUrl) {
      uploadImage(dataUrl)
        .then((url) => {
          // Only onto the shape it pictures: a Redraw, coordinate import or
          // flip made while this upload was in flight must keep its own.
          const layer = findLayer(layerId);
          if (layer && samePositions(layer.positions, pts)) updateDrawLayer(layerId, { thumbnail: url });
        })
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

    const toWindow = (p: DrawLayerPoint) =>
      Cesium.SceneTransforms.worldToWindowCoordinates(v.scene, Cesium.Cartesian3.fromDegrees(p.lon, p.lat));

    handler.setInputAction((e: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
      if (geomRef.current === 'point') {
        const p = pickLngLat(v, e.position);
        if (p) commit([p]); // single click places the marker and finishes
        return;
      }
      // pointsRef is current here: React flushes the previous click's update
      // (a discrete event) before the next click's task runs.
      const pts = pointsRef.current;
      const action = classifyDrawClick(geomRef.current, pts, e.position, toWindow);
      if (action === 'close') { commit(pts); return; }
      if (action === 'ignore') return;
      const p = pickLngLat(v, e.position);
      if (p) setPoints((prev) => [...prev, p]);
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

    handler.setInputAction((e: Cesium.ScreenSpaceEventHandler.MotionEvent) => {
      setHoverPt(pickLngLat(v, e.endPosition));
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

    // Double-click finishes. Its two clicks already fired LEFT_CLICK, and the
    // near-the-last-vertex rule kept the second one out, so every vertex here
    // is one the operator placed.
    handler.setInputAction(() => {
      commit(pointsRef.current);
    }, Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);

    // The cursor leaving the map — typically for the toolbar's Finish button —
    // drops the rubber band, so it isn't in the thumbnail captured on Finish.
    const onLeave = () => setHoverPt(null);
    v.scene.canvas.addEventListener('pointerleave', onLeave);

    return () => {
      v.scene.canvas.removeEventListener('pointerleave', onLeave);
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

  // Keyboard shortcuts: Enter finishes, Backspace undoes, Esc cancels — never
  // while the key is going into a field (see drawKeyAction).
  useEffect(() => {
    if (!activeId) return;
    const onKey = (e: KeyboardEvent) => {
      const action = drawKeyAction(e);
      if (action === 'cancel') cancelDrawing();
      else if (action === 'finish') commit(pointsRef.current);
      else if (action === 'undo') { e.preventDefault(); setPoints((prev) => prev.slice(0, -1)); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, viewer]);

  if (!activeId) return null;

  const count = `${points.length} point${points.length !== 1 ? 's' : ''}`;
  const instruction =
    geometry === 'point' ? 'Click on the map to place the marker'
    : points.length === 0 ? (directional ? 'Click on the map to start — the arrow will point toward your last click' : 'Click on the map to start')
    : geometry === 'line' ? `${count} · double-click to finish${directional ? ' · arrow points to last point' : ''}`
    : points.length < 3 ? `${count} · keep clicking to outline the area`
    : `${count} · click the first point or double-click to close`;
  // Keyboard shortcuts are otherwise undiscoverable; phones have no keyboard
  // (and no room), so the hint shows from md up.
  const shortcuts = geometry === 'point' ? 'Esc cancel' : 'Enter finish · ⌫ undo · Esc cancel';

  // Wraps (and stays inside the viewport) on phones, so Finish and Cancel are
  // always reachable; the dividers only make sense on one row.
  return createPortal(
    <div className="fixed bottom-24 left-1/2 z-[3000] w-max max-w-[calc(100vw-2rem)] -translate-x-1/2">
      <div
        role="toolbar"
        aria-label={`Drawing ${directional ? 'directional line' : geometry}: ${activeLayer?.name ?? ''}`}
        className="flex flex-wrap items-center justify-center gap-2 rounded-lg border border-white/20 bg-ink-950/95 px-4 py-2.5 shadow-xl"
      >
        <div className="mr-1 min-w-0">
          <p className="text-[9px] font-bold uppercase tracking-wider text-white/35">
            Drawing {directional ? 'directional line' : geometry}
          </p>
          <p className="truncate text-[12px] font-semibold text-white/80">{activeLayer?.name ?? '—'}</p>
        </div>
        <div className="mx-2 hidden h-6 w-px bg-white/10 md:block" />
        <p className="text-[10px] text-white/40" aria-live="polite">
          {instruction}
          <span className="hidden text-white/25 md:inline"> · {shortcuts}</span>
        </p>
        <div className="mx-2 hidden h-6 w-px bg-white/10 md:block" />
        <div className="flex items-center gap-2">
          {geometry !== 'point' && (
            <>
              <button
                type="button"
                onClick={() => setPoints((prev) => prev.slice(0, -1))}
                disabled={points.length === 0}
                title="Remove the last point (Backspace)"
                className="rounded px-3 py-1.5 text-[11px] text-white/45 transition hover:bg-white/8 hover:text-white/70 disabled:opacity-30 md:px-2.5 md:py-1 md:text-[10px]"
              >
                Undo
              </button>
              <button
                type="button"
                onClick={() => commit(points)}
                disabled={points.length < minPoints(geometry)}
                title="Finish the shape (Enter)"
                className="rounded bg-accent/20 px-3 py-1.5 text-[11px] text-accent transition hover:bg-accent/30 disabled:opacity-30 md:px-2.5 md:py-1 md:text-[10px]"
              >
                Finish
              </button>
            </>
          )}
          <button
            type="button"
            onClick={cancelDrawing}
            title="Stop drawing without saving (Esc)"
            className="rounded px-3 py-1.5 text-[11px] text-red-400/60 transition hover:bg-red-400/8 hover:text-red-400 md:px-2.5 md:py-1 md:text-[10px]"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
