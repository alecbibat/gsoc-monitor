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

// Colour + size ramp on Fire Radiative Power (MW): hotter fires read redder.
function fireColor(frp: number | undefined): Cesium.Color {
  const f = frp ?? 0;
  if (f >= 100) return Cesium.Color.fromCssColorString('#ff2d1a');
  if (f >= 30) return Cesium.Color.fromCssColorString('#ff6a1a');
  if (f >= 8) return Cesium.Color.fromCssColorString('#ff9d2e');
  return Cesium.Color.fromCssColorString('#ffc24d');
}

function fireSize(frp: number | undefined): number {
  const f = frp ?? 0;
  return Math.min(16, 4 + Math.sqrt(f));
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
        const color = fireColor(frp);
        const id = `fire-${drawn}`;
        const entity = ds.entities.add({
          id,
          position: Cesium.Cartesian3.fromDegrees(lon, lat),
          point: {
            pixelSize: fireSize(frp),
            color: color.withAlpha(0.9),
            outlineColor: Cesium.Color.BLACK.withAlpha(0.45),
            outlineWidth: 1,
            // Default depth test so hotspots behind the globe stay hidden.
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
