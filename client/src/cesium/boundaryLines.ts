import * as Cesium from 'cesium';

// Vector country and state/province borders for the imagery basemaps (Dark
// Sat, Earth), whose raster tiles carry none. Natural Earth 1:10m lines,
// simplified and delta-encoded by scripts/build-boundaries.mjs and served
// with the app.
//
// Rendering: one Primitive holding two instances (provinces, then countries,
// so countries draw on top) of a hand-built PrimitiveType.LINES geometry, one
// vertex per point. That is the lightest way Cesium has to draw ~90k points
// of static line work:
//   - PolylineCollection re-derives a material id (a JSON.stringify) for
//     every polyline on every rendered frame — ~9k lines of per-frame JS —
//     and, like PolylineGeometry, spends 4 wide-line vertices (~650 bytes of
//     vertex buffer) per point: ~60 MB here, against ~5 MB for GL lines.
//   - GL lines are a constant 1 px (lineWidth > 1 is unsupported on most
//     WebGL implementations), anti-aliased by the viewer's MSAA/FXAA. Country
//     and province lines are told apart by opacity instead of width.
//   - Not pickable, so drillPick never spends a pass or a slot on a border.
// The lines sit at height 0. With globe.depthTestAgainstTerrain off, Cesium
// clears the globe's depth before drawing primitives and writes a depth plane
// through the horizon, so the lines never z-fight the imagery and lines on
// the far side of the globe stay hidden. Long straight runs (the 49th
// parallel) are densified so the chords between points hug the surface.

const DATA_URL = '/data/boundaries.json';

// Longest step, in degrees of longitude or latitude, between two points. A
// 0.5° chord sags ~60 m below the surface at its midpoint: invisible.
const DENSIFY_STEP_DEG = 0.5;

// White on dark imagery; subtle. The alpha multiplier from setAlpha scales these.
const COUNTRY_ALPHA = 0.6;
const STATE_ALPHA = 0.28;
// Province lines are clutter at whole-globe scale (every oblast, departement
// and Brazilian state at once) and only earn their place regionally, so they
// fade in with camera height: none above `far`, full strength below `near`.
const STATE_FADE_M = { near: 2_500_000, far: 7_000_000 };

export function stateLineFade(heightM: number): number {
  if (!Number.isFinite(heightM)) return 0;
  const t = (STATE_FADE_M.far - heightM) / (STATE_FADE_M.far - STATE_FADE_M.near);
  return t <= 0 ? 0 : t >= 1 ? 1 : t;
}
const COUNTRY_ID = 'boundary-lines:country';
const STATE_ID = 'boundary-lines:state';

export interface EncodedLines {
  /** Points in each line. */
  n: number[];
  /** Running integer lon/lat deltas (× scale) across all lines of the class. */
  d: number[];
}

export interface BoundaryData {
  v: number;
  scale: number;
  country: EncodedLines;
  state: EncodedLines;
}

/** Decodes one class into a flat [lon, lat, lon, lat, …] array (degrees) per line. */
export function decodeLines(enc: EncodedLines, scale: number): number[][] {
  const lines: number[][] = [];
  let x = 0;
  let y = 0;
  let i = 0;
  for (const count of enc.n) {
    const line = new Array<number>(count * 2);
    for (let p = 0; p < count; p++, i += 2) {
      x += enc.d[i];
      y += enc.d[i + 1];
      line[2 * p] = x / scale;
      line[2 * p + 1] = y / scale;
    }
    lines.push(line);
  }
  return lines;
}

/**
 * Adds points along every segment longer than `stepDeg` (in longitude or
 * latitude), interpolating linearly in lon/lat — the planar sense in which
 * the source data draws a straight segment, so a run along a parallel stays
 * on that parallel. A segment that jumps more than 180° of longitude is taken
 * the short way, across the antimeridian.
 */
export function densifyLine(line: ArrayLike<number>, stepDeg: number): number[] {
  const out: number[] = [];
  const n = line.length >> 1;
  if (n === 0) return out;
  out.push(line[0], line[1]);
  for (let p = 1; p < n; p++) {
    const lon0 = line[2 * p - 2];
    const lat0 = line[2 * p - 1];
    const lon1 = line[2 * p];
    const lat1 = line[2 * p + 1];
    let dLon = lon1 - lon0;
    if (dLon > 180) dLon -= 360;
    else if (dLon < -180) dLon += 360;
    const dLat = lat1 - lat0;
    const steps = Math.ceil(Math.max(Math.abs(dLon), Math.abs(dLat)) / stepDeg);
    for (let k = 1; k < steps; k++) {
      let lon = lon0 + (dLon * k) / steps;
      if (lon > 180) lon -= 360;
      else if (lon < -180) lon += 360;
      out.push(lon, lat0 + (dLat * k) / steps);
    }
    out.push(lon1, lat1);
  }
  return out;
}

interface PreparedLines {
  country: number[][];
  state: number[][];
}

// Fetched, decoded and densified once per page; later layers reuse it.
let prepared: Promise<PreparedLines> | null = null;

function loadLines(): Promise<PreparedLines> {
  if (!prepared) {
    prepared = fetch(DATA_URL)
      .then((resp) => {
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        return resp.json() as Promise<BoundaryData>;
      })
      .then((data) => ({
        country: decodeLines(data.country, data.scale).map((l) => densifyLine(l, DENSIFY_STEP_DEG)),
        state: decodeLines(data.state, data.scale).map((l) => densifyLine(l, DENSIFY_STEP_DEG)),
      }));
    // A failed load is retried by the next layer that asks.
    prepared.catch(() => {
      prepared = null;
    });
  }
  return prepared;
}

// One LINES geometry for every line of a class: each point becomes one
// vertex at height 0, each segment one index pair.
function buildGeometry(lines: number[][]): Cesium.Geometry | null {
  let vertexCount = 0;
  let segmentCount = 0;
  for (const l of lines) {
    const k = l.length >> 1;
    if (k < 2) continue;
    vertexCount += k;
    segmentCount += k - 1;
  }
  if (segmentCount === 0) return null;

  const positions = new Float64Array(vertexCount * 3);
  const indices = vertexCount > 65535 ? new Uint32Array(segmentCount * 2) : new Uint16Array(segmentCount * 2);
  const ellipsoid = Cesium.Ellipsoid.WGS84;
  const scratch = new Cesium.Cartesian3();
  let v = 0;
  let i = 0;
  for (const l of lines) {
    const k = l.length >> 1;
    if (k < 2) continue;
    for (let p = 0; p < k; p++) {
      Cesium.Cartesian3.fromDegrees(l[2 * p], l[2 * p + 1], 0, ellipsoid, scratch);
      positions[3 * (v + p)] = scratch.x;
      positions[3 * (v + p) + 1] = scratch.y;
      positions[3 * (v + p) + 2] = scratch.z;
      if (p > 0) {
        indices[i++] = v + p - 1;
        indices[i++] = v + p;
      }
    }
    v += k;
  }

  const attributes = new Cesium.GeometryAttributes();
  attributes.position = new Cesium.GeometryAttribute({
    componentDatatype: Cesium.ComponentDatatype.DOUBLE,
    componentsPerAttribute: 3,
    values: positions,
  });
  return new Cesium.Geometry({
    attributes,
    indices,
    primitiveType: Cesium.PrimitiveType.LINES,
    boundingSphere: Cesium.BoundingSphere.fromVertices(positions),
  });
}

function lineColor(alpha: number): Cesium.Color {
  return new Cesium.Color(1, 1, 1, alpha);
}

export interface BoundaryLinesHandle {
  setShow(show: boolean): void; // whole layer on/off
  setAlpha(alpha: number): void; // 0..1 multiplier for the fade the globe applies
  destroy(): void;
}

export function createBoundaryLines(viewer: Cesium.Viewer): BoundaryLinesHandle {
  let destroyed = false;
  let show = true;
  let alpha = 1;
  let stateFade = stateLineFade(viewer.camera.positionCartographic?.height ?? Number.POSITIVE_INFINITY);
  let primitive: Cesium.Primitive | null = null;
  // Instance colours can only be written once the primitive has been built
  // (on its first rendered frame); an alpha change before then waits here.
  let offPending: Cesium.Event.RemoveCallback | null = null;

  const live = (): Cesium.Primitive | null =>
    !destroyed && !viewer.isDestroyed() && primitive && !primitive.isDestroyed() ? primitive : null;

  const syncShow = () => {
    const p = live();
    if (!p) return;
    const visible = show && alpha > 0.001;
    if (p.show !== visible) {
      p.show = visible;
      viewer.scene.requestRender();
    }
  };

  const applyColors = () => {
    const p = live();
    if (!p) return;
    if (!p.ready) {
      if (!offPending) {
        offPending = viewer.scene.postRender.addEventListener(() => {
          const q = live();
          if (q && !q.ready) return;
          offPending?.();
          offPending = null;
          applyColors();
        });
      }
      return;
    }
    p.getGeometryInstanceAttributes(COUNTRY_ID).color = Cesium.ColorGeometryInstanceAttribute.toValue(
      lineColor(COUNTRY_ALPHA * alpha)
    );
    p.getGeometryInstanceAttributes(STATE_ID).color = Cesium.ColorGeometryInstanceAttribute.toValue(
      lineColor(STATE_ALPHA * alpha * stateFade)
    );
    viewer.scene.requestRender();
  };

  // Follow camera height for the province-line fade; only touches the GPU
  // when the fade moves by a visible step.
  const offPreRender = viewer.scene.preRender.addEventListener(() => {
    if (destroyed || !show) return;
    const f = stateLineFade(viewer.camera.positionCartographic?.height ?? Number.POSITIVE_INFINITY);
    if (Math.abs(f - stateFade) <= 0.01 && (f > 0) === (stateFade > 0)) return;
    stateFade = f;
    applyColors();
  });

  loadLines()
    .then((lines) => {
      if (destroyed || viewer.isDestroyed()) return;
      const instances: Cesium.GeometryInstance[] = [];
      const add = (id: string, geometry: Cesium.Geometry | null, base: number) => {
        if (!geometry) return;
        instances.push(
          new Cesium.GeometryInstance({
            id,
            geometry,
            attributes: { color: Cesium.ColorGeometryInstanceAttribute.fromColor(lineColor(base * alpha)) },
          })
        );
      };
      // Provinces first: one draw call, drawn in instance order, so the
      // brighter country lines land on top where the two meet.
      add(STATE_ID, buildGeometry(lines.state), STATE_ALPHA * stateFade);
      add(COUNTRY_ID, buildGeometry(lines.country), COUNTRY_ALPHA);
      if (instances.length < 2) throw new Error('boundary data is empty');

      primitive = new Cesium.Primitive({
        geometryInstances: instances,
        appearance: new Cesium.PerInstanceColorAppearance({ flat: true, translucent: true }),
        // Hand-built geometry has no worker to build it; it is combined on the
        // main thread on the first frame (tens of milliseconds, once).
        asynchronous: false,
        allowPicking: false,
        show: show && alpha > 0.001,
      });
      viewer.scene.primitives.add(primitive);
      viewer.scene.requestRender();
    })
    .catch((err: unknown) => {
      if (destroyed) return;
      console.warn('[boundaries] could not load border lines', err);
    });

  return {
    setShow(next: boolean) {
      if (next === show) return;
      show = next;
      syncShow();
    },
    setAlpha(next: number) {
      const a = Number.isFinite(next) ? Math.min(1, Math.max(0, next)) : 1;
      // Skip changes too small to see, but never one that hides or reveals the layer.
      if (Math.abs(a - alpha) <= 0.01 && a > 0.001 === alpha > 0.001) return;
      alpha = a;
      if (a > 0.001) applyColors();
      syncShow();
    },
    destroy() {
      if (destroyed) return;
      const p = live();
      destroyed = true;
      offPreRender();
      offPending?.();
      offPending = null;
      if (p) {
        // remove() destroys the primitive and its GPU resources.
        viewer.scene.primitives.remove(p);
        viewer.scene.requestRender();
      }
      primitive = null;
    },
  };
}
