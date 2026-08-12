// Imagery providers for the live GeoColor mosaic. Tiles come straight from
// NASA GIBS (public, keyless, CORS-enabled) — the server only supplies the
// frame timestamps (see /api/goes), never the image bytes.

import * as Cesium from 'cesium';
import type { GoesSat } from './goesStore';

// GIBS serves the geostationary GeoColor layers on the Web-Mercator
// GoogleMapsCompatible_Level8 matrix (256px tiles, levels 0–8 ≈ the imagery's
// ~1 km native resolution). Capping at 8 lets Cesium bilinearly magnify the
// deepest texture on closer zooms instead of requesting non-existent levels.
const GIBS_MAX_LEVEL = 8;

// 'YYYY-MM-DDTHH:MM:SSZ' — GIBS subdaily REST time values carry no
// milliseconds and must match a published 10-minute scan time exactly.
export function gibsTime(sec: number): string {
  return new Date(sec * 1000).toISOString().replace('.000Z', 'Z');
}

// One immutable provider per (satellite slice, scan time). The timestamp is
// baked into the URL — GIBS tiles for a fixed time never change, so replayed
// loop frames come straight from the browser cache.
export function makeGoesProvider(sat: GoesSat, timeSec: number): Cesium.ImageryProvider {
  return new Cesium.UrlTemplateImageryProvider({
    url:
      `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${sat.gibsLayer}` +
      `/default/${gibsTime(timeSec)}/GoogleMapsCompatible_Level8/{z}/{y}/{x}.png`,
    tilingScheme: new Cesium.WebMercatorTilingScheme(),
    tileWidth: 256,
    tileHeight: 256,
    maximumLevel: GIBS_MAX_LEVEL,
    // Only request tiles inside this satellite's mosaic slice; outside it the
    // neighboring satellite (or nothing, in the Meteosat gap) owns the pixels.
    rectangle: Cesium.Rectangle.fromDegrees(sat.west, sat.south, sat.east, sat.north),
    credit: new Cesium.Credit('Satellite: NOAA GOES / JMA Himawari GeoColor via NASA GIBS', false),
  });
}
