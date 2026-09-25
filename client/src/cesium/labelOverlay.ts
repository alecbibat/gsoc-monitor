import * as Cesium from 'cesium';

// The basemap's place-label overlay, registered per viewer by CesiumGlobe, so
// opaque tile overlays (weather radar) can slot in underneath it: city names
// stay legible on top of the imagery, which itself sits above the base map.
const labelOverlays = new WeakMap<Cesium.Viewer, Cesium.ImageryLayer>();

export function setLabelOverlay(viewer: Cesium.Viewer, layer: Cesium.ImageryLayer | null): void {
  if (layer) labelOverlays.set(viewer, layer);
  else labelOverlays.delete(viewer);
}

// Insert an imagery provider just below the place labels — or on top of the
// stack when the active basemap has no label overlay.
export function addImageryBelowLabels(
  viewer: Cesium.Viewer,
  provider: Cesium.ImageryProvider
): Cesium.ImageryLayer {
  const layers = viewer.imageryLayers;
  const labels = labelOverlays.get(viewer);
  if (labels) {
    const idx = layers.indexOf(labels);
    if (idx >= 0) return layers.addImageryProvider(provider, idx);
  }
  return layers.addImageryProvider(provider);
}
