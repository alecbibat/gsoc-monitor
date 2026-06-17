import * as Cesium from 'cesium';
import { useEffect, useRef } from 'react';
import { useCesiumViewer } from '../../cesium/CesiumContext';
import { useLayersStore } from '../../store/layersStore';
import { attachPanelData } from '../../cesium/entityPanelLink';
import { useAlertsStatus } from './alertsStore';
import { useScreensaverStore } from '../../screensaver/screensaverStore';

// Fetched directly from the browser: NWS sends CORS headers, so this avoids the
// server-side User-Agent restrictions that block api.weather.gov from a proxy.
// No query params — exactly like the proven weather-leaflet reference (the
// /alerts/active endpoint can 400 on some param combinations).
const ALERTS_API = 'https://api.weather.gov/alerts/active';

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

const c = (hex: string) => Cesium.Color.fromCssColorString(hex);

// Severity is still used for draw-order (most severe drawn last/on top) and as the
// fallback colour when an event doesn't match a known hazard family.
function severityColor(severity: string): Cesium.Color {
  switch (severity) {
    case 'Extreme':
      return c('#ff3b3b');
    case 'Severe':
      return c('#ff8a3d');
    case 'Moderate':
      return c('#ffe14d');
    case 'Minor':
      return c('#52a9ff');
    default:
      return c('#9aa5b1');
  }
}

// Colour by hazard TYPE (the NWS `event` string), not just severity, so the map
// reads semantically: floods are blue, thunderstorms yellow, fire orange, winter
// icy, and the genuinely life-threatening events (tornado, tsunami, flash flood,
// storm surge, hurricane, extreme wind) get bold, saturated, mutually-distinct
// colours so they jump off the map on any basemap. Checks run most-specific
// first; `severity` shades a few families (Warning vs Watch/Advisory).
function alertColor(event: string, severity: string): Cesium.Color {
  const e = event.toLowerCase();
  const isWarning = e.includes('warning') || e.includes('emergency');
  const isWatch = e.includes('watch');

  // --- Life-threatening: bold, vivid, each a distinct hue ---
  if (e.includes('tornado')) return c('#ff1f4f'); // crimson
  if (e.includes('tsunami')) return c('#b026ff'); // electric purple
  if (e.includes('extreme wind')) return c('#ff3d00'); // orange-red
  if (e.includes('flash flood')) return c('#00c8ff'); // bright cyan
  if (e.includes('storm surge')) return c('#6a5cff'); // violet-blue
  if (e.includes('hurricane') && !e.includes('wind')) return c('#ff2d95'); // hot magenta
  if (e.includes('typhoon') || e.includes('tropical storm')) return c('#ff2d95');

  // --- Flooding family: shades of blue (Warning darkest) ---
  if (e.includes('flood') || e.includes('seiche')) {
    return c(isWarning ? '#1769ff' : isWatch ? '#4d94ff' : '#86b6ff');
  }

  // --- Thunderstorms: yellow ---
  if (e.includes('thunderstorm')) return c(isWarning ? '#ffd60a' : '#ffe98a');

  // --- Fire / red-flag: orange ---
  if (e.includes('fire') || e.includes('red flag') || e.includes('smoke')) return c('#ff8a1e');

  // --- Excessive heat: amber-red ---
  if (e.includes('heat') || (e.includes('hot') && isWarning)) return c('#ff6024');

  // --- Winter / cold: icy lavender (desaturated to stay distinct from flood blue) ---
  if (/winter|snow|\bice\b|icy|blizzard|freez|frost|sleet|wind chill|cold|avalanche/.test(e)) {
    return c(e.includes('blizzard') || e.includes('ice storm') ? '#8fa8e0' : '#b9c4e8');
  }

  // --- Wind (non-tornado): khaki ---
  if (e.includes('wind') || e.includes('gale')) return c('#caa54a');

  // --- Marine / coastal hazards: teal ---
  if (e.includes('marine') || e.includes('small craft') || e.includes('rip current') || e.includes('surf'))
    return c('#23c2b8');

  // --- Air quality / dust / ash / fog: muted brown-grey ---
  if (/air quality|dust|ashfall|\bfog\b/.test(e)) return c('#9a8a7a');

  // --- Anything else: fall back to severity ---
  return severityColor(severity);
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

function alertRings(
  alert: RawAlert,
  counties: Map<string, GeoJSON.Geometry> | null
): number[][][] {
  // Prefer the alert's own precise polygon (storm-based warnings have one)...
  const own = extractRings(alert.geometry);
  if (own.length) return own;

  // ...otherwise fall back to the counties named by its SAME (county FIPS) codes.
  if (!counties) return [];
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
  const screensaverMode = useScreensaverStore((s) => s.mode);
  const screensaverPhase = useScreensaverStore((s) => s.phase);
  const screensaverActive = useScreensaverStore((s) => s.active);
  const dsRef = useRef<Cesium.CustomDataSource | null>(null);
  const lastSigRef = useRef<string>('');

  // Hide alert polygon tints during the PINS screensaver close-up orbit —
  // the coloured fills look wrong at building-level altitude.
  useEffect(() => {
    const ds = dsRef.current;
    if (!ds || !viewer) return;
    const closeUp = screensaverActive && screensaverMode === 'pins' && screensaverPhase === 'at-poi';
    ds.show = !closeUp;
    viewer.scene.requestRender();
  }, [viewer, screensaverActive, screensaverMode, screensaverPhase]);

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
      // Counties are a best-effort enhancement (they fill in non-storm alerts
      // that lack their own polygon). Never let a county-file hiccup take down
      // the whole layer — fall back to drawing only alerts that ship geometry.
      const countiesPromise = loadCounties().catch((err) => {
        console.warn('NWS alerts: county geometry unavailable', err);
        return null;
      });

      let alerts: RawAlert[];
      try {
        const r = await fetch(ALERTS_API);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const json = (await r.json()) as { features?: RawAlert[] };
        alerts = json.features ?? [];
      } catch (err) {
        if (cancelled) return;
        console.error('NWS alerts fetch failed', err);
        const reason = err instanceof Error ? err.message : 'unreachable';
        useAlertsStatus.getState().setStatus({ error: `NWS feed error: ${reason}` });
        return;
      }

      const counties = await countiesPromise;
      if (cancelled) return;

      try {
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
          const color = alertColor(p.event ?? '', p.severity ?? 'Unknown');
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
