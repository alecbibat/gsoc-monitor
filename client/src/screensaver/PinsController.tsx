import * as Cesium from 'cesium';
import { useEffect, useRef } from 'react';
import { useCesiumViewer } from '../cesium/CesiumContext';
import { useScreensaverStore, type Poi } from './screensaverStore';
import { LOCATION_GROUPS } from '../layers/locations/locations';

// ─────────────────────────────────────────────────────────────────────────────
// REBUILD — Stage 0: parks-shaped foundation.
//
// The pins screensaver black-screens weak GPUs *cumulatively* (fine for a while,
// then dies), which rules out every instantaneous peak-load cause we tested
// (building volume, altitude, the zoom-in burst). The remaining differences from
// the parks screensaver — which never crashes — are all pins-only per-frame
// work: a continuous camera orbit during dwell (re-culls + re-streams tiles
// every frame), the loot beam, and ship 3D models. Parks holds the camera dead
// still during dwell, so its continuous render is nearly free.
//
// So this is a ground-up rebuild modelled directly on NationalParksController:
// fly in, hold a STATIC dwell, fly back — clean lifecycle, no orbit RAF, no
// terrain sampling, no ships. Once this soak-tests stable we re-add the flashy
// pieces one stage at a time (gentle high orbit → lower altitude for buildings →
// loot beam → ships), each behind its own test, so whichever one reintroduces
// the crash is unambiguous.
// ─────────────────────────────────────────────────────────────────────────────

const OVERVIEW_ALT = 9_000_000;
const OVERVIEW_LAT = 38;
const OVERVIEW_LON = -96;

const POI_INTERVAL_MIN_MS = 12_000;
const POI_INTERVAL_MAX_MS = 20_000;
const POI_DWELL_MIN_MS = 12_000;
const POI_DWELL_MAX_MS = 18_000;

// Static top-down dwell altitude. Deliberately high enough to be unambiguously
// safe for the soak test — later stages descend toward the buildings.
const VIEW_ALT_M = 12_000;

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
        altitudeM: VIEW_ALT_M,
        category: 'pin',
        meta: { color: pin.color },
      };

      setPhase('flying-to');
      setCurrentPoi(poi);

      // Static top-down approach — no orbit. Exactly the parks motion profile.
      v.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(pin.lon, pin.lat, VIEW_ALT_M),
        duration: 5.0,
        complete: () => {
          if (cancelledRef.current) return;
          setPhase('at-poi');
          dwellTimerRef.current = setTimeout(leaveAndReturn, rand(POI_DWELL_MIN_MS, POI_DWELL_MAX_MS));
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
