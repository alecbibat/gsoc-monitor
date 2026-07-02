import * as Cesium from 'cesium';
import { useEffect } from 'react';
import { useCesiumViewer } from '../../cesium/CesiumContext';
import { useLayersStore } from '../../store/layersStore';
import { useWindStatus, acquireWindGrid } from './windStore';
import { makeSampler, speedColorHex, flowAxis } from './windProbe';

// A bolder arrow than the probe HUD's — a big triangular head over a solid
// shaft, thick dark outline. The billboard `color` tints the white fill to the
// speed color while the near-black outline stays dark (multiply), so each arrow
// keeps a crisp edge and reads on a light OR dark basemap.
const BOLD_ARROW_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">' +
  '<path d="M24 2 L41 27 L31 27 L31 46 L17 46 L17 27 L7 27 Z" ' +
  'fill="#ffffff" stroke="#0a1520" stroke-width="3.4" stroke-linejoin="round" stroke-linecap="round"/>' +
  '</svg>';
const BOLD_ARROW_URI = `data:image/svg+xml,${encodeURIComponent(BOLD_ARROW_SVG)}`;

// A meteorological direction-arrow field: one oriented arrow per cell of a
// camera-adaptive grid, colored and sized by wind speed. Complements the
// particle animation — arrows give an at-a-glance directional read (and a
// static one: no GPU cost while the camera is idle), particles show flow.
//
// Orientation uses the billboard alignedAxis trick from the wind probe
// (windProbe.flowAxis): the axis is the world-space surface tangent of the
// flow, so arrows stay geographically correct under any camera heading/tilt —
// no screen-space rotation bookkeeping.

const ALT_M = 3_000; // match the particle field's lift above the ellipsoid
const PX_SPACING = 72; // target on-screen spacing — wider now that arrows are bigger
const MAX_ARROWS = 3_600; // hard cap per rebuild
const MIN_STEP_DEG = 0.35; // don't oversample far below the 5° data resolution
const MIN_SPEED_MPS = 0.6; // skip near-calm cells — a direction there is noise

// On-screen arrow size, strongly driven by wind speed so the field's structure
// (jets, fronts, calm zones) reads at a glance: a light breeze is a small mark,
// a gale is ~3.5× larger.
const SIZE_MIN = 17; // px at MIN_SPEED_MPS
const SIZE_PER_MS = 1.5; // px added per m/s
const SIZE_MAX = 62; // px cap (≈30 m/s) so storms don't blanket the view
function arrowSize(spd: number): number {
  return Math.min(SIZE_MAX, SIZE_MIN + spd * SIZE_PER_MS);
}

// Precompute the color object per ramp step of 1 m/s to avoid allocating a
// Cesium.Color for every arrow on every rebuild. Full opacity so they pop.
const COLOR_LUT: Cesium.Color[] = [];
function colorFor(spd: number): Cesium.Color {
  const key = Math.min(60, Math.round(spd));
  if (!COLOR_LUT[key]) {
    COLOR_LUT[key] = Cesium.Color.fromCssColorString(speedColorHex(key));
  }
  return COLOR_LUT[key];
}

export function WindArrowsLayer() {
  const viewer = useCesiumViewer();
  const active = useLayersStore((s) => (s.active as Record<string, boolean>).windArrows ?? false);

  // NB: `grid` is intentionally NOT an effect dependency. acquireWindGrid()
  // *sets* the grid (hydrating from cache), so depending on it would tear down
  // and re-acquire on every grid change — and the last release resets the store,
  // flip-flopping into an infinite render loop. Instead we acquire once and
  // rebuild via a store subscription below.
  useEffect(() => {
    if (!viewer || !active) return;
    const v = viewer;
    const release = acquireWindGrid();

    const billboards = new Cesium.BillboardCollection({ scene: v.scene });
    v.scene.primitives.add(billboards);

    const out: [number, number] = [0, 0];

    const rebuild = () => {
      const g = useWindStatus.getState().grid;
      billboards.removeAll();
      if (!g) {
        v.scene.requestRender();
        return;
      }
      const sample = makeSampler(g);

      // Visible extent; a horizon/tilted view can't compute one — fall back to
      // the whole covered band at the grid's native 5° spacing.
      const rect = v.camera.computeViewRectangle(v.scene.globe.ellipsoid);
      const west = rect ? Cesium.Math.toDegrees(rect.west) : -180;
      const south = Math.max(-80, rect ? Cesium.Math.toDegrees(rect.south) : -80);
      const north = Math.min(80, rect ? Cesium.Math.toDegrees(rect.north) : 80);
      const widthDeg = rect ? Cesium.Math.toDegrees(Cesium.Rectangle.computeWidth(rect)) : 360;

      // Pick a step that lands arrows ~PX_SPACING apart on screen.
      const canvasW = Math.max(320, v.scene.canvas.clientWidth || 1280);
      let step = rect ? Math.max(MIN_STEP_DEG, widthDeg / Math.max(4, canvasW / PX_SPACING)) : 5;

      // Bound the total count: rows × (columns at the equator-most row).
      const estimate = () => {
        let n = 0;
        for (let lat = south + step / 2; lat <= north; lat += step) {
          const lonStep = step / Math.max(0.25, Math.cos((lat * Math.PI) / 180));
          n += Math.ceil(widthDeg / lonStep);
        }
        return n;
      };
      while (estimate() > MAX_ARROWS) step *= 1.3;

      let count = 0;
      for (let lat = south + step / 2; lat <= north; lat += step) {
        // Longitude degrees shrink by cos(lat) on screen — widen the step so
        // rows near the poles keep the same visual density instead of crowding.
        const lonStep = step / Math.max(0.25, Math.cos((lat * Math.PI) / 180));
        for (let x = lonStep / 2; x < widthDeg; x += lonStep) {
          let lon = west + x;
          if (lon > 180) lon -= 360;
          if (!sample(lon, lat, out)) continue;
          const spd = Math.hypot(out[0], out[1]);
          if (spd < MIN_SPEED_MPS) continue;
          const toDeg = ((Math.atan2(out[0], out[1]) * 180) / Math.PI + 360) % 360;
          const size = arrowSize(spd);
          billboards.add({
            position: Cesium.Cartesian3.fromDegrees(lon, lat, ALT_M),
            image: BOLD_ARROW_URI,
            width: size,
            height: size,
            color: colorFor(spd),
            alignedAxis: flowAxis(lon, lat, toDeg),
            // Default depth test so arrows on the far side stay behind the globe.
          });
          count++;
        }
      }
      useWindStatus.getState().setStatus({ arrowCount: count });
      v.scene.requestRender();
    };

    rebuild();
    // Re-grid on every camera settle so density tracks the zoom level.
    const offMove = v.camera.moveEnd.addEventListener(rebuild);
    // Rebuild when the grid changes (first load, background refresh) — only when
    // the grid reference actually changes, not on every arrowCount write.
    let lastGrid = useWindStatus.getState().grid;
    const unsub = useWindStatus.subscribe((s) => {
      if (s.grid !== lastGrid) {
        lastGrid = s.grid;
        rebuild();
      }
    });

    return () => {
      offMove();
      unsub();
      release();
      v.scene.primitives.remove(billboards);
      useWindStatus.getState().setStatus({ arrowCount: 0 });
      v.scene.requestRender();
    };
  }, [viewer, active]);

  return null;
}
