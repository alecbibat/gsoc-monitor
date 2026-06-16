import * as Cesium from 'cesium';
import { useEffect, useRef } from 'react';
import { useCesiumViewer } from '../../cesium/CesiumContext';
import { useLayersStore } from '../../store/layersStore';
import { attachPanelData } from '../../cesium/entityPanelLink';
import { useAlertsStatus } from './alertsStore';

// Fetched directly from the browser: NWS sends CORS headers, so this avoids the
// server-side User-Agent restrictions that block api.weather.gov from a proxy.
const ALERTS_API = 'https://api.weather.gov/alerts/active?limit=500';

// Static US county polygons keyed by 5-digit FIPS (the dataset the proven
// weather-leaflet app uses). Most non-storm NWS alerts ship geometry: null and
// only reference county SAME codes, which we resolve against these polygons.
const COUNTY_GEOJSON =
  'https://raw.githubusercontent.com/plotly/datasets/master/geojson-counties-fips.json';

interface RawAlert {
  id?: string;
  geometry: GeoJSON.Geometry | null;
  properties: {
    id?: string;
    event?: string;
    headline?: string | null;
    description?: string;
    instruction?: string | null;
    severity?: string;
    certainty?: string;
    urgency?: string;
    senderName?: string;
    effective?: string;
    expires?: string;
    areaDesc?: string;
    geocode?: { SAME?: string[]; UGC?: string[] };
  };
}

const SEVERITY_RANK: Record<string, number> = {
  Extreme: 4,
  Severe: 3,
  Moderate: 2,
  Minor: 1,
  Unknown: 0,
};

function severityColor(severity: string): Cesium.Color {
  switch (severity) {
    case 'Extreme':
      return Cesium.Color.fromCssColorString('#ff3b3b');
    case 'Severe':
      return Cesium.Color.fromCssColorString('#ff8a3d');
    case 'Moderate':
      return Cesium.Color.fromCssColorString('#ffe14d');
    case 'Minor':
      return Cesium.Color.fromCssColorString('#52a9ff');
    default:
      return Cesium.Color.fromCssColorString('#9aa5b1');
  }
}

function extractRings(geometry: GeoJSON.Geometry | null | undefined): number[][][] {
  if (!geometry) return [];
  if (geometry.type === 'Polygon') {
    return [geometry.coordinates[0] as number[][]];
  }
  if (geometry.type === 'MultiPolygon') {
    return geometry.coordinates.map((poly) => poly[0] as number[][]);
  }
  return [];
}

// Load the county polygons once and index them by FIPS id. Memoised across the
// app's lifetime; a failed load is allowed to retry on the next refresh.
let countyPromise: Promise<Map<string, GeoJSON.Geometry>> | null = null;
function loadCounties(): Promise<Map<string, GeoJSON.Geometry>> {
  if (!countyPromise) {
    countyPromise = fetch(COUNTY_GEOJSON)
      .then((r) => {
        if (!r.ok) throw new Error(`county geojson ${r.status}`);
        return r.json() as Promise<GeoJSON.FeatureCollection>;
      })
      .then((data) => {
        const map = new Map<string, GeoJSON.Geometry>();
        for (const f of data.features) {
          if (f.id != null && f.geometry) map.set(String(f.id), f.geometry);
        }
        return map;
      })
      .catch((err) => {
        countyPromise = null;
        throw err;
      });
  }
  return countyPromise;
}

function alertRings(alert: RawAlert, counties: Map<string, GeoJSON.Geometry>): number[][][] {
  // Prefer the alert's own precise polygon (storm-based warnings have one)...
  const own = extractRings(alert.geometry);
  if (own.length) return own;

  // ...otherwise fall back to the counties named by its SAME (county FIPS) codes.
  const rings: number[][][] = [];
  for (const code of alert.properties.geocode?.SAME ?? []) {
    const fips = code.length === 6 ? code.slice(1) : code; // SAME -> 5-digit FIPS
    const geom = counties.get(fips);
    if (geom) for (const ring of extractRings(geom)) rings.push(ring);
  }
  return rings;
}

export function AlertsLayer() {
  const viewer = useCesiumViewer();
  const active = useLayersStore((s) => s.active.alerts);
  const dsRef = useRef<Cesium.CustomDataSource | null>(null);
  const lastSigRef = useRef<string>('');

  useEffect(() => {
    if (!viewer) return;
    const ds = new Cesium.CustomDataSource('alerts');
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

    const load = async () => {
      try {
        const [counties, res] = await Promise.all([
          loadCounties(),
          fetch(ALERTS_API).then((r) => {
            if (!r.ok) throw new Error(`NWS ${r.status}`);
            return r.json() as Promise<{ features?: RawAlert[] }>;
          }),
        ]);
        if (cancelled) return;

        const alerts = res.features ?? [];
        const sig = alerts.map((a) => a.properties.id ?? a.id ?? '').join('|');
        if (sig === lastSigRef.current) {
          useAlertsStatus.getState().setStatus({ error: null });
          return;
        }
        lastSigRef.current = sig;

        // Draw higher-severity polygons last so they sit on top.
        const sorted = [...alerts].sort(
          (a, b) =>
            (SEVERITY_RANK[a.properties.severity ?? 'Unknown'] ?? 0) -
            (SEVERITY_RANK[b.properties.severity ?? 'Unknown'] ?? 0)
        );

        ds.entities.removeAll();
        let drawn = 0;
        for (const alert of sorted) {
          const rings = alertRings(alert, counties);
          if (rings.length === 0) continue;
          const p = alert.properties;
          const color = severityColor(p.severity ?? 'Unknown');
          const id = p.id ?? alert.id ?? `${drawn}`;

          rings.forEach((ring, idx) => {
            const positions = Cesium.Cartesian3.fromDegreesArray(ring.flat());
            const entity = ds.entities.add({
              id: `alert-${id}-${idx}`,
              polygon: {
                hierarchy: new Cesium.PolygonHierarchy(positions),
                material: color.withAlpha(0.28),
                outline: true,
                outlineColor: color.withAlpha(0.9),
                outlineWidth: 2,
              },
            });
            attachPanelData(entity, {
              id: `alert-${id}`,
              kind: 'alerts',
              title: p.event ?? 'Alert',
              subtitle: p.areaDesc ?? '',
              payload: {
                event: p.event ?? 'Alert',
                headline: p.headline ?? null,
                description: p.description ?? '',
                instruction: p.instruction ?? null,
                severity: p.severity ?? 'Unknown',
                urgency: p.urgency ?? 'Unknown',
                certainty: p.certainty ?? 'Unknown',
                senderName: p.senderName ?? '',
                effective: p.effective ?? '',
                expires: p.expires ?? '',
                areaDesc: p.areaDesc ?? '',
              },
            });
          });
          drawn++;
        }

        useAlertsStatus.getState().setStatus({ count: drawn, error: null });
        viewer.scene.requestRender();
      } catch (err) {
        if (cancelled) return;
        console.error('Failed to load NWS alerts', err);
        useAlertsStatus.getState().setStatus({ error: 'NWS alert feed unavailable' });
      }
    };

    load();
    const interval = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [viewer, active]);

  return null;
}
