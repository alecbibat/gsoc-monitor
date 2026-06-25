import * as Cesium from 'cesium';
import { useEffect, useRef } from 'react';
import { useCesiumViewer } from '../../cesium/CesiumContext';
import { useLayersStore } from '../../store/layersStore';
import { useFuelStatus } from './fuelStore';
import {
  LANDFIRE_FBFM40_IMAGESERVER,
  LANDFIRE_CONUS_RECT,
} from './landfireService';

// Source resolution is 30 m; beyond ~16 we'd only upsample blocky pixels.
const FUEL_MAX_LEVEL = 16;
// Opacity over the dark basemap: the FBFM40 colormap is fully saturated, so
// ~0.7 keeps the fuel classes legible while terrain/labels still read through.
const FUEL_ALPHA = 0.72;

// The ImageServer has no tile cache, so each tile is a live `exportImage`
// render. We template the per-tile Web-Mercator extent into the bbox and request
// the image in the same projection (3857) so it lines up with Cesium's default
// Mercator tiling — no reprojection skew. `format=png32&transparent=true` makes
// NoData (ocean / outside CONUS) come back fully transparent instead of a solid
// box, and the server applies the FBFM40 colormap by default (no renderingRule
// or client-side recoloring needed).
function makeFuelProvider(): Cesium.UrlTemplateImageryProvider {
  return new Cesium.UrlTemplateImageryProvider({
    url:
      `${LANDFIRE_FBFM40_IMAGESERVER}/exportImage` +
      '?bbox={westProjected},{southProjected},{eastProjected},{northProjected}' +
      '&bboxSR=3857&imageSR=3857&size=256,256&format=png32&transparent=true&f=image',
    tilingScheme: new Cesium.WebMercatorTilingScheme(),
    tileWidth: 256,
    tileHeight: 256,
    maximumLevel: FUEL_MAX_LEVEL,
    // Only request tiles intersecting CONUS — everything else is transparent.
    rectangle: Cesium.Rectangle.fromDegrees(
      LANDFIRE_CONUS_RECT.west,
      LANDFIRE_CONUS_RECT.south,
      LANDFIRE_CONUS_RECT.east,
      LANDFIRE_CONUS_RECT.north
    ),
    credit: new Cesium.Credit('Fuel: LANDFIRE LF2024 FBFM40 — USGS/USFS', false),
  });
}

export function FuelLayer() {
  const viewer = useCesiumViewer();
  const active = useLayersStore((s) => s.active.fuel);
  const imgLayerRef = useRef<Cesium.ImageryLayer | null>(null);

  useEffect(() => {
    if (!viewer) return;
    const setStatus = useFuelStatus.getState().setStatus;

    // Toggle off — tear the overlay down.
    if (!active) {
      if (imgLayerRef.current) {
        viewer.imageryLayers.remove(imgLayerRef.current, true);
        imgLayerRef.current = null;
      }
      setStatus({ ready: false, error: null });
      viewer.scene.requestRender();
      return;
    }

    if (!imgLayerRef.current) {
      // Tiles are live exportImage renders fetched directly from LANDFIRE
      // (open CORS, no key). Transient per-tile failures are retried by Cesium
      // and shouldn't latch a sticky error, so we don't wire errorEvent to the
      // sidebar — same as the radar/traffic tile overlays.
      const layer = viewer.imageryLayers.addImageryProvider(makeFuelProvider());
      layer.alpha = FUEL_ALPHA;
      imgLayerRef.current = layer;
      setStatus({ ready: true, error: null });
    }
    viewer.scene.requestRender();

    return () => {
      if (imgLayerRef.current) {
        viewer.imageryLayers.remove(imgLayerRef.current, true);
        imgLayerRef.current = null;
      }
    };
  }, [viewer, active]);

  return null;
}
