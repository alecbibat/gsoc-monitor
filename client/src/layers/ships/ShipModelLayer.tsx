import * as Cesium from 'cesium';
import { useEffect, useRef } from 'react';
import { useCesiumViewer } from '../../cesium/CesiumContext';
import { useScreensaverStore } from '../../screensaver/screensaverStore';
import { mastCountForShip } from './shipMeta';
import { fleetColor, FLEET_ROSTER } from './fleet';

// Metres per model unit. The hull spans ~9 units bow-to-stern; SCALE=54 yields
// a ~490 m hull — 3x the real Windstar length, so it reads as a believable
// (if heroic) vessel that stays legible from the 15 km screensaver orbit
// without dominating the frame.
const SCALE = 54;

// Replaces the flat ship billboard with the true 3D wireframe model (the same
// geometry shown in the ship card) while the pins screensaver orbits a ship.
// The camera already orbits, so the static, heading-aligned model reads as a
// slowly-revolving 3D vessel.
export function ShipModelLayer() {
  const viewer = useCesiumViewer();
  const active = useScreensaverStore((s) => s.active);
  const mode   = useScreensaverStore((s) => s.mode);
  const poi    = useScreensaverStore((s) => s.currentPoi);

  const collRef = useRef<Cesium.PolylineCollection | null>(null);
  const restoreRef = useRef<(() => void) | null>(null);

  const isShipFocus = active && mode === 'pins' && poi?.category === 'ship';
  const mmsi    = poi?.meta?.mmsi as string | undefined;
  const cls     = poi?.meta?.cls as 'STAR' | 'WIND' | undefined;
  const heading = (poi?.meta?.heading as number | null | undefined) ?? 0;
  const lon = poi?.lon;
  const lat = poi?.lat;

  useEffect(() => {
    if (!viewer || !isShipFocus || !cls || lon == null || lat == null) return;
    const v = viewer;
    let cancelled = false;

    const fleet = mmsi ? FLEET_ROSTER.find((f) => f.mmsi === mmsi) : undefined;
    const variant = cls === 'STAR' ? 'star' : 'wind';
    const color = Cesium.Color.fromCssColorString(fleetColor(cls));

    // The segment geometry comes from the Three.js-backed module; import it on
    // demand so `three` stays out of the entry chunk. Building the entities was
    // already deferred to this effect, so the extra tick is invisible.
    import('./ShipModel3D').then(({ shipWireframeSegments }) => {
      if (cancelled) return;
      const seg = shipWireframeSegments(variant, mastCountForShip(fleet?.name));

      // East-North-Up frame at the ship, then rotate model axes into it:
      //   model +X (bow) → heading direction, +Z (starboard) → heading+90°, +Y → up
      const enu = Cesium.Transforms.eastNorthUpToFixedFrame(Cesium.Cartesian3.fromDegrees(lon, lat, 0));
      const hRad = Cesium.Math.toRadians(heading);
      const sinH = Math.sin(hRad), cosH = Math.cos(hRad);
      const toWorld = (px: number, py: number, pz: number) => {
        const east  = (px * sinH + pz * cosH) * SCALE;
        const north = (px * cosH - pz * sinH) * SCALE;
        const up    = py * SCALE;
        return Cesium.Matrix4.multiplyByPoint(enu, new Cesium.Cartesian3(east, north, up), new Cesium.Cartesian3());
      };

      const coll = new Cesium.PolylineCollection();
      const material = Cesium.Material.fromType('Color', { color });
      for (let i = 0; i + 5 < seg.length; i += 6) {
        coll.add({
          positions: [toWorld(seg[i], seg[i + 1], seg[i + 2]), toWorld(seg[i + 3], seg[i + 4], seg[i + 5])],
          width: 2,
          material,
        });
      }
      v.scene.primitives.add(coll);
      collRef.current = coll;

      // Hide the flat ship icon while the model is shown.
      const dsArr = v.dataSources.getByName('ships');
      const ent = mmsi ? dsArr[0]?.entities.getById(`ship-${mmsi}`) : undefined;
      if (ent?.billboard) {
        const prev = ent.billboard.show;
        ent.billboard.show = new Cesium.ConstantProperty(false);
        restoreRef.current = () => { if (ent.billboard) ent.billboard.show = prev ?? new Cesium.ConstantProperty(true); };
      }

      v.scene.requestRender();
    });

    return () => {
      cancelled = true;
      if (collRef.current) { v.scene.primitives.remove(collRef.current); collRef.current = null; }
      if (restoreRef.current) { restoreRef.current(); restoreRef.current = null; }
      v.scene.requestRender();
    };
  }, [viewer, isShipFocus, mmsi, cls, heading, lon, lat]);

  return null;
}
