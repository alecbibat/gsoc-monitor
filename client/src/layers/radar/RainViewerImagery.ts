// Imagery providers for RainViewer tiles with client-side recoloring. Tiles
// are requested in raw form (color scheme 0, server smoothing off) and every
// downloaded tile is decoded → smoothed → palette-mapped before Cesium ever
// sees it. WebGL already requires these cross-origin tiles to be CORS-clean to
// texture them, so reading their pixels adds no new constraint.

import * as Cesium from 'cesium';
import type { RadarFrame } from '../../types';
import { radarEngine } from './engineFlag';
import { getRadarLut, type RadarPaletteId } from './palettes';
import { isForecastPath } from './nowcast/forecast';
import { radarBlurPx, recolorRadarTile } from './recolor';
import { noteTileRequested } from './visibleTiles';
import { recolorTile, workerPipelineSupported } from './worker/pool';

// 512px tiles: fewer requests, and declaring the true tile size lets Cesium
// pick one level coarser for the same screen density — the radar data is far
// coarser than the basemap anyway.
const TILE_SIZE = 512;
// The deepest level RainViewer actually serves data for. Verified against the
// live CDN (Stage 0, Aug 2026): z6 and z7 return real mosaics that differ from
// their parents, while z8, z9, z10 and z11 all return the SAME 3269-byte
// placeholder regardless of coordinates. Requesting past 7 therefore bought
// nothing but bandwidth and a placeholder image fed through the palette
// inversion. Beyond this Cesium bilinearly magnifies our smoothed level-7
// texture, which is the same trick zoom.earth leans on.
export const RADAR_MAX_LEVEL = 7;

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

// The tile path the pipeline is calibrated for. The CDN currently serves the
// same palette for every color id; request 2 (Universal Blue — the palette
// that matches what actually arrives, and what the inversion anchors expect)
// with server smoothing on and snow folded into the rain ramp, so if the
// parameter ever starts working again the bytes stay what the inverter expects.
export function radarTileUrl(
  host: string,
  frame: RadarFrame,
  z: number | string,
  x: number | string,
  y: number | string
): string {
  return `${host}${frame.path}/${TILE_SIZE}/${z}/${x}/${y}/2/1_0.png`;
}

// A tile we could not recolor renders as nothing. Raw scheme-0 bytes are
// dBZ-encoded grayscale — as UI they read as white/gray garbage over the map —
// so a failed recolor degrades to an EMPTY tile, never the raw one.
function blankTile(size = TILE_SIZE): HTMLCanvasElement {
  const blank = document.createElement('canvas');
  blank.width = size;
  blank.height = size;
  return blank;
}

// Cesium assigns `_reload` onto an imagery provider while its layer is in the
// scene (GlobeSurfaceTileProvider._onLayerAdded). Calling it rebuilds the
// layer's tile imagery in place: new skeletons are created and the OLD ones are
// freed only once the new ones are ready, so the swap never blanks. It is the
// same hook Cesium's own time-dynamic WMTS provider uses, but it is private and
// absent from the typings, hence the cast.
type Reloadable = { _reload?: () => void };

// Engine v2's radar provider. Its frame and palette are MUTABLE: pointing it at
// a new frame and calling `reload()` swaps what the layer draws without
// touching the layer itself, which is what lets two layers serve a whole
// timeline instead of one layer per frame.
//
// Tile bytes are fetched here so Cesium's RequestScheduler still governs the
// network; everything after that — decode, blur, palette LUT — happens in a
// worker that caches the decoded intensity field. Where OffscreenCanvas is
// missing the same class runs the synchronous main-thread pipeline instead, so
// the ping-pong works everywhere.
export class RadarFrameProvider extends Cesium.UrlTemplateImageryProvider {
  private readonly host: string;
  private readonly useWorker: boolean;
  private frame: RadarFrame;
  private palette: RadarPaletteId;
  private inFlight = 0;

  constructor(host: string, frame: RadarFrame, palette: RadarPaletteId) {
    super({
      // requestImage is fully overridden below; the template is what the base
      // class reports as this provider's identity.
      url: radarTileUrl(host, frame, '{z}', '{x}', '{y}'),
      maximumLevel: RADAR_MAX_LEVEL,
      tileWidth: TILE_SIZE,
      tileHeight: TILE_SIZE,
    });
    this.host = host;
    this.frame = frame;
    this.palette = palette;
    this.useWorker = workerPipelineSupported();
  }

  get framePath(): string {
    return this.frame.path;
  }

  // Tiles requested but not yet handed back. Cesium exposes no "layer ready"
  // event, so readiness is counted here (see PingPongLayers.waitForSettled).
  get pendingTiles(): number {
    return this.inFlight;
  }

  // Point at a different frame / palette. Returns whether anything changed, so
  // callers can skip a pointless reload.
  setFrame(frame: RadarFrame): boolean {
    if (this.frame.path === frame.path) return false;
    this.frame = frame;
    return true;
  }

  setPalette(palette: RadarPaletteId): boolean {
    if (this.palette === palette) return false;
    this.palette = palette;
    return true;
  }

  // Rebuild this layer's tiles from the current frame/palette.
  //
  // NB: a reload SKIPS any tile still waiting on a previous reload's
  // loaded-callback, so back-to-back reloads can leave tiles showing the older
  // frame. Callers must let one settle before issuing the next — PingPongLayers
  // serializes transitions for exactly this reason.
  reload(): void {
    (this as unknown as Reloadable)._reload?.();
  }

  requestImage(
    x: number,
    y: number,
    level: number,
    request?: Cesium.Request
  ): Promise<Cesium.ImageryTypes> | undefined {
    const frame = this.frame;
    const palette = this.palette;

    // Noted BEFORE the forecast short-circuit below. Whatever Cesium asks for
    // IS the visible tile set, whichever frame happens to be mounted — it is
    // what the prefetcher warms the other frames' copies of and what region
    // planning is built from. Skipping it for forecast frames meant that
    // parking in the forecast zone recorded nothing, the observed coordinates
    // aged out after ninety seconds, and the forecast then had no region to
    // render into and vanished.
    noteTileRequested(level, x, y);

    // A forecast frame has no bytes anywhere — it is computed from the newest
    // observation, and only the motion layer can compute it. This path renders
    // it EMPTY rather than falling back to the observation it was derived from.
    //
    // That is the whole honesty contract for the forecast zone. The tempting
    // alternative — leave the last observed frame showing underneath — puts
    // current weather on screen while the timeline reads "forecast +20 min",
    // and there is no state in which that is not a lie. Empty is legible: the
    // timeline says the forecast is unavailable and there is nothing drawn to
    // contradict it.
    if (isForecastPath(frame.path)) return Promise.resolve(blankTile());

    const url = radarTileUrl(this.host, frame, level, x, y);

    if (!this.useWorker) {
      const upstream = new Cesium.Resource({ url, request }).fetchImage({
        preferImageBitmap: true,
        flipY: true,
      });
      if (!upstream) return undefined;
      return this.track(
        upstream.then((img) => {
          if (!img || !('width' in img)) return blankTile();
          return recolorRadarTile(
            img as HTMLImageElement | ImageBitmap,
            getRadarLut(palette),
            radarBlurPx(level)
          );
        })
      );
    }

    const job = recolorTile(`${frame.path}|${level}/${x}/${y}`, level, palette, (throttled) =>
      // Cesium's own Request carries the per-server slot this tile was granted;
      // without it (the worker's cache-miss retry) a default Request issues
      // immediately, which is what that path needs.
      new Cesium.Resource(throttled ? { url, request } : { url }).fetchBlob()
    );
    // Scheduler declined the fetch — preserve the contract so Cesium retries.
    if (!job) return undefined;
    return this.track(job.bitmap);
  }

  // Count a tile as in flight until it is handed back, and never let a failure
  // escape: an imagery request that rejects or never settles leaves Cesium's
  // tile in TRANSITIONING with no retry, so radar stays missing there for the
  // rest of the session. Resolving with a transparent tile instead keeps the
  // tile's state machine moving.
  private track(work: Promise<Cesium.ImageryTypes>): Promise<Cesium.ImageryTypes> {
    this.inFlight++;
    return work
      .catch((err) => {
        console.error('[radar] tile recolor failed — dropping tile', err);
        return blankTile();
      })
      .finally(() => {
        this.inFlight--;
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
  if (radarEngine() === 'v2') return new RadarFrameProvider(host, frame, palette);
  const lut = getRadarLut(palette);
  return new RecoloringImageryProvider(
    {
      url: radarTileUrl(host, frame, '{z}', '{x}', '{y}'),
      maximumLevel: RADAR_MAX_LEVEL,
      tileWidth: TILE_SIZE,
      tileHeight: TILE_SIZE,
    },
    (img, level) => recolorRadarTile(img, lut, radarBlurPx(level))
  );
}
