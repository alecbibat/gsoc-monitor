import * as Cesium from 'cesium';
import { useEffect, useRef } from 'react';
import { useCesiumViewer } from '../cesium/CesiumContext';
import { useScreensaverStore, type Poi } from './screensaverStore';
import { LOCATION_GROUPS } from '../layers/locations/locations';
import { useShipsStatus } from '../layers/ships/shipsStore';
import { FLEET_ROSTER, fleetColor } from '../layers/ships/fleet';

// ─────────────────────────────────────────────────────────────────────────────
// REBUILD — altitude raise: 2.5 km crashed cumulatively on weak integrated
// GPUs (AMD Radeon Graphics / 0x0000150E). The crash is not ship-specific —
// a ship visit is now lighter than a pin visit — it is cumulative tile
// streaming: at 2.5 km range the frustum fills with high-LOD terrain and OSM
// building tiles every dwell, and after enough visits the GPU exhausts its
// context budget. Raising to 15 km means the scene requests coarser, fewer
// tiles per orbit, giving the GPU a chance to settle between visits.
//
// 15 km is a meaningful step above the 12 km Stage-1 floor (which soaked
// short-term) toward the parks screensaver's 60 km+ proven-safe band.
// ─────────────────────────────────────────────────────────────────────────────

const OVERVIEW_ALT = 9_000_000;
const OVERVIEW_LAT = 38;
const OVERVIEW_LON = -96;

const POI_INTERVAL_MIN_MS = 12_000;
const POI_INTERVAL_MAX_MS = 20_000;
const POI_DWELL_MIN_MS = 12_000;
const POI_DWELL_MAX_MS = 18_000;

// Orbit range (camera-to-target distance) — shared by pins and ships.
// -45° pitch minimises horizon tiles in the frustum. At 15 km range the
// camera sits ~10.6 km above the target in absolute altitude, which keeps
// terrain and building tiles at a coarser, lighter LOD than the 2.5 km orbit.
const ORBIT_RANGE_M = 15_000;
// Slow orbit during dwell. Matches the original 32 s period.
const ORBIT_PERIOD_MS = 32_000;
// Steeper tilt keeps the camera looking down rather than off toward the
// horizon, so fewer distant tiles stream as it orbits.
const ORBIT_PITCH_RAD = Cesium.Math.toRadians(-45);
const METERS_PER_DEG_LAT = 110_574;

interface PinEntry {
  kind: 'pin';
  name: string;
  groupName: string;
  groupIcon: string;
  color: string;
  lat: number;
  lon: number;
}

// Live ship entry snapped from the store on each queue refresh.
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
  }))
);

function rand(min: number, max: number) {
  return min + Math.random() * (max - min);
}

// Snap the current live ship positions from the store for interleaving into the
// visit queue. Only includes allowlisted ships that have a known position; if
// the AIS stream isn't connected this is empty and the tour is pins-only.
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

function buildQueue(): VisitEntry[] {
  const a: VisitEntry[] = [...ALL_PINS, ...buildShipEntries()];
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
  const queueRef = useRef<VisitEntry[]>([]);
  const poiTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dwellTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rafRef = useRef(0);

  const isPins = active && mode === 'pins';

  useEffect(() => {
    if (!isPins || !viewer) return;
    const v = viewer;

    cancelledRef.current = false;
    queueRef.current = buildQueue();

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

    // Orbit the given target continuously for the dwell, then leave. Shared by
    // pins and ships so both paths exit identically (cancel rAF, drop the
    // look-at transform, fly back).
    function orbitDwell(target: Cesium.Cartesian3, pitch: number, range: number) {
      setPhase('at-poi');
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
      }, rand(POI_DWELL_MIN_MS, POI_DWELL_MAX_MS));
    }

    async function visitNext() {
      if (cancelledRef.current) return;
      // Refresh ships on each full cycle so the positions stay current.
      if (queueRef.current.length === 0) queueRef.current = buildQueue();
      const entry = queueRef.current.shift()!;

      // ── Ship orbit (over ocean, height 0 — no terrain sampling) ─────────────
      if (entry.kind === 'ship') {
        const poi: Poi = {
          title: entry.name,
          description: '🚢 Windstar Fleet',
          lat: entry.lat,
          lon: entry.lon,
          altitudeM: ORBIT_RANGE_M,
          category: 'ship',
          meta: {
            mmsi: entry.mmsi,
            cls: entry.cls,
            // Fleet color so the loot beam over the ship matches its class.
            color: entry.color,
            speedKt: entry.speedKt,
            heading: entry.heading,
            // Absolute Unix-ms of the last AIS fix so the card can tick forward.
            aisTimestamp: Date.now() - entry.lastSeenSec * 1000,
          },
        };
        setPhase('flying-to');
        setCurrentPoi(poi);

        const target = Cesium.Cartesian3.fromDegrees(entry.lon, entry.lat, 0);
        const back = ORBIT_RANGE_M * Math.cos(-ORBIT_PITCH_RAD);
        const up = ORBIT_RANGE_M * Math.sin(-ORBIT_PITCH_RAD);
        const startLat = entry.lat - back / METERS_PER_DEG_LAT;

        v.camera.flyTo({
          destination: Cesium.Cartesian3.fromDegrees(entry.lon, startLat, up),
          orientation: { heading: 0, pitch: ORBIT_PITCH_RAD, roll: 0 },
          duration: 5.0,
          complete: () => {
            if (cancelledRef.current) return;
            orbitDwell(target, ORBIT_PITCH_RAD, ORBIT_RANGE_M);
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
          orbitDwell(target, ORBIT_PITCH_RAD, ORBIT_RANGE_M);
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
