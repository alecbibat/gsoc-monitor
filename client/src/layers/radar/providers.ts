// Cesium imagery providers for the radar sources, with a shared decoded-tile
// cache. Tiles are downloaded once per (frame, tile) and the processed result
// is cached, so revisiting a frame during playback/scrubbing — or rebuilding
// a layer after a settings change — repaints from memory instead of
// re-fetching and re-decoding. Combined with the immutable frame URLs both
// sources offer, this is what lets the renderer keep only ~3 live Cesium
// layers per source (current / fading / preload) instead of the old
// one-layer-per-frame stack of ~30.

import * as Cesium from 'cesium';
import { getStormLut, type RadarStyle } from './palettes';
import {
  getGlobalAnchors,
  getUsAnchors,
  globalTileTemplate,
  GLOBAL_CREDIT,
  GLOBAL_MAX_LEVEL,
  GLOBAL_TILE_SIZE,
  US_CREDIT,
  US_MAX_LEVEL,
  US_TILE_SIZE,
  usTileTemplate,
} from './sources';
import { blurPxForLevel, getInversionLut, maskTile, recolorTile } from './recolor';
import type { RadarFrame } from '../../types';

// ---------------------------------------------------------------------------
// Decoded-tile LRU cache. 256px RGBA ≈ 0.26 MB; 512px ≈ 1 MB. The cap keeps
// worst-case memory around ~120 MB while comfortably holding a full playback
// loop of visible tiles for both sources.
const tileCache = new Map<string, HTMLCanvasElement>();
const TILE_CACHE_MAX = 320;

function cacheGet(key: string): HTMLCanvasElement | undefined {
  const hit = tileCache.get(key);
  if (hit) {
    // Refresh recency (delete+set re-inserts at the end) so eviction is LRU.
    tileCache.delete(key);
    tileCache.set(key, hit);
  }
  return hit;
}

function cachePut(key: string, canvas: HTMLCanvasElement) {
  tileCache.delete(key);
  tileCache.set(key, canvas);
  if (tileCache.size > TILE_CACHE_MAX) {
    const oldest = tileCache.keys().next().value;
    if (oldest !== undefined) tileCache.delete(oldest);
  }
}

type TileProcessor = (
  img: HTMLImageElement | ImageBitmap,
  level: number,
  x: number,
  y: number
) => HTMLCanvasElement;

class ProcessingImageryProvider extends Cesium.UrlTemplateImageryProvider {
  private readonly cachePrefix: string;
  private readonly process: TileProcessor;

  constructor(
    options: Cesium.UrlTemplateImageryProvider.ConstructorOptions,
    cachePrefix: string,
    process: TileProcessor
  ) {
    super(options);
    this.cachePrefix = cachePrefix;
    this.process = process;
  }

  requestImage(
    x: number,
    y: number,
    level: number,
    request?: Cesium.Request
  ): Promise<Cesium.ImageryTypes> | undefined {
    const key = `${this.cachePrefix}|${level}/${x}/${y}`;
    const cached = cacheGet(key);
    if (cached) return Promise.resolve(cached);
    const upstream = super.requestImage(x, y, level, request);
    if (!upstream) return undefined; // request throttled — preserve the contract
    return upstream.then((img) => {
      if (!img || !('width' in img)) return img;
      try {
        const out = this.process(img as HTMLImageElement | ImageBitmap, level, x, y);
        cachePut(key, out);
        return out;
      } catch (err) {
        // The raw tiles are foreign palettes — as UI they'd read as garbage —
        // so a failed pass degrades to an EMPTY tile, never the raw one.
        console.error('[radar] tile processing failed — dropping tile', err);
        const blank = document.createElement('canvas');
        blank.width = img.width;
        blank.height = img.height;
        return blank;
      }
    });
  }
}

// ---------------------------------------------------------------------------

export function makeUsProvider(timeSec: number, style: RadarStyle): Cesium.ImageryProvider {
  const template = usTileTemplate(timeSec);
  const base: Cesium.UrlTemplateImageryProvider.ConstructorOptions = {
    url: template,
    maximumLevel: US_MAX_LEVEL,
    tileWidth: US_TILE_SIZE,
    tileHeight: US_TILE_SIZE,
    credit: new Cesium.Credit(US_CREDIT),
  };
  if (style === 'agency') return new Cesium.UrlTemplateImageryProvider(base);
  const inversion = getInversionLut(getUsAnchors());
  const lut = getStormLut();
  return new ProcessingImageryProvider(base, `us|storm|${timeSec}`, (img, level) =>
    recolorTile(img, { inversion, lut, blurPx: blurPxForLevel(level, US_MAX_LEVEL) })
  );
}

export function makeGlobalProvider(
  host: string,
  frame: RadarFrame,
  style: RadarStyle,
  maskUs: boolean
): Cesium.ImageryProvider {
  const base: Cesium.UrlTemplateImageryProvider.ConstructorOptions = {
    url: globalTileTemplate(host, frame),
    // HARD cap at the free tier's native max: above this RainViewer serves
    // tiles with "Zoom level is not supported" burned in. Cesium magnifies
    // the level-7 texture bilinearly for deeper zooms instead.
    maximumLevel: GLOBAL_MAX_LEVEL,
    tileWidth: GLOBAL_TILE_SIZE,
    tileHeight: GLOBAL_TILE_SIZE,
    credit: new Cesium.Credit(GLOBAL_CREDIT),
  };
  if (style === 'agency' && !maskUs) return new Cesium.UrlTemplateImageryProvider(base);
  if (style === 'agency') {
    return new ProcessingImageryProvider(base, `rv|agency-mask|${frame.path}`, (img, level, x, y) =>
      maskTile(img, { z: level, x, y })
    );
  }
  const inversion = getInversionLut(getGlobalAnchors());
  const lut = getStormLut();
  return new ProcessingImageryProvider(
    base,
    `rv|storm${maskUs ? '-mask' : ''}|${frame.path}`,
    (img, level, x, y) =>
      recolorTile(img, {
        inversion,
        lut,
        blurPx: blurPxForLevel(level, GLOBAL_MAX_LEVEL),
        maskUsCoverage: maskUs ? { z: level, x, y } : undefined,
      })
  );
}

// Layer alpha ceiling per style: the storm palette carries per-pixel
// translucency, so the layer runs at full strength; agency tiles are solid
// house colors, so cap the layer to keep the basemap readable underneath.
export function styleAlphaCeiling(style: RadarStyle): number {
  return style === 'storm' ? 1 : 0.82;
}
