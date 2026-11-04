import * as Cesium from 'cesium';

// Add an imagery overlay (weather radar) on top of the imagery stack. Place
// names used to be a raster tile layer this had to slot in underneath; they are
// now vector primitives (placeLabels.ts) drawn over every imagery layer, so
// city names stay legible on top of the overlay wherever it goes in the stack.
export function addImageryBelowLabels(
  viewer: Cesium.Viewer,
  provider: Cesium.ImageryProvider
): Cesium.ImageryLayer {
  return viewer.imageryLayers.addImageryProvider(provider);
}
