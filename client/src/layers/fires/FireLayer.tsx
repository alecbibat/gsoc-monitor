import * as Cesium from 'cesium';
import { useEffect, useRef } from 'react';
import { useCesiumViewer } from '../../cesium/CesiumContext';
import { useLayersStore } from '../../store/layersStore';
import { useFiresStatus } from './firesStore';
import { MILES_TO_M } from '../../lib/geo';
import { startVisiblePolling } from '../../lib/poll';
import type { PanelOpenData } from '../../panels/panelStore';
import {
  fetchHotspotsNearPins,
  fetchEnvelope,
  getFireLayerId,
  parseHotspot,
  MAX_FIRES,
  type FireHotspot,
} from './firesData';

// Layered flame SVG billboard — 3 color zones (outer body, mid flame, hot
// core) keyed on FRP tier so we generate exactly 4 distinct data URIs.
type FrpTier = 'extreme' | 'high' | 'med' | 'low';

function frpTier(frp: number | undefined): FrpTier {
  const f = frp ?? 0;
  if (f >= 100) return 'extreme';
  if (f >= 30) return 'high';
  if (f >= 8) return 'med';
  return 'low';
}

const FIRE_COLORS: Record<FrpTier, { outer: string; mid: string; size: number }> = {
  extreme: { outer: '#ff2d1a', mid: '#ff9d2e', size: 28 },
  high:    { outer: '#ff6a1a', mid: '#ffb84d', size: 24 },
  med:     { outer: '#ff9d2e', mid: '#ffd84d', size: 20 },
  low:     { outer: '#ffc24d', mid: '#fff08a', size: 17 },
};

function makeFireSvg(tier: FrpTier): string {
  const { outer, mid } = FIRE_COLORS[tier];
  // Three nested flame paths: outer body → mid flame → white-hot core.
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 30">` +
    `<path d="M12 1C8.5 5.5 5 11 5 17C5 22.5 8 28 12 28C16 28 19 22.5 19 17C19 11 15.5 5.5 12 1Z" fill="${outer}"/>` +
    `<path d="M12 9C10 12.5 8 15.5 8 18.5C8 22.5 9.7 26 12 26C14.3 26 16 22.5 16 18.5C16 15.5 14 12.5 12 9Z" fill="${mid}"/>` +
    `<path d="M12 17C10.8 18.8 10.5 20.2 10.5 21.5C10.5 23.5 11.1 24.8 12 24.8C12.9 24.8 13.5 23.5 13.5 21.5C13.5 20.2 13.2 18.8 12 17Z" fill="#fff8b0" opacity="0.95"/>` +
    `</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

const fireIconCache = new Map<FrpTier, string>();
function fireIcon(frp: number | undefined): string {
  const tier = frpTier(frp);
  if (!fireIconCache.has(tier)) fireIconCache.set(tier, makeFireSvg(tier));
  return fireIconCache.get(tier)!;
}

function fireIconSize(frp: number | undefined): number {
  return FIRE_COLORS[frpTier(frp)].size;
}

function debounce<T extends (...args: never[]) => void>(fn: T, ms: number) {
  let handle: ReturnType<typeof setTimeout> | null = null;
  return (...args: Parameters<T>) => {
    if (handle) clearTimeout(handle);
    handle = setTimeout(() => fn(...args), ms);
  };
}

export function FireLayer() {
  const viewer = useCesiumViewer();
  const active = useLayersStore((s) => s.active.fires);
  const nearMiles = useLayersStore((s) => s.firesNearMiles);
  const bbRef = useRef<Cesium.BillboardCollection | null>(null);

  // A raw BillboardCollection rather than entities: entity billboards are
  // re-synced by BillboardVisualizer on every clock tick (every rAF, even when
  // requestRenderMode skips the draw), which for up to MAX_FIRES static
  // hotspots is milliseconds of CPU per frame. A primitive is only touched on a
  // render.
  useEffect(() => {
    if (!viewer) return;
    const bb = viewer.scene.primitives.add(
      new Cesium.BillboardCollection({ scene: viewer.scene })
    ) as Cesium.BillboardCollection;
    bbRef.current = bb;
    return () => {
      bbRef.current = null;
      if (!viewer.isDestroyed()) viewer.scene.primitives.remove(bb); // destroys bb
    };
  }, [viewer]);

  useEffect(() => {
    const bb = bbRef.current;
    if (!viewer || !bb) return;

    if (!active) {
      bb.removeAll();
      viewer.scene.requestRender();
      return;
    }

    let cancelled = false;
    // Loads come from both the poll and camera moves, and a slow query for an
    // older view must not land after (and overwrite) the current view's result:
    // each load supersedes the previous one and aborts its download.
    let seq = 0;
    let ctrl: AbortController | null = null;

    const load = async () => {
      if (cancelled) return; // a debounced call can fire after cleanup
      const my = ++seq;
      ctrl?.abort();
      ctrl = new AbortController();
      const signal = ctrl.signal;
      const stale = () => cancelled || my !== seq;

      let hotspots: FireHotspot[] | null;
      let error: string | null = null;

      if (nearMiles > 0) {
        // Query a fixed box around each pin group (independent of the camera),
        // then keep only hotspots within the selected radius of a pin.
        const res = await fetchHotspotsNearPins(nearMiles * MILES_TO_M);
        if (stale()) return;
        hotspots = res.hotspots;
        error = res.error;
      } else {
        const layerId = await getFireLayerId();
        if (stale()) return;
        const rect = viewer.camera.computeViewRectangle();
        const xmin = rect ? Cesium.Math.toDegrees(rect.west) : -180;
        const xmax = rect ? Cesium.Math.toDegrees(rect.east) : 180;
        const ymin = rect ? Cesium.Math.toDegrees(rect.south) : -90;
        const ymax = rect ? Cesium.Math.toDegrees(rect.north) : 90;
        // Cesium reports a view that crosses the antimeridian as west > east,
        // which an ArcGIS envelope can't express — query each side and merge.
        const crossesIdl = xmin > xmax;
        let features: GeoJSON.Feature[] | null;
        if (crossesIdl) {
          const [a, b] = await Promise.all([
            fetchEnvelope(layerId, `${xmin},${ymin},180,${ymax}`, signal),
            fetchEnvelope(layerId, `-180,${ymin},${xmax},${ymax}`, signal),
          ]);
          if (stale()) return;
          features =
            a.features || b.features ? [...(a.features ?? []), ...(b.features ?? [])] : null;
          error = features ? null : (a.error ?? b.error);
        } else {
          const res = await fetchEnvelope(layerId, `${xmin},${ymin},${xmax},${ymax}`, signal);
          if (stale()) return;
          features = res.features;
          error = res.error;
        }
        if (features) {
          let parsed = features.map(parseHotspot).filter((h): h is FireHotspot => h !== null);
          if (crossesIdl) {
            // Same strongest-first cap a single query would apply (FRP >= 0; null last).
            parsed.sort((p, q) => (q.frp ?? -1) - (p.frp ?? -1));
            parsed = parsed.slice(0, MAX_FIRES);
          }
          hotspots = parsed;
        } else {
          hotspots = null;
        }
      }

      // Before the error branch: an aborted, superseded query isn't a feed error.
      if (stale()) return;
      if (hotspots == null) {
        console.error('FIRMS fire feed fetch failed', error);
        useFiresStatus
          .getState()
          .setStatus({ error: `FIRMS feed error: ${error ?? 'unreachable'}` });
        return;
      }

      bb.removeAll();
      // Identity follows the detection, not its index in this FRP-sorted,
      // viewport-dependent list, so a click after a refresh re-opens the same
      // hotspot's panel and never overwrites a (locked) panel for another one.
      // Kept unique so the click handler's per-panel-id dedupe never merges two.
      const usedIds = new Set<string>();
      let drawn = 0;
      for (const h of hotspots) {
        const frp = h.frp ?? undefined;
        const base = `fire-${h.lat.toFixed(5)},${h.lon.toFixed(5)}-${h.acqDate}-${h.acqTime}-${h.satellite}`;
        let id = base;
        for (let n = 2; usedIds.has(id); n++) id = `${base}#${n}`;
        usedIds.add(id);
        const sz = fireIconSize(frp);
        bb.add({
          position: Cesium.Cartesian3.fromDegrees(h.lon, h.lat),
          image: fireIcon(frp),
          width: sz,
          height: Math.round(sz * 1.25), // flame is taller than wide
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          // Default depth test so hotspots on the far side of the globe stay hidden.
          // The picked `id`: the global click handler reads `gsocPanel` off it
          // exactly as it does off an entity (see entityPanelLink).
          id: {
            id,
            gsocPanel: {
              id,
              kind: 'fires',
              title: 'Active Fire Detection',
              subtitle: `${h.lat.toFixed(2)}, ${h.lon.toFixed(2)}`,
              payload: {
                latitude: h.lat,
                longitude: h.lon,
                frp: h.frp,
                brightness: h.brightness,
                confidence: h.confidence,
                satellite: h.satellite,
                daynight: h.daynight,
                acqDate: h.acqDate,
                acqTime: h.acqTime,
              },
            } satisfies PanelOpenData,
          },
        });
        drawn++;
      }

      useFiresStatus.getState().setStatus({
        count: drawn,
        capped: nearMiles === 0 && drawn >= MAX_FIRES,
        error: null,
      });
      viewer.scene.requestRender();
    };

    const stopPolling = startVisiblePolling(() => void load(), 5 * 60_000);
    const debouncedLoad = debounce(load, 800);
    // In near-pins mode the regions are fixed, so we don't refetch on pan/zoom.
    if (nearMiles === 0) viewer.camera.moveEnd.addEventListener(debouncedLoad);

    return () => {
      cancelled = true;
      ctrl?.abort();
      stopPolling();
      if (nearMiles === 0) viewer.camera.moveEnd.removeEventListener(debouncedLoad);
    };
  }, [viewer, active, nearMiles]);

  return null;
}
