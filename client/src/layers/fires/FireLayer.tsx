import * as Cesium from 'cesium';
import { useEffect, useRef } from 'react';
import { useCesiumViewer } from '../../cesium/CesiumContext';
import { useLayersStore } from '../../store/layersStore';
import { attachPanelData } from '../../cesium/entityPanelLink';
import { useFiresStatus } from './firesStore';

// NASA FIRMS VIIRS active-fire detections, served (no API key) through Esri's
// CORS-enabled Living Atlas feature service and queried by viewport so the
// global feed stays manageable. Same browser-side approach as the other GIS
// layers (hurricanes / alerts).
const SERVICE =
  'https://services9.arcgis.com/RHVPKKiFTONKtxq3/arcgis/rest/services/Satellite_VIIRS_Thermal_Hotspots_and_Fire_Activity/FeatureServer';

const MAX_FIRES = 2500; // strongest-by-FRP hotspots we draw at once
const FALLBACK_LAYER_ID = 0; // "past 24 hrs" sublayer if name discovery fails

interface ServiceLayer {
  id: number;
  name: string;
}

function pick<T = unknown>(
  props: Record<string, unknown> | undefined,
  keys: string[]
): T | undefined {
  if (!props) return undefined;
  for (const k of keys) {
    const v = props[k];
    if (v != null && v !== '') return v as T;
  }
  return undefined;
}

function asNumber(v: unknown): number | undefined {
  if (v == null || v === '') return undefined;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : undefined;
}

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

function confidenceLabel(raw: unknown): string {
  if (raw == null || raw === '') return 'Unknown';
  const s = String(raw).toLowerCase();
  if (s === 'h' || s === 'high') return 'High';
  if (s === 'n' || s === 'nominal') return 'Nominal';
  if (s === 'l' || s === 'low') return 'Low';
  const n = Number(raw);
  if (Number.isFinite(n)) return `${n}%`;
  return String(raw);
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
  const dsRef = useRef<Cesium.CustomDataSource | null>(null);
  const layerIdRef = useRef<number | null>(null);

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

    // Discover the "past 24 hrs" sublayer once, by name, with an index fallback.
    const resolveLayerId = async (): Promise<number> => {
      if (layerIdRef.current != null) return layerIdRef.current;
      try {
        const r = await fetch(`${SERVICE}?f=json`);
        if (r.ok) {
          const meta = (await r.json()) as { layers?: ServiceLayer[] };
          const found = meta.layers?.find((l) => {
            const n = l.name.toLowerCase();
            return n.includes('24') || n.includes('last');
          });
          layerIdRef.current = found?.id ?? meta.layers?.[0]?.id ?? FALLBACK_LAYER_ID;
        } else {
          layerIdRef.current = FALLBACK_LAYER_ID;
        }
      } catch {
        layerIdRef.current = FALLBACK_LAYER_ID;
      }
      return layerIdRef.current;
    };

    const load = async () => {
      const layerId = await resolveLayerId();
      if (cancelled) return;

      const rect = viewer.camera.computeViewRectangle();
      const xmin = rect ? Cesium.Math.toDegrees(rect.west) : -180;
      const xmax = rect ? Cesium.Math.toDegrees(rect.east) : 180;
      const ymin = rect ? Cesium.Math.toDegrees(rect.south) : -90;
      const ymax = rect ? Cesium.Math.toDegrees(rect.north) : 90;
      const envelope = `${xmin},${ymin},${xmax},${ymax}`;

      const base =
        `${SERVICE}/${layerId}/query?where=1%3D1` +
        `&geometry=${encodeURIComponent(envelope)}&geometryType=esriGeometryEnvelope` +
        `&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=*&outSR=4326` +
        `&resultRecordCount=${MAX_FIRES}&f=geojson`;

      // Prefer the strongest fires first (matters only when we hit the cap at
      // global zoom), but don't let a schema surprise on that field break the
      // whole layer — fall back to an unordered query.
      const candidates = [`${base}&orderByFields=frp%20DESC`, base];

      let features: GeoJSON.Feature[] | null = null;
      let lastErr: unknown = null;
      for (const url of candidates) {
        try {
          const r = await fetch(url);
          if (!r.ok) {
            lastErr = new Error(`HTTP ${r.status}`);
            continue;
          }
          const j = (await r.json()) as { features?: GeoJSON.Feature[] };
          features = j.features ?? [];
          break;
        } catch (err) {
          lastErr = err;
        }
      }
      if (cancelled) return;
      if (features == null) {
        console.error('FIRMS fire feed fetch failed', lastErr);
        const reason = lastErr instanceof Error ? lastErr.message : 'unreachable';
        useFiresStatus.getState().setStatus({ error: `FIRMS feed error: ${reason}` });
        return;
      }

      ds.entities.removeAll();
      let drawn = 0;
      for (const f of features) {
        if (f.geometry?.type !== 'Point') continue;
        const [lon, lat] = f.geometry.coordinates as [number, number];
        const p = (f.properties ?? undefined) as Record<string, unknown> | undefined;
        const frp = asNumber(pick(p, ['frp', 'FRP']));
        const id = `fire-${drawn}`;
        const sz = fireIconSize(frp);
        const entity = ds.entities.add({
          id,
          position: Cesium.Cartesian3.fromDegrees(lon, lat),
          billboard: {
            image: fireIcon(frp),
            width: sz,
            height: Math.round(sz * 1.25), // flame is taller than wide
            verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        });
        attachPanelData(entity, {
          id,
          kind: 'fires',
          title: 'Active Fire Detection',
          subtitle: `${lat.toFixed(2)}, ${lon.toFixed(2)}`,
          payload: {
            latitude: lat,
            longitude: lon,
            frp: frp ?? null,
            brightness: asNumber(pick(p, ['bright_ti4', 'BRIGHT_TI4', 'brightness'])) ?? null,
            confidence: confidenceLabel(pick(p, ['confidence', 'CONFIDENCE'])),
            satellite: (pick<string>(p, ['satellite', 'SATELLITE']) ?? '—') as string,
            daynight: (pick<string>(p, ['daynight', 'DAYNIGHT']) ?? '') as string,
            acqDate: (pick<string>(p, ['acq_date', 'ACQ_DATE']) ?? '') as string,
            acqTime: (pick<string>(p, ['acq_time', 'ACQ_TIME']) ?? '') as string,
          },
        });
        drawn++;
      }

      useFiresStatus.getState().setStatus({
        count: drawn,
        capped: drawn >= MAX_FIRES,
        error: null,
      });
      viewer.scene.requestRender();
    };

    load();
    const debouncedLoad = debounce(load, 800);
    viewer.camera.moveEnd.addEventListener(debouncedLoad);
    const interval = setInterval(load, 5 * 60_000);

    return () => {
      cancelled = true;
      clearInterval(interval);
      viewer.camera.moveEnd.removeEventListener(debouncedLoad);
    };
  }, [viewer, active]);

  return null;
}
