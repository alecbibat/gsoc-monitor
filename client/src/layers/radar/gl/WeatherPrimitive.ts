// A draped rectangle carrying the weather material.
//
// `EllipsoidSurfaceAppearance` conforms the geometry to the globe (and to
// terrain) without needing a height, so this is a real drape rather than a
// floating quad. The primitive is rebuilt whenever the composited region
// changes and only its uniforms move otherwise — rebuilding a Primitive costs a
// geometry upload and a shader re-derive, so per-frame rebuilds would swamp any
// win the GPU path offers.

import * as Cesium from 'cesium';
import type { RadarPaletteId } from '../palettes';
import { buildComposite, planRegion, regionKey, type CompositeRegion } from './composite';
import { buildLutBitmap, createWeatherMaterial } from './WeatherMaterial';

// Cesium uploads a material's texture on the next `Material.update`, so a
// bitmap handed over cannot be closed immediately. Retiring after this many
// rendered frames is comfortably past the upload without holding CPU copies of
// 4096-square images around.
const RETIRE_AFTER_FRAMES = 3;

export interface WeatherPrimitiveStats {
  regionKey: string | null;
  compositePixels: number;
  /** Bytes of GPU texture the two composites plus the LUT currently occupy. */
  textureBytes: number;
  compositesBuilt: number;
  /** Frame swaps that reused the outgoing B composite as the new A. */
  compositesReused: number;
  /** Fraction of the composited block the field cache could fill, 0-1. */
  coverage: number;
  bitmapsRetired: number;
  bitmapsOutstanding: number;
  lastBuildMs: number;
}

export class WeatherPrimitive {
  private readonly viewer: Cesium.Viewer;
  private readonly material: Cesium.Material;
  private primitive: Cesium.Primitive | null = null;
  private region: CompositeRegion | null = null;
  private destroyed = false;

  // Bitmaps handed to the material, with the frame count at handover.
  private retiring: Array<{ bitmap: ImageBitmap; at: number }> = [];
  private frameCount = 0;
  private readonly stopPostRender: Cesium.Event.RemoveCallback;

  private framePaths: [string | null, string | null] = [null, null];
  private building = false;
  private stats: WeatherPrimitiveStats = {
    regionKey: null,
    compositePixels: 0,
    textureBytes: 0,
    compositesBuilt: 0,
    compositesReused: 0,
    coverage: 0,
    bitmapsRetired: 0,
    bitmapsOutstanding: 0,
    lastBuildMs: 0,
  };

  constructor(viewer: Cesium.Viewer, palette: RadarPaletteId) {
    this.viewer = viewer;
    this.material = createWeatherMaterial();
    void this.setPalette(palette);
    this.stopPostRender = viewer.scene.postRender.addEventListener(() => {
      this.frameCount++;
      this.drainRetired();
    });
  }

  // Enough of the block is decoded for the primitive to stand in for the
  // imagery path. Below this it would punch a hole in the radar instead.
  get hasContent(): boolean {
    return this.stats.coverage >= 0.6;
  }

  get snapshot(): WeatherPrimitiveStats {
    return { ...this.stats, bitmapsOutstanding: this.retiring.length };
  }

  // A context loss destroys the viewer BEFORE React runs the cleanup that
  // calls destroy(), so `this.destroyed` alone cannot guard an async
  // continuation — the viewer must be consulted too.
  private gone(): boolean {
    return this.destroyed || this.viewer.isDestroyed();
  }

  async setPalette(palette: RadarPaletteId): Promise<void> {
    const lut = await buildLutBitmap(palette);
    if (this.gone()) {
      lut.close();
      return;
    }
    this.handOver('lut', lut);
    this.viewer.scene.requestRender();
  }

  setAlpha(alpha: number): void {
    this.material.uniforms.alphaScale = alpha;
    this.viewer.scene.requestRender();
  }

  setBlend(t: number): void {
    this.material.uniforms.blend = Math.max(0, Math.min(1, t));
    this.viewer.scene.requestRender();
  }

  get show(): boolean {
    return this.primitive?.show ?? false;
  }

  setShow(show: boolean): void {
    if (this.primitive) {
      this.primitive.show = show;
      this.viewer.scene.requestRender();
    }
  }

  // Point the primitive at a pair of frames, recompositing if the view has
  // moved enough to need a different tile block.
  async update(frameA: string, frameB: string, maxLevel: number): Promise<void> {
    if (this.destroyed || this.building) return;
    const plan = planRegion(this.viewer, maxLevel);
    if (!plan) return;

    const sameRegion = this.region && regionKey(this.region) === regionKey(plan);
    const sameFrames = this.framePaths[0] === frameA && this.framePaths[1] === frameB;
    if (sameRegion && sameFrames) return;

    this.building = true;
    const started = performance.now();
    try {
      // Advancing the playhead by one turns the old frameB into the new
      // frameA, so only ONE composite is genuinely new per step. Rebuilding
      // both would double the most expensive operation on this path for nothing.
      const promoteB = sameRegion && this.framePaths[1] === frameA;
      const [built, bBuilt] = await Promise.all([
        promoteB ? Promise.resolve(null) : buildComposite(plan, frameA),
        buildComposite(plan, frameB),
      ]);
      const a = built?.bitmap ?? null;
      const b = bBuilt.bitmap;
      if (this.gone()) {
        a?.close();
        b.close();
        return;
      }
      // What fraction of the block the field cache could actually fill. The
      // spike must not hide the imagery path behind an empty texture, so the
      // caller checks this before dimming anything.
      this.stats.coverage = Math.min(built?.coverage ?? 1, bBuilt.coverage);

      const uniformsNow = this.material.uniforms as Record<string, unknown>;
      const previousA = uniformsNow.frameA;
      const previousB = uniformsNow.frameB;
      // The outgoing A is always finished with. The outgoing B is only finished
      // with when it is NOT being promoted into the A slot — retiring a bitmap
      // that is still a live uniform would close it out from under the upload.
      uniformsNow.frameA = a ?? previousB;
      uniformsNow.frameB = b;
      this.retire(previousA);
      if (a) this.retire(previousB);
      else this.stats.compositesReused++;
      this.framePaths = [frameA, frameB];

      const uniforms = this.material.uniforms as Record<string, unknown>;
      uniforms.south = plan.rectangle.south;
      uniforms.north = plan.rectangle.north;
      uniforms.mercSouth = plan.mercSouth;
      uniforms.mercNorth = plan.mercNorth;

      if (!sameRegion) this.rebuildGeometry(plan);
      this.region = plan;

      this.stats.regionKey = regionKey(plan);
      this.stats.compositePixels = plan.widthPx * plan.heightPx;
      // Two composites plus the 256x1 LUT, all RGBA8.
      this.stats.textureBytes = plan.widthPx * plan.heightPx * 4 * 2 + 256 * 4;
      this.stats.compositesBuilt += promoteB ? 1 : 2;
      this.stats.lastBuildMs = Math.round(performance.now() - started);
      this.viewer.scene.requestRender();
    } finally {
      this.building = false;
    }
  }

  private rebuildGeometry(plan: CompositeRegion): void {
    const previous = this.primitive;
    this.primitive = new Cesium.Primitive({
      geometryInstances: new Cesium.GeometryInstance({
        geometry: new Cesium.RectangleGeometry({
          rectangle: plan.rectangle,
          vertexFormat: Cesium.EllipsoidSurfaceAppearance.VERTEX_FORMAT,
        }),
      }),
      appearance: new Cesium.EllipsoidSurfaceAppearance({
        material: this.material,
        translucent: true,
        // The drape follows the ellipsoid rather than sitting above it, which
        // is what keeps it correct at every altitude and latitude.
        aboveGround: false,
      }),
      asynchronous: false,
    });
    // The first build starts HIDDEN. setShow is a no-op while there is no
    // primitive yet, so the spike's usable/coverage gate has always run before
    // this and its "not yet" answer must not be overruled by a default —
    // showing an unvetted first composite double-draws the same echo over
    // undimmed tiles.
    this.primitive.show = previous?.show ?? false;
    this.viewer.scene.primitives.add(this.primitive);
    if (previous) this.viewer.scene.primitives.remove(previous);
  }

  // Give a bitmap to the material and schedule the one it replaced for closing.
  // Cesium destroys the old GPU texture itself, only once the new one has
  // uploaded, so the leak risk here is the CPU-side ImageBitmap rather than the
  // texture.
  private handOver(uniform: 'frameA' | 'frameB' | 'lut', bitmap: ImageBitmap): void {
    const uniforms = this.material.uniforms as Record<string, unknown>;
    const previous = uniforms[uniform];
    uniforms[uniform] = bitmap;
    this.retire(previous);
  }

  // Schedule a bitmap for closing a few rendered frames from now. Closing it
  // immediately would pull the pixels out from under an upload that has not
  // happened yet; never closing it leaks a full-size CPU image per keyframe.
  private retire(value: unknown): void {
    if (value instanceof ImageBitmap) {
      this.retiring.push({ bitmap: value, at: this.frameCount });
    }
  }

  private drainRetired(): void {
    if (this.retiring.length === 0) return;
    const keep: typeof this.retiring = [];
    for (const entry of this.retiring) {
      if (this.frameCount - entry.at >= RETIRE_AFTER_FRAMES) {
        entry.bitmap.close();
        this.stats.bitmapsRetired++;
      } else {
        keep.push(entry);
      }
    }
    this.retiring = keep;
  }

  destroy(): void {
    this.destroyed = true;
    this.stopPostRender();
    for (const entry of this.retiring) entry.bitmap.close();
    this.retiring = [];
    const uniforms = this.material.uniforms as Record<string, unknown>;
    for (const key of ['frameA', 'frameB', 'lut'] as const) {
      const value = uniforms[key];
      if (value instanceof ImageBitmap) value.close();
    }
    if (!this.viewer.isDestroyed()) {
      if (this.primitive) this.viewer.scene.primitives.remove(this.primitive);
      this.viewer.scene.requestRender();
    }
    this.primitive = null;
  }
}
