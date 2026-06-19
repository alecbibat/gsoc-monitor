import * as Cesium from 'cesium';
import { useEffect, useRef } from 'react';
import { useCesiumViewer } from '../cesium/CesiumContext';
import { useScreensaverStore, type Poi } from './screensaverStore';
import { LOCATION_GROUPS } from '../layers/locations/locations';

// ─────────────────────────────────────────────────────────────────────────────
// REBUILD — Stage 2: descend the orbit toward the buildings.
//
// Established so far: static dwell at 12 km is stable (Stage 0), and orbiting at
// 12 km is also stable (Stage 1) — so camera motion alone is fine. The original
// crash was orbiting at ~1.6 km, where the moving camera continuously streams
// dense OSM building tiles. The safe floor is therefore between 1.6 km and 12 km.
//
// Stage 2 steps the orbit down to a 4 km range (camera ≈ 2.8 km up at -45°) —
// conservatively, so a crash doesn't cost a full soak. Buildings start to read
// here. If stable, the next stage steps lower (≈2.5 km); if it crashes, the
// floor is just above 4 km and we either hold here or slow/throttle the orbit so
// the tile churn stays low enough to survive lower altitudes.
// ─────────────────────────────────────────────────────────────────────────────

const OVERVIEW_ALT = 9_000_000;
const OVERVIEW_LAT = 38;
const OVERVIEW_LON = -96;

const POI_INTERVAL_MIN_MS = 12_000;
const POI_INTERVAL_MAX_MS = 20_000;
const POI_DWELL_MIN_MS = 12_000;
const POI_DWELL_MAX_MS = 18_000;

// Orbit range (camera-to-target distance). Stage 2 steps this down from 12 km
// toward the buildings; this is the one variable changing this stage.
const ORBIT_RANGE_M = 4_000;
// Slow orbit during dwell. Matches the original 32 s period.
const ORBIT_PERIOD_MS = 32_000;
// Steeper tilt keeps the camera looking down at the pin rather than off toward
// the horizon, so fewer distant tiles stream as it orbits.
const ORBIT_PITCH_RAD = Cesium.Math.toRadians(-45);
const METERS_PER_DEG_LAT = 110_574;

interface PinEntry {
  name: string;
  groupName: string;
  groupIcon: string;
  color: string;
  lat: number;
  lon: number;
}

const ALL_PINS: PinEntry[] = LOCATION_GROUPS.flatMap((g) =>
  g.locations.map((loc) => ({
    name: loc.name,
    groupName: g.name,
    groupIcon: g.icon,
    color: g.color,
    lat: loc.lat,
    lon: loc.lon,
  }))
);

function rand(min: number, max: number) {
  return min + Math.random() * (max - min);
}

function shuffledPins(): PinEntry[] {
  const a = [...ALL_PINS];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function PinsController() {
  const viewer = useCesiumViewer();
  const active = useScreensaverStore((s) => s.active);
  const mode = useScreensaverStore((s) => s.mode);
  const setPhase = useScreensaverStore((s) => s.setPhase);
  const setCurrentPoi = useScreensaverStore((s) => s.setCurrentPoi);

  const cancelledRef = useRef(false);
  const queueRef = useRef<PinEntry[]>([]);
  const poiTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dwellTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rafRef = useRef(0);

  const isPins = active && mode === 'pins';

  useEffect(() => {
    if (!isPins || !viewer) return;
    const v = viewer;

    cancelledRef.current = false;
    queueRef.current = shuffledPins();

    // Mirror parks exactly: continuous render so the fly-tos are smooth. The
    // dwell is static, so continuous rendering of an unchanging scene is cheap.
    const prevRequestRender = v.scene.requestRenderMode;
    const prevMaxRenderTime = v.scene.maximumRenderTimeChange;
    v.scene.requestRenderMode = false;

    v.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(OVERVIEW_LON, OVERVIEW_LAT, OVERVIEW_ALT),
      duration: 2.5,
    });

    function scheduleNext() {
      if (cancelledRef.current) return;
      poiTimerRef.current = setTimeout(visitNext, rand(POI_INTERVAL_MIN_MS, POI_INTERVAL_MAX_MS));
    }

    function visitNext() {
      if (cancelledRef.current) return;
      if (queueRef.current.length === 0) queueRef.current = shuffledPins();
      const pin = queueRef.current.shift()!;

      const poi: Poi = {
        title: pin.name,
        description: `${pin.groupIcon} ${pin.groupName}`,
        lat: pin.lat,
        lon: pin.lon,
        altitudeM: ORBIT_RANGE_M,
        category: 'pin',
        meta: { color: pin.color },
      };

      setPhase('flying-to');
      setCurrentPoi(poi);

      const target = Cesium.Cartesian3.fromDegrees(pin.lon, pin.lat, 0);
      // Fly straight to the heading=0 orbit-start position (south of and above
      // the pin) so the orbit begins seamlessly with no camera snap.
      const back = ORBIT_RANGE_M * Math.cos(-ORBIT_PITCH_RAD);
      const up = ORBIT_RANGE_M * Math.sin(-ORBIT_PITCH_RAD);
      const startLat = pin.lat - back / METERS_PER_DEG_LAT;

      v.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(pin.lon, startLat, up),
        orientation: { heading: 0, pitch: ORBIT_PITCH_RAD, roll: 0 },
        duration: 5.0,
        complete: () => {
          if (cancelledRef.current) return;
          setPhase('at-poi');

          // Stage 2: orbit the pin during dwell at ORBIT_RANGE_M.
          const orbitStart = performance.now();
          const tick = () => {
            if (cancelledRef.current) return;
            const heading =
              (((performance.now() - orbitStart) % ORBIT_PERIOD_MS) * Cesium.Math.TWO_PI) /
              ORBIT_PERIOD_MS;
            v.camera.lookAt(target, new Cesium.HeadingPitchRange(heading, ORBIT_PITCH_RAD, ORBIT_RANGE_M));
            rafRef.current = requestAnimationFrame(tick);
          };
          rafRef.current = requestAnimationFrame(tick);

          dwellTimerRef.current = setTimeout(() => {
            cancelAnimationFrame(rafRef.current);
            v.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
            leaveAndReturn();
          }, rand(POI_DWELL_MIN_MS, POI_DWELL_MAX_MS));
        },
      });
    }

    function leaveAndReturn() {
      if (cancelledRef.current) return;
      setPhase('flying-back');
      setCurrentPoi(null);
      v.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(OVERVIEW_LON, OVERVIEW_LAT, OVERVIEW_ALT),
        duration: 4.5,
        complete: () => {
          if (cancelledRef.current) return;
          setPhase('rotating');
          scheduleNext();
        },
      });
    }

    poiTimerRef.current = setTimeout(scheduleNext, 2800);

    return () => {
      cancelledRef.current = true;
      if (poiTimerRef.current) clearTimeout(poiTimerRef.current);
      if (dwellTimerRef.current) clearTimeout(dwellTimerRef.current);
      cancelAnimationFrame(rafRef.current);
      v.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
      v.scene.requestRenderMode = prevRequestRender;
      v.scene.maximumRenderTimeChange = prevMaxRenderTime;
      v.scene.requestRender();
      setPhase('rotating');
      setCurrentPoi(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPins, viewer]);

  return null;
}
