import * as Cesium from 'cesium';
import { useEffect, useRef } from 'react';
import { useCesiumViewer } from '../../cesium/CesiumContext';
import { useLayersStore } from '../../store/layersStore';
import { attachPanelData } from '../../cesium/entityPanelLink';
import { useHurricanesStatus } from './hurricanesStore';
import { classifyStorm } from './classify';

// Esri's hosted "Active Hurricanes" feature service mirrors the NOAA/National
// Hurricane Center live advisory GIS feed and, unlike www.nhc.noaa.gov, sends
// CORS headers + returns GeoJSON directly — so (like the NWS alerts layer) we
// fetch it straight from the browser instead of proxying through our server.
const SERVICE =
  'https://services9.arcgis.com/RHVPKKiFTONKtxq3/arcgis/rest/services/Active_Hurricanes_v1/FeatureServer';

// The service exposes one sublayer per artifact. We discover them by name at
// runtime so we're resilient to NHC/Esri re-ordering the indices, but keep the
// documented ordering as a fallback in case the metadata request fails.
const FALLBACK_LAYERS: Array<{ id: number; name: string }> = [
  { id: 0, name: 'Forecast Position' },
  { id: 1, name: 'Forecast Track' },
  { id: 2, name: 'Observed Position' },
  { id: 3, name: 'Observed Track' },
  { id: 4, name: 'Forecast Error Cone' },
  { id: 5, name: 'Watches and Warnings' },
];

interface ServiceLayer {
  id: number;
  name: string;
}

/** First non-empty value among several candidate attribute names. */
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

function lineParts(geom: GeoJSON.Geometry | null | undefined): number[][][] {
  if (!geom) return [];
  if (geom.type === 'LineString') return [geom.coordinates as number[][]];
  if (geom.type === 'MultiLineString') return geom.coordinates as number[][][];
  return [];
}

function ringParts(geom: GeoJSON.Geometry | null | undefined): number[][][] {
  if (!geom) return [];
  if (geom.type === 'Polygon') return [geom.coordinates[0] as number[][]];
  if (geom.type === 'MultiPolygon')
    return geom.coordinates.map((poly) => poly[0] as number[][]);
  return [];
}

function pointCoord(geom: GeoJSON.Geometry | null | undefined): [number, number] | null {
  if (geom?.type === 'Point') return geom.coordinates as [number, number];
  return null;
}

function stormKey(props: Record<string, unknown> | undefined): string {
  return (
    pick<string>(props, ['STORMID', 'stormId', 'STORMNAME', 'stormName', 'NAME']) ?? 'storm'
  );
}

interface StormAgg {
  id: string;
  name?: string;
  type?: string;
  windKt?: number;
  gustKt?: number;
  pressureMb?: number;
  lat?: number;
  lon?: number;
  basin?: string;
  advDate?: string;
  obsRank: number; // highest OBJECTID seen for the latest observed fix
  fcstTau: number; // lowest forecast hour seen (used only when no observed fix)
}

// NHC tropical-cyclone glyph (two opposing arms around an eye), tinted by the
// Saffir–Simpson colour so category reads at a glance against any basemap.
function hurricaneIcon(color: string): string {
  const arms =
    '<path d="M32 11 C17 11 17 31 32 31 C41 31 41 22 33 22"/>' +
    '<path d="M32 53 C47 53 47 33 32 33 C23 33 23 42 31 42"/>';
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">` +
    `<g fill="none" stroke-linecap="round">` +
    `<g stroke="#04161c" stroke-width="9">${arms}</g>` +
    `<g stroke="${color}" stroke-width="5.5">${arms}</g>` +
    `</g>` +
    `<circle cx="32" cy="32" r="5" fill="#04161c"/>` +
    `<circle cx="32" cy="32" r="3" fill="${color}"/>` +
    `</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

export function HurricaneLayer() {
  const viewer = useCesiumViewer();
  const active = useLayersStore((s) => s.active.hurricanes);
  const dsRef = useRef<Cesium.CustomDataSource | null>(null);
  const lastSigRef = useRef<string>('');

  useEffect(() => {
    if (!viewer) return;
    const ds = new Cesium.CustomDataSource('hurricanes');
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
      lastSigRef.current = '';
      viewer.scene.requestRender();
      return;
    }

    let cancelled = false;

    // Resolve a sublayer id by matching keywords against its display name.
    const findId = (layers: ServiceLayer[], ...needles: string[]): number | undefined =>
      layers.find((l) => {
        const n = l.name.toLowerCase();
        return needles.every((needle) => n.includes(needle));
      })?.id;

    const queryLayer = async (id: number | undefined): Promise<GeoJSON.Feature[]> => {
      if (id == null) return [];
      try {
        const url =
          `${SERVICE}/${id}/query?where=1%3D1&outFields=*&outSR=4326&returnGeometry=true&f=geojson`;
        const r = await fetch(url);
        if (!r.ok) return [];
        const j = (await r.json()) as { features?: GeoJSON.Feature[] };
        return j.features ?? [];
      } catch {
        return [];
      }
    };

    const load = async () => {
      let layers: ServiceLayer[];
      try {
        const r = await fetch(`${SERVICE}?f=json`);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const meta = (await r.json()) as { layers?: ServiceLayer[] };
        layers = meta.layers?.length ? meta.layers : FALLBACK_LAYERS;
      } catch (err) {
        // Metadata is non-fatal: fall back to documented indices and keep going.
        console.warn('NHC service metadata unavailable, using fallback layers', err);
        layers = FALLBACK_LAYERS;
      }
      if (cancelled) return;

      const coneId = findId(layers, 'cone');
      const obsTrackId = findId(layers, 'observed', 'track');
      const fcstTrackId = findId(layers, 'forecast', 'track');
      const obsPtId = findId(layers, 'observed', 'position');
      const fcstPtId = findId(layers, 'forecast', 'position');

      let cones: GeoJSON.Feature[];
      let obsTracks: GeoJSON.Feature[];
      let fcstTracks: GeoJSON.Feature[];
      let obsPts: GeoJSON.Feature[];
      let fcstPts: GeoJSON.Feature[];
      try {
        [cones, obsTracks, fcstTracks, obsPts, fcstPts] = await Promise.all([
          queryLayer(coneId),
          queryLayer(obsTrackId),
          queryLayer(fcstTrackId),
          queryLayer(obsPtId),
          queryLayer(fcstPtId),
        ]);
      } catch (err) {
        if (cancelled) return;
        console.error('NHC hurricane feed fetch failed', err);
        const reason = err instanceof Error ? err.message : 'unreachable';
        useHurricanesStatus.getState().setStatus({ error: `NHC feed error: ${reason}` });
        return;
      }
      if (cancelled) return;

      // Aggregate per-storm summary info that drives the clickable marker.
      const storms = new Map<string, StormAgg>();
      const ensure = (id: string): StormAgg => {
        let s = storms.get(id);
        if (!s) {
          s = { id, obsRank: -Infinity, fcstTau: Infinity };
          storms.set(id, s);
        }
        return s;
      };

      // Latest observed fix = current position + current intensity/pressure.
      for (const f of obsPts) {
        const p = f.properties ?? undefined;
        const coord = pointCoord(f.geometry);
        if (!coord) continue;
        const rank = asNumber(pick(p, ['OBJECTID', 'FID', 'objectId'])) ?? 0;
        const s = ensure(stormKey(p));
        if (rank >= s.obsRank) {
          s.obsRank = rank;
          s.lon = coord[0];
          s.lat = coord[1];
          s.name = pick<string>(p, ['STORMNAME', 'stormName', 'NAME']) ?? s.name;
          s.type = pick<string>(p, ['STORMTYPE', 'stormType', 'TYPE']) ?? s.type;
          s.windKt = asNumber(pick(p, ['INTENSITY', 'MAXWIND', 'intensity'])) ?? s.windKt;
          s.gustKt = asNumber(pick(p, ['GUST', 'gust'])) ?? s.gustKt;
          s.pressureMb = asNumber(pick(p, ['MSLP', 'mslp', 'pressure'])) ?? s.pressureMb;
          s.basin = pick<string>(p, ['BASIN', 'basin']) ?? s.basin;
        }
      }

      // Forecast points fill in storms that have no observed fix yet and give
      // us the gust/name when the observed layer is sparse.
      for (const f of fcstPts) {
        const p = f.properties ?? undefined;
        const coord = pointCoord(f.geometry);
        const s = ensure(stormKey(p));
        s.name = s.name ?? pick<string>(p, ['STORMNAME', 'stormName', 'NAME']);
        s.type = s.type ?? pick<string>(p, ['STORMTYPE', 'stormType', 'TYPE']);
        const tau = asNumber(pick(p, ['TAU', 'FCSTHR', 'FLHR'])) ?? Infinity;
        if (coord && s.obsRank === -Infinity && tau < s.fcstTau) {
          s.fcstTau = tau;
          s.lon = coord[0];
          s.lat = coord[1];
          s.windKt = asNumber(pick(p, ['MAXWIND', 'INTENSITY'])) ?? s.windKt;
          s.gustKt = asNumber(pick(p, ['GUST', 'gust'])) ?? s.gustKt;
        }
      }

      // Advisory date comes off the cone (one per storm).
      for (const f of cones) {
        const p = f.properties ?? undefined;
        const s = ensure(stormKey(p));
        s.advDate = pick<string>(p, ['ADVDATE', 'advDate', 'ADVISDATE']) ?? s.advDate;
      }

      const named = [...storms.values()].filter((s) => s.lat != null && s.lon != null);

      // Skip the teardown/redraw when nothing meaningful changed.
      const sig = named
        .map((s) => `${s.id}:${s.advDate ?? ''}:${s.windKt ?? ''}:${s.lat}:${s.lon}`)
        .sort()
        .join('|');
      if (sig === lastSigRef.current) {
        useHurricanesStatus.getState().setStatus({ count: named.length, error: null });
        return;
      }
      lastSigRef.current = sig;

      ds.entities.removeAll();

      // 1) Cone of uncertainty (drawn first so everything else sits on top).
      for (const f of cones) {
        for (const ring of ringParts(f.geometry)) {
          const positions = Cesium.Cartesian3.fromDegreesArray(ring.flat());
          ds.entities.add({
            polygon: {
              hierarchy: new Cesium.PolygonHierarchy(positions),
              material: Cesium.Color.WHITE.withAlpha(0.1),
              outline: true,
              outlineColor: Cesium.Color.WHITE.withAlpha(0.45),
            },
          });
        }
      }

      // 2) Observed (past) track — solid, cool grey.
      for (const f of obsTracks) {
        for (const part of lineParts(f.geometry)) {
          if (part.length < 2) continue;
          ds.entities.add({
            polyline: {
              positions: Cesium.Cartesian3.fromDegreesArray(part.flat()),
              width: 2,
              material: Cesium.Color.fromCssColorString('#aab9c9').withAlpha(0.7),
            },
          });
        }
      }

      // 3) Forecast track — dashed, amber.
      for (const f of fcstTracks) {
        for (const part of lineParts(f.geometry)) {
          if (part.length < 2) continue;
          ds.entities.add({
            polyline: {
              positions: Cesium.Cartesian3.fromDegreesArray(part.flat()),
              width: 2.5,
              material: new Cesium.PolylineDashMaterialProperty({
                color: Cesium.Color.fromCssColorString('#ffcf4d'),
                dashLength: 14,
              }),
            },
          });
        }
      }

      // 4) Forecast position dots along the track.
      for (const f of fcstPts) {
        const coord = pointCoord(f.geometry);
        if (!coord) continue;
        ds.entities.add({
          position: Cesium.Cartesian3.fromDegrees(coord[0], coord[1]),
          point: {
            pixelSize: 5,
            color: Cesium.Color.fromCssColorString('#ffe9a6').withAlpha(0.9),
            outlineColor: Cesium.Color.BLACK.withAlpha(0.6),
            outlineWidth: 1,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        });
      }

      // 5) The storm itself — category-tinted glyph + label, clickable for a panel.
      for (const s of named) {
        const info = classifyStorm(s.type, s.windKt);
        const id = `hurricane-${s.id}`;
        const entity = ds.entities.add({
          id,
          position: Cesium.Cartesian3.fromDegrees(s.lon!, s.lat!),
          billboard: {
            image: hurricaneIcon(info.color),
            width: 42,
            height: 42,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
          label: {
            text: s.name ?? s.id,
            font: '600 13px Inter, system-ui, sans-serif',
            fillColor: Cesium.Color.fromCssColorString(info.color),
            outlineColor: Cesium.Color.BLACK.withAlpha(0.85),
            outlineWidth: 3,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
            pixelOffset: new Cesium.Cartesian2(0, -26),
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        });
        attachPanelData(entity, {
          id,
          kind: 'hurricanes',
          title: s.name ?? 'Tropical Cyclone',
          subtitle: info.label,
          payload: {
            name: s.name ?? 'Unknown',
            classification: info.label,
            category: info.category,
            color: info.color,
            windKt: s.windKt ?? null,
            gustKt: s.gustKt ?? null,
            pressureMb: s.pressureMb ?? null,
            latitude: s.lat!,
            longitude: s.lon!,
            basin: s.basin ?? null,
            advDate: s.advDate ?? null,
          },
        });
      }

      useHurricanesStatus.getState().setStatus({ count: named.length, error: null });
      viewer.scene.requestRender();
    };

    load();
    // Advisories refresh on a 3–6h cadence; 5 min keeps us current cheaply.
    const interval = setInterval(load, 5 * 60_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [viewer, active]);

  return null;
}
