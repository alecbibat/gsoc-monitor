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

// Close cinematic orbit — used when OSM buildings + terrain (or Google 3D
// tiles) are loaded so real geometry is visible from a low, tilted angle.
// Range and pitch are chosen so the camera stays ≥ 1 km above sampled
// terrain even at grand-canyon/yellowstone elevations.
const CLOSE_RANGE_M = 2_200;
const CLOSE_PITCH_RAD = Cesium.Math.toRadians(-35);
// Safe high fallback orbit — used when 3D tiles aren't available (no API key)
// or terrain height can't be sampled. Stays well above any terrain.
const FAR_RANGE_M = 18_000;
const FAR_PITCH_RAD = Cesium.Math.toRadians(-38);

const METERS_PER_DEG_LAT = 110_574;
const METERS_PER_DEG_LON_EQ = 111_320;

// How much vertical clearance to keep between the camera and the highest
// terrain/building it passes over during the orbit.
const CLEARANCE_M = 350;
// Points sampled around each orbit ring to find the tallest obstruction.
const RING_SAMPLES = 12;
// If clearing the terrain would require pulling back further than this, the
// site is too extreme for a close orbit — use the far safe orbit instead.
const MAX_CLOSE_RANGE_M = 28_000;

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

// Sample the topmost loaded surface (terrain + OSM buildings, or Google 3D
// tiles) at the pin AND around two rings encircling the orbit path, forcing the
// most-detailed tiles to stream in first. Returns the pin's ground height plus
// the maximum height found anywhere on the rings, so the caller can lift the
// camera above any ridge/building it would otherwise swing into. Returns nulls
// when sampling is unsupported or fails so callers can fall back to a safe orbit.
async function sampleArea(
  v: Cesium.Viewer,
  lon: number,
  lat: number,
  ringRadiusM: number
): Promise<{ base: number | null; max: number | null }> {
  try {
    if (!v.scene.sampleHeightSupported) return { base: null, max: null };
    const mPerDegLon = METERS_PER_DEG_LON_EQ * Math.cos(Cesium.Math.toRadians(lat));
    const cartos: Cesium.Cartographic[] = [Cesium.Cartographic.fromDegrees(lon, lat)];
    // Two concentric rings (the orbit radius and double it) catch terrain that
    // rises beyond the immediate orbit if the camera has to pull back.
    for (const radius of [ringRadiusM, ringRadiusM * 2]) {
      for (let i = 0; i < RING_SAMPLES; i++) {
        const a = (i / RING_SAMPLES) * Cesium.Math.TWO_PI;
        const dLat = (radius * Math.cos(a)) / METERS_PER_DEG_LAT;
        const dLon = (radius * Math.sin(a)) / mPerDegLon;
        cartos.push(Cesium.Cartographic.fromDegrees(lon + dLon, lat + dLat));
      }
    }
    const results = await v.scene.sampleHeightMostDetailed(cartos);
    const heights = results
      .map((r) => r?.height)
      .filter((h): h is number => typeof h === 'number' && Number.isFinite(h));
    if (heights.length === 0) return { base: null, max: null };
    const baseRaw = results[0]?.height;
    const base =
      typeof baseRaw === 'number' && Number.isFinite(baseRaw) ? baseRaw : Math.min(...heights);
    return { base, max: Math.max(...heights) };
  } catch {
    return { base: null, max: null };
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
      // sample the real ground/building heights so we can orbit close to the
      // terrain. Otherwise stay high and safe over the flat globe.
      const tilesReady = useOsmStatus.getState().ready || useEarthStatus.getState().ready;
      const ringRadius0 = CLOSE_RANGE_M * Math.cos(-CLOSE_PITCH_RAD);
      const sample = tilesReady
        ? await sampleArea(v, pin.lon, pin.lat, ringRadius0)
        : { base: null, max: null };
      if (cancelledRef.current) return;

      let pitch = FAR_PITCH_RAD;
      let range = FAR_RANGE_M;
      let baseH = 0;

      if (sample.base !== null) {
        baseH = sample.base;
        pitch = CLOSE_PITCH_RAD;
        const upFactor = Math.sin(-pitch); // vertical component of the range
        // The camera traces a horizontal circle, so its absolute height is
        // constant: baseH + range*upFactor. Pick a range large enough that this
        // height clears the tallest terrain/building anywhere on the orbit ring.
        const requiredCamH = (sample.max ?? baseH) + CLEARANCE_M;
        const neededRange = (requiredCamH - baseH) / upFactor;
        range = Math.max(CLOSE_RANGE_M, neededRange);
        if (range > MAX_CLOSE_RANGE_M) {
          // Terrain too extreme for a close orbit — fall back to the far view.
          pitch = FAR_PITCH_RAD;
          range = FAR_RANGE_M;
        }
      }

      const upFactor = Math.sin(-pitch);
      const outFactor = Math.cos(-pitch);
      const target = Cesium.Cartesian3.fromDegrees(pin.lon, pin.lat, baseH);

      // Fly straight to the heading=0 orbit position (south of and above the
      // target) so the subsequent orbit begins seamlessly with no camera snap.
      const back = range * outFactor; // metres south of target
      const up = baseH + range * upFactor; // absolute camera height (clears ring)
      const startLat = pin.lat - back / METERS_PER_DEG_LAT;

      v.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(pin.lon, startLat, up),
        orientation: { heading: 0, pitch, roll: 0 },
        duration: 4.5,
        complete: () => {
          if (cancelledRef.current) return;
          setPhase('at-poi');

          // Cinematic orbit around the pin while dwelling. The camera traces a
          // horizontal circle at a constant height already proven (by the ring
          // sampling above) to clear the tallest obstruction on the path.
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
