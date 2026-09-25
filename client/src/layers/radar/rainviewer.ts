import * as Cesium from 'cesium';
import type { RadarPaletteId } from './radarPalettes';
import { RADAR_MAX_LEVEL, radarTileUrl } from './radarSource';
import { TileCancelled, type RadarTileClient } from './radarTileClient';

// The globe's own credit strip is hidden, so the wording RainViewer asks for
// ("Weather data by RainViewer", linked) is shown in the radar legend.
const RADAR_CREDIT = new Cesium.Credit('Weather data by RainViewer', false);

// A frame's tile path, fixed for the life of its layer: a re-hashed frame
// gets a new key and a fresh layer (frameKeyOf in radarEngine.ts).
export interface FrameSource {
  readonly path: string;
}

export interface RadarProviderOptions {
  host: string;
  source: FrameSource;
  frameKey: string;
  palette: RadarPaletteId;
  sigma: number; // data-space smoothing, source pixels
  snow: boolean;
  // Declared tile size. 512 matches the images (full detail); each doubling
  // makes Cesium pick one level coarser for the same view — a quarter of the
  // requests and GPU memory for softer imagery.
  tileWidth: 512 | 1024 | 2048;
  client: RadarTileClient;
  // Postpone this frame's requests for now (Cesium asks again next frame).
  defer: () => boolean;
  // Whether the view still needs a tile requested at `since` (a stamp()).
  wanted: (level: number, x: number, y: number, since: RequestStamp) => boolean;
  stamp: () => RequestStamp;
}

export interface RequestStamp {
  scan: number; // the engine's readiness-scan count at request time
  at: number; // performance.now() at request time
}

export class RadarImageryProvider extends Cesium.UrlTemplateImageryProvider {
  layer: Cesium.ImageryLayer | null = null; // set once added to the globe
  private readonly radar: RadarProviderOptions;

  constructor(opts: RadarProviderOptions) {
    super({
      // Unused for fetching (requestImage below builds URLs itself); Cesium
      // just needs a template.
      url: radarTileUrl(opts.host, opts.source.path, '{z}', '{x}', '{y}'),
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
    const since = o.stamp();
    return o.client
      .requestTile(
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
        () => this.stillWanted(x, y, level, since, request)
      )
      .catch((err: unknown) => {
        // A cancelled request goes back to "not loaded" (Cesium asks again if
        // the tile returns to view) instead of failing for good.
        if (err instanceof TileCancelled && request) {
          (request as { state: number }).state = Cesium.RequestState.CANCELLED;
        }
        throw err;
      }) as Promise<Cesium.ImageryTypes>;
  }

  // Whether a request is still worth its queue slot and rate budget: Cesium
  // holds imagery for the tile (it deletes the layer's cache entry, keyed
  // [x, y, level], when the last tile using it goes; a removed layer is
  // destroyed outright) and the engine's view scans still list it. Cesium
  // never cancels imagery requests itself.
  private stillWanted(x: number, y: number, level: number, since: RequestStamp, request?: Cesium.Request): boolean {
    if ((request as { cancelled?: boolean } | undefined)?.cancelled) return false;
    const layer = this.layer;
    if (layer) {
      if (layer.isDestroyed()) return false;
      const cache = (layer as unknown as { _imageryCache?: Record<string, unknown> })._imageryCache;
      if (cache && !(JSON.stringify([x, y, level]) in cache)) return false;
    }
    return this.radar.wanted(level, x, y, since);
  }
}
