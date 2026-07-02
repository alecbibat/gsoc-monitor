import * as Cesium from 'cesium';
import { useEffect } from 'react';
import { useCesiumViewer } from '../../cesium/CesiumContext';
import { useLayersStore } from '../../store/layersStore';
import { useWindStatus, acquireWindGrid } from './windStore';
import { makeSampler, speedColorHex, flowAxis } from './windProbe';

// A streamline wind field: from a camera-adaptive grid of seed points we
// integrate the interpolated flow forward into continuous glowing lines, each
// capped with a directional arrowhead. Lines are colored and weighted by speed,
// so the field's structure (jets, fronts, calm zones) reads at a glance — a
// static complement to the animated particle layer. Density and line length
// track the zoom level, so the field stays legible from globe to street.
//
// Arrowhead orientation reuses windProbe.flowAxis (billboard alignedAxis): the
// axis is the world-space surface tangent of the flow, so heads point the true
// way the wind blows under any camera heading/tilt.

const ALT_M = 3_000; // lift above the ellipsoid (matches the particle field)
const SEED_SPACING_PX = 80; // target on-screen spacing between streamline seeds
const TARGET_LEN_PX = 95; // target on-screen streamline length
const STEPS = 18; // integration steps per streamline
const MAX_LINES = 1_600; // hard cap per rebuild
const MIN_SPEED_MPS = 0.5; // skip near-calm seeds — a direction there is noise
const LAT_LIMIT = 84; // stop integrating into the polar cap

// A bold arrowhead. The billboard `color` tints the white fill to the speed
// color while the near-black outline stays dark (multiply), so heads keep a
// crisp edge on a light OR dark basemap.
const HEAD_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="44" height="44" viewBox="0 0 44 44">' +
  '<path d="M22 4 L36 30 L26 25 L26 40 L18 40 L18 25 L8 30 Z" ' +
  'fill="#ffffff" stroke="#0a1520" stroke-width="3" stroke-linejoin="round"/>' +
  '</svg>';
const HEAD_URI = `data:image/svg+xml,${encodeURIComponent(HEAD_SVG)}`;

// Precompute per-speed colors (1 m/s steps) so we don't allocate per line.
const COLOR_LUT: Cesium.Color[] = [];
function colorFor(spd: number): Cesium.Color {
  const key = Math.min(60, Math.round(spd));
  if (!COLOR_LUT[key]) COLOR_LUT[key] = Cesium.Color.fromCssColorString(speedColorHex(key));
  return COLOR_LUT[key];
}

function lineWidth(spd: number): number {
  return 2.5 + Math.min(spd, 26) * 0.16; // 2.5 → ~6.7 px
}
function headSize(spd: number): number {
  return 13 + Math.min(spd, 28) * 0.55; // 13 → ~28 px
}

type Sampler = (lon: number, lat: number, out: [number, number]) => boolean;

// Integrate one streamline forward from a seed. Returns the surface points
// (lon/lat), the flow speed/direction at the leading end (for the arrowhead),
// and the mean speed (for color/width). Uses ground-distance steps: the
// longitude step is divided by cos(lat) so a step covers a uniform distance and
// the on-screen length stays even from equator to high latitude.
interface Streamline {
  lonlat: number[]; // [lon0,lat0, lon1,lat1, ...]
  endLon: number;
  endLat: number;
  endToDeg: number;
  meanSpd: number;
}
function integrate(sample: Sampler, lon0: number, lat0: number, stepDeg: number): Streamline | null {
  const out: [number, number] = [0, 0];
  if (!sample(lon0, lat0, out)) return null;
  let spd0 = Math.hypot(out[0], out[1]);
  if (spd0 < MIN_SPEED_MPS) return null;

  const lonlat: number[] = [lon0, lat0];
  let lon = lon0;
  let lat = lat0;
  let sumSpd = 0;
  let n = 0;
  let lastU = out[0];
  let lastV = out[1];
  for (let i = 0; i < STEPS; i++) {
    if (!sample(lon, lat, out)) break;
    const u = out[0];
    const v = out[1];
    const spd = Math.hypot(u, v);
    if (spd < 1e-3) break;
    sumSpd += spd;
    n++;
    lastU = u;
    lastV = v;
    const cosLat = Math.max(0.25, Math.cos((lat * Math.PI) / 180));
    lon += ((u / spd) * stepDeg) / cosLat;
    lat += (v / spd) * stepDeg;
    if (lat > LAT_LIMIT || lat < -LAT_LIMIT) break;
    if (lon > 180) lon -= 360;
    else if (lon < -180) lon += 360;
    lonlat.push(lon, lat);
  }
  if (lonlat.length < 4) return null; // need at least a segment to draw
  return {
    lonlat,
    endLon: lon,
    endLat: lat,
    // Bearing the wind blows toward at the leading end.
    endToDeg: ((Math.atan2(lastU, lastV) * 180) / Math.PI + 360) % 360,
    meanSpd: n ? sumSpd / n : spd0,
  };
}

export function WindArrowsLayer() {
  const viewer = useCesiumViewer();
  const active = useLayersStore((s) => (s.active as Record<string, boolean>).windArrows ?? false);

  // NB: the grid is intentionally NOT an effect dependency. acquireWindGrid()
  // *sets* the grid (hydrating from cache), so depending on it would tear down
  // and re-acquire on every grid change — flip-flopping into a render loop.
  // We acquire once and rebuild via a store subscription below.
  useEffect(() => {
    if (!viewer || !active) return;
    const v = viewer;
    const release = acquireWindGrid();

    const lines = new Cesium.PolylineCollection();
    v.scene.primitives.add(lines);
    const heads = new Cesium.BillboardCollection({ scene: v.scene });
    v.scene.primitives.add(heads);

    // One shared glow Material per speed step, reused across rebuilds so we
    // don't recompile shaders every camera move. PolylineCollection batches
    // polylines by material, so sharing is also faster to draw.
    const matLut: Cesium.Material[] = [];
    const matFor = (spd: number): Cesium.Material => {
      const key = Math.min(60, Math.round(spd));
      if (!matLut[key]) {
        matLut[key] = Cesium.Material.fromType('PolylineGlow', {
          color: colorFor(key),
          glowPower: 0.22,
          taperPower: 1.0,
        });
      }
      return matLut[key];
    };

    const rebuild = () => {
      const g = useWindStatus.getState().grid;
      lines.removeAll();
      heads.removeAll();
      if (!g) {
        v.scene.requestRender();
        return;
      }
      const sample = makeSampler(g);

      // Visible extent; a horizon/tilted view can't compute one — fall back to
      // the whole covered band.
      const rect = v.camera.computeViewRectangle(v.scene.globe.ellipsoid);
      const west = rect ? Cesium.Math.toDegrees(rect.west) : -180;
      const south = Math.max(-LAT_LIMIT, rect ? Cesium.Math.toDegrees(rect.south) : -80);
      const north = Math.min(LAT_LIMIT, rect ? Cesium.Math.toDegrees(rect.north) : 80);
      const widthDeg = Math.max(
        0.001,
        rect ? Cesium.Math.toDegrees(Cesium.Rectangle.computeWidth(rect)) : 360
      );
      const latSpan = Math.max(0.001, north - south);

      const canvasH = Math.max(240, v.scene.canvas.clientHeight || 900);
      const degPerPx = latSpan / canvasH; // latitude isn't compressed on screen
      // Step/length are derived from degPerPx so a streamline is always ~the same
      // on-screen length at ANY zoom (no fixed-degree floor — that made lines run
      // off-screen when zoomed in tight). A tiny epsilon just avoids a zero step.
      const stepDeg = Math.max(1e-5, (TARGET_LEN_PX * degPerPx) / STEPS);

      // Seed spacing in latitude degrees, ~SEED_SPACING_PX apart on screen.
      let seedStep = Math.max(1e-4, SEED_SPACING_PX * degPerPx);
      // Bound total seeds (rows × columns at the equator-most row).
      const estimate = () => {
        let nn = 0;
        for (let lat = south + seedStep / 2; lat <= north; lat += seedStep) {
          const lonStep = seedStep / Math.max(0.25, Math.cos((lat * Math.PI) / 180));
          nn += Math.ceil(widthDeg / lonStep);
        }
        return nn;
      };
      while (estimate() > MAX_LINES) seedStep *= 1.3;

      let count = 0;
      for (let lat = south + seedStep / 2; lat <= north; lat += seedStep) {
        // Longitude degrees shrink by cos(lat) on screen — widen the seed step
        // so rows near the poles keep even visual density.
        const lonStep = seedStep / Math.max(0.25, Math.cos((lat * Math.PI) / 180));
        for (let x = lonStep / 2; x < widthDeg; x += lonStep) {
          let lon = west + x;
          if (lon > 180) lon -= 360;
          const sl = integrate(sample, lon, lat, stepDeg);
          if (!sl) continue;

          // Lift the streamline above the ellipsoid.
          const heights = new Array<number>(sl.lonlat.length / 2).fill(ALT_M);
          const positions = Cesium.Cartesian3.fromDegreesArrayHeights(
            flatWithHeights(sl.lonlat, heights)
          );
          lines.add({
            positions,
            width: lineWidth(sl.meanSpd),
            material: matFor(sl.meanSpd),
          });
          heads.add({
            position: Cesium.Cartesian3.fromDegrees(sl.endLon, sl.endLat, ALT_M),
            image: HEAD_URI,
            width: headSize(sl.meanSpd),
            height: headSize(sl.meanSpd),
            color: colorFor(sl.meanSpd),
            alignedAxis: flowAxis(sl.endLon, sl.endLat, sl.endToDeg),
          });
          count++;
        }
      }
      useWindStatus.getState().setStatus({ arrowCount: count });
      v.scene.requestRender();
    };

    rebuild();
    // Re-grid on every camera settle so density + length track the zoom level.
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
      v.scene.primitives.remove(lines); // destroys the collection + GPU resources
      v.scene.primitives.remove(heads);
      useWindStatus.getState().setStatus({ arrowCount: 0 });
      v.scene.requestRender();
    };
  }, [viewer, active]);

  return null;
}

// Interleave [lon,lat,...] with per-vertex heights into [lon,lat,h,...].
function flatWithHeights(lonlat: number[], heights: number[]): number[] {
  const out = new Array<number>((lonlat.length / 2) * 3);
  for (let i = 0, j = 0, k = 0; i < lonlat.length; i += 2) {
    out[k++] = lonlat[i];
    out[k++] = lonlat[i + 1];
    out[k++] = heights[j++];
  }
  return out;
}
