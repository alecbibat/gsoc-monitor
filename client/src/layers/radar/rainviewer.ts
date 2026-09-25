import * as Cesium from 'cesium';
import type { RadarPaletteId } from './radarPalettes';
import type { RadarTileClient } from './radarTileClient';

// RainViewer tile scheme: {host}{path}/{size}/{z}/{x}/{y}/{color}/{smooth}_{snow}.png
//
// Free tier (since 2026-01-01): zoom ≤ 7 (above that the CDN answers with a
// grey "Zoom Level Not Supported" image and HTTP 200), one palette whatever
// `color` says (Universal Blue), PNG only, ~100 requests/IP/minute. A 512 px
// image of a z7 tile is ~0.6 km/px, finer than the ~1 km composite, so past
// z7 Cesium magnifies the z7 texture — the data has no more detail to give.
// Tiles are decoded back to reflectivity and repainted (radarTileService), so
// what we ask for is simply the data: smoothing on, snow tint on (it tells
// rain from snow; our palettes paint snow their own way).
export const RADAR_MAX_LEVEL = 7;
const SIZE = 512;
const COLOR = 2;
const OPTIONS = '1_1';

export function radarTileUrl(host: string, path: string, z: number, x: number, y: number): string {
  return `${host}${path}/${SIZE}/${z}/${x}/${y}/${COLOR}/${OPTIONS}.png`;
}

// RainViewer asks for this wording with a link; the globe's own credit strip
// is hidden, so the legend card shows it too.
export const RADAR_CREDIT = new Cesium.Credit('Weather data by RainViewer', false);

// A frame's current tile path. Mutable: if RainViewer re-hashes a frame
// between manifests, later requests follow the new path.
export interface FrameSource {
  path: string;
}

export interface RadarProviderOptions {
  host: string;
  source: FrameSource;
  frameKey: string;
  palette: RadarPaletteId;
  sigma: number; // data-space smoothing, source pixels
  snow: boolean;
  // Declared tile size. 512 matches the images (full detail); 1024 makes
  // Cesium pick one level coarser for the same view — a quarter of the
  // requests and GPU memory for slightly softer imagery.
  tileWidth: 512 | 1024;
  client: RadarTileClient;
  // Postpone this frame's requests for now (Cesium asks again next frame).
  defer: () => boolean;
}

export class RadarImageryProvider extends Cesium.UrlTemplateImageryProvider {
  layer: Cesium.ImageryLayer | null = null; // set once added to the globe
  private readonly radar: RadarProviderOptions;

  constructor(opts: RadarProviderOptions) {
    super({
      // Unused for fetching (requestImage below builds URLs from the live
      // path); Cesium just needs a template.
      url: `${opts.host}${opts.source.path}/${SIZE}/{z}/{x}/{y}/${COLOR}/${OPTIONS}.png`,
      tileWidth: opts.tileWidth,
      tileHeight: opts.tileWidth,
      maximumLevel: RADAR_MAX_LEVEL,
      hasAlphaChannel: true,
      credit: RADAR_CREDIT,
    });
    this.radar = opts;
  }

  requestImage(
    x: number,
    y: number,
    level: number,
    request?: Cesium.Request
  ): Promise<Cesium.ImageryTypes> | undefined {
    const o = this.radar;
    if (o.defer()) return undefined;
    return o.client.requestTile(
      {
        frameKey: o.frameKey,
        url: radarTileUrl(o.host, o.source.path, level, x, y),
        z: level,
        x,
        y,
        palette: o.palette,
        sigma: o.sigma,
        snow: o.snow,
      },
      () => this.stillWanted(x, y, level, request)
    ) as Promise<Cesium.ImageryTypes>;
  }

  // Whether Cesium still holds imagery for this tile. It keeps live imagery
  // in the layer's cache (keyed [x, y, level]) and deletes the entry when the
  // last tile using it is dropped; a removed layer is destroyed outright.
  private stillWanted(x: number, y: number, level: number, request?: Cesium.Request): boolean {
    if ((request as { cancelled?: boolean } | undefined)?.cancelled) return false;
    const layer = this.layer;
    if (!layer) return true;
    if (layer.isDestroyed()) return false;
    const cache = (layer as unknown as { _imageryCache?: Record<string, unknown> })._imageryCache;
    return cache ? JSON.stringify([x, y, level]) in cache : true;
  }
}
