import * as Cesium from 'cesium';
import { useCallback, useEffect, useRef } from 'react';
import { makePinIcon } from '../layers/locations/pinIcon';
import { useScreensaverStore } from '../screensaver/screensaverStore';

export interface SearchPinTarget {
  lat: number;
  lon: number;
  label: string;
}

// Matches the search box's focus ring (tailwind accent), so the pin reads as
// "your search", not one of the property-location groups.
const PIN_COLOR = '#3ddcff';
// WGS84's polar radius: the smaller one, so the horizon is never overstated.
const EARTH_MIN_RADIUS_M = 6_356_752;

/**
 * The pin a search drops on the place it found, like Google Maps. One at a
 * time; it stays until the next search, the search box is cleared, or the box
 * itself unmounts (the pins tour swaps the top bar out). Survives a viewer
 * rebuild (WebGL context loss) by re-adding itself.
 */
export function useSearchPin(viewer: Cesium.Viewer | null) {
  const dsRef = useRef<Cesium.CustomDataSource | null>(null);
  const targetRef = useRef<SearchPinTarget | null>(null);

  const draw = useCallback(() => {
    const ds = dsRef.current;
    if (!ds) return;
    ds.entities.removeAll();
    const t = targetRef.current;
    if (t && viewer) {
      const pin = makePinIcon(PIN_COLOR);
      // Anchored at ellipsoid height, the pin would sit under 3D buildings and
      // Google's photorealistic tiles (which write depth at real ground
      // height). So it skips the depth test anywhere short of the camera's
      // horizon — the whole visible side of the globe — and keeps it beyond,
      // where the globe must hide a far-side pin.
      const onTop = new Cesium.CallbackProperty(() => {
        const h = Math.max(0, viewer.camera.positionCartographic.height);
        return Math.sqrt(h * (h + 2 * EARTH_MIN_RADIUS_M));
      }, false);
      // Hidden while a screensaver tour runs (the search box is hidden then too).
      const show = new Cesium.CallbackProperty(() => !useScreensaverStore.getState().active, false);
      ds.entities.add({
        // Ellipsoid-anchored with the default depth test, not clamped — see
        // LocationsLayer: clamped billboards render through the far side of
        // the globe in this app.
        position: Cesium.Cartesian3.fromDegrees(t.lon, t.lat, 0),
        billboard: {
          image: pin.url,
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          width: pin.width,
          height: pin.height,
          scaleByDistance: new Cesium.NearFarScalar(600_000, 1.0, 16_000_000, 0.8),
          disableDepthTestDistance: onTop,
          show,
        },
        label: {
          text: t.label,
          font: 'bold 12px sans-serif',
          fillColor: Cesium.Color.WHITE,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          outlineWidth: 2,
          outlineColor: Cesium.Color.fromCssColorString('#0a0c10').withAlpha(0.9),
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          pixelOffset: new Cesium.Cartesian2(0, -(pin.height + 4)),
          showBackground: true,
          backgroundColor: Cesium.Color.fromCssColorString('#0a0c10').withAlpha(0.75),
          backgroundPadding: new Cesium.Cartesian2(6, 4),
          disableDepthTestDistance: onTop,
          show,
        },
      });
    }
    viewer?.scene.requestRender();
  }, [viewer]);

  useEffect(() => {
    if (!viewer) return;
    const ds = new Cesium.CustomDataSource('search-result');
    viewer.dataSources.add(ds);
    dsRef.current = ds;
    draw();
    return () => {
      dsRef.current = null;
      if (!viewer.isDestroyed()) viewer.dataSources.remove(ds, true);
    };
  }, [viewer, draw]);

  const show = useCallback(
    (target: SearchPinTarget) => {
      targetRef.current = target;
      draw();
    },
    [draw]
  );

  const clear = useCallback(() => {
    targetRef.current = null;
    draw();
  }, [draw]);

  return { show, clear };
}
