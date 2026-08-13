// Dense pyramidal Lucas-Kanade over radar intensity fields.
//
// This is the measurement Stage C's motion rests on: how far, and in what
// direction, the echo moved between two frames. Ten minutes of storm travel is
// 6-15 km — 10-25 px at regional zoom — and displacements that large are why a
// crossfade reads as a blink rather than movement. A dissolve shows the old cell
// fading while a new one appears beside it; a warp carries the pixels across.
//
// Radar is an unusually kind subject for LK: the field is smooth, band-limited
// and already blurred by the decode pipeline, so the brightness-constancy
// assumption holds far better than it does on natural imagery. It is also an
// unusually cruel one in the other direction — most of the frame is empty, and
// empty regions carry no gradient at all, so the aperture problem is everywhere.
// The confidence-weighted smoothing below is what carries motion from the parts
// of the field that can see it into the parts that cannot.
//
// Pure typed arrays, no DOM, no dependencies — the plan explicitly rules out
// pulling in 8 MB of opencv.js for one function.

export interface Plane {
  width: number;
  height: number;
  /** Intensity, any scale; only gradients matter. */
  data: Float32Array;
}

export interface FlowField {
  cols: number;
  rows: number;
  /** Displacement per frame pair, in pixels of the plane LK ran on. */
  u: Float32Array;
  v: Float32Array;
  /** Per-cell reliability, 0-1. Low means the field had nothing to track. */
  confidence: Float32Array;
}

export interface LkOptions {
  /** Pyramid levels. Each doubles the displacement the search can reach. */
  levels?: number;
  /** Gauss-Newton iterations per level. */
  iterations?: number;
  /** Half-width of the correlation window, in pixels. */
  window?: number;
  cols?: number;
  rows?: number;
  /**
   * Displacement ceiling in level-0 pixels. Radar cells travel 10-25 px per
   * 10-minute frame at regional zoom; anything far beyond that is a mis-match,
   * not a storm.
   */
  maxDisplacement?: number;
  /** Tikhonov term, relative to the window's mean squared gradient. */
  regularization?: number;
  /** How strongly neighbouring cells pull on an unreliable one, 0-1. */
  smoothing?: number;
}

const DEFAULTS = {
  levels: 3,
  iterations: 4,
  window: 6,
  cols: 32,
  rows: 32,
  maxDisplacement: 40,
  regularization: 0.05,
  smoothing: 0.6,
} satisfies Required<LkOptions>;

// --- plane helpers -----------------------------------------------------------

export function planeFrom(
  data: Uint8Array | Float32Array,
  width: number,
  height: number
): Plane {
  const out = new Float32Array(width * height);
  for (let i = 0; i < out.length; i++) out[i] = data[i];
  return { width, height, data: out };
}

// 2x2 box reduction. Box rather than a proper Gaussian pyramid because the
// input is already blurred in data space by the decode pipeline, so the extra
// smoothing would only cost detail LK needs.
function halve(src: Plane): Plane {
  const w = Math.max(1, src.width >> 1);
  const h = Math.max(1, src.height >> 1);
  const data = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.min(src.height - 1, y * 2);
    const y1 = Math.min(src.height - 1, y * 2 + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.min(src.width - 1, x * 2);
      const x1 = Math.min(src.width - 1, x * 2 + 1);
      data[y * w + x] =
        (src.data[y0 * src.width + x0] +
          src.data[y0 * src.width + x1] +
          src.data[y1 * src.width + x0] +
          src.data[y1 * src.width + x1]) *
        0.25;
    }
  }
  return { width: w, height: h, data };
}

// Integer box downsample to fit a budget, so LK runs on a few hundred pixels a
// side no matter how large the composited region is. Cost scales with area, and
// the flow field is coarse anyway.
export function downsampleToFit(src: Plane, maxSide: number): Plane {
  let out = src;
  while (Math.max(out.width, out.height) > maxSide && out.width > 8 && out.height > 8) {
    out = halve(out);
  }
  return out;
}

function sampleBilinear(p: Plane, x: number, y: number): number {
  const { width: w, height: h, data } = p;
  const cx = x < 0 ? 0 : x > w - 1 ? w - 1 : x;
  const cy = y < 0 ? 0 : y > h - 1 ? h - 1 : y;
  const x0 = Math.floor(cx);
  const y0 = Math.floor(cy);
  const x1 = x0 + 1 > w - 1 ? w - 1 : x0 + 1;
  const y1 = y0 + 1 > h - 1 ? h - 1 : y0 + 1;
  const fx = cx - x0;
  const fy = cy - y0;
  const a = data[y0 * w + x0];
  const b = data[y0 * w + x1];
  const c = data[y1 * w + x0];
  const d = data[y1 * w + x1];
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

// --- the solver --------------------------------------------------------------

export function computeFlow(aPlane: Plane, bPlane: Plane, options: LkOptions = {}): FlowField {
  const opt = { ...DEFAULTS, ...options };
  const cols = Math.max(2, opt.cols);
  const rows = Math.max(2, opt.rows);
  const cells = cols * rows;

  const u = new Float32Array(cells);
  const v = new Float32Array(cells);
  const confidence = new Float32Array(cells);

  // Coarsest first: each level up doubles the displacement reachable by a
  // window of the same size, which is the whole point of the pyramid.
  const pyramidA: Plane[] = [aPlane];
  const pyramidB: Plane[] = [bPlane];
  for (let l = 1; l < opt.levels; l++) {
    pyramidA.push(halve(pyramidA[l - 1]));
    pyramidB.push(halve(pyramidB[l - 1]));
  }

  const du = new Float32Array(cells);
  const dv = new Float32Array(cells);

  // Window scratch, reused across every cell and level.
  const wn = (2 * opt.window + 1) ** 2;
  const winA = new Float32Array(wn);
  const winB = new Float32Array(wn);
  const winIx = new Float32Array(wn);
  const winIy = new Float32Array(wn);

  for (let level = opt.levels - 1; level >= 0; level--) {
    const A = pyramidA[level];
    const B = pyramidB[level];
    // A's gradients do not depend on the flow, so they are computed once per
    // level rather than re-differenced inside every iteration of every cell.
    const { gx: gradX, gy: gradY } = gradients(A);
    const scale = 1 / (1 << level);
    // Flow carries down the pyramid in that level's own pixel units.
    if (level < opt.levels - 1) {
      for (let i = 0; i < cells; i++) {
        u[i] *= 2;
        v[i] *= 2;
      }
    }
    const maxAtLevel = opt.maxDisplacement * scale;

    for (let iter = 0; iter < opt.iterations; iter++) {
      for (let gy = 0; gy < rows; gy++) {
        for (let gx = 0; gx < cols; gx++) {
          const i = gy * cols + gx;
          // Cell centres snap to whole pixels so the reference frame and its
          // gradients are direct array reads; only B is sampled at a fractional
          // offset. The flow grid is far coarser than a pixel anyway.
          const cx = Math.min(A.width - 1, Math.round(((gx + 0.5) / cols) * A.width));
          const cy = Math.min(A.height - 1, Math.round(((gy + 0.5) / rows) * A.height));

          // Gather the window once, tracking each frame's mean and energy.
          let sumA = 0;
          let sumB = 0;
          let k = 0;
          for (let wy = -opt.window; wy <= opt.window; wy++) {
            const sy = clampInt(cy + wy, A.height);
            const row = sy * A.width;
            for (let wx = -opt.window; wx <= opt.window; wx++, k++) {
              const sx = clampInt(cx + wx, A.width);
              const ia = A.data[row + sx];
              const ib = sampleBilinear(B, cx + wx + u[i], cy + wy + v[i]);
              winA[k] = ia;
              winB[k] = ib;
              winIx[k] = gradX[row + sx];
              winIy[k] = gradY[row + sx];
              sumA += ia;
              sumB += ib;
            }
          }

          const n = wn;
          const meanA = sumA / n;
          const meanB = sumB / n;
          let varA = 0;
          let varB = 0;
          for (let j = 0; j < n; j++) {
            varA += (winA[j] - meanA) ** 2;
            varB += (winB[j] - meanB) ** 2;
          }
          // Normalising each window to zero mean and matched energy makes the
          // solve invariant to the echo simply getting brighter or fainter.
          // Without it, a cell intensifying in place violates brightness
          // constancy and LK reports the change as spurious outward motion —
          // exactly the growth/decay artifact the plan flags as a Stage C risk.
          const gain = varB > 1e-6 ? Math.sqrt(varA / varB) : 1;

          let gxx = 0;
          let gxy = 0;
          let gyy = 0;
          let bx = 0;
          let by = 0;
          for (let j = 0; j < n; j++) {
            const ix = winIx[j];
            const iy = winIy[j];
            const it = (winB[j] - meanB) * gain - (winA[j] - meanA);
            gxx += ix * ix;
            gxy += ix * iy;
            gyy += iy * iy;
            bx += ix * it;
            by += iy * it;
          }
          // Regularize relative to how much gradient this window actually has,
          // so the same constant behaves sensibly on a faint drizzle field and
          // on a convective core.
          const lambda = opt.regularization * ((gxx + gyy) / n + 1e-6);
          const a11 = gxx + lambda * n;
          const a22 = gyy + lambda * n;
          const det = a11 * a22 - gxy * gxy;

          // Smallest eigenvalue of the structure tensor is the classic
          // "is there anything to track here" measure: large means the window
          // has gradient in two directions, near zero means flat or a single
          // edge (the aperture problem).
          const trace = gxx + gyy;
          const disc = Math.sqrt(Math.max(0, trace * trace - 4 * (gxx * gyy - gxy * gxy)));
          const minEig = (trace - disc) / 2 / n;
          confidence[i] = minEig / (minEig + 1);

          if (det > 1e-12) {
            let stepU = (-a22 * bx + gxy * by) / det;
            let stepV = (gxy * bx - a11 * by) / det;
            // A single Gauss-Newton step should not leap further than the
            // window can see, or the iteration walks off into noise.
            const step = Math.hypot(stepU, stepV);
            const cap = opt.window;
            if (step > cap) {
              stepU = (stepU / step) * cap;
              stepV = (stepV / step) * cap;
            }
            du[i] = stepU;
            dv[i] = stepV;
          } else {
            du[i] = 0;
            dv[i] = 0;
          }
        }
      }

      for (let i = 0; i < cells; i++) {
        u[i] = clamp(u[i] + du[i], -maxAtLevel, maxAtLevel);
        v[i] = clamp(v[i] + dv[i], -maxAtLevel, maxAtLevel);
      }

      // Let confident cells pull their neighbours. Most of a radar frame is
      // empty and has no gradient to solve from; without this the flow field is
      // motion inside the storms and zeros everywhere else, and the warp tears
      // along the boundary.
      smoothByConfidence(u, v, confidence, cols, rows, opt.smoothing);
    }

    // Median filter last: LK produces the occasional wild cell where two
    // unrelated echoes line up, and a median removes it without softening the
    // genuine field the way another blur would.
    medianFilter3(u, cols, rows);
    medianFilter3(v, cols, rows);
  }

  return { cols, rows, u, v, confidence };
}

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

function clampInt(x: number, size: number): number {
  return x < 0 ? 0 : x >= size ? size - 1 : x;
}

// Central-difference gradients with edge clamping, one pass per pyramid level.
function gradients(p: Plane): { gx: Float32Array; gy: Float32Array } {
  const { width: w, height: h, data } = p;
  const gx = new Float32Array(w * h);
  const gy = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    const up = clampInt(y - 1, h) * w;
    const down = clampInt(y + 1, h) * w;
    for (let x = 0; x < w; x++) {
      const left = clampInt(x - 1, w);
      const right = clampInt(x + 1, w);
      gx[row + x] = (data[row + right] - data[row + left]) * 0.5;
      gy[row + x] = (data[down + x] - data[up + x]) * 0.5;
    }
  }
  return { gx, gy };
}

// Each cell moves toward the confidence-weighted mean of its 3x3 neighbourhood,
// by an amount inversely proportional to its own confidence.
function smoothByConfidence(
  u: Float32Array,
  v: Float32Array,
  confidence: Float32Array,
  cols: number,
  rows: number,
  strength: number
): void {
  const outU = new Float32Array(u.length);
  const outV = new Float32Array(v.length);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      let sumU = 0;
      let sumV = 0;
      let sumW = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= rows) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= cols) continue;
          const j = ny * cols + nx;
          const w = confidence[j] + 1e-4;
          sumU += u[j] * w;
          sumV += v[j] * w;
          sumW += w;
        }
      }
      const meanU = sumU / sumW;
      const meanV = sumV / sumW;
      // A cell that can see the motion itself keeps its own answer; a blind one
      // adopts the neighbourhood's.
      const pull = strength * (1 - confidence[i]);
      outU[i] = u[i] + (meanU - u[i]) * pull;
      outV[i] = v[i] + (meanV - v[i]) * pull;
    }
  }
  u.set(outU);
  v.set(outV);
}

function medianFilter3(field: Float32Array, cols: number, rows: number): void {
  const out = new Float32Array(field.length);
  const window: number[] = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      window.length = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= rows) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= cols) continue;
          window.push(field[ny * cols + nx]);
        }
      }
      window.sort((p, q) => p - q);
      out[y * cols + x] = window[window.length >> 1];
    }
  }
  field.set(out);
}

// Bilinear read of the flow grid at a normalized position, for callers warping
// at a finer resolution than the grid.
export function sampleFlow(flow: FlowField, fx: number, fy: number): [number, number] {
  const x = clamp(fx * flow.cols - 0.5, 0, flow.cols - 1);
  const y = clamp(fy * flow.rows - 0.5, 0, flow.rows - 1);
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(flow.cols - 1, x0 + 1);
  const y1 = Math.min(flow.rows - 1, y0 + 1);
  const tx = x - x0;
  const ty = y - y0;
  const lerp = (f: Float32Array) => {
    const a = f[y0 * flow.cols + x0];
    const b = f[y0 * flow.cols + x1];
    const c = f[y1 * flow.cols + x0];
    const d = f[y1 * flow.cols + x1];
    return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
  };
  return [lerp(flow.u), lerp(flow.v)];
}

// Fill a flow field out into the places it could not be measured.
//
// Lucas-Kanade only knows the motion of things it can SEE. Over empty sky there
// is nothing to track, so those cells come back near zero with near-zero
// confidence — which is honest, and fine for the warp, because the warp only
// ever samples where the echo already is.
//
// Advection needs the opposite. A forecast asks "what will be HERE in twenty
// minutes", and it answers by tracing backwards from a spot that is currently
// empty. Run that against a raw field and the trace starts in a zero-flow cell,
// never travels, and reports empty sky forever — a storm bearing down on a city
// simply never arrives. Measured on a synthetic storm with a known 18 px/frame
// track: +1 interval landed 7 px short, +3 landed 27 px short, and the echo
// tore apart as different parts of it advected at different speeds.
//
// So the measured vectors are spread outward into the unmeasured cells by
// normalized convolution — the same trick the tile decoder uses on intensity:
// carry the value pre-multiplied by its weight, blur both, divide at the end.
// Cells near a confident measurement inherit it; cells far from any settle onto
// the field's own dominant motion, which is the best available answer for "what
// is the weather doing around here".
export function densifyFlow(flow: FlowField, iterations = 24): FlowField {
  const { cols, rows } = flow;
  const n = cols * rows;

  // The dominant motion, for cells the spreading never reaches.
  let mu = 0;
  let mv = 0;
  let mw = 0;
  for (let i = 0; i < n; i++) {
    const c = weight(flow.confidence[i]);
    mu += flow.u[i] * c;
    mv += flow.v[i] * c;
    mw += c;
  }
  if (mw <= 1e-6) return flow; // nothing measured anywhere; leave it alone
  mu /= mw;
  mv /= mw;

  let au = new Float32Array(n);
  let av = new Float32Array(n);
  let aw = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const c = weight(flow.confidence[i]);
    au[i] = flow.u[i] * c;
    av[i] = flow.v[i] * c;
    aw[i] = c;
  }
  let bu = new Float32Array(n);
  let bv = new Float32Array(n);
  let bw = new Float32Array(n);

  // Repeated 3x3 box blur. On a 32x32 grid this is a few hundred thousand
  // operations total — far below the cost of the solve that produced it.
  for (let it = 0; it < iterations; it++) {
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        let su = 0;
        let sv = 0;
        let sw = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= rows) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= cols) continue;
            const j = yy * cols + xx;
            su += au[j];
            sv += av[j];
            sw += aw[j];
          }
        }
        const i = y * cols + x;
        bu[i] = su;
        bv[i] = sv;
        bw[i] = sw;
      }
    }
    [au, bu] = [bu, au];
    [av, bv] = [bv, av];
    [aw, bw] = [bw, aw];
  }

  const u = new Float32Array(n);
  const v = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    // A cell that WAS measured keeps its own answer; spreading is only there to
    // fill silence, not to blur away a real observation.
    const c = flow.confidence[i];
    if (c > 0.2) {
      u[i] = flow.u[i];
      v[i] = flow.v[i];
      continue;
    }
    if (aw[i] > 1e-6) {
      const fu = au[i] / aw[i];
      const fv = av[i] / aw[i];
      // Ramp from the spread answer to the cell's own as confidence rises, so
      // there is no seam at the threshold.
      const k = c / 0.2;
      u[i] = fu * (1 - k) + flow.u[i] * k;
      v[i] = fv * (1 - k) + flow.v[i] * k;
    } else {
      u[i] = mu;
      v[i] = mv;
    }
  }
  // Confidence is deliberately carried through UNCHANGED. These vectors are
  // inferred, not measured, and anything downstream that weights by confidence
  // must keep seeing them for what they are.
  return { cols, rows, u, v, confidence: flow.confidence };
}

// How much a cell's own answer counts when spreading it into its neighbours.
//
// SQUARED, with a floor, rather than plain confidence. A cell straddling the
// leading edge of a storm half-sees the motion and reports an honestly smaller
// vector at honestly lower confidence; averaged in linearly, enough of those
// drag the spread answer below the truth. Measured on a synthetic storm with a
// known track, weighting by c instead of c^2 cost 5-8 percentage points of
// advected speed, and including cells below the floor cost another 5.
const CONFIDENCE_FLOOR = 0.15;
function weight(confidence: number): number {
  return confidence < CONFIDENCE_FLOOR ? 0 : confidence * confidence;
}
