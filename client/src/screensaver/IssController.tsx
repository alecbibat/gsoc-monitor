import * as Cesium from 'cesium';
import { useEffect } from 'react';
import {
  twoline2satrec,
  propagate,
  gstime,
  eciToGeodetic,
  degreesLong,
  degreesLat,
  type EciVec3,
} from 'satellite.js';
import { useCesiumViewer } from '../cesium/CesiumContext';
import { useScreensaverStore } from './screensaverStore';
import { useLayersStore } from '../store/layersStore';
import { api } from '../api/client';

const ISS_SATNUM = '25544';

// Cinematic chase framing: look down at the station from behind/above while the
// heading slowly orbits it, so the Earth wheels past underneath.
const PITCH = Cesium.Math.toRadians(-32);
const RANGE_M = 2_600_000;
const ORBIT_PERIOD_MS = 100_000; // one full camera orbit around the station
const POI_THROTTLE_MS = 1000; // how often the toast text refreshes

// Self-contained "follow the ISS" screensaver. It fetches the station TLE
// directly (the satellite layer keeps its entity map private), propagates the
// orbit with SGP4 every frame, and locks the camera onto the live position.
export function IssController() {
  const viewer = useCesiumViewer();
  const active = useScreensaverStore((s) => s.active);
  const mode = useScreensaverStore((s) => s.mode);
  const setPhase = useScreensaverStore((s) => s.setPhase);
  const setCurrentPoi = useScreensaverStore((s) => s.setCurrentPoi);

  const isIss = active && mode === 'iss';

  useEffect(() => {
    if (!viewer || !isIss) return;

    let cancelled = false;
    let raf = 0;
    let satrec: ReturnType<typeof twoline2satrec> | null = null;
    let lastPoi = 0;

    // Make the ISS itself visible (billboard + comet trail) while we chase it.
    const layers = useLayersStore.getState();
    if (!layers.active.satellites) layers.toggleLayer('satellites');
    if (layers.satelliteGroup !== 'stations') layers.setSatelliteGroup('stations');

    // A smooth follow needs continuous rendering; on-demand mode would stutter.
    const prevRenderMode = viewer.scene.requestRenderMode;
    const prevMaxChange = viewer.scene.maximumRenderTimeChange;
    viewer.scene.requestRenderMode = false;
    viewer.scene.maximumRenderTimeChange = 0;

    setPhase('rotating');

    const tick = () => {
      if (cancelled || !satrec) return;
      const now = new Date();
      const pv = propagate(satrec, now);
      if (typeof pv.position !== 'boolean') {
        const geo = eciToGeodetic(pv.position as EciVec3<number>, gstime(now));
        const lat = degreesLat(geo.latitude);
        const lon = degreesLong(geo.longitude);
        const altM = geo.height * 1000;
        const target = Cesium.Cartesian3.fromDegrees(lon, lat, altM);
        const heading =
          ((performance.now() % ORBIT_PERIOD_MS) / ORBIT_PERIOD_MS) * Cesium.Math.TWO_PI;
        viewer.camera.lookAt(target, new Cesium.HeadingPitchRange(heading, PITCH, RANGE_M));

        // Throttle the toast update so we don't re-render React every frame.
        if (performance.now() - lastPoi > POI_THROTTLE_MS) {
          lastPoi = performance.now();
          const ns = lat >= 0 ? 'N' : 'S';
          const ew = lon >= 0 ? 'E' : 'W';
          setCurrentPoi({
            title: 'International Space Station',
            description: `Live SGP4 track · ${Math.abs(lat).toFixed(1)}°${ns} ${Math.abs(lon).toFixed(1)}°${ew} · ${Math.round(geo.height)} km · NORAD 25544`,
            lat,
            lon,
            altitudeM: altM,
            category: 'iss',
          });
          setPhase('at-poi');
        }
      }
      raf = requestAnimationFrame(tick);
    };

    api
      .satellites('stations')
      .then((res) => {
        if (cancelled) return;
        const iss = res.satellites.find((s) => s.satnum === ISS_SATNUM) ?? res.satellites[0];
        if (!iss) throw new Error('ISS TLE not found');
        satrec = twoline2satrec(iss.line1, iss.line2);
        raf = requestAnimationFrame(tick);
      })
      .catch(() => {
        if (cancelled) return;
        setCurrentPoi({
          title: 'International Space Station',
          description: 'Live track unavailable — could not load the station TLE.',
          lat: 0,
          lon: 0,
          altitudeM: 0,
          category: 'iss',
        });
        setPhase('at-poi');
      });

    return () => {
      cancelled = true;
      if (raf) cancelAnimationFrame(raf);
      // Release the locked chase frame and restore render throttling.
      viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
      viewer.scene.requestRenderMode = prevRenderMode;
      viewer.scene.maximumRenderTimeChange = prevMaxChange;
      viewer.scene.requestRender();
    };
  }, [viewer, isIss, setPhase, setCurrentPoi]);

  return null;
}
