import * as Cesium from 'cesium';

// The live strike-down effect: a descending blue-white bolt and a red impact
// flash, for strikes the browser's own socket sees in view. Moved out of the
// old LightningLayer unchanged; the factory owns its data source, listeners
// and RAF loop so the layer can drop it all in one destroy().

// --- Strike-down animation tuning --------------------------------------------
export const BOLT_TOP_M = 120_000; // altitude the leader descends from
const BOLT_DESCEND_MS = 150; // time for the leader to reach the ground
const BOLT_LIFE_MS = 480; // total bolt life (descend + flash-out)
// Impact flash: a fixed-size red circle that pops on the strike point and fades.
// Replaces the old expanding shockwave, whose ring was re-tessellated (49 pts)
// and re-clamped to terrain every frame for every concurrent strike — by far
// the heaviest per-frame cost in a storm. This circle's geometry is built once
// at spawn; only its alpha animates.
const RING_FLASH_MS = 550; // flash duration
const RING_FIXED_M = 12_000; // flash circle radius (constant — no expansion)
export const MAX_ANIMS = 80; // concurrent bolt animations (storm safety valve)
const hex = (s: string) => Cesium.Color.fromCssColorString(s);
const BOLT_COLOR = hex('#f2f9ff'); // blue-white bolt
const RING_COLOR = hex('#ff2a1f'); // red impact flash

// A jagged vertical path from high altitude straight down onto the strike point.
// Top and bottom are anchored on the point; the horizontal wander peaks in the
// middle so it reads as a forking bolt rather than a wobbly line.
function makeBoltPath(lon: number, lat: number): Cesium.Cartesian3[] {
  const SEGMENTS = 9;
  const pts: Cesium.Cartesian3[] = [];
  for (let i = 0; i <= SEGMENTS; i++) {
    const f = i / SEGMENTS; // 0 top -> 1 ground
    const alt = BOLT_TOP_M * (1 - f);
    const taper = Math.sin(f * Math.PI); // 0 at the ends, 1 mid-span
    const amp = 0.07 * taper; // up to ~7.7 km of horizontal wander
    const jx = i === 0 || i === SEGMENTS ? 0 : (Math.random() - 0.5) * amp;
    const jy = i === 0 || i === SEGMENTS ? 0 : (Math.random() - 0.5) * amp;
    pts.push(Cesium.Cartesian3.fromDegrees(lon + jx, lat + jy, alt));
  }
  return pts;
}

// A ground circle of `radiusM` around (lon, lat), built once per strike (not
// per frame) — the impact flash holds a constant radius, so its positions never
// need recomputing.
function circlePositions(lon: number, lat: number, radiusM: number): Cesium.Cartesian3[] {
  const N = 48;
  const dLatM = radiusM / 111_320;
  const dLonM = radiusM / (111_320 * Math.cos((lat * Math.PI) / 180));
  const pts: Cesium.Cartesian3[] = [];
  for (let i = 0; i <= N; i++) {
    const ang = (i / N) * 2 * Math.PI;
    pts.push(
      Cesium.Cartesian3.fromDegrees(lon + dLonM * Math.sin(ang), lat + dLatM * Math.cos(ang))
    );
  }
  return pts;
}

export interface BoltAnimator {
  /**
   * Can the camera see this ground point? Also the live pool's near/far test,
   * so it has to stay cheap: one horizon test and one rectangle test.
   */
  inView(lon: number, lat: number): boolean;
  /** Fire the bolt + impact flash (dropped past MAX_ANIMS). */
  spawn(lon: number, lat: number): void;
  /** Remove every bolt entity, the data source, listeners and the RAF loop. */
  destroy(): void;
}

export function createBoltAnimator(viewer: Cesium.Viewer): BoltAnimator {
  const ds = new Cesium.CustomDataSource('lightning-bolts');
  void viewer.dataSources.add(ds);

  // --- Bolt strike-down animation ------------------------------------------
  // Driven by requestAnimationFrame (not Cesium's clock) so it stays smooth in
  // the viewer's on-demand render mode. CallbackProperties pull live progress
  // from performance.now(); the loop just requests renders and reaps finished
  // bolts, and idles itself when nothing is animating.
  interface BoltAnim {
    lon: number;
    lat: number;
    path: Cesium.Cartesian3[];
    start: number;
    bolt: Cesium.Entity;
    ring: Cesium.Entity;
  }
  const anims: BoltAnim[] = [];
  let rafId: number | null = null;
  let destroyed = false;

  const boltPositions = (a: BoltAnim): Cesium.Cartesian3[] => {
    const p = Math.min(1, (performance.now() - a.start) / BOLT_DESCEND_MS);
    if (p >= 1) return a.path;
    // Reveal the path from the top down to a fractional vertex (the leader).
    const segs = a.path.length - 1;
    const fpos = p * segs;
    const idx = Math.floor(fpos);
    const out = a.path.slice(0, idx + 1);
    if (idx < segs) {
      out.push(
        Cesium.Cartesian3.lerp(a.path[idx], a.path[idx + 1], fpos - idx, new Cesium.Cartesian3())
      );
    }
    return out;
  };

  const boltColor = (a: BoltAnim): Cesium.Color => {
    const e = performance.now() - a.start;
    if (e <= BOLT_DESCEND_MS) return BOLT_COLOR;
    const k = (e - BOLT_DESCEND_MS) / (BOLT_LIFE_MS - BOLT_DESCEND_MS);
    return BOLT_COLOR.withAlpha(Math.max(0, 1 - k));
  };

  const ringFlashColor = (a: BoltAnim): Cesium.Color => {
    const p = Math.min(1, (performance.now() - a.start) / RING_FLASH_MS);
    const alpha = 0.85 * (1 - p) * (1 - p); // bright pop, then ease-out fade
    return RING_COLOR.withAlpha(Math.max(0, alpha));
  };

  const animate = () => {
    if (destroyed) return;
    const now = performance.now();
    const ttl = Math.max(BOLT_LIFE_MS, RING_FLASH_MS);
    for (let i = anims.length - 1; i >= 0; i--) {
      if (now - anims[i].start >= ttl) {
        ds.entities.remove(anims[i].bolt);
        ds.entities.remove(anims[i].ring);
        anims.splice(i, 1);
      }
    }
    if (anims.length) {
      viewer.scene.requestRender();
      rafId = requestAnimationFrame(animate);
    } else {
      rafId = null;
    }
  };

  const spawn = (lon: number, lat: number) => {
    if (destroyed || anims.length >= MAX_ANIMS) return;
    const anim = {
      lon,
      lat,
      path: makeBoltPath(lon, lat),
      start: performance.now(),
    } as BoltAnim;

    anim.bolt = ds.entities.add({
      polyline: {
        positions: new Cesium.CallbackProperty(() => boltPositions(anim), false),
        width: 3,
        material: new Cesium.PolylineGlowMaterialProperty({
          glowPower: 0.22,
          color: new Cesium.CallbackProperty(() => boltColor(anim), false),
        }),
      },
    });

    anim.ring = ds.entities.add({
      polyline: {
        // Geometry built once (constant radius); only the colour alpha animates.
        positions: circlePositions(lon, lat, RING_FIXED_M),
        width: 2,
        clampToGround: true,
        material: new Cesium.ColorMaterialProperty(
          new Cesium.CallbackProperty(() => ringFlashColor(anim), false)
        ),
      },
    });

    anims.push(anim);
    if (rafId == null) rafId = requestAnimationFrame(animate);
  };

  // The global stream delivers tens of strikes/sec worldwide. Spawning the
  // descending-bolt animation for every one keeps the RAF loop (and thus
  // full-scene rendering) running 24/7 even when every strike is on the far
  // side of the globe. Cache the camera's view rectangle and only animate
  // strikes that are actually in view — off-screen strikes still get their
  // crosshair billboard.
  let viewRect: Cesium.Rectangle | null = viewer.camera.computeViewRectangle() ?? null;
  const refreshViewRect = () => {
    viewRect = viewer.camera.computeViewRectangle() ?? null;
  };
  const offCamera = viewer.camera.changed.addEventListener(refreshViewRect);
  // changed has a 50% threshold; also refresh once the camera settles.
  const offMoveEnd = viewer.camera.moveEnd.addEventListener(refreshViewRect);
  const scratchCarto = new Cesium.Cartographic();
  // computeViewRectangle() returns Rectangle.MAX_VALUE whenever 3+ viewport
  // corners miss the globe (the whole-globe overview), so on its own it lets
  // every far-side strike through. Horizon-test the bolt's top first: if even
  // the 120 km top is below the horizon, the whole bolt and its ground flash
  // are hidden behind the globe. A sphere of the ellipsoid's minimum radius
  // sits entirely inside the globe, so it never hides a point the globe shows.
  const HORIZON_R = Cesium.Ellipsoid.WGS84.minimumRadius;
  const horizon = new Cesium.Occluder(
    new Cesium.BoundingSphere(Cesium.Cartesian3.ZERO, HORIZON_R),
    viewer.camera.positionWC
  );
  const scratchTop = new Cesium.Cartesian3();
  const inView = (lon: number, lat: number): boolean => {
    const camPos = viewer.camera.positionWC;
    // Occluder treats a camera inside the sphere as "everything hidden"; that
    // can't happen in normal navigation, but fall through to the old check if it does.
    if (Cesium.Cartesian3.magnitudeSquared(camPos) > HORIZON_R * HORIZON_R) {
      horizon.cameraPosition = camPos; // live position; camera.changed is too coarse
      Cesium.Cartesian3.fromDegrees(lon, lat, BOLT_TOP_M, Cesium.Ellipsoid.WGS84, scratchTop);
      if (!horizon.isPointVisible(scratchTop)) return false;
    }
    if (!viewRect) return true; // can't tell — keep the old behavior
    Cesium.Cartographic.fromDegrees(lon, lat, 0, scratchCarto);
    return Cesium.Rectangle.contains(viewRect, scratchCarto);
  };

  const destroy = () => {
    if (destroyed) return;
    destroyed = true;
    if (rafId != null) cancelAnimationFrame(rafId);
    rafId = null;
    offCamera();
    offMoveEnd();
    anims.length = 0;
    ds.entities.removeAll();
    if (!viewer.isDestroyed()) viewer.dataSources.remove(ds, true);
  };

  return { inView, spawn, destroy };
}
