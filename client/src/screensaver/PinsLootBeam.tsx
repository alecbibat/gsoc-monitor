import * as Cesium from 'cesium';
import { useEffect, useRef } from 'react';
import { useCesiumViewer } from '../cesium/CesiumContext';
import { useScreensaverStore } from './screensaverStore';

const BEAM_H = 5000;   // metres — towers up out of frame, loot-beam style
const R_CORE = 38;     // bright inner column radius
const R_OUTER = 110;   // soft outer glow radius
const R_GLOW = 300;    // ground glow / ripple radius

// Animated glowing "loot beam" rendered through the focused property pin during
// the pins screensaver, replacing the floating pin icon. A bright pulsing core,
// a soft outer halo, a steady base disc, and an expanding ground ripple.
export function PinsLootBeam() {
  const viewer = useCesiumViewer();
  const active = useScreensaverStore((s) => s.active);
  const mode   = useScreensaverStore((s) => s.mode);
  const poi    = useScreensaverStore((s) => s.currentPoi);

  const dsRef = useRef<Cesium.CustomDataSource | null>(null);

  const isPinFocus = active && mode === 'pins' && poi?.category === 'pin';
  const lon = poi?.lon;
  const lat = poi?.lat;
  const colorHex = (poi?.meta?.color as string | undefined) ?? '#a78bfa';

  useEffect(() => {
    if (!viewer || !isPinFocus || lon == null || lat == null) return;
    const v = viewer;
    const ds = new Cesium.CustomDataSource('pin-loot-beam');
    v.dataSources.add(ds);
    dsRef.current = ds;

    const color = Cesium.Color.fromCssColorString(colorHex);
    const t0 = performance.now();
    const sec = () => (performance.now() - t0) / 1000;

    const pulse = (base: number, amp: number, speed: number, phase = 0) =>
      new Cesium.ColorMaterialProperty(
        new Cesium.CallbackProperty(
          () => color.withAlpha(Math.max(0, base + amp * Math.sin(sec() * speed + phase))),
          false
        )
      );

    const beam = (length: number, radius: number, taper: number, material: Cesium.ColorMaterialProperty) =>
      ds.entities.add({
        position: Cesium.Cartesian3.fromDegrees(lon, lat, length / 2),
        cylinder: {
          length,
          topRadius: radius,
          bottomRadius: radius * taper,
          material,
          numberOfVerticalLines: 0,
          outline: false,
        },
      });

    // Soft outer halo + bright inner core
    beam(BEAM_H, R_OUTER, 0.55, pulse(0.12, 0.06, 1.7, 1.0));
    beam(BEAM_H, R_CORE, 1.0, pulse(0.5, 0.2, 3.0));

    // Steady base glow disc
    ds.entities.add({
      position: Cesium.Cartesian3.fromDegrees(lon, lat, 1),
      ellipse: {
        semiMajorAxis: R_GLOW * 0.5,
        semiMinorAxis: R_GLOW * 0.5,
        material: pulse(0.2, 0.07, 3.0),
        height: 1,
      },
    });

    // Expanding ground ripple
    const phase = () => (sec() / 1.5) % 1;
    ds.entities.add({
      position: Cesium.Cartesian3.fromDegrees(lon, lat, 2),
      ellipse: {
        semiMajorAxis: new Cesium.CallbackProperty(() => R_GLOW * (0.25 + 0.75 * phase()), false),
        semiMinorAxis: new Cesium.CallbackProperty(() => R_GLOW * (0.25 + 0.75 * phase()), false),
        material: new Cesium.ColorMaterialProperty(
          new Cesium.CallbackProperty(() => color.withAlpha(0.4 * (1 - phase())), false)
        ),
        height: 2,
      },
    });

    v.scene.requestRender();
    return () => {
      v.dataSources.remove(ds, true);
      dsRef.current = null;
      v.scene.requestRender();
    };
  }, [viewer, isPinFocus, lon, lat, colorHex]);

  return null;
}
