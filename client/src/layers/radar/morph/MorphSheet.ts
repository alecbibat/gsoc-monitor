// The morph sheet: a globe-draped rectangle whose material warps two radar
// mosaics along an estimated motion field and blends them by playback time —
// zoom.earth-style continuous morphing, impossible with static imagery-layer
// textures. A second, slightly raised sheet re-draws the basemap's place
// labels so they stay legible above the animating radar (matching the
// imagery pipeline's labels-above-weather ordering).

import * as Cesium from 'cesium';
import type { MosaicExtent } from './mosaic';
import { mosaicWindow } from './mosaic';

// Samples both mosaics in canvas space (u right, v DOWN from the north edge),
// converting the geometry's geographic st to web-mercator v first. Textures
// upload with flipY, hence the 1-v at sampling. A feature crossing position q
// at time t originated at q − d·t in frame A and lands at q + d·(1−t) in B.
const MORPH_SOURCE = `
czm_material czm_getMaterial(czm_materialInput materialInput)
{
  czm_material m = czm_getDefaultMaterial(materialInput);
  vec2 st = materialInput.st;
  float lat = latS + st.y * latSpan;
  float mv = 0.5 * (1.0 - log(tan(lat) + 1.0 / cos(lat)) / czm_pi);
  float cv = (mv - v0) / (v1 - v0);
  float cu = st.x;
  if (cv < 0.0 || cv > 1.0) { m.alpha = 0.0; return m; }
  vec2 flow = texture(flowTex, vec2(cu, 1.0 - cv)).rg;
  vec2 d = (flow - vec2(0.5)) * 2.0 * vec2(maxDispU, maxDispV);
  vec2 pA = vec2(cu - d.x * t, cv - d.y * t);
  vec2 pB = vec2(cu + d.x * (1.0 - t), cv + d.y * (1.0 - t));
  vec4 a = texture(imageA, vec2(pA.x, 1.0 - pA.y));
  vec4 b = texture(imageB, vec2(pB.x, 1.0 - pB.y));
  vec3 pm = mix(a.rgb * a.a, b.rgb * b.a, t);
  float al = mix(a.a, b.a, t);
  m.diffuse = al > 0.001 ? pm / al : vec3(0.0);
  m.alpha = al * opacity;
  return m;
}
`;

function neutralFlowCanvas(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = 1;
  const ctx = c.getContext('2d');
  if (ctx) {
    ctx.fillStyle = 'rgb(128,128,128)';
    ctx.fillRect(0, 0, 1, 1);
  }
  return c;
}

function blankCanvas(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = 1;
  return c;
}

function makeMaterial(): Cesium.Material {
  return new Cesium.Material({
    fabric: {
      // No `type` — anonymous fabric avoids registering in the global
      // material cache (we create several instances with different state).
      uniforms: {
        imageA: blankCanvas(),
        imageB: blankCanvas(),
        flowTex: neutralFlowCanvas(),
        t: 0,
        opacity: 1,
        latS: 0,
        latSpan: 1,
        v0: 0,
        v1: 1,
        maxDispU: 0,
        maxDispV: 0,
      },
      source: MORPH_SOURCE,
    },
  });
}

function makePrimitive(
  rectangle: Cesium.Rectangle,
  material: Cesium.Material,
  height: number
): Cesium.Primitive {
  return new Cesium.Primitive({
    geometryInstances: new Cesium.GeometryInstance({
      geometry: new Cesium.RectangleGeometry({
        rectangle,
        height,
        vertexFormat: Cesium.EllipsoidSurfaceAppearance.VERTEX_FORMAT,
        granularity: Cesium.Math.toRadians(0.5),
      }),
    }),
    appearance: new Cesium.EllipsoidSurfaceAppearance({
      material,
      flat: true,
      translucent: true,
      aboveGround: false,
    }),
    asynchronous: false,
    allowPicking: false,
  });
}

export class MorphSheet {
  private readonly scene: Cesium.Scene;
  private radarMaterial: Cesium.Material;
  private labelMaterial: Cesium.Material;
  private radarPrimitive: Cesium.Primitive | null = null;
  private labelPrimitive: Cesium.Primitive | null = null;
  private extent: MosaicExtent | null = null;
  private visible = false;

  constructor(scene: Cesium.Scene) {
    this.scene = scene;
    this.radarMaterial = makeMaterial();
    this.labelMaterial = makeMaterial();
  }

  setExtent(extent: MosaicExtent) {
    this.extent = extent;
    const rectangle = new Cesium.Rectangle(extent.west, extent.south, extent.east, extent.north);
    const win = mosaicWindow(extent);
    for (const mat of [this.radarMaterial, this.labelMaterial]) {
      mat.uniforms.latS = extent.south;
      mat.uniforms.latSpan = extent.north - extent.south;
      mat.uniforms.v0 = win.v0;
      mat.uniforms.v1 = win.v1;
    }
    this.removePrimitives();
    // Labels stay above the radar via insertion order (with OIT enabled the
    // translucent commands are weighted-blended, and in the sorted fallback
    // co-located spheres keep insertion order); the 40 m offset only breaks
    // the exact co-planarity. If strict label-over-radar compositing ever
    // matters, fold the label texture into the radar material instead.
    this.radarPrimitive = makePrimitive(rectangle, this.radarMaterial, 0);
    this.labelPrimitive = makePrimitive(rectangle, this.labelMaterial, 40);
    this.radarPrimitive.show = this.visible;
    this.labelPrimitive.show = false; // until labels are supplied
    this.scene.primitives.add(this.radarPrimitive);
    this.scene.primitives.add(this.labelPrimitive);
  }

  // The mosaic canvases for the active pair plus the flow between them.
  setPair(a: HTMLCanvasElement, b: HTMLCanvasElement, flow: HTMLCanvasElement, maxDispPx: number) {
    const u = this.radarMaterial.uniforms;
    u.imageA = a;
    u.imageB = b;
    u.flowTex = flow;
    u.maxDispU = a.width > 0 ? maxDispPx / a.width : 0;
    u.maxDispV = a.height > 0 ? maxDispPx / a.height : 0;
  }

  setT(t: number) {
    this.radarMaterial.uniforms.t = Math.max(0, Math.min(1, t));
  }

  setOpacity(o: number) {
    this.radarMaterial.uniforms.opacity = o;
  }

  setLabels(canvas: HTMLCanvasElement | null, alpha: number) {
    if (!this.labelPrimitive) return;
    if (!canvas) {
      this.labelPrimitive.show = false;
      return;
    }
    const u = this.labelMaterial.uniforms;
    // Only imageA — with t=0 the mix never reads imageB, which stays the 1×1
    // blank; assigning the label canvas to both would upload two full-size
    // copies of the same texture.
    u.imageA = canvas;
    u.t = 0;
    u.opacity = alpha;
    this.labelPrimitive.show = this.visible && alpha > 0.001;
  }

  setLabelAlpha(alpha: number) {
    if (!this.labelPrimitive) return;
    this.labelMaterial.uniforms.opacity = alpha;
    this.labelPrimitive.show = this.visible && alpha > 0.001;
  }

  get shown(): boolean {
    return this.visible;
  }

  get currentExtent(): MosaicExtent | null {
    return this.extent;
  }

  show(v: boolean) {
    this.visible = v;
    if (this.radarPrimitive) this.radarPrimitive.show = v;
    if (this.labelPrimitive) {
      this.labelPrimitive.show = v && (this.labelMaterial.uniforms.opacity as number) > 0.001;
    }
  }

  private removePrimitives() {
    const sceneAlive = !this.scene.isDestroyed();
    if (this.radarPrimitive) {
      if (sceneAlive) this.scene.primitives.remove(this.radarPrimitive);
      this.radarPrimitive = null;
    }
    if (this.labelPrimitive) {
      if (sceneAlive) this.scene.primitives.remove(this.labelPrimitive);
      this.labelPrimitive = null;
    }
  }

  destroy() {
    this.removePrimitives();
    // Removing a primitive does NOT release its appearance's material —
    // without an explicit destroy, imageA/imageB/flow textures (up to ~16MB
    // of VRAM each) leak on every unmount, compounding on kiosks that toggle
    // layers on a schedule. A destroyed scene has already released them.
    if (!this.scene.isDestroyed()) {
      this.radarMaterial.destroy();
      this.labelMaterial.destroy();
    }
  }
}
