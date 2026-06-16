import * as Cesium from 'cesium';
import { useEffect, useRef } from 'react';
import { useCesiumViewer } from '../cesium/CesiumContext';
import { useScreensaverStore, type Poi } from './screensaverStore';

const ROTATE_RAD_PER_SEC = (10 * Math.PI) / (180 * 60); // 10°/min
const OVERVIEW_ALT = 13_500_000; // metres above earth
const POI_INTERVAL_MIN_MS = 18_000;
const POI_INTERVAL_MAX_MS = 30_000;
const POI_DWELL_MIN_MS = 10_000;
const POI_DWELL_MAX_MS = 16_000;

// Geopolitically and operationally interesting fallback locations.
const LANDMARK_POIS: Poi[] = [
  { title: 'Strait of Hormuz', description: '≈20% of global oil transit passes through this 39-km chokepoint.', lat: 26.6, lon: 56.4, altitudeM: 450_000, category: 'landmark' },
  { title: 'English Channel', description: 'The world\'s busiest shipping lane, handling over 500 vessels per day.', lat: 51.0, lon: 1.5, altitudeM: 350_000, category: 'landmark' },
  { title: 'Panama Canal', description: 'Connects Pacific and Atlantic Oceans, saving 8,000 NM per transit.', lat: 9.1, lon: -79.6, altitudeM: 280_000, category: 'landmark' },
  { title: 'Suez Canal', description: 'Handles ≈12% of global trade, cutting the Europe–Asia route by 7,000 km.', lat: 30.5, lon: 32.3, altitudeM: 400_000, category: 'landmark' },
  { title: 'Pentagon, Arlington VA', description: 'Headquarters of the U.S. Department of Defense — 25,000 staff.', lat: 38.87, lon: -77.06, altitudeM: 80_000, category: 'landmark' },
  { title: 'Bosporus Strait', description: 'Only exit from the Black Sea — monitored under the Montreux Convention.', lat: 41.1, lon: 29.0, altitudeM: 250_000, category: 'landmark' },
  { title: 'South China Sea', description: 'Overlapping territorial claims; $3 trillion in annual trade transits.', lat: 12.0, lon: 115.0, altitudeM: 1_800_000, category: 'landmark' },
  { title: 'Gulf of Aden', description: 'Key corridor from Indian Ocean to Suez; high piracy and maritime risk.', lat: 12.5, lon: 47.0, altitudeM: 900_000, category: 'landmark' },
  { title: 'Malacca Strait', description: 'The world\'s most critical chokepoint for Pacific–Indian Ocean trade.', lat: 2.5, lon: 101.5, altitudeM: 550_000, category: 'landmark' },
  { title: 'Diego Garcia', description: 'Critical U.S./UK military installation — Indian Ocean hub for power projection.', lat: -7.3, lon: 72.4, altitudeM: 200_000, category: 'landmark' },
  { title: 'Arctic Circle', description: 'Opening sea routes as ice retreats — new competition for resources.', lat: 73.0, lon: 10.0, altitudeM: 3_500_000, category: 'landmark' },
  { title: 'Cape of Good Hope', description: 'Alternative to Suez for VLCC tankers and bulk carriers.', lat: -34.4, lon: 18.5, altitudeM: 700_000, category: 'landmark' },
  { title: 'Taiwan Strait', description: 'Strategically contested 180-km strait with daily military monitoring.', lat: 24.5, lon: 120.0, altitudeM: 600_000, category: 'landmark' },
  { title: 'Guam', description: 'Westernmost U.S. territory — key forward-deployed base in the Pacific.', lat: 13.4, lon: 144.8, altitudeM: 300_000, category: 'landmark' },
  { title: 'Djibouti', description: 'Hosts military bases from six nations. Gateway to the Red Sea.', lat: 11.6, lon: 43.1, altitudeM: 250_000, category: 'landmark' },
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchDynamicPois(): Promise<Poi[]> {
  const pois: Poi[] = [];

  try {
    const res = await fetch(
      'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/5.0_week.geojson'
    );
    const data = await res.json();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const f of (data.features as any[]).slice(0, 12)) {
      if (!f.geometry) continue;
      pois.push({
        title: `M${Number(f.properties.mag).toFixed(1)} Earthquake`,
        description: f.properties.title ?? f.properties.place ?? '',
        lat: f.geometry.coordinates[1],
        lon: f.geometry.coordinates[0],
        altitudeM: 700_000,
        category: 'earthquake',
      });
    }
  } catch { /* network or parse error — skip */ }

  try {
    const res = await fetch('https://api.weather.gov/alerts/active?status=actual&message_type=alert', {
      headers: { 'User-Agent': 'gsoc-monitor-screensaver' },
    });
    const data = await res.json();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const f of (data.features as any[]).slice(0, 12)) {
      if (!f.geometry) continue;
      const type = f.geometry.type as string;
      const ring: [number, number][] =
        type === 'Polygon'
          ? f.geometry.coordinates[0]
          : type === 'MultiPolygon'
            ? f.geometry.coordinates[0][0]
            : null;
      if (!ring || ring.length === 0) continue;
      const lon = ring.reduce((s, c) => s + c[0], 0) / ring.length;
      const lat = ring.reduce((s, c) => s + c[1], 0) / ring.length;
      pois.push({
        title: f.properties.event ?? 'Weather Alert',
        description: f.properties.headline ?? f.properties.areaDesc ?? '',
        lat,
        lon,
        altitudeM: 350_000,
        category: 'weather',
      });
    }
  } catch { /* skip */ }

  return pois;
}

function rand(min: number, max: number) {
  return min + Math.random() * (max - min);
}

export function ScreensaverController() {
  const viewer = useCesiumViewer();
  const active = useScreensaverStore((s) => s.active);
  const setPhase = useScreensaverStore((s) => s.setPhase);
  const setCurrentPoi = useScreensaverStore((s) => s.setCurrentPoi);

  // Stable refs so closure callbacks see current values without stale captures.
  const cancelledRef = useRef(false);
  const phaseRef = useRef<'rotating' | 'flying-to' | 'at-poi' | 'flying-back'>('rotating');
  const poisRef = useRef<Poi[]>([...LANDMARK_POIS]);
  const poiTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dwellTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function updatePhase(p: typeof phaseRef.current) {
    phaseRef.current = p;
    setPhase(p);
  }

  useEffect(() => {
    if (!active || !viewer) return;
    // Capture as non-nullable so inner closures don't need null checks.
    const v = viewer;

    cancelledRef.current = false;
    poisRef.current = [...LANDMARK_POIS];

    // Fetch dynamic POIs in background; landmark fallbacks are always ready.
    fetchDynamicPois().then((dynamic) => {
      if (!cancelledRef.current) {
        poisRef.current = [...LANDMARK_POIS, ...dynamic];
      }
    });

    // Disable request-render throttling so the rotation is buttery-smooth.
    const prevRequestRender = v.scene.requestRenderMode;
    const prevMaxRenderTime = v.scene.maximumRenderTimeChange;
    v.scene.requestRenderMode = false;

    // Fly from current position to a pleasing global overview.
    const startLon = Cesium.Math.toDegrees(v.camera.positionCartographic.longitude);
    v.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(startLon, 20, OVERVIEW_ALT),
      duration: 2.5,
    });

    // rAF rotation loop — only moves camera while phase is 'rotating'.
    let lastTime = performance.now();
    let animId: number;

    const tick = (now: number) => {
      if (cancelledRef.current) return;
      const dt = Math.min((now - lastTime) / 1000, 0.05);
      lastTime = now;
      if (phaseRef.current === 'rotating') {
        v.camera.rotateRight(ROTATE_RAD_PER_SEC * dt);
      }
      animId = requestAnimationFrame(tick);
    };
    animId = requestAnimationFrame(tick);

    // --- POI state machine ---

    function scheduleNextPoi() {
      if (cancelledRef.current) return;
      poiTimerRef.current = setTimeout(visitPoi, rand(POI_INTERVAL_MIN_MS, POI_INTERVAL_MAX_MS));
    }

    function visitPoi() {
      if (cancelledRef.current) return;
      const pool = poisRef.current;
      if (pool.length === 0) { scheduleNextPoi(); return; }

      const poi = pool[Math.floor(Math.random() * pool.length)];
      updatePhase('flying-to');
      setCurrentPoi(poi);

      v.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(poi.lon, poi.lat, poi.altitudeM),
        duration: 4.5,
        complete: () => {
          if (cancelledRef.current) return;
          updatePhase('at-poi');
          dwellTimerRef.current = setTimeout(leavePoiAndReturn, rand(POI_DWELL_MIN_MS, POI_DWELL_MAX_MS));
        },
      });
    }

    function leavePoiAndReturn() {
      if (cancelledRef.current) return;
      updatePhase('flying-back');
      setCurrentPoi(null);

      // Return to a global view slightly east of wherever we left off.
      const lon = Cesium.Math.toDegrees(v.camera.positionCartographic.longitude);
      v.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(lon + 8, 20, OVERVIEW_ALT),
        duration: 4.0,
        complete: () => {
          if (cancelledRef.current) return;
          updatePhase('rotating');
          scheduleNextPoi();
        },
      });
    }

    // Kick off the cycle 2.5 s after the initial fly-to-overview completes.
    poiTimerRef.current = setTimeout(scheduleNextPoi, 2500);

    return () => {
      cancelledRef.current = true;
      cancelAnimationFrame(animId);
      if (poiTimerRef.current) clearTimeout(poiTimerRef.current);
      if (dwellTimerRef.current) clearTimeout(dwellTimerRef.current);

      v.scene.requestRenderMode = prevRequestRender;
      v.scene.maximumRenderTimeChange = prevMaxRenderTime;
      updatePhase('rotating');
      setCurrentPoi(null);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, viewer]);

  return null;
}
