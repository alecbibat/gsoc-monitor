import * as Cesium from 'cesium';
import { LIGHTNING_STAGES, X_ICON_DATA_URI } from './lightningPalette';

// Strike Xs are raw BillboardCollection billboards, not entities: entity
// billboards are re-synced by BillboardVisualizer on every clock tick (every
// rAF, even when requestRenderMode skips the draw) — ~1.5–2 ms/frame for a few
// thousand strikes, far worse for a 16k-mark field. A primitive collection is
// only touched when a frame renders.
//
// Retired billboards are hidden and reused (as EntityCluster does) rather than
// removed: add/remove rebuild the whole vertex array; show/position/color only
// rewrite that one billboard. So each pool only ever grows to its peak and a
// refresh never clears and re-adds.

// Per-stage colour, built once. The icon is drawn white and tinted by this
// (its dark casing stays dark under any tint).
const STAGE_COLORS: readonly Cesium.Color[] = LIGHTNING_STAGES.map((s) =>
  Cesium.Color.fromCssColorString(s.hex).withAlpha(s.alpha)
);
// Slightly smaller from far out so a whole-globe view of thousands of marks
// reads as a field rather than a smear; full size once zoomed to a region.
const SCALE_BY_DISTANCE = new Cesium.NearFarScalar(5.0e6, 1.0, 2.5e7, 0.75);

const scratchPos = new Cesium.Cartesian3(); // Billboard setters/ctor clone it

/** Point `bb` at (lon, lat) in `stage`'s colour, size and altitude lift. */
export function styleX(bb: Cesium.Billboard, lon: number, lat: number, stage: number): void {
  const st = LIGHTNING_STAGES[stage];
  // The lift is per stage, so a newer X sits a few metres above an older one
  // on the same spot and wins the depth test. Sub-pixel at any real distance.
  bb.position = Cesium.Cartesian3.fromDegrees(lon, lat, st.liftM, Cesium.Ellipsoid.WGS84, scratchPos);
  bb.color = STAGE_COLORS[stage];
  bb.width = st.sizePx;
  bb.height = st.sizePx;
}

export class XBillboardPool {
  private readonly free: Cesium.Billboard[] = [];

  constructor(private readonly bbs: Cesium.BillboardCollection) {}

  /** A billboard styled for `stage` at (lon, lat), reusing a hidden one when there is one. */
  acquire(lon: number, lat: number, stage: number, show = true): Cesium.Billboard {
    let bb = this.free.pop();
    if (bb) {
      styleX(bb, lon, lat, stage);
    } else {
      const st = LIGHTNING_STAGES[stage];
      // Default depth test (disableDepthTestDistance = 0) so strikes on the
      // far side of the planet are correctly hidden behind the globe.
      bb = this.bbs.add({
        position: Cesium.Cartesian3.fromDegrees(lon, lat, st.liftM, Cesium.Ellipsoid.WGS84, scratchPos),
        image: X_ICON_DATA_URI,
        width: st.sizePx,
        height: st.sizePx,
        color: STAGE_COLORS[stage],
        scaleByDistance: SCALE_BY_DISTANCE,
      });
    }
    bb.show = show;
    return bb;
  }

  /** Hide and keep for reuse. */
  release(bb: Cesium.Billboard): void {
    bb.show = false;
    this.free.push(bb);
  }
}
