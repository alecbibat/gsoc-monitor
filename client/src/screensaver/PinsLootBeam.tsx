import * as Cesium from 'cesium';
import { useEffect, useRef } from 'react';
import { useCesiumViewer } from '../cesium/CesiumContext';
import { useScreensaverStore } from './screensaverStore';

const BEAM_H = 2600; // metres the shaft rises before the glow tapers out

// Soft radial glow sprite (white; tinted per-pin via billboard color), built once.
function radialGlowUrl(): string {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.5)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return c.toDataURL();
}
const GLOW_URL = radialGlowUrl();

// A sleek glowing "loot beam" through the focused property pin during the pins
// screensaver — a soft outer halo + bright inner core rendered as screen-space
// PolylineGlow shafts (crisp at any zoom, no chunky tube), anchored to a
// ground-clamped radial glow. The base tracks terrain height so the beam
// terminates at the surface instead of punching through it.
export function PinsLootBeam() {
  const viewer = useCesiumViewer();
  const active = useScreensaverStore((s) => s.active);
  const mode   = useScreensaverStore((s) => s.mode);
  const poi    = useScreensaverStore((s) => s.currentPoi);

  const dsRef = useRef<Cesium.CustomDataSource | null>(null);

  // Staged pins rebuild: the loot beam is a per-frame cost (globe.getHeight +
  // glow shaders every frame for the whole session), so it's held out of the
  // Stage 0 soak-test baseline and re-added as its own stage once the bare
  // parks-shaped lifecycle is proven stable.
  const STAGE_LOOT_BEAM_ENABLED = true;

  const isPinFocus =
    STAGE_LOOT_BEAM_ENABLED && active && mode === 'pins' && poi?.category === 'pin';
  const lon = poi?.lon;
  const lat = poi?.lat;
  const colorHex = (poi?.meta?.color as string | undefined) ?? '#a78bfa';

  useEffect(() => {
    if (!viewer || !isPinFocus || lon == null || lat == null) return;
    const v = viewer;
    const ds = new Cesium.CustomDataSource('pin-loot-beam');
    v.dataSources.add(ds);
    dsRef.current = ds;

    const base = Cesium.Color.fromCssColorString(colorHex);
    const core = Cesium.Color.lerp(base, Cesium.Color.WHITE, 0.55, new Cesium.Color());
    const carto = Cesium.Cartographic.fromDegrees(lon, lat);

    const t0 = performance.now();
    const sec = () => (performance.now() - t0) / 1000;

    // Terrain-aware base height — refreshed each frame so the beam settles onto
    // the ground as detailed tiles stream in.
    let groundH = v.scene.globe.getHeight(carto) ?? 0;
    const beamPositions = () => {
      const h = v.scene.globe.getHeight(carto);
      if (typeof h === 'number') groundH = h;
      return [
        Cesium.Cartesian3.fromDegrees(lon, lat, groundH),
        Cesium.Cartesian3.fromDegrees(lon, lat, groundH + BEAM_H),
      ];
    };

    const shaft = (color: Cesium.Color, baseA: number, amp: number, speed: number, width: number, glowPower: number) =>
      ds.entities.add({
        polyline: {
          positions: new Cesium.CallbackProperty(beamPositions, false),
          width,
          material: new Cesium.PolylineGlowMaterialProperty({
            color: new Cesium.CallbackProperty(
              () => color.withAlpha(Math.max(0, baseA + amp * Math.sin(sec() * speed))),
              false
            ),
            glowPower,
            taperPower: 0.72,
          }),
        },
      });

    shaft(base, 0.34, 0.10, 1.8, 42, 0.42); // soft outer halo
    shaft(core, 0.85, 0.12, 3.0, 13, 0.16); // bright inner core

    // Ground-clamped radial glow at the foot of the beam.
    ds.entities.add({
      position: Cesium.Cartesian3.fromDegrees(lon, lat),
      billboard: {
        image: GLOW_URL,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        width: 150,
        height: 150,
        color: new Cesium.CallbackProperty(
          () => base.withAlpha(Math.max(0, 0.55 + 0.14 * Math.sin(sec() * 2.4))),
          false
        ),
        scaleByDistance: new Cesium.NearFarScalar(800, 1.3, 40_000, 0.5),
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
