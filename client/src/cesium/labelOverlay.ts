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

// Stack already-added layers, in the given order (first = lowest), directly
// beneath the place labels (or at the top of the stack). Moves are adjacent
// swaps, which only re-sort each tile's imagery list — nothing reloads.
export function stackBelowLabels(viewer: Cesium.Viewer, ordered: Cesium.ImageryLayer[]): void {
  const layers = viewer.imageryLayers;
  const labels = labelOverlays.get(viewer);
  const labelIdx = labels ? layers.indexOf(labels) : -1;
  // Target slots: the run of indices ending just below the labels.
  const top = labelIdx >= 0 ? labelIdx - 1 : layers.length - 1;
  const first = top - ordered.length + 1;
  const inPlace = ordered.every((l, i) => layers.indexOf(l) === first + i);
  if (inPlace) return;
  for (const layer of ordered) {
    // Carry each layer to just below the labels; the ones placed before it
    // shift down one, so the run ends in the given order. The labels' index
    // moves when a layer passes them, so re-read it every swap.
    for (let guard = layers.length * 2; guard > 0; guard--) {
      const idx = layers.indexOf(layer);
      if (idx < 0) break;
      const labelNow = labels ? layers.indexOf(labels) : -1;
      const target = labelNow >= 0 ? labelNow - 1 : layers.length - 1;
      if (idx < target) layers.raise(layer);
      else if (idx > target) layers.lower(layer);
      else break;
    }
  }
}
