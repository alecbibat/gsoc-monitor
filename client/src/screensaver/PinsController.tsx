import * as Cesium from 'cesium';
import { useEffect, useRef } from 'react';
import { useCesiumViewer } from '../cesium/CesiumContext';
import { useScreensaverStore, type Poi } from './screensaverStore';
import { LOCATION_GROUPS } from '../layers/locations/locations';
import { useShipsStatus } from '../layers/ships/shipsStore';
import { FLEET_ROSTER, fleetColor } from '../layers/ships/fleet';

// ─────────────────────────────────────────────────────────────────────────────
// REBUILD — Stage 6: interleave the live ships back into the tour.
//
// Stages 0-5 proved the pin orbit (down to a 2.5 km range, lifted onto real
// terrain) and the loot beam are stable through long soaks. The last feature
// held out of the rebuild is the Windstar fleet: live AIS positions interleaved
// with the property pins, each orbited close (850 m range) so the 3D wireframe
// card reads clearly.
//
// Ships orbit LOWER than the 2.5 km pin floor — but always over open ocean,
// where there are no building tiles and no detailed terrain to stream, so the
// per-visit GPU load is far lighter than a low city orbit. That's the bet this
// stage tests: if the low ship orbit black-screens, raise SHIP_RANGE_M; if it
// soaks clean, the rebuild is complete and the diagnostic OSM SSE can be dialed
// back toward production values.
// ─────────────────────────────────────────────────────────────────────────────

const OVERVIEW_ALT = 9_000_000;
const OVERVIEW_LAT = 38;
const OVERVIEW_LON = -96;

const POI_INTERVAL_MIN_MS = 12_000;
const POI_INTERVAL_MAX_MS = 20_000;
const POI_DWELL_MIN_MS = 12_000;
const POI_DWELL_MAX_MS = 18_000;

// Orbit range (camera-to-target distance) for property pins. Stable at 2.5 km
// through Stages 2-5.
const ORBIT_RANGE_M = 2_500;
// Slow orbit during dwell. Matches the original 32 s period.
const ORBIT_PERIOD_MS = 32_000;
// Steeper tilt keeps the camera looking down at the pin rather than off toward
// the horizon, so fewer distant tiles stream as it orbits.
const ORBIT_PITCH_RAD = Cesium.Math.toRadians(-45);
const METERS_PER_DEG_LAT = 110_574;

// Ship orbit (over open ocean — height 0, no terrain sampling). Raised to
// match the proven-safe pin floor: 850 m crashed, confirming terrain tiles
// stream aggressively even over water at close range.
const SHIP_RANGE_M = 2_500;
const SHIP_PITCH_RAD = Cesium.Math.toRadians(-28);

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

        const target = Cesium.Cartesian3.fromDegrees(entry.lon, entry.lat, 0);
        const back = SHIP_RANGE_M * Math.cos(-SHIP_PITCH_RAD);
        const up = SHIP_RANGE_M * Math.sin(-SHIP_PITCH_RAD);
        const startLat = entry.lat - back / METERS_PER_DEG_LAT;

        v.camera.flyTo({
          destination: Cesium.Cartesian3.fromDegrees(entry.lon, startLat, up),
          orientation: { heading: 0, pitch: SHIP_PITCH_RAD, roll: 0 },
          duration: 5.0,
          complete: () => {
            if (cancelledRef.current) return;
            orbitDwell(target, SHIP_PITCH_RAD, SHIP_RANGE_M);
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
