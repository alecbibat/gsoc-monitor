import * as Cesium from 'cesium';
import { useEffect, useRef } from 'react';
import { useCesiumViewer } from '../../cesium/CesiumContext';
import { useScreensaverStore } from '../../screensaver/screensaverStore';
import { shipWireframeSegments, mastCountForShip } from './ShipModel3D';
import { fleetColor, FLEET_ROSTER } from './fleet';

// Metres per model unit. The hull spans ~9 units bow-to-stern, so this yields a
// ~160 m vessel — close to the real Windstar ships and a good size for the
// ~850 m screensaver orbit.
const SCALE = 18;

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

  // Disabled: the PolylineCollection (~100 lines) is rendered every frame during
  // the dwell (requestRenderMode=false) and is the last ship-unique GPU overhead
  // that was causing black-screen crashes on weak integrated GPUs. The
  // ShipWireframe2D in ShipFocusCard already provides the spinning wireframe;
  // the in-world model can be re-enabled once the stable floor is confirmed.
  const isShipFocus = false as boolean;
  const mmsi    = poi?.meta?.mmsi as string | undefined;
  const cls     = poi?.meta?.cls as 'STAR' | 'WIND' | undefined;
  const heading = (poi?.meta?.heading as number | null | undefined) ?? 0;
  const lon = poi?.lon;
  const lat = poi?.lat;

  useEffect(() => {
    if (!viewer || !isShipFocus || !cls || lon == null || lat == null) return;
    const v = viewer;

    const fleet = mmsi ? FLEET_ROSTER.find((f) => f.mmsi === mmsi) : undefined;
    const variant = cls === 'STAR' ? 'star' : 'wind';
    const seg = shipWireframeSegments(variant, mastCountForShip(fleet?.name));
    const color = Cesium.Color.fromCssColorString(fleetColor(cls));

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
    return () => {
      if (collRef.current) { v.scene.primitives.remove(collRef.current); collRef.current = null; }
      if (restoreRef.current) { restoreRef.current(); restoreRef.current = null; }
      v.scene.requestRender();
    };
  }, [viewer, isShipFocus, mmsi, cls, heading, lon, lat]);

  return null;
}
