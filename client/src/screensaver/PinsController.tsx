import * as Cesium from 'cesium';
import { useEffect, useRef } from 'react';
import { useCesiumViewer } from '../cesium/CesiumContext';
import { useScreensaverStore, type Poi } from './screensaverStore';
import { useEarthStatus } from '../layers/earth3d/earthStore';
import { useOsmStatus } from '../layers/osmBuildings/osmStore';
import { LOCATION_GROUPS } from '../layers/locations/locations';

const OVERVIEW_ALT = 9_000_000;
const OVERVIEW_LAT = 38;
const OVERVIEW_LON = -96;

const DWELL_MIN_MS = 11_000;
const DWELL_MAX_MS = 17_000;
const INTERVAL_MIN_MS = 6_000;
const INTERVAL_MAX_MS = 10_000;
// Camera orbits slowly around each pin while dwelling.
const ORBIT_PERIOD_MS = 45_000;

// Close cinematic orbit — used when Google 3D tiles are loaded so the
// photorealistic buildings and terrain are visible from a low, tilted angle.
const CLOSE_RANGE_M = 1_600;
const CLOSE_PITCH_RAD = Cesium.Math.toRadians(-28);
// Safe high fallback orbit — used when 3D tiles aren't available (no API key)
// or terrain height can't be sampled. Stays well above any terrain.
const FAR_RANGE_M = 18_000;
const FAR_PITCH_RAD = Cesium.Math.toRadians(-38);

const METERS_PER_DEG_LAT = 110_574;

// Flatten every pin across all groups into a single array.
interface PinEntry {
  name: string;
  groupName: string;
  groupIcon: string;
  color: string;
  lat: number;
  lon: number;
  altitudeM: number;
}

const ALL_PINS: PinEntry[] = LOCATION_GROUPS.flatMap((g) =>
  g.locations.map((loc) => ({
    name: loc.name,
    groupName: g.name,
    groupIcon: g.icon,
    color: g.color,
    lat: loc.lat,
    lon: loc.lon,
    altitudeM: loc.altitudeM ?? 12_000,
  }))
);

function rand(min: number, max: number) {
  return min + Math.random() * (max - min);
}
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Sample the height of the topmost loaded surface (Google 3D tiles or globe)
// at a point, forcing the most-detailed tiles there to stream in first. Returns
// null when sampling is unsupported or fails so callers can fall back safely.
async function sampleGroundHeight(
  v: Cesium.Viewer,
  lon: number,
  lat: number
): Promise<number | null> {
  try {
    if (!v.scene.sampleHeightSupported) return null;
    const carto = Cesium.Cartographic.fromDegrees(lon, lat);
    const [result] = await v.scene.sampleHeightMostDetailed([carto]);
    const h = result?.height;
    return typeof h === 'number' && Number.isFinite(h) ? h : null;
  } catch {
    return null;
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
    queueRef.current = shuffle(ALL_PINS);

    const prevRenderMode = v.scene.requestRenderMode;
    const prevMaxChange = v.scene.maximumRenderTimeChange;
    v.scene.requestRenderMode = false;
    v.scene.maximumRenderTimeChange = 0;

    v.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(OVERVIEW_LON, OVERVIEW_LAT, OVERVIEW_ALT),
      duration: 2.5,
    });

    function scheduleNext() {
      if (cancelledRef.current) return;
      poiTimerRef.current = setTimeout(visitNext, rand(INTERVAL_MIN_MS, INTERVAL_MAX_MS));
    }

    async function visitNext() {
      if (cancelledRef.current) return;
      if (queueRef.current.length === 0) queueRef.current = shuffle(ALL_PINS);
      const pin = queueRef.current.shift()!;

      const poi: Poi = {
        title: pin.name,
        description: `${pin.groupIcon} ${pin.groupName}`,
        lat: pin.lat,
        lon: pin.lon,
        altitudeM: pin.altitudeM,
        category: 'pin',
      };

      setPhase('flying-to');
      setCurrentPoi(poi);

      // If a 3D source (OSM buildings + terrain, or Google tiles) is loaded,
      // sample the real ground/building height so we can orbit close to the
      // terrain. Otherwise stay high and safe over the flat globe.
      const tilesReady = useOsmStatus.getState().ready || useEarthStatus.getState().ready;
      const groundH = tilesReady ? await sampleGroundHeight(v, pin.lon, pin.lat) : null;
      if (cancelledRef.current) return;

      const close = groundH !== null;
      const range = close ? CLOSE_RANGE_M : FAR_RANGE_M;
      const pitch = close ? CLOSE_PITCH_RAD : FAR_PITCH_RAD;
      const baseH = close ? (groundH as number) : 0;
      const target = Cesium.Cartesian3.fromDegrees(pin.lon, pin.lat, baseH);

      // Fly straight to the heading=0 orbit position (south of and above the
      // target) so the subsequent orbit begins seamlessly with no camera snap.
      const back = range * Math.cos(-pitch); // metres south of target
      const up = baseH + range * Math.sin(-pitch); // metres above ellipsoid
      const startLat = pin.lat - back / METERS_PER_DEG_LAT;

      v.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(pin.lon, startLat, up),
        orientation: { heading: 0, pitch, roll: 0 },
        duration: 4.5,
        complete: () => {
          if (cancelledRef.current) return;
          setPhase('at-poi');

          // Cinematic orbit around the pin while dwelling.
          const orbitStart = performance.now();
          const tick = () => {
            if (cancelledRef.current) return;
            const heading =
              (((performance.now() - orbitStart) % ORBIT_PERIOD_MS) * Cesium.Math.TWO_PI) /
              ORBIT_PERIOD_MS;
            v.camera.lookAt(target, new Cesium.HeadingPitchRange(heading, pitch, range));
            rafRef.current = requestAnimationFrame(tick);
          };
          rafRef.current = requestAnimationFrame(tick);

          dwellTimerRef.current = setTimeout(() => {
            cancelAnimationFrame(rafRef.current);
            v.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
            leaveAndReturn();
          }, rand(DWELL_MIN_MS, DWELL_MAX_MS));
        },
      });
    }

    function leaveAndReturn() {
      if (cancelledRef.current) return;
      setPhase('flying-back');
      setCurrentPoi(null);
      v.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(OVERVIEW_LON, OVERVIEW_LAT, OVERVIEW_ALT),
        duration: 4.0,
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
      v.scene.requestRenderMode = prevRenderMode;
      v.scene.maximumRenderTimeChange = prevMaxChange;
      v.scene.requestRender();
      setPhase('rotating');
      setCurrentPoi(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPins, viewer]);

  return null;
}
