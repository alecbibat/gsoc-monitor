// One imagery layer showing one warped region.
//
// The Stage A path serves the timeline as TILES: Cesium asks for z/x/y, the
// worker recolors one, and two layers ping-pong between whole frames. Motion
// cannot work that way — a warp pulls each pixel from where the echo was, which
// is routinely across a tile boundary, so it is computed over a whole region at
// once and arrives as a single image.
//
// So this layer is a single texture pinned to exactly the rectangle the region
// covers. The trick that makes it exact: a WebMercatorTilingScheme with a 1x1
// level-zero grid whose bounds are the block's own mercator corners. The block
// IS the level-zero tile, the composite IS that tile's pixels, and nothing is
// reprojected or resampled on the way to the globe.
//
// Weather goes in below the place labels, like every other radar layer.

import * as Cesium from 'cesium';
import { addImageryBelowLabels } from '../../../cesium/imageryOrder';
import type { CompositeRegion } from '../gl/composite';

// Cesium assigns `_reload` onto a provider while its layer is in the scene; see
// the note in RainViewerImagery. Same private hook, same reason.
type Reloadable = { _reload?: () => void };

// If Cesium has not asked for the tile in this long, stop waiting for it. The
// layer can legitimately go unrequested — the globe is mid-load, the region is
// off screen after a fast pan — and a motion loop that waits forever for a
// serve that is never coming would freeze rather than degrade.
//
// Deliberately generous. This is a safety valve for a serve that is NEVER
// coming, not a pacing knob: pacing comes from the real serve, and a value near
// the frame time turns a slow device into one that queues a second warp before
// the first is drawn — which is the back-to-back reload hazard above, plus
// wasted worker time. Measured at 400 ms on a software renderer with ~1.6 s
// frames, a third of all presents expired; at this value none should, and a
// device slower still degrades to one warp per second rather than thrashing.
const SERVE_TIMEOUT_MS = 2000;

function transparentPixel(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  return canvas;
}

class WarpRegionProvider extends Cesium.UrlTemplateImageryProvider {
  private bitmap: ImageBitmap | null = null;
  private onServed: (() => void) | null = null;
  // Serves that hit the timeout instead of the globe actually taking the image.
  // Worth counting rather than swallowing: if every present() times out, the
  // motion loop still reports frames while nothing reaches the screen, and that
  // looks exactly like success from the outside.
  timeouts = 0;

  constructor(scheme: Cesium.WebMercatorTilingScheme, width: number, height: number) {
    super({
      // requestImage is fully overridden; nothing is ever fetched from this.
      url: 'about:blank',
      tilingScheme: scheme,
      rectangle: scheme.rectangle,
      tileWidth: width,
      tileHeight: height,
      minimumLevel: 0,
      maximumLevel: 0,
    });
  }

  // Hand the layer a new frame of the warp. The previous bitmap is closed:
  // these are region-sized, and holding even a few is tens of megabytes.
  setBitmap(bitmap: ImageBitmap | null): void {
    this.bitmap?.close();
    this.bitmap = bitmap;
  }

  hasBitmap(): boolean {
    return this.bitmap !== null;
  }

  reload(): void {
    (this as unknown as Reloadable)._reload?.();
  }

  // Resolves once Cesium has actually taken the current bitmap — `true` for a
  // real serve, `false` when the timeout fired instead.
  //
  // A reload SKIPS any tile still waiting on a previous reload, so issuing them
  // back to back can leave the layer showing an older warp than the playhead.
  // Waiting for the serve makes the motion loop self-pacing: it renders as fast
  // as the globe will accept frames and no faster. The two outcomes must stay
  // distinguishable: a timeout means the globe never asked for the region at
  // all (off screen, renderer stalled), and treating that like success would
  // let the caller dim the tile path behind a frame nobody is drawing.
  waitForServe(): Promise<boolean> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.timeouts++;
        this.onServed = null;
        resolve(false);
      }, SERVE_TIMEOUT_MS);
      this.onServed = () => {
        clearTimeout(timer);
        this.onServed = null;
        resolve(true);
      };
    });
  }

  requestImage(): Promise<Cesium.ImageryTypes> {
    const bitmap = this.bitmap;
    this.onServed?.();
    // A region with nothing warped yet renders as nothing, never as anything
    // else — the same rule the tile path follows for a failed recolor.
    return Promise.resolve(bitmap ?? transparentPixel());
  }
}

export class WarpRegionLayer {
  private readonly viewer: Cesium.Viewer;
  private readonly provider: WarpRegionProvider;
  private readonly layer: Cesium.ImageryLayer;
  readonly region: CompositeRegion;
  private destroyed = false;
  private raf: number | null = null;

  constructor(viewer: Cesium.Viewer, region: CompositeRegion) {
    this.viewer = viewer;
    this.region = region;

    const projection = new Cesium.WebMercatorProjection();
    const sw = projection.project(Cesium.Rectangle.southwest(region.rectangle));
    const ne = projection.project(Cesium.Rectangle.northeast(region.rectangle));
    const scheme = new Cesium.WebMercatorTilingScheme({
      rectangleSouthwestInMeters: new Cesium.Cartesian2(sw.x, sw.y),
      rectangleNortheastInMeters: new Cesium.Cartesian2(ne.x, ne.y),
      numberOfLevelZeroTilesX: 1,
      numberOfLevelZeroTilesY: 1,
    });

    this.provider = new WarpRegionProvider(scheme, region.widthPx, region.heightPx);
    this.layer = addImageryBelowLabels(viewer, this.provider);
    // Starts invisible: the tile path is still showing this weather, and the
    // two must not double-expose before the handover tween runs.
    this.layer.alpha = 0;
    viewer.scene.requestRender();
  }

  get alive(): boolean {
    return !this.destroyed && !this.viewer.isDestroyed();
  }

  get showing(): boolean {
    return this.provider.hasBitmap();
  }

  get serveTimeouts(): number {
    return this.provider.timeouts;
  }

  setAlpha(alpha: number): void {
    if (!this.alive) return;
    if (this.layer.alpha === alpha) return;
    this.layer.alpha = alpha;
    this.viewer.scene.requestRender();
  }

  // Show a warped frame and resolve once the globe has taken it. Returns
  // whether the globe actually did — a `false` is the serve timeout, and the
  // caller must NOT treat it as something on screen.
  async present(bitmap: ImageBitmap): Promise<boolean> {
    if (!this.alive) {
      bitmap.close();
      return false;
    }
    this.provider.setBitmap(bitmap);
    const served = this.provider.waitForServe();
    this.provider.reload();

    // The globe only advances tile loading WHILE IT RENDERS, and
    // requestRenderMode means it will not render on its own — so drive it until
    // the image is taken, the same way PingPongLayers drives a frame to settle.
    // One requestRender after the reload is not enough: the tile's state
    // machine needs several passes to get from "reloaded" to "asked for the
    // image", and without this the serve reliably expired instead.
    let settled = false;
    const drive = () => {
      if (settled || !this.alive) {
        this.raf = null;
        return;
      }
      this.viewer.scene.requestRender();
      this.raf = requestAnimationFrame(drive);
    };
    this.raf = requestAnimationFrame(drive);

    const taken = await served;
    settled = true;
    this.cancelDrive();
    if (this.alive) this.viewer.scene.requestRender();
    return taken && this.alive;
  }

  private cancelDrive(): void {
    if (this.raf != null) cancelAnimationFrame(this.raf);
    this.raf = null;
  }

  destroy(): void {
    this.destroyed = true;
    this.cancelDrive();
    this.provider.setBitmap(null);
    if (!this.viewer.isDestroyed()) {
      this.viewer.imageryLayers.remove(this.layer, true);
      this.viewer.scene.requestRender();
    }
  }
}
