import * as Cesium from 'cesium';
import { useEffect, useRef } from 'react';
import { useCesiumViewer } from '../../cesium/CesiumContext';
import { useLayersStore } from '../../store/layersStore';
import { usePrecipStore, QPF_LAYER } from './precipStore';

// NOAA Weather Prediction Center QPF — an ArcGIS MapServer of forecast
// precipitation-accumulation polygons over CONUS, updated 2×/day (06Z & 18Z).
const WPC_QPF_MAPSERVER =
  'https://mapservices.weather.noaa.gov/vector/rest/services/precip/wpc_qpf/MapServer';

// Service coverage (CONUS) — clip imagery requests so Cesium never asks the
// MapServer for tiles outside it (everything else renders transparent anyway).
const QPF_CONUS_RECT = { west: -132, south: 20, east: -59, north: 57 };
// QPF is a coarse national product; past ~9 we'd only render the same polygons
// across many more live `export` calls for no extra detail.
const QPF_MAX_LEVEL = 9;

// Each tile is a live `export` render. We template the per-tile Web-Mercator
// extent into bbox and request the image in the same projection (3857) so it
// lines up with Cesium's default Mercator tiling — no reprojection skew.
// `layers=show:<id>` picks the accumulation window; `transparent=true&png32`
// makes everything outside the QPF polygons fully transparent.
function makeQpfProvider(layerId: number): Cesium.UrlTemplateImageryProvider {
  return new Cesium.UrlTemplateImageryProvider({
    url:
      `${WPC_QPF_MAPSERVER}/export` +
      '?bbox={westProjected},{southProjected},{eastProjected},{northProjected}' +
      `&bboxSR=3857&imageSR=3857&size=256,256&dpi=96&layers=show:${layerId}` +
      '&format=png32&transparent=true&f=image',
    tilingScheme: new Cesium.WebMercatorTilingScheme(),
    tileWidth: 256,
    tileHeight: 256,
    maximumLevel: QPF_MAX_LEVEL,
    rectangle: Cesium.Rectangle.fromDegrees(
      QPF_CONUS_RECT.west,
      QPF_CONUS_RECT.south,
      QPF_CONUS_RECT.east,
      QPF_CONUS_RECT.north,
    ),
    credit: new Cesium.Credit('Precip: NOAA/WPC Quantitative Precipitation Forecast', false),
  });
}

export function PrecipLayer() {
  const viewer = useCesiumViewer();
  const active = useLayersStore((s) => s.active.precip);
  const period = usePrecipStore((s) => s.period);
  const opacity = usePrecipStore((s) => s.opacity);
  const layerRef = useRef<Cesium.ImageryLayer | null>(null);

  // Rebuild the overlay when it toggles on or the accumulation window changes
  // (each window is a different MapServer sublayer). Tiles are live `export`
  // renders hit directly from the browser (open CORS, no key); transient
  // per-tile failures are retried by Cesium, so we don't latch a sidebar error.
  useEffect(() => {
    if (!viewer) return;
    if (layerRef.current) {
      viewer.imageryLayers.remove(layerRef.current, true);
      layerRef.current = null;
    }
    if (active) {
      const layer = viewer.imageryLayers.addImageryProvider(makeQpfProvider(QPF_LAYER[period]));
      layer.alpha = opacity;
      layerRef.current = layer;
    }
    viewer.scene.requestRender();
    return () => {
      if (layerRef.current) {
        viewer.imageryLayers.remove(layerRef.current, true);
        layerRef.current = null;
      }
    };
    // opacity is intentionally excluded — it's applied live below without a rebuild.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewer, active, period]);

  // Opacity changes adjust the live layer's alpha without tearing down tiles.
  useEffect(() => {
    if (!viewer || !layerRef.current) return;
    layerRef.current.alpha = opacity;
    viewer.scene.requestRender();
  }, [viewer, opacity]);

  return null;
}
