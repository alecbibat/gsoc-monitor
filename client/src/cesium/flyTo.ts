import * as Cesium from 'cesium';

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
