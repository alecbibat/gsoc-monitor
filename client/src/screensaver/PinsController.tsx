import * as Cesium from 'cesium';
import { useEffect, useRef } from 'react';
import { useCesiumViewer } from '../cesium/CesiumContext';
import { useScreensaverStore, type Poi } from './screensaverStore';
import { LOCATION_GROUPS } from '../layers/locations/locations';
import { useShipsStatus } from '../layers/ships/shipsStore';
import { FLEET_ROSTER } from '../layers/ships/fleet';

const OVERVIEW_ALT = 9_000_000;
const OVERVIEW_LAT = 38;
const OVERVIEW_LON = -96;

const POI_INTERVAL_MIN_MS = 12_000;
const POI_INTERVAL_MAX_MS = 20_000;
const POI_DWELL_MIN_MS = 12_000;
const POI_DWELL_MAX_MS = 18_000;

// Orbit standoff. Ships keep the wide 15 km framing that suits the ~490 m hero
// wireframe; property pins pull in closer so the pin + 2.6 km loot beam read
// clearly (but not as tight as the old ~850 m, which felt claustrophobic).
const ORBIT_RANGE_M = 15_000;
const PIN_ORBIT_RANGE_M = 8_000;
const ORBIT_PERIOD_MS = 32_000;
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

interface ShipEntry {
  kind: 'ship';
  name: string;
  lat: number;
  lon: number;
  mmsi: string;
  cls: 'STAR' | 'WIND';
  speedKt: number | null;
  heading: number | null;
  aisTimestamp: number | null;
  destination: string | null;
  navStatus: number | null;
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

function buildShipEntries(): ShipEntry[] {
  return useShipsStatus.getState().ships.flatMap((ship) => {
    const fleet = FLEET_ROSTER.find((f) => f.mmsi === ship.mmsi);
    if (!fleet) return [];
    const lat = ship.latitude;
    const lon = ship.longitude;
    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lon) ||
      Math.abs(lat) > 90 ||
      Math.abs(lon) > 180
    )
      return [];
    return [
      {
        kind: 'ship' as const,
        name: ship.name?.trim() || fleet.name,
        lat,
        lon,
        mmsi: ship.mmsi,
        cls: fleet.cls,
        speedKt: ship.speedKt,
        heading: ship.heading ?? ship.course ?? null,
        aisTimestamp: ship.lastSeenSec > 0 ? ship.lastSeenSec * 1000 : null,
        destination: ship.destination,
        navStatus: ship.navStatus,
      },
    ];
  });
}

function rand(min: number, max: number) {
  return min + Math.random() * (max - min);
}

function buildQueue(): VisitEntry[] {
  const combined: VisitEntry[] = [...ALL_PINS, ...buildShipEntries()];
  for (let i = combined.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [combined[i], combined[j]] = [combined[j], combined[i]];
  }
  return combined;
}

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

    function orbitDwell(target: Cesium.Cartesian3, range: number) {
      setPhase('at-poi');
      const orbitStart = performance.now();
      const tick = () => {
        if (cancelledRef.current) return;
        const heading =
          (((performance.now() - orbitStart) % ORBIT_PERIOD_MS) * Cesium.Math.TWO_PI) /
          ORBIT_PERIOD_MS;
        v.camera.lookAt(target, new Cesium.HeadingPitchRange(heading, ORBIT_PITCH_RAD, range));
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
      if (queueRef.current.length === 0) queueRef.current = buildQueue();
      const entry = queueRef.current.shift()!;

      setPhase('flying-to');

      if (entry.kind === 'ship') {
        const poi: Poi = {
          title: entry.name,
          description: '🚢 Windstar Cruises',
          lat: entry.lat,
          lon: entry.lon,
          altitudeM: ORBIT_RANGE_M,
          category: 'ship',
          meta: {
            mmsi: entry.mmsi,
            cls: entry.cls,
            speedKt: entry.speedKt,
            heading: entry.heading,
            aisTimestamp: entry.aisTimestamp,
            destination: entry.destination,
            navStatus: entry.navStatus,
          },
        };
        setCurrentPoi(poi);

        // Ships sit at sea level; skip terrain sampling.
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
            orbitDwell(target, ORBIT_RANGE_M);
          },
        });
        return;
      }

      const poi: Poi = {
        title: entry.name,
        description: `${entry.groupIcon} ${entry.groupName}`,
        lat: entry.lat,
        lon: entry.lon,
        altitudeM: PIN_ORBIT_RANGE_M,
        category: 'pin',
        meta: { color: entry.color },
      };

      setCurrentPoi(poi);

      const baseH = await sampleGroundHeight(v, entry.lon, entry.lat);
      if (cancelledRef.current) return;

      const target = Cesium.Cartesian3.fromDegrees(entry.lon, entry.lat, baseH);
      const back = PIN_ORBIT_RANGE_M * Math.cos(-ORBIT_PITCH_RAD);
      const up = baseH + PIN_ORBIT_RANGE_M * Math.sin(-ORBIT_PITCH_RAD);
      const startLat = entry.lat - back / METERS_PER_DEG_LAT;

      v.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(entry.lon, startLat, up),
        orientation: { heading: 0, pitch: ORBIT_PITCH_RAD, roll: 0 },
        duration: 5.0,
        complete: () => {
          if (cancelledRef.current) return;
          orbitDwell(target, PIN_ORBIT_RANGE_M);
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
