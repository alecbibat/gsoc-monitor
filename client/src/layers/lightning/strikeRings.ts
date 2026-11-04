import * as Cesium from 'cesium';

// New-strike rings: when a strike lands in view, a ring pops out of its X,
// widens and fades — a cue that reads at any zoom. It is drawn in screen
// pixels, so it never shrinks to nothing on a whole-globe view the way a
// ground-sized circle does, and it opens wider the further out the camera is,
// where a lone X is only a speck.
//
// Each ring is three GPU points (PointPrimitiveCollection): a white ring with
// a thin dark casing on either side, so it reads over the dark basemap,
// bright cloud tops and radar colours alike. A point's outline keeps its
// pixel width at any size, and animating pixel size and colour rewrites a few
// vertex attributes — no geometry is rebuilt per frame. The points are pooled
// and reused, like the X billboards.

/** How long one ring lives. */
export const RING_LIFE_MS = 1_600;
/** Diameter (px) a ring opens to with the camera at or below NEAR_HEIGHT_M… */
export const RING_PX_NEAR = 34;
/** …and at or above FAR_HEIGHT_M. */
export const RING_PX_FAR = 64;
const NEAR_HEIGHT_M = 50_000;
const FAR_HEIGHT_M = 8_000_000;
/** A ring starts this fraction of its full size, but no smaller than the live X it rings. */
const START_FRACTION = 0.32;
const START_MIN_PX = 12;
const CORE_W = 2; // the white ring (px)
const CASING_W = 1; // each dark edge (px)

const CORE = Cesium.Color.fromCssColorString('#e6f6ff'); // the bolt's electric white
const CORE_ALPHA = 0.95;
const CASING = Cesium.Color.BLACK;
const CASING_ALPHA = 0.42;

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/**
 * The diameter a ring opens to for a camera `heightM` above the ellipsoid:
 * RING_PX_NEAR when zoomed in, RING_PX_FAR from a continent or globe away,
 * on a log scale between (zoom steps feel even).
 */
export function ringFullPx(heightM: number): number {
  const lo = Math.log(NEAR_HEIGHT_M);
  const t = clamp01((Math.log(Math.max(1, heightM)) - lo) / (Math.log(FAR_HEIGHT_M) - lo));
  return RING_PX_NEAR + t * (RING_PX_FAR - RING_PX_NEAR);
}

export interface RingFrame {
  /** Inside diameter of the white ring (px). */
  diameterPx: number;
  /** Ring opacity, 0–1 (scaled by each colour's own alpha). */
  alpha: number;
}

/**
 * The ring at `progress` (0 → 1) through its life, opening to `fullPx`: it
 * bursts out (ease-out), holds its brightness for the first third, then fades
 * away as it drifts to full size.
 */
export function ringFrame(progress: number, fullPx: number): RingFrame {
  const p = clamp01(progress);
  const startPx = Math.min(fullPx, Math.max(START_MIN_PX, START_FRACTION * fullPx));
  const grow = 1 - (1 - p) ** 3;
  return {
    diameterPx: startPx + (fullPx - startPx) * grow,
    alpha: 1 - smoothstep(0.3, 1, p),
  };
}

interface Ring {
  start: number;
  outer: Cesium.PointPrimitive;
  inner: Cesium.PointPrimitive;
  core: Cesium.PointPrimitive;
}

export interface StrikeRings {
  /** Ring a strike that just landed (the oldest ring makes way past the cap). */
  spawn(lon: number, lat: number): void;
  /** Rings on screen now. */
  readonly active: number;
  /** Remove the points, the collection and the animation loop. */
  destroy(): void;
}

export function createStrikeRings(viewer: Cesium.Viewer, cap: number): StrikeRings {
  // TRANSLUCENT: one alpha-blended pass in draw order — every ring fades, so
  // none is ever opaque. Default depth test: with depthTestAgainstTerrain off
  // the globe's depth is cleared and Cesium's horizon depth plane hides only
  // the far side, so a ring is never clipped by the ground near it and never
  // shows through the planet. Added after the X collections, so it draws
  // over them (the live X's own depth keeps the X itself on top).
  const points = new Cesium.PointPrimitiveCollection({ blendOption: Cesium.BlendOption.TRANSLUCENT });
  viewer.scene.primitives.add(points);

  const live: Ring[] = []; // oldest first: every ring lives as long, so they also end in order
  const free: Ring[] = [];
  let rafId: number | null = null;
  let destroyed = false;
  const scratchColor = new Cesium.Color(); // the setters copy it
  const scratchPos = new Cesium.Cartesian3();

  const style = (r: Ring, f: RingFrame) => {
    // The casing hugs the white ring on both sides: a point's outline is a
    // band from pixelSize/2 out to pixelSize/2 + outlineWidth.
    r.inner.pixelSize = Math.max(0, f.diameterPx - 2 * CASING_W);
    r.inner.outlineColor = CASING.withAlpha(CASING_ALPHA * f.alpha, scratchColor);
    r.core.pixelSize = f.diameterPx;
    r.core.outlineColor = CORE.withAlpha(CORE_ALPHA * f.alpha, scratchColor);
    r.outer.pixelSize = f.diameterPx + 2 * CORE_W;
    r.outer.outlineColor = CASING.withAlpha(CASING_ALPHA * f.alpha, scratchColor);
  };

  const release = (r: Ring) => {
    r.outer.show = false;
    r.inner.show = false;
    r.core.show = false;
    free.push(r);
  };

  const cameraHeight = () => viewer.camera.positionCartographic.height;

  // requestAnimationFrame rather than Cesium's clock, so it stays smooth in
  // requestRenderMode: each frame restyles the live rings and asks for a
  // render; the loop stops itself once the last ring is gone.
  const animate = () => {
    rafId = null;
    if (destroyed || viewer.isDestroyed()) return;
    const now = performance.now();
    while (live.length > 0 && now - live[0].start >= RING_LIFE_MS) release(live.shift()!);
    if (live.length === 0) {
      viewer.scene.requestRender(); // clear the last one from the screen
      return;
    }
    const fullPx = ringFullPx(cameraHeight());
    for (const r of live) style(r, ringFrame((now - r.start) / RING_LIFE_MS, fullPx));
    viewer.scene.requestRender();
    rafId = requestAnimationFrame(animate);
  };

  // Only the outlines show: every point's fill stays transparent.
  const transparent = new Cesium.Color(0, 0, 0, 0);
  const addPoint = (outlineWidth: number) =>
    points.add({ position: scratchPos, pixelSize: 0, outlineWidth, color: transparent, outlineColor: transparent });

  const spawn = (lon: number, lat: number) => {
    if (destroyed || cap <= 0) return;
    if (live.length >= cap) release(live.shift()!);
    Cesium.Cartesian3.fromDegrees(lon, lat, 0, Cesium.Ellipsoid.WGS84, scratchPos);
    let r = free.pop();
    if (r) {
      r.outer.position = scratchPos;
      r.inner.position = scratchPos;
      r.core.position = scratchPos;
    } else {
      // Added in draw order: both casings, then the white ring over them.
      r = { start: 0, outer: addPoint(CASING_W), inner: addPoint(CASING_W), core: addPoint(CORE_W) };
    }
    r.start = performance.now();
    style(r, ringFrame(0, ringFullPx(cameraHeight())));
    r.outer.show = true;
    r.inner.show = true;
    r.core.show = true;
    live.push(r);
    viewer.scene.requestRender();
    if (rafId === null) rafId = requestAnimationFrame(animate);
  };

  const destroy = () => {
    if (destroyed) return;
    destroyed = true;
    if (rafId !== null) cancelAnimationFrame(rafId);
    rafId = null;
    live.length = 0;
    free.length = 0;
    // remove() destroys the collection and its GPU buffers.
    if (!viewer.isDestroyed()) viewer.scene.primitives.remove(points);
  };

  return {
    spawn,
    get active() {
      return live.length;
    },
    destroy,
  };
}
