import * as Cesium from 'cesium';
import { useEffect, useRef } from 'react';
import { useCesiumViewer } from '../../cesium/CesiumContext';
import { useLayersStore } from '../../store/layersStore';
import { attachPanelData } from '../../cesium/entityPanelLink';
import { useFiresStatus } from './firesStore';
import { MILES_TO_M } from '../../lib/geo';
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
  const dsRef = useRef<Cesium.CustomDataSource | null>(null);

  useEffect(() => {
    if (!viewer) return;
    const ds = new Cesium.CustomDataSource('fires');
    dsRef.current = ds;
    viewer.dataSources.add(ds);
    return () => {
      viewer.dataSources.remove(ds, true);
      dsRef.current = null;
    };
  }, [viewer]);

  useEffect(() => {
    const ds = dsRef.current;
    if (!viewer || !ds) return;

    if (!active) {
      ds.entities.removeAll();
      viewer.scene.requestRender();
      return;
    }

    let cancelled = false;

    const load = async () => {
      let hotspots: FireHotspot[] | null;
      let error: string | null = null;

      if (nearMiles > 0) {
        // Query a fixed box around each pin group (independent of the camera),
        // then keep only hotspots within the selected radius of a pin.
        const res = await fetchHotspotsNearPins(nearMiles * MILES_TO_M);
        if (cancelled) return;
        hotspots = res.hotspots;
        error = res.error;
      } else {
        const layerId = await getFireLayerId();
        if (cancelled) return;
        const rect = viewer.camera.computeViewRectangle();
        const xmin = rect ? Cesium.Math.toDegrees(rect.west) : -180;
        const xmax = rect ? Cesium.Math.toDegrees(rect.east) : 180;
        const ymin = rect ? Cesium.Math.toDegrees(rect.south) : -90;
        const ymax = rect ? Cesium.Math.toDegrees(rect.north) : 90;
        const res = await fetchEnvelope(layerId, `${xmin},${ymin},${xmax},${ymax}`);
        if (cancelled) return;
        hotspots = res.features
          ? res.features.map(parseHotspot).filter((h): h is FireHotspot => h !== null)
          : null;
        error = res.error;
      }

      if (cancelled) return;
      if (hotspots == null) {
        console.error('FIRMS fire feed fetch failed', error);
        useFiresStatus
          .getState()
          .setStatus({ error: `FIRMS feed error: ${error ?? 'unreachable'}` });
        return;
      }

      ds.entities.removeAll();
      let drawn = 0;
      for (const h of hotspots) {
        const frp = h.frp ?? undefined;
        const id = `fire-${drawn}`;
        const sz = fireIconSize(frp);
        const entity = ds.entities.add({
          id,
          position: Cesium.Cartesian3.fromDegrees(h.lon, h.lat),
          billboard: {
            image: fireIcon(frp),
            width: sz,
            height: Math.round(sz * 1.25), // flame is taller than wide
            verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
            // Default depth test so hotspots on the far side of the globe stay hidden.
          },
        });
        attachPanelData(entity, {
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

    load();
    const debouncedLoad = debounce(load, 800);
    // In near-pins mode the regions are fixed, so we don't refetch on pan/zoom.
    if (nearMiles === 0) viewer.camera.moveEnd.addEventListener(debouncedLoad);
    const interval = setInterval(load, 5 * 60_000);

    return () => {
      cancelled = true;
      clearInterval(interval);
      if (nearMiles === 0) viewer.camera.moveEnd.removeEventListener(debouncedLoad);
    };
  }, [viewer, active, nearMiles]);

  return null;
}
