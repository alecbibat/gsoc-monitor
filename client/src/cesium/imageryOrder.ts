// Imagery z-order coordination between the basemap (CesiumGlobe) and data
// overlays. The place-label overlay must stay ABOVE weather imagery — radar
// blotting out city names is the fastest way to make a weather view illegible
// (zoom.earth keeps labels crisp on top of its radar for the same reason) —
// while weather sits above the base imagery.

import * as Cesium from 'cesium';

let labelOverlay: Cesium.ImageryLayer | null = null;

// CesiumGlobe registers its label overlay here whenever the basemap changes.
export function setLabelOverlay(layer: Cesium.ImageryLayer | null) {
  labelOverlay = layer;
}

// Insert an overlay just below the place labels (or on top of the stack when
// the active basemap has no label overlay).
export function addImageryBelowLabels(
  viewer: Cesium.Viewer,
  provider: Cesium.ImageryProvider
): Cesium.ImageryLayer {
  const layers = viewer.imageryLayers;
  if (labelOverlay) {
    const idx = layers.indexOf(labelOverlay);
    if (idx >= 0) return layers.addImageryProvider(provider, idx);
  }
  return layers.addImageryProvider(provider);
}

// Insert an overlay directly above the base imagery (index 1 — CesiumGlobe
// pins the basemap to the bottom of the stack). Live satellite imagery is
// opaque earth photography: inserted at the label index like the other
// overlays it would land above whatever data layer rebuilt before it and blot
// out radar echoes or QPF shading, so it gets a deterministic slot beneath
// every data overlay instead.
export function addImageryAboveBase(
  viewer: Cesium.Viewer,
  provider: Cesium.ImageryProvider
): Cesium.ImageryLayer {
  const layers = viewer.imageryLayers;
  return layers.addImageryProvider(provider, Math.min(1, layers.length));
}
