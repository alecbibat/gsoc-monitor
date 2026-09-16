import * as Cesium from 'cesium';
import type { RadarFrame } from '../../types';

// RainViewer tile scheme: {host}{path}/{size}/{z}/{x}/{y}/{color}/{smooth}_{snow}.png
//
// The free tier serves ONE fixed palette whatever `color` says (verified
// 2026-09: every scheme id returns byte-identical tiles), so the tiles are
// used exactly as served — nothing is repainted client-side, and the legend
// (radarPalette.ts) is sampled from live tiles. Smoothing is the one option
// the CDN honors.
const TILE_SIZE = 512;
const COLOR_SCHEME = 2; // "Universal Blue" — the palette the CDN actually serves
const OPTIONS = '1_1'; // smoothing on, snow tint on
// RainViewer's mosaic is ~1 km data: past this level the tiles are plain
// upscales, so let Cesium magnify the cached level instead of requesting more.
const MAX_LEVEL = 9;

export function radarTileUrl(host: string, frame: RadarFrame): string {
  return `${host}${frame.path}/${TILE_SIZE}/{z}/{x}/{y}/${COLOR_SCHEME}/${OPTIONS}.png`;
}

export function makeRadarProvider(host: string, frame: RadarFrame): Cesium.ImageryProvider {
  return new Cesium.UrlTemplateImageryProvider({
    url: radarTileUrl(host, frame),
    tileWidth: TILE_SIZE,
    tileHeight: TILE_SIZE,
    maximumLevel: MAX_LEVEL,
    credit: new Cesium.Credit('Radar: RainViewer', false),
  });
}
