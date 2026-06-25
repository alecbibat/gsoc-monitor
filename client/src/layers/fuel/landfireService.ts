// LANDFIRE Product Service (LFPS) — the authoritative, public USGS host for the
// FBFM40 fuel-model raster. The service is an ArcGIS ImageServer (thematic, one
// band of S16 pixel values), open CORS (`Access-Control-Allow-Origin: *`), no
// API key required. We hit it directly from the browser — both for the colorized
// tile overlay (`exportImage`) and the zonal "draw a circle" breakdown
// (`computeHistograms`).
//
// Naming scheme: Landfire_LF<YYYY>/LF<YYYY>_FBFM40_<region>. LF2024 is the
// current stable annual CONUS product. (Do NOT use the old product-code form
// `US_240FBFM40` — those URLs are dead.)
export const LANDFIRE_FBFM40_IMAGESERVER =
  'https://lfps.usgs.gov/arcgis/rest/services/Landfire_LF2024/LF2024_FBFM40_CONUS/ImageServer';

export const LANDFIRE_VERSION_LABEL = 'LANDFIRE LF2024 FBFM40';

// Continental-US coverage of the service, in degrees — used to clip imagery
// requests so Cesium never asks for tiles outside CONUS.
export const LANDFIRE_CONUS_RECT = {
  west: -127.98,
  south: 22.77,
  east: -65.25,
  north: 51.65,
};
