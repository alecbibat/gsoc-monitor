import * as Cesium from 'cesium';

// RainViewer serves precipitation as small, banded, blocky PNG tiles. This
// provider intercepts each fetched tile and redraws it through a canvas blur
// (plus a touch of saturation) so the discrete reflectivity steps melt into
// soft gradient blobs — the smooth zoom.earth look — before Cesium uploads it
// as a WebGL texture.
//
// RainViewer's tiles are CORS-enabled (Cesium already textures them directly),
// so the canvas stays untainted and is safe to upload.

type Img = Cesium.ImageryTypes;

function smoothTile(image: Img, blurPx: number): Img {
  // ImageBitmap/HTMLImageElement/canvas all expose width/height.
  const w = (image as { width: number }).width || 512;
  const h = (image as { height: number }).height || 512;

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return image;

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.filter = `blur(${blurPx}px) saturate(1.12)`;

  // Overscan by the blur radius on every side. A blur samples transparent
  // pixels beyond the tile edge, which would leave a faint faded border on
  // every tile and show up as a grid of seams. Drawing the source slightly
  // larger pushes that falloff just off the visible 0..w/0..h area.
  const pad = Math.ceil(blurPx * 2);
  ctx.drawImage(image as CanvasImageSource, -pad, -pad, w + pad * 2, h + pad * 2);

  return canvas;
}

export interface SmoothImageryOptions
  extends Cesium.UrlTemplateImageryProvider.ConstructorOptions {
  /** Gaussian blur radius in tile-native pixels (default 2.5). */
  blurPx?: number;
}

export class SmoothImageryProvider extends Cesium.UrlTemplateImageryProvider {
  private readonly _blurPx: number;

  constructor(options: SmoothImageryOptions) {
    super(options);
    this._blurPx = options.blurPx ?? 2.5;
  }

  requestImage(
    x: number,
    y: number,
    level: number,
    request?: Cesium.Request
  ): Promise<Img> | undefined {
    const base = super.requestImage(x, y, level, request);
    if (!base) return base;
    const blurPx = this._blurPx;
    if (blurPx <= 0) return base; // bypass: serve the raw tile untouched
    return base.then((image) => (image ? smoothTile(image, blurPx) : image));
  }
}
