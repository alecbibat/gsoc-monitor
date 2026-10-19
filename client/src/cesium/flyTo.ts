import * as Cesium from 'cesium';
import type { GeocodeBias, PlaceKind } from '../types';

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

// How far above the ground to frame a place of each kind when there's no
// extent to fit (a business node, a city's centre point). Roughly Google's
// zoom for the same search.
const PLACE_RANGE_M: Record<PlaceKind | 'coordinates', number> = {
  country: 4_000_000,
  state: 1_200_000,
  county: 150_000,
  city: 30_000,
  locality: 8_000,
  street: 2_000,
  address: 1_000,
  poi: 1_000,
  other: 8_000,
  coordinates: 3_000,
};
// A fitted extent never frames tighter than a city block for a building, or
// a neighbourhood for anything else — a street comes back as one short OSM
// way, which would otherwise fill the view with a single block.
const MIN_RANGE_BUILDING_M = 800;
const MIN_RANGE_AREA_M = 1_500;
const MAX_PLACE_RANGE_M = 20_000_000;
// Breathing room around a fitted extent; the top bar and search results
// cover the top of the view.
const FIT_PADDING = 1.3;
// Close framings with world terrain on need the real ground height: the
// tiles already loaded for a far-off destination are coarse enough to be
// kilometres off in the mountains. Sampled before the flight, briefly.
const TERRAIN_SAMPLE_BELOW_M = 50_000;
const TERRAIN_SAMPLE_TIMEOUT_MS = 1_200;

export interface PlaceTarget {
  lat: number;
  lon: number;
  kind: PlaceKind | 'coordinates';
  bbox?: [number, number, number, number] | null;
}

// Bumped per flyToPlace, so a terrain sample that resolves after a newer
// search doesn't fly the camera back to the older place.
let placeFlightSeq = 0;

/**
 * Fly top-down to a search result: fit its extent when it has one, else
 * frame its point at its kind's range. Heights are measured from the ground,
 * so with world terrain on the camera doesn't end up inside a mountain town.
 */
export function flyToPlace(viewer: Cesium.Viewer, target: PlaceTarget) {
  const { camera, scene } = viewer;
  let lon = target.lon;
  let lat = target.lat;
  let range = PLACE_RANGE_M[target.kind];
  if (target.bbox) {
    const [west, south, east, north] = target.bbox;
    // Cesium's own fit for the current view's aspect and field of view.
    const fit = Cesium.Cartographic.fromCartesian(
      camera.getRectangleCameraCoordinates(Cesium.Rectangle.fromDegrees(west, south, east, north))
    );
    if (fit && Number.isFinite(fit.height)) {
      lon = Cesium.Math.toDegrees(fit.longitude);
      lat = Cesium.Math.toDegrees(fit.latitude);
      range = fit.height * FIT_PADDING;
    }
  }
  const building = target.kind === 'poi' || target.kind === 'address';
  range = Math.min(MAX_PLACE_RANGE_M, Math.max(building ? MIN_RANGE_BUILDING_M : MIN_RANGE_AREA_M, range));

  const seq = ++placeFlightSeq;
  const fly = (ground: number) => {
    if (seq !== placeFlightSeq || viewer.isDestroyed()) return;
    camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(lon, lat, Math.max(0, ground) + range),
      duration: 1.6,
    });
  };

  const carto = Cesium.Cartographic.fromDegrees(lon, lat);
  const loaded = scene.globe.getHeight(carto);
  const quick = loaded !== undefined && Number.isFinite(loaded) ? loaded : 0;
  if (viewer.terrainProvider instanceof Cesium.EllipsoidTerrainProvider || range >= TERRAIN_SAMPLE_BELOW_M) {
    fly(quick);
    return;
  }
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), TERRAIN_SAMPLE_TIMEOUT_MS));
  Promise.race([
    Cesium.sampleTerrainMostDetailed(viewer.terrainProvider, [carto]).then(([r]) => r?.height ?? null),
    timeout,
  ])
    .then((h) => fly(typeof h === 'number' && Number.isFinite(h) ? h : quick))
    .catch(() => fly(quick));
}

/** The slippy-map zoom level whose view roughly matches a camera this high. */
export function zoomForHeight(heightMeters: number): number {
  const z = Math.round(Math.log2(1.35e8 / Math.max(50, heightMeters)));
  return Math.max(0, Math.min(18, z));
}

/**
 * What the camera is looking at, as a geocoder bias: the point under the
 * centre of the view and a zoom level. Null when the whole globe is in view
 * (nothing to prefer) or the camera state is unusable.
 */
export function cameraFocus(viewer: Cesium.Viewer): GeocodeBias | null {
  const { camera, scene } = viewer;
  const height = camera.positionCartographic?.height;
  if (height === undefined || !Number.isFinite(height)) return null;
  const zoom = zoomForHeight(height);
  if (zoom <= 4) return null;
  const canvas = scene.canvas;
  const hit = camera.pickEllipsoid(
    new Cesium.Cartesian2(canvas.clientWidth / 2, canvas.clientHeight / 2),
    scene.globe.ellipsoid
  );
  // Tilted toward the horizon the centre ray can miss the globe; the point
  // under the camera is the next best thing.
  const c = hit ? Cesium.Cartographic.fromCartesian(hit) : camera.positionCartographic;
  if (!c) return null;
  return { lat: Cesium.Math.toDegrees(c.latitude), lon: Cesium.Math.toDegrees(c.longitude), zoom };
}
