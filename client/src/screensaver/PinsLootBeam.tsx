import * as Cesium from 'cesium';
import { useEffect, useRef } from 'react';
import { useCesiumViewer } from '../cesium/CesiumContext';
import { useScreensaverStore } from './screensaverStore';

const BEAM_H = 2600; // metres the shaft rises before the glow tapers out

// Glowing-orb sprite for the beacon's foot: white-hot centre melting into the
// group colour, bloom fading to transparent. Colour is baked into the texture
// (a white sprite tinted via billboard.color would lose the white core), so
// it's rebuilt per focused pin — one small canvas per visit.
function orbSpriteUrl(colorHex: string): string {
  const cc = Cesium.Color.fromCssColorString(colorHex);
  const rgba = (a: number) =>
    `rgba(${Math.round(cc.red * 255)},${Math.round(cc.green * 255)},${Math.round(cc.blue * 255)},${a})`;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.16, 'rgba(255,255,255,0.95)');
  g.addColorStop(0.3, rgba(0.9));
  g.addColorStop(0.55, rgba(0.35));
  g.addColorStop(1, rgba(0));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return c.toDataURL();
}

// Halo ring sprite (white; tinted via material color): one crisp thin stroke
// over a faint under-glow, draped flat on the ground around the beacon.
function haloRingUrl(): string {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const ctx = c.getContext('2d')!;
  for (const [w, a] of [
    [16, 0.18],
    [5, 1],
  ] as const) {
    ctx.strokeStyle = `rgba(255,255,255,${a})`;
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.arc(256, 256, 240, 0, Math.PI * 2);
    ctx.stroke();
  }
  return c.toDataURL();
}
const RING_URL = haloRingUrl();

// A sleek glowing "loot beam" through the focused property pin during the pins
// screensaver — a soft outer halo + bright inner core rendered as screen-space
// PolylineGlow shafts (crisp at any zoom, no chunky tube), anchored to a
// ground-clamped radial glow. The base tracks terrain height so the beam
// terminates at the surface instead of punching through it.
//
// Ships use ShipShockwave instead — HeightReference.CLAMP_TO_GROUND over open
// ocean (no terrain to clamp to at the ship's zoom level) creates a degenerate
// GPU state that causes an immediate WebGL context loss.
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

  const isFocus =
    STAGE_LOOT_BEAM_ENABLED && active && mode === 'pins' && poi?.category === 'pin';
  const lon = poi?.lon;
  const lat = poi?.lat;
  const colorHex = (poi?.meta?.color as string | undefined) ?? '#a78bfa';

  useEffect(() => {
    if (!viewer || !isFocus || lon == null || lat == null) return;
    const v = viewer;
    const ds = new Cesium.CustomDataSource('loot-beam');
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

    // Beacon styling from the approved mockup: a thin shaft that burns
    // hottest right above the orb at its foot.
    shaft(base, 0.30, 0.10, 1.8, 16, 0.42); // soft outer halo
    shaft(core, 0.85, 0.12, 3.0, 5.5, 0.14); // bright inner core

    // The glowing orb at the beam's foot: white-hot centre, colored bloom.
    // Depth test disabled so the beacon never loses its anchor into terrain.
    ds.entities.add({
      position: Cesium.Cartesian3.fromDegrees(lon, lat),
      billboard: {
        image: orbSpriteUrl(colorHex),
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        width: 64,
        height: 64,
        color: new Cesium.CallbackProperty(
          () => Cesium.Color.WHITE.withAlpha(Math.max(0, 0.9 + 0.1 * Math.sin(sec() * 2.4))),
          false
        ),
        scaleByDistance: new Cesium.NearFarScalar(800, 1.4, 40_000, 0.6),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });

    // Thin halo ring draped on the terrain around the base, breathing in
    // sync with the orb.
    ds.entities.add({
      position: Cesium.Cartesian3.fromDegrees(lon, lat),
      ellipse: {
        semiMajorAxis: 900,
        semiMinorAxis: 900,
        material: new Cesium.ImageMaterialProperty({
          image: RING_URL,
          transparent: true,
          color: new Cesium.CallbackProperty(
            () => base.withAlpha(Math.max(0, 0.5 + 0.12 * Math.sin(sec() * 2.4))),
            false
          ),
        }),
        classificationType: Cesium.ClassificationType.BOTH,
      },
    });

    v.scene.requestRender();
    return () => {
      v.dataSources.remove(ds, true);
      dsRef.current = null;
      v.scene.requestRender();
    };
  }, [viewer, isFocus, lon, lat, colorHex]);


  return null;
}
