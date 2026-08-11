// Imagery providers for RainViewer tiles with client-side recoloring. Tiles
// are requested in raw form (color scheme 0, server smoothing off) and every
// downloaded tile is decoded → smoothed → palette-mapped before Cesium ever
// sees it. WebGL already requires these cross-origin tiles to be CORS-clean to
// texture them, so reading their pixels adds no new constraint.

import * as Cesium from 'cesium';
import type { RadarFrame } from '../../types';
import { getCloudLut, getRadarLut, type RadarPaletteId } from './palettes';
import { radarBlurPx, recolorCloudTile, recolorRadarTile } from './recolor';

// 512px tiles: fewer requests, and declaring the true tile size lets Cesium
// pick one level coarser for the same screen density — the radar data is far
// coarser than the basemap anyway.
const TILE_SIZE = 512;
// Cap requests a few levels below the basemap: RainViewer's mosaic is ~1 km
// data, so high-zoom tiles are just upscales. Letting Cesium bilinearly
// magnify our smoothed level-9 texture looks cleaner (zoom.earth's trick).
const RADAR_MAX_LEVEL = 9;
// The IR satellite mosaic is coarser still (~4 km).
const SAT_MAX_LEVEL = 6;

type Recolor = (img: HTMLImageElement | ImageBitmap, level: number) => HTMLCanvasElement;

class RecoloringImageryProvider extends Cesium.UrlTemplateImageryProvider {
  private readonly recolorTile: Recolor;

  constructor(options: Cesium.UrlTemplateImageryProvider.ConstructorOptions, recolorTile: Recolor) {
    super(options);
    this.recolorTile = recolorTile;
  }

  requestImage(
    x: number,
    y: number,
    level: number,
    request?: Cesium.Request
  ): Promise<Cesium.ImageryTypes> | undefined {
    const upstream = super.requestImage(x, y, level, request);
    if (!upstream) return undefined; // request throttled — preserve the contract
    return upstream.then((img) => {
      if (!img || !('width' in img)) return img;
      try {
        return this.recolorTile(img as HTMLImageElement | ImageBitmap, level);
      } catch (err) {
        // Raw scheme-0 tiles are dBZ-encoded grayscale — as UI they read as
        // white/gray garbage — so a failed recolor degrades to an EMPTY tile,
        // never the raw one.
        console.error('[radar] tile recolor failed — dropping tile', err);
        const blank = document.createElement('canvas');
        blank.width = img.width;
        blank.height = img.height;
        return blank;
      }
    });
  }
}

// Client recoloring inverts the palette RainViewer actually serves (the CDN
// ignores the {color} path segment — see recolor.ts) and repaints through our
// own gradients. Escape hatch: flipping this off falls back to the served
// colors directly, keeping the rest of the composition.
export const CLIENT_RECOLOR = true;

// Server-side color scheme per palette while pass-through is active.
const PASSTHROUGH_SCHEME: Record<RadarPaletteId, number> = {
  storm: 4, // The Weather Channel — closest stock scheme to the zoom.earth ramp
  classic: 4,
  blue: 2, // Universal Blue
  mono: 8, // Dark Sky
};

export function makeRadarProvider(
  host: string,
  frame: RadarFrame,
  palette: RadarPaletteId
): Cesium.ImageryProvider {
  if (!CLIENT_RECOLOR) {
    return new Cesium.UrlTemplateImageryProvider({
      // Server-colored tiles with server-side smoothing, snow folded into the
      // rain gradient.
      url: `${host}${frame.path}/${TILE_SIZE}/{z}/{x}/{y}/${PASSTHROUGH_SCHEME[palette]}/1_0.png`,
      maximumLevel: RADAR_MAX_LEVEL,
      tileWidth: TILE_SIZE,
      tileHeight: TILE_SIZE,
    });
  }
  const lut = getRadarLut(palette);
  return new RecoloringImageryProvider(
    {
      // The CDN currently serves the same palette for every color id; request
      // 2 (Universal Blue — the palette that matches what actually arrives,
      // and what the inversion anchors expect) with server smoothing on and
      // snow folded into the rain ramp, so if the parameter ever starts
      // working again the bytes stay what the inverter is calibrated for.
      url: `${host}${frame.path}/${TILE_SIZE}/{z}/{x}/{y}/2/1_0.png`,
      maximumLevel: RADAR_MAX_LEVEL,
      tileWidth: TILE_SIZE,
      tileHeight: TILE_SIZE,
    },
    (img, level) => recolorRadarTile(img, lut, radarBlurPx(level))
  );
}

export function makeCloudProvider(host: string, frame: RadarFrame): Cesium.ImageryProvider {
  const lut = getCloudLut();
  return new RecoloringImageryProvider(
    {
      // color 0 = grayscale infrared; luminance keys the cloud overlay.
      url: `${host}${frame.path}/${TILE_SIZE}/{z}/{x}/{y}/0/0_0.png`,
      maximumLevel: SAT_MAX_LEVEL,
      tileWidth: TILE_SIZE,
      tileHeight: TILE_SIZE,
    },
    (img) => recolorCloudTile(img, lut)
  );
}
