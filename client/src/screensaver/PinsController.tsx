import * as Cesium from 'cesium';
import { useEffect, useRef } from 'react';
import { useCesiumViewer } from '../cesium/CesiumContext';
import { useScreensaverStore, type Poi } from './screensaverStore';
import { useEarthStatus } from '../layers/earth3d/earthStore';
import { useOsmStatus } from '../layers/osmBuildings/osmStore';
import { LOCATION_GROUPS } from '../layers/locations/locations';
import { useShipsStatus } from '../layers/ships/shipsStore';
import { FLEET_ROSTER, fleetColor } from '../layers/ships/fleet';
import { getGpuInfo } from '../perf/gpuInfo';

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
const CLEARANCE_M = 500;
// Points sampled around each orbit ring to find the tallest obstruction.
const RING_SAMPLES = 12;
// If clearing the terrain would require pulling back further than this, the
// site is too extreme for a close orbit — use the far safe orbit instead.
const MAX_CLOSE_RANGE_M = 28_000;

// Static pin list built from all location groups.
interface PinEntry {
  kind: 'pin';
  name: string;
  groupName: string;
  groupIcon: string;
  color: string;
  lat: number;
  lon: number;
  altitudeM: number;
}

// Live ship entry built from the latest store state on each queue refresh.
interface ShipEntry {
  kind: 'ship';
  name: string;
  lat: number;
  lon: number;
  mmsi: string;
  cls: 'STAR' | 'WIND';
  color: string;
  speedKt: number | null;
  heading: number | null;
  lastSeenSec: number;
}

type VisitEntry = PinEntry | ShipEntry;

const ALL_PINS: PinEntry[] = LOCATION_GROUPS.flatMap((g) =>
  g.locations.map((loc) => ({
    kind: 'pin' as const,
    name: loc.name,
    groupName: g.name,
    groupIcon: g.icon,
    color: g.color,
    lat: loc.lat,
    lon: loc.lon,
    altitudeM: loc.altitudeM ?? 12_000,
  }))
);

// Snap the current live ship positions from the store for interleaving into
// the visit queue. Only includes ships that have a known position.
function buildShipEntries(): ShipEntry[] {
  return useShipsStatus.getState().ships.flatMap((ship) => {
    const fleet = FLEET_ROSTER.find((f) => f.mmsi === ship.mmsi);
    if (!fleet) return [];
    return [{
      kind: 'ship' as const,
      name: ship.name?.trim() || fleet.name,
      lat: ship.latitude,
      lon: ship.longitude,
      mmsi: ship.mmsi,
      cls: fleet.cls,
      color: fleetColor(fleet.cls),
      speedKt: ship.speedKt,
      heading: ship.heading ?? ship.course ?? null,
      lastSeenSec: ship.lastSeenSec,
    }];
  });
}

// Orbit parameters for ships (over open ocean — no terrain sampling needed).
// Closer than a normal pin orbit so the 3D ship wireframe model reads clearly.
const SHIP_RANGE_M  = 850;
const SHIP_PITCH_RAD = Cesium.Math.toRadians(-28);

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

// Sample terrain heights at the pin and around two rings encircling the orbit
// path. Uses sampleTerrainMostDetailed (terrain-provider query) rather than
// scene.sampleHeightMostDetailed so it works before flying to the location —
// scene.sampleHeightMostDetailed requires the destination tiles to already be
// in the camera frustum, which they aren't until after flyTo completes.
async function sampleArea(
  v: Cesium.Viewer,
  lon: number,
  lat: number,
  ringRadiusM: number
): Promise<{ base: number | null; max: number | null }> {
  try {
    // EllipsoidTerrainProvider returns height=0 everywhere — not useful.
    if (v.terrainProvider instanceof Cesium.EllipsoidTerrainProvider) {
      return { base: null, max: null };
    }
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
    const results = await Cesium.sampleTerrainMostDetailed(v.terrainProvider, cartos);
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
  const queueRef = useRef<VisitEntry[]>([]);
  const poiTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dwellTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rafRef = useRef(0);

  const isPins = active && mode === 'pins';

  useEffect(() => {
    if (!isPins || !viewer) return;
    const v = viewer;

    cancelledRef.current = false;
    queueRef.current = shuffle([...ALL_PINS, ...buildShipEntries()]);

    // Detect GPU capability once for the entire screensaver session. On a
    // weak/integrated GPU we keep the scene in on-demand rendering mode so
    // the GPU only runs during the ~4.5s flyTo animations, NOT during dwell
    // (11-17s) or between-pin pauses (6-10s). requestRenderMode = false runs
    // the GPU at full rate for the entire session, which trips the AMD/Intel
    // TDR watchdog on shared-memory iGPUs and causes the black screen.
    const weakGpu = (() => {
      const g = getGpuInfo();
      return g.software || g.majorPerformanceCaveat || g.tier === 'low';
    })();

    const prevRenderMode = v.scene.requestRenderMode;
    const prevMaxChange = v.scene.maximumRenderTimeChange;
    if (!weakGpu) {
      // Strong GPU: continuous rendering gives a smooth orbit during dwell.
      v.scene.requestRenderMode = false;
      v.scene.maximumRenderTimeChange = 0;
    }

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
      if (queueRef.current.length === 0) {
        // Refresh ships on each full cycle so the positions stay current.
        queueRef.current = shuffle([...ALL_PINS, ...buildShipEntries()]);
      }
      const entry = queueRef.current.shift()!;

      // ── Ship orbit (no terrain sampling — ships are over ocean at height 0) ──
      if (entry.kind === 'ship') {
        const poi: Poi = {
          title: entry.name,
          description: '🚢 Windstar Fleet',
          lat: entry.lat,
          lon: entry.lon,
          altitudeM: SHIP_RANGE_M,
          category: 'ship',
          meta: {
            mmsi: entry.mmsi,
            cls: entry.cls,
            speedKt: entry.speedKt,
            heading: entry.heading,
            // Absolute Unix-ms of the last AIS fix so the card can tick forward.
            aisTimestamp: Date.now() - entry.lastSeenSec * 1000,
          },
        };
        setPhase('flying-to');
        setCurrentPoi(poi);

        const pitch    = SHIP_PITCH_RAD;
        const range    = SHIP_RANGE_M;
        const upFactor = Math.sin(-pitch);
        const back     = range * Math.cos(-pitch);
        const startLat = entry.lat - back / METERS_PER_DEG_LAT;

        v.camera.flyTo({
          destination: Cesium.Cartesian3.fromDegrees(entry.lon, startLat, range * upFactor),
          orientation: { heading: 0, pitch, roll: 0 },
          duration: 4.5,
          complete: () => {
            if (cancelledRef.current) return;
            setPhase('at-poi');
            const target = Cesium.Cartesian3.fromDegrees(entry.lon, entry.lat, 0);
            if (!weakGpu) {
              // On strong GPUs: orbit continuously around the ship.
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
            }
            // On weak GPU: camera holds at landing position; scene is idle (no
            // continuous render), GPU load drops to near zero during dwell.
            dwellTimerRef.current = setTimeout(() => {
              cancelAnimationFrame(rafRef.current);
              v.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
              leaveAndReturn();
            }, rand(DWELL_MIN_MS, DWELL_MAX_MS));
          },
        });
        return;
      }

      // ── Property pin orbit ──────────────────────────────────────────────────
      const pin = entry;

      const poi: Poi = {
        title: pin.name,
        description: `${pin.groupIcon} ${pin.groupName}`,
        lat: pin.lat,
        lon: pin.lon,
        altitudeM: pin.altitudeM,
        category: 'pin',
        meta: { color: pin.color },
      };

      setPhase('flying-to');
      setCurrentPoi(poi);

      // If a 3D source (OSM buildings + terrain, or Google tiles) is loaded AND
      // the GPU can handle continuous 3D tile rendering, sample real ground/
      // building heights for a close cinematic orbit. On weak GPUs skip both
      // (already in on-demand mode, and close 3D geometry is the heaviest path).
      const tilesReady =
        !weakGpu && (useOsmStatus.getState().ready || useEarthStatus.getState().ready);
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
        const upFactor = Math.sin(-pitch);
        const requiredCamH = (sample.max ?? baseH) + CLEARANCE_M;
        const neededRange = (requiredCamH - baseH) / upFactor;
        range = Math.max(CLOSE_RANGE_M, neededRange);
        if (range > MAX_CLOSE_RANGE_M) {
          pitch = FAR_PITCH_RAD;
          range = FAR_RANGE_M;
        }
      }

      const upFactor  = Math.sin(-pitch);
      const outFactor = Math.cos(-pitch);
      const target = Cesium.Cartesian3.fromDegrees(pin.lon, pin.lat, baseH);

      const back     = range * outFactor;
      const up       = baseH + range * upFactor;
      const startLat = pin.lat - back / METERS_PER_DEG_LAT;

      v.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(pin.lon, startLat, up),
        orientation: { heading: 0, pitch, roll: 0 },
        duration: 4.5,
        complete: () => {
          if (cancelledRef.current) return;
          setPhase('at-poi');

          if (!weakGpu) {
            // On strong GPUs: continuous orbit around the pin.
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
          }
          // On weak GPU: camera holds static at the landing view. Scene is in
          // on-demand mode so no GPU work happens until the next flyTo starts.

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
