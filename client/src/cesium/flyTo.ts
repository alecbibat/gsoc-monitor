import * as Cesium from 'cesium';

// Shared "home" framing: the overview the globe opens at, and where the
// reset-camera button returns to. Keep in one place so both stay in sync.
export const HOME_VIEW = { lon: -95, lat: 38, height: 14_000_000 } as const;

export function resetCamera(viewer: Cesium.Viewer) {
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(HOME_VIEW.lon, HOME_VIEW.lat, HOME_VIEW.height),
    duration: 1.4,
  });
}

export function flyToLonLat(
  viewer: Cesium.Viewer,
  lon: number,
  lat: number,
  heightMeters = 250_000
) {
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(lon, lat, heightMeters),
    duration: 1.6,
  });
}

export function flyToBoundingBox(
  viewer: Cesium.Viewer,
  west: number,
  south: number,
  east: number,
  north: number
) {
  viewer.camera.flyTo({
    destination: Cesium.Rectangle.fromDegrees(west, south, east, north),
    duration: 1.6,
  });
}
