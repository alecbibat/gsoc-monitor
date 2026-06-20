import * as Cesium from 'cesium';
import { useEffect } from 'react';
import { useCesiumViewer } from '../cesium/CesiumContext';
import { useScreensaverStore } from './screensaverStore';

const RING_COUNT = 3;
const RING_PERIOD_MS = 3_500;
const R_MIN =   350; // metres – clears the hull tips at SCALE=54 (~243 m half-length)
const R_MAX = 2_800; // metres – visible ring from the 15 km ship orbit

// Cyan sonar pulse — reads as ocean / radar on dark water.
const RING_COLOR = Cesium.Color.fromCssColorString('#67e8f9');

export function ShipShockwave() {
  const viewer = useCesiumViewer();
  const active = useScreensaverStore((s) => s.active);
  const mode   = useScreensaverStore((s) => s.mode);
  const poi    = useScreensaverStore((s) => s.currentPoi);

  const isFocus = active && mode === 'pins' && poi?.category === 'ship';
  const lon = poi?.lon;
  const lat = poi?.lat;

  useEffect(() => {
    if (!viewer || !isFocus || lon == null || lat == null) return;
    const v = viewer;
    const ds = new Cesium.CustomDataSource('ship-shockwave');
    v.dataSources.add(ds);

    // Precompute the ENU→ECEF transform and unit circle once for this dwell;
    // the ship position is stable so these never need to change.
    const center = Cesium.Cartesian3.fromDegrees(lon, lat, 0);
    const enuToEcef = Cesium.Transforms.eastNorthUpToFixedFrame(
      center, undefined, new Cesium.Matrix4()
    );
    const N = 64;
    const unitPts = Array.from({ length: N + 1 }, (_, i) => {
      const a = (i / N) * Cesium.Math.TWO_PI;
      return { e: Math.cos(a), n: Math.sin(a) };
    });
    // Single scratch vector reused per-point inside the map (map is synchronous).
    const scratch = new Cesium.Cartesian3();

    const t0 = performance.now();
    const ringPhase = (idx: number): number => {
      const offset = idx * (RING_PERIOD_MS / RING_COUNT);
      const elapsed = performance.now() - t0 - offset;
      return (((elapsed % RING_PERIOD_MS) + RING_PERIOD_MS) % RING_PERIOD_MS) / RING_PERIOD_MS;
    };

    for (let i = 0; i < RING_COUNT; i++) {
      const ri = i;
      ds.entities.add({
        polyline: {
          positions: new Cesium.CallbackProperty(() => {
            const r = R_MIN + (R_MAX - R_MIN) * ringPhase(ri);
            return unitPts.map(({ e, n }) => {
              scratch.x = e * r;
              scratch.y = n * r;
              scratch.z = 0;
              return Cesium.Matrix4.multiplyByPoint(enuToEcef, scratch, new Cesium.Cartesian3());
            });
          }, false),
          width: 6,
          material: new Cesium.PolylineGlowMaterialProperty({
            color: new Cesium.CallbackProperty(
              () => RING_COLOR.withAlpha(Math.max(0, (1 - ringPhase(ri)) * 0.8)),
              false
            ),
            glowPower: 0.45,
          }),
        },
      });
    }

    v.scene.requestRender();
    return () => {
      v.dataSources.remove(ds, true);
      v.scene.requestRender();
    };
  }, [viewer, isFocus, lon, lat]);

  return null;
}
