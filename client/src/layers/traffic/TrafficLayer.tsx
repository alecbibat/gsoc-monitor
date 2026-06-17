import * as Cesium from 'cesium';
import { useEffect, useRef } from 'react';
import { useCesiumViewer } from '../../cesium/CesiumContext';
import { useLayersStore } from '../../store/layersStore';
import { useTrafficStatus } from './trafficStore';
import { TrafficRainMaterialProperty } from './trafficRainMaterial';
import { PulseLineMaterialProperty } from '../locations/pulseLineMaterial';

// Set VITE_TOMTOM_KEY as a Heroku Config Var before building.
// Free tier: https://developer.tomtom.com (sign up, create an app, copy the key).
const TOMTOM_KEY =
  (import.meta as unknown as { env: Record<string, string> }).env.VITE_TOMTOM_KEY ?? '';

// How high the falling "digital rain" columns rise above each incident.
const RAIN_HEIGHT_M = 5_200;
// Bottom of each rain strand — starts above the ellipsoid so it looks above ground
// for most locations even without terrain-height sampling.
const RAIN_BASE_M = 200;
// Parallel rain strands per incident, staggered so drops don't sync up.
const STRAND_OFFSETS: [number, number, number][] = [
  // [dLon, dLat, phaseOffset]  — offsets in degrees (~200–300 m spread)
  [0, 0, 0],
  [0.0025, 0.001, 1 / 3],
  [-0.0015, 0.002, 2 / 3],
];
const MAX_INCIDENTS = 100;
const REFRESH_MS = 5 * 60_000;
// Continental US bounding box for the incident query.
const US_BBOX = '-126,24,-66,50';

interface IncidentGeom {
  type: string;
  coordinates: number[] | number[][];
}

interface Incident {
  type: string;
  geometry: IncidentGeom;
  properties: {
    iconCategory?: number;
    magnitudeOfDelay?: number;
    from?: string;
    to?: string;
    roadNumbers?: string[];
  };
}

// Returns a Cesium Color for the given TomTom magnitudeOfDelay (0-4).
function severityColor(mag: number): Cesium.Color {
  if (mag >= 4) return new Cesium.Color(0.95, 0.22, 0.22, 0.93); // red   — blocking
  if (mag >= 3) return new Cesium.Color(0.98, 0.56, 0.12, 0.90); // orange — major
  return new Cesium.Color(0.95, 0.80, 0.06, 0.85);               // amber  — moderate
}

// Drop speed scales with severity so heavier congestion looks more urgent.
function rainSpeed(mag: number): number {
  if (mag >= 4) return 8.0;
  if (mag >= 3) return 5.5;
  return 3.0;
}

// Returns the visual centre point [lon, lat] for an incident's geometry.
function incidentCenter(g: IncidentGeom): [number, number] | null {
  if (g.type === 'Point') {
    const c = g.coordinates as number[];
    return c.length >= 2 ? [c[0], c[1]] : null;
  }
  if (g.type === 'LineString') {
    const pts = g.coordinates as number[][];
    const mid = pts[Math.floor(pts.length / 2)];
    return mid?.length >= 2 ? [mid[0], mid[1]] : null;
  }
  return null;
}

export function TrafficLayer() {
  const viewer = useCesiumViewer();
  const active = useLayersStore((s) => s.active.traffic);
  const dsRef = useRef<Cesium.CustomDataSource | null>(null);
  const imgLayerRef = useRef<Cesium.ImageryLayer | null>(null);

  // Data source lifecycle — mirrors viewer lifetime.
  useEffect(() => {
    if (!viewer) return;
    const ds = new Cesium.CustomDataSource('traffic');
    dsRef.current = ds;
    viewer.dataSources.add(ds);
    return () => {
      viewer.dataSources.remove(ds, true);
      dsRef.current = null;
    };
  }, [viewer]);

  // Toggle, fetch, animate.
  useEffect(() => {
    const setStatus = useTrafficStatus.getState().setStatus;
    const ds = dsRef.current;
    if (!viewer || !ds) return;

    if (!active) {
      ds.entities.removeAll();
      if (imgLayerRef.current) {
        viewer.imageryLayers.remove(imgLayerRef.current, true);
        imgLayerRef.current = null;
      }
      setStatus({ loading: false, ready: false, incidentCount: 0, error: null });
      viewer.scene.requestRender();
      return;
    }

    if (!TOMTOM_KEY) {
      setStatus({ noKey: true, loading: false, ready: false });
      return;
    }

    // TomTom real-time traffic flow tile overlay.
    if (!imgLayerRef.current) {
      const provider = new Cesium.UrlTemplateImageryProvider({
        url: `https://api.tomtom.com/traffic/map/4/tile/flow/absolute/{z}/{x}/{y}.png?key=${TOMTOM_KEY}&tileSize=256`,
        minimumLevel: 0,
        maximumLevel: 18,
        credit: new Cesium.Credit('© TomTom', false),
      });
      imgLayerRef.current = viewer.imageryLayers.addImageryProvider(provider);
      imgLayerRef.current.alpha = 0.78;
      imgLayerRef.current.brightness = 1.15;
    }

    setStatus({ loading: true, error: null, noKey: false });

    let mounted = true;
    let timer: ReturnType<typeof setInterval> | null = null;

    async function fetchAndDraw() {
      if (!mounted) return;
      try {
        // v5 incidentDetails requires an explicit `fields` selector. Omit the
        // traffic-model id (`t`) so TomTom uses its latest model automatically.
        const fields =
          '{incidents{type,geometry{type,coordinates},' +
          'properties{iconCategory,magnitudeOfDelay,from,to,roadNumbers}}}';
        const resp = await fetch(
          `https://api.tomtom.com/traffic/services/5/incidentDetails` +
            `?key=${TOMTOM_KEY}&bbox=${US_BBOX}` +
            `&fields=${encodeURIComponent(fields)}` +
            `&language=en-US&timeValidityFilter=present`
        );
        if (!resp.ok) {
          if (resp.status === 403) {
            throw new Error(
              '403 — key rejected. Enable the Traffic APIs for this key and ' +
                'remove any domain/referrer restriction in the TomTom dashboard.'
            );
          }
          throw new Error(`TomTom ${resp.status}`);
        }
        const data: { incidents?: Incident[] } = await resp.json();
        if (!mounted || !dsRef.current) return;

        const incidents = (data.incidents ?? [])
          .filter((i) => (i.properties.magnitudeOfDelay ?? 0) >= 2)
          .sort((a, b) => (b.properties.magnitudeOfDelay ?? 0) - (a.properties.magnitudeOfDelay ?? 0))
          .slice(0, MAX_INCIDENTS);

        dsRef.current.entities.removeAll();

        for (const inc of incidents) {
          const center = incidentCenter(inc.geometry);
          if (!center) continue;
          const [lon, lat] = center;
          const mag = inc.properties.magnitudeOfDelay ?? 2;
          const color = severityColor(mag);
          const speed = rainSpeed(mag);

          // Animated road segment — PulseLine along the incident path.
          if (inc.geometry.type === 'LineString') {
            const pts = inc.geometry.coordinates as number[][];
            const positions = pts
              .filter((p) => p.length >= 2)
              .map(([pLon, pLat]) => Cesium.Cartesian3.fromDegrees(pLon, pLat));
            if (positions.length >= 2) {
              dsRef.current.entities.add({
                polyline: {
                  positions,
                  width: mag >= 3 ? 3.5 : 2.5,
                  material: new PulseLineMaterialProperty(color, mag >= 3 ? 13 : 9, 0.2),
                  clampToGround: true,
                },
              });
            }
          }

          // Falling "digital rain" strands above the incident.
          for (const [dLon, dLat, phase] of STRAND_OFFSETS) {
            dsRef.current.entities.add({
              polyline: {
                positions: [
                  Cesium.Cartesian3.fromDegrees(lon + dLon, lat + dLat, RAIN_BASE_M),
                  Cesium.Cartesian3.fromDegrees(lon + dLon, lat + dLat, RAIN_HEIGHT_M),
                ],
                width: 2,
                material: new TrafficRainMaterialProperty(color, speed, 0.13, phase),
              },
            });
          }

          // Glowing base dot at the incident location.
          dsRef.current.entities.add({
            position: Cesium.Cartesian3.fromDegrees(lon, lat, 0),
            point: {
              pixelSize: mag >= 4 ? 10 : mag >= 3 ? 8 : 6,
              color: color.withAlpha(0.9),
              outlineColor: Cesium.Color.WHITE.withAlpha(0.35),
              outlineWidth: 1.5,
              heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
            },
          });
        }

        if (mounted) {
          setStatus({ loading: false, ready: true, incidentCount: incidents.length, error: null });
          viewer?.scene.requestRender();
        }
      } catch (err) {
        if (!mounted) return;
        const msg = err instanceof Error ? err.message : String(err);
        setStatus({ loading: false, error: `Traffic: ${msg}` });
      }
    }

    fetchAndDraw();
    timer = setInterval(fetchAndDraw, REFRESH_MS);

    return () => {
      mounted = false;
      if (timer) clearInterval(timer);
    };
  }, [viewer, active]);

  return null;
}
