import * as Cesium from 'cesium';
import { useEffect, useRef } from 'react';
import { useCesiumViewer } from '../../cesium/CesiumContext';
import { useLayersStore } from '../../store/layersStore';
import { startVisiblePolling } from '../../lib/poll';
import { usePanelStore, type PanelOpenData } from '../../panels/panelStore';
import type { NgfsPixel, NgfsResponse } from '../../types';
import { pixelFootprint, SLOT_LON0 } from './abiFootprint';
import { fetchNgfs, ngfsPanelData, ngfsPanelId, panelPayload, pixelStyle } from './ngfsMeta';
import { useNgfsStatus } from './ngfsStore';

// The server refreshes every 2 minutes and GOES scans every 5.
const POLL_MS = 2 * 60_000;
const WARMING_RETRY_MS = 15_000;

// A 2–5 km footprint is under a screen pixel from the default view, so each
// detection also gets a dot. Footprints draw up close, dots from mid-range out
// (the bands overlap so there's no zoom at which a detection vanishes).
const FOOTPRINT_MAX_M = 2_000_000;
const DOT_MIN_M = 400_000;

// The picked id: the global click handler reads `gsocPanel` off it exactly
// as it does off an entity (see entityPanelLink).
function pickId(panel: PanelOpenData) {
  return { id: panel.id, gsocPanel: panel };
}

/**
 * Open NGFS panels show the pixel as of the click; bring their contents up
 * to date with each refresh (in place: re-opening would also raise them).
 * A pixel that has left the window keeps its last state.
 */
function refreshOpenPanels(byId: Map<string, PanelOpenData>) {
  usePanelStore.setState((s) => {
    if (!s.panels.some((pp) => pp.kind === 'ngfs' && byId.has(pp.id))) return s;
    return {
      panels: s.panels.map((pp) => {
        const fresh = pp.kind === 'ngfs' ? byId.get(pp.id) : undefined;
        return fresh ? { ...pp, title: fresh.title, subtitle: fresh.subtitle, payload: fresh.payload } : pp;
      }),
    };
  });
}

export function NgfsLayer() {
  const viewer = useCesiumViewer();
  const active = useLayersStore((s) => s.active.ngfs);
  const hours = useLayersStore((s) => s.ngfsHours);
  const showOther = useLayersStore((s) => s.ngfsShowOther);
  const collRef = useRef<Cesium.PrimitiveCollection | null>(null);
  const dotsRef = useRef<Cesium.PointPrimitiveCollection | null>(null);

  // Raw primitives rather than entities: entity visualizers re-sync every
  // clock tick, which for thousands of static footprints is wasted CPU on
  // every frame (same reasoning as FireLayer).
  useEffect(() => {
    if (!viewer) return;
    const coll = viewer.scene.primitives.add(new Cesium.PrimitiveCollection()) as Cesium.PrimitiveCollection;
    const dots = viewer.scene.primitives.add(
      new Cesium.PointPrimitiveCollection()
    ) as Cesium.PointPrimitiveCollection;
    collRef.current = coll;
    dotsRef.current = dots;
    return () => {
      collRef.current = null;
      dotsRef.current = null;
      if (!viewer.isDestroyed()) {
        viewer.scene.primitives.remove(coll); // destroys its children
        viewer.scene.primitives.remove(dots);
      }
    };
  }, [viewer]);

  useEffect(() => {
    const coll = collRef.current;
    const dots = dotsRef.current;
    if (!viewer || !coll || !dots) return;
    const status = useNgfsStatus.getState();

    if (!active) {
      coll.removeAll();
      dots.removeAll();
      status.reset();
      viewer.scene.requestRender();
      return;
    }

    let cancelled = false;
    let seq = 0;
    let ctrl: AbortController | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    // Footprints build asynchronously (off the main thread); the previous
    // set stays on screen until the new one is ready, then they swap. That
    // includes a set left by the previous run of this effect (a window or
    // filter change), which stays up until the new window's data replaces it.
    const shownBefore: Cesium.Primitive[] = [];
    for (let i = 0; i < coll.length; i++) shownBefore.push(coll.get(i) as Cesium.Primitive);
    let shown = shownBefore;
    let incoming: Cesium.Primitive[] = [];
    let stopWatch: (() => void) | null = null;
    status.setStatus({ loading: true, error: null });

    const swapWhenReady = (applyDots: () => void) => {
      stopWatch?.();
      const finish = () => {
        stopWatch?.();
        stopWatch = null;
        for (const p of shown) coll.remove(p);
        shown = incoming;
        incoming = [];
        applyDots();
        viewer.scene.requestRender();
      };
      if (incoming.length === 0) {
        finish();
        return;
      }
      stopWatch = viewer.scene.postRender.addEventListener(() => {
        if (incoming.every((p) => p.ready)) finish();
        // requestRenderMode only renders on demand; keep frames coming until
        // the worker-built geometry is in.
        else requestAnimationFrame(() => !viewer.isDestroyed() && viewer.scene.requestRender());
      });
      viewer.scene.requestRender();
    };

    const draw = (data: NgfsResponse) => {
      const now = Date.now();
      const visible = data.pixels.filter((p) => p.wildland || showOther);
      // Oldest first, so the freshest heat draws on top where footprints overlap.
      visible.sort((a, b) => a.last - b.last);

      const fills: Cesium.GeometryInstance[] = [];
      const outlines: Cesium.GeometryInstance[] = [];
      const dotSpecs: Array<{ p: NgfsPixel; color: Cesium.Color; id: ReturnType<typeof pickId>; near: boolean }> = [];
      const nearOnly = () => new Cesium.DistanceDisplayConditionGeometryInstanceAttribute(0, FOOTPRINT_MAX_M);

      const panels = new Map<string, PanelOpenData>();
      for (const p of data.pixels) panels.set(ngfsPanelId(p), ngfsPanelData(p, panelPayload(p, data)));

      for (const p of visible) {
        const style = pixelStyle(p, now);
        const color = Cesium.Color.fromCssColorString(style.color);
        const id = pickId(panels.get(ngfsPanelId(p))!);
        const ring = pixelFootprint(p.lat, p.lon, SLOT_LON0[p.slot]);
        if (ring) {
          const hierarchy = new Cesium.PolygonHierarchy(Cesium.Cartesian3.fromDegreesArray(ring.flat()));
          fills.push(
            new Cesium.GeometryInstance({
              id,
              geometry: new Cesium.PolygonGeometry({
                polygonHierarchy: hierarchy,
                height: 0, // on the ellipsoid, like the other polygon layers (no terrain)
                vertexFormat: Cesium.PerInstanceColorAppearance.FLAT_VERTEX_FORMAT,
              }),
              attributes: {
                color: Cesium.ColorGeometryInstanceAttribute.fromColor(color.withAlpha(style.fill)),
                // Per-instance show lets drillPick step through overlapping
                // footprints (GOES-East and -West over the same fire) instead
                // of hiding the whole primitive after the first hit.
                show: new Cesium.ShowGeometryInstanceAttribute(true),
                distanceDisplayCondition: nearOnly(),
              },
            })
          );
          outlines.push(
            new Cesium.GeometryInstance({
              geometry: new Cesium.PolygonOutlineGeometry({ polygonHierarchy: hierarchy, height: 0 }),
              attributes: {
                color: Cesium.ColorGeometryInstanceAttribute.fromColor(color.withAlpha(0.9)),
                distanceDisplayCondition: nearOnly(),
              },
            })
          );
        }
        dotSpecs.push({ p, color, id, near: ring != null });
      }

      for (const p of incoming) coll.remove(p); // superseded before it finished building
      incoming = [];
      if (fills.length > 0) {
        incoming.push(
          coll.add(
            new Cesium.Primitive({
              geometryInstances: fills,
              appearance: new Cesium.PerInstanceColorAppearance({ flat: true, translucent: true, closed: false }),
              asynchronous: true,
            })
          ) as Cesium.Primitive,
          coll.add(
            new Cesium.Primitive({
              geometryInstances: outlines,
              appearance: new Cesium.PerInstanceColorAppearance({ flat: true, translucent: true }),
              allowPicking: false,
              asynchronous: true,
            })
          ) as Cesium.Primitive
        );
      }

      swapWhenReady(() => {
        dots.removeAll();
        for (const { p, color, id, near } of dotSpecs) {
          const fresh = p.wildland && now - p.last < 60 * 60_000;
          dots.add({
            position: Cesium.Cartesian3.fromDegrees(p.lon, p.lat),
            color,
            pixelSize: fresh ? 7 : 5,
            outlineColor: Cesium.Color.BLACK.withAlpha(0.6),
            outlineWidth: 1,
            // Without a footprint (off the disk) the dot is all there is.
            distanceDisplayCondition: near ? new Cesium.DistanceDisplayCondition(DOT_MIN_M, Number.MAX_VALUE) : undefined,
            id,
          });
        }
      });

      refreshOpenPanels(panels);

      // The newest scan actually on the map (a newer one may still be
      // downloading, or failing; the notes say so).
      const newest = data.products.map((p) => p.newestLoaded ?? 0).reduce((a, b) => Math.max(a, b), 0);
      useNgfsStatus.getState().setStatus({
        count: visible.length,
        hiddenOther: data.pixels.length - visible.length,
        newestScan: newest || null,
        windowStart: data.windowStart,
        products: data.products,
        loading: false,
        error: null,
      });
    };

    const load = async () => {
      if (cancelled) return;
      if (retry) clearTimeout(retry);
      retry = null;
      const my = ++seq;
      ctrl?.abort();
      ctrl = new AbortController();
      let data: NgfsResponse;
      try {
        data = await fetchNgfs(hours, ctrl.signal);
      } catch (err) {
        if (cancelled || my !== seq) return; // superseded, not a feed error
        console.error('NGFS feed fetch failed', err);
        useNgfsStatus.getState().setStatus({
          loading: false,
          error: `NGFS feed error: ${err instanceof Error ? err.message : 'unreachable'}`,
        });
        return;
      }
      if (cancelled || my !== seq) return;
      if (data.warming) {
        // The server is still on its first upstream fetch: ask again soon
        // rather than at the next 2-minute tick.
        useNgfsStatus.getState().setStatus({ loading: true, error: null, products: data.products });
        retry = setTimeout(() => void load(), WARMING_RETRY_MS);
        return;
      }
      draw(data);
    };

    const stopPolling = startVisiblePolling(() => void load(), POLL_MS);

    return () => {
      cancelled = true;
      ctrl?.abort();
      if (retry) clearTimeout(retry);
      stopPolling();
      stopWatch?.();
      // On unmount the [viewer] effect's cleanup has already destroyed the
      // collection (and everything in it).
      if (!coll.isDestroyed()) {
        for (const p of incoming) coll.remove(p);
      }
    };
  }, [viewer, active, hours, showOther]);

  return null;
}
