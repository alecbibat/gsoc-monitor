import * as Cesium from 'cesium';
import { useEffect, useRef } from 'react';
import { useCesiumViewer } from '../cesium/CesiumContext';
import { useScreensaverStore, type Poi } from './screensaverStore';
import { LOCATION_GROUPS } from '../layers/locations/locations';

// ─────────────────────────────────────────────────────────────────────────────
// REBUILD — Stage 4: add terrain elevation back.
//
// The orbit is stable down to a 2.5 km range (Stages 0-3). Until now the orbit
// target was hardcoded to sea level, so at elevated sites (Grand Canyon rim
// ~2.1 km, Yellowstone ~2.4 km) the camera sat at the wrong height relative to
// the 3D terrain. Stage 4's single new variable: sample the ground elevation at
// the pin and lift both the orbit target and the camera by it.
//
// This is ONE sampleTerrainMostDetailed point — not the heavy 25-point ring the
// pre-rebuild version used. (We proved camera-logic complexity wasn't the crash
// cause, but keeping it minimal stays honest to the staged approach.) Ridges
// around the orbit can still clip on the most rugged park sites; a ring sample
// can be added later if that matters. Loot beam and ships are still out.
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
const ORBIT_RANGE_M = 2_500;
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

// Ground elevation at a single point, so the orbit sits on real terrain instead
// of sea level. Returns 0 for the flat ellipsoid (no world terrain loaded) or on
// any failure, which just reproduces the prior sea-level behaviour.
async function sampleGroundHeight(v: Cesium.Viewer, lon: number, lat: number): Promise<number> {
  try {
    if (v.terrainProvider instanceof Cesium.EllipsoidTerrainProvider) return 0;
    const [r] = await Cesium.sampleTerrainMostDetailed(v.terrainProvider, [
      Cesium.Cartographic.fromDegrees(lon, lat),
    ]);
    const h = r?.height;
    return typeof h === 'number' && Number.isFinite(h) ? h : 0;
  } catch {
    return 0;
  }
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

    async function visitNext() {
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

      // Lift the orbit onto real terrain so elevated sites read correctly.
      const baseH = await sampleGroundHeight(v, pin.lon, pin.lat);
      if (cancelledRef.current) return;

      const target = Cesium.Cartesian3.fromDegrees(pin.lon, pin.lat, baseH);
      // Fly straight to the heading=0 orbit-start position (south of and above
      // the pin) so the orbit begins seamlessly with no camera snap.
      const back = ORBIT_RANGE_M * Math.cos(-ORBIT_PITCH_RAD);
      const up = baseH + ORBIT_RANGE_M * Math.sin(-ORBIT_PITCH_RAD);
      const startLat = pin.lat - back / METERS_PER_DEG_LAT;

      v.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(pin.lon, startLat, up),
        orientation: { heading: 0, pitch: ORBIT_PITCH_RAD, roll: 0 },
        duration: 5.0,
        complete: () => {
          if (cancelledRef.current) return;
          setPhase('at-poi');

          // Orbit the pin during dwell at ORBIT_RANGE_M, around the elevated target.
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
