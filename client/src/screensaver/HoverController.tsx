import * as Cesium from 'cesium';
import { useEffect, useRef } from 'react';
import { useCesiumViewer } from '../cesium/CesiumContext';
import { useHoverStore } from './hoverStore';
import { useEarthStatus } from '../layers/earth3d/earthStore';
import { useOsmStatus } from '../layers/osmBuildings/osmStore';
import { useScreensaverStore } from './screensaverStore';

// Cinematic orbit tuning — mirrors the pins screensaver so a custom point feels
// the same as orbiting a tracked property.
const ORBIT_PERIOD_MS = 45_000;
const CLOSE_RANGE_M = 2_200;
const CLOSE_PITCH_RAD = Cesium.Math.toRadians(-35);
const FAR_RANGE_M = 18_000;
const FAR_PITCH_RAD = Cesium.Math.toRadians(-38);
const METERS_PER_DEG_LAT = 110_574;
const METERS_PER_DEG_LON_EQ = 111_320;
const CLEARANCE_M = 500;
const RING_SAMPLES = 12;
const MAX_CLOSE_RANGE_M = 28_000;

// Sample terrain at the point and around two rings so the orbit height clears
// the tallest obstruction. Mirrors the pins screensaver's sampler.
async function sampleArea(
  v: Cesium.Viewer,
  lon: number,
  lat: number,
  ringRadiusM: number
): Promise<{ base: number | null; max: number | null }> {
  try {
    if (v.terrainProvider instanceof Cesium.EllipsoidTerrainProvider) {
      return { base: null, max: null };
    }
    const mPerDegLon = METERS_PER_DEG_LON_EQ * Math.cos(Cesium.Math.toRadians(lat));
    const cartos: Cesium.Cartographic[] = [Cesium.Cartographic.fromDegrees(lon, lat)];
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

export function HoverController() {
  const viewer = useCesiumViewer();
  const active = useHoverStore((s) => s.active);
  const point = useHoverStore((s) => s.point);
  const picking = useHoverStore((s) => s.picking);
  const setPoint = useHoverStore((s) => s.setPoint);
  const ssActive = useScreensaverStore((s) => s.active);

  const cancelledRef = useRef(false);
  const rafRef = useRef(0);

  // Hover and the screensaver both drive the camera — if a screensaver starts,
  // bow out.
  useEffect(() => {
    if (ssActive) useHoverStore.getState().stop();
  }, [ssActive]);

  // Picking: the next globe click becomes the orbit center. (CesiumGlobe's own
  // click handler bails while picking so it doesn't also open a panel.)
  useEffect(() => {
    if (!viewer || !picking) return;
    const v = viewer;
    const handler = new Cesium.ScreenSpaceEventHandler(v.scene.canvas);
    handler.setInputAction((e: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
      const cart = v.camera.pickEllipsoid(e.position, v.scene.globe.ellipsoid);
      if (!cart) return;
      const c = Cesium.Cartographic.fromCartesian(cart);
      setPoint(Cesium.Math.toDegrees(c.latitude), Cesium.Math.toDegrees(c.longitude));
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') useHoverStore.getState().stop();
    };
    window.addEventListener('keydown', onKey);

    return () => {
      handler.destroy();
      window.removeEventListener('keydown', onKey);
    };
  }, [viewer, picking, setPoint]);

  // Orbit around the chosen point until hover is stopped.
  useEffect(() => {
    if (!viewer || !active || !point) return;
    const v = viewer;
    const { lat, lon } = point;
    cancelledRef.current = false;

    const prevRenderMode = v.scene.requestRenderMode;
    const prevMaxChange = v.scene.maximumRenderTimeChange;
    v.scene.requestRenderMode = false;
    v.scene.maximumRenderTimeChange = 0;

    // A pulsing marker pins the orbit center.
    const ds = new Cesium.CustomDataSource('hover-point');
    v.dataSources.add(ds);
    ds.entities.add({
      position: Cesium.Cartesian3.fromDegrees(lon, lat),
      point: {
        pixelSize: new Cesium.CallbackProperty(
          () => 9 + 3 * (0.5 + 0.5 * Math.sin(Date.now() / 240)),
          false
        ) as unknown as Cesium.Property,
        color: Cesium.Color.fromCssColorString('#3ddcff'),
        outlineColor: Cesium.Color.WHITE,
        outlineWidth: 2,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });

    (async () => {
      const tilesReady = useOsmStatus.getState().ready || useEarthStatus.getState().ready;
      const ringRadius0 = CLOSE_RANGE_M * Math.cos(-CLOSE_PITCH_RAD);
      const sample = tilesReady
        ? await sampleArea(v, lon, lat, ringRadius0)
        : { base: null, max: null };
      if (cancelledRef.current) return;

      let pitch = FAR_PITCH_RAD;
      let range = FAR_RANGE_M;
      let baseH = 0;

      if (sample.base !== null) {
        baseH = sample.base;
        pitch = CLOSE_PITCH_RAD;
        const upF = Math.sin(-pitch);
        const requiredCamH = (sample.max ?? baseH) + CLEARANCE_M;
        const neededRange = (requiredCamH - baseH) / upF;
        range = Math.max(CLOSE_RANGE_M, neededRange);
        if (range > MAX_CLOSE_RANGE_M) {
          pitch = FAR_PITCH_RAD;
          range = FAR_RANGE_M;
        }
      }

      const upFactor = Math.sin(-pitch);
      const outFactor = Math.cos(-pitch);
      const target = Cesium.Cartesian3.fromDegrees(lon, lat, baseH);
      const back = range * outFactor;
      const up = baseH + range * upFactor;
      const startLat = lat - back / METERS_PER_DEG_LAT;

      v.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(lon, startLat, up),
        orientation: { heading: 0, pitch, roll: 0 },
        duration: 3.0,
        complete: () => {
          if (cancelledRef.current) return;
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
        },
      });
    })();

    return () => {
      cancelledRef.current = true;
      cancelAnimationFrame(rafRef.current);
      v.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
      v.dataSources.remove(ds, true);
      v.scene.requestRenderMode = prevRenderMode;
      v.scene.maximumRenderTimeChange = prevMaxChange;
      v.scene.requestRender();
    };
  }, [viewer, active, point]);

  return null;
}
