// RainViewer's tile scheme, shared by the imagery provider (main thread) and
// the tile worker — kept free of Cesium so the worker bundle stays small.
//
// {host}{path}/{size}/{z}/{x}/{y}/{color}/{smooth}_{snow}.png
//
// Free tier (since 2026-01-01): zoom ≤ 7 (above that the CDN answers with a
// grey "Zoom Level Not Supported" image and HTTP 200), one palette whatever
// `color` says (Universal Blue), PNG only, ~100 requests/IP/minute. A 512 px
// image of a z7 tile is ~0.6 km/px, finer than the ~1 km composite, so past
// z7 Cesium magnifies the z7 texture — the data has no more detail to give.
// Tiles are decoded back to reflectivity and repainted, so what we ask for is
// simply the data: smoothing on, snow tint on (it tells rain from snow).

export const RADAR_MAX_LEVEL = 7;
const SIZE = 512;
const COLOR = 2;
const OPTIONS = '1_1';

export function radarTileUrl(host: string, path: string, z: number | string, x: number | string, y: number | string): string {
  return `${host}${path}/${SIZE}/${z}/${x}/${y}/${COLOR}/${OPTIONS}.png`;
}
