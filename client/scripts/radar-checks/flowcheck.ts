// flowcheck — permanent recreation of the Stage C PR 5 synthetic flow suite.
//
// Exercises the REAL dense pyramidal Lucas-Kanade solver and densifyFlow from
// client/src/layers/radar/flow/lk.ts against synthesized radar-like fields, and
// asserts the bounds recorded in docs/radar-motion-engine-plan.md
// ("Stage C PR 5 — optical flow in the worker", plus the densifyFlow rows from
// the PR 8 section).
//
// Run from the repo root:  ./node_modules/.bin/tsx client/scripts/radar-checks/flowcheck.ts

import {
  computeFlow,
  densifyFlow,
  type FlowField,
  type Plane,
} from '../../src/layers/radar/flow/lk';

// --- tiny check harness ------------------------------------------------------

let passed = 0;
let failed = 0;
let num = 0;

function check(name: string, cond: boolean, detail: string): void {
  num++;
  if (cond) {
    passed++;
    console.log(`  ${num}. PASS  ${name}  (${detail})`);
  } else {
    failed++;
    console.log(`  ${num}. FAIL  ${name}  (${detail})`);
  }
}

function skip(name: string, why: string): void {
  console.log(`  -- SKIPPED  ${name}: ${why}`);
}

// --- scene synthesis ---------------------------------------------------------

interface Blob {
  cx: number;
  cy: number;
  r: number;
  amp: number;
}

// Analytic Gaussian evaluation, so a "shifted" frame is exact at any
// (fractional) displacement rather than a resampled copy.
function renderScene(w: number, h: number, blobs: Blob[], dx = 0, dy = 0): Plane {
  const data = new Float32Array(w * h);
  for (const b of blobs) {
    const cx = b.cx + dx;
    const cy = b.cy + dy;
    const inv = 1 / (2 * b.r * b.r);
    for (let y = 0; y < h; y++) {
      const dy2 = (y - cy) * (y - cy);
      for (let x = 0; x < w; x++) {
        const d2 = (x - cx) * (x - cx) + dy2;
        if (d2 < 25 * b.r * b.r) data[y * w + x] += b.amp * Math.exp(-d2 * inv);
      }
    }
  }
  return { width: w, height: h, data };
}

// A textured storm-like field: many small cells scattered over the middle of
// the frame, from a deterministic LCG so every run sees the same weather.
// Texture matters: LK recovers translation of a fine-structured field to well
// under a pixel, while a single broad Gaussian tracks at only ~85-88% of true
// displacement (the plan records exactly this contrast in the PR 8 section).
function texturedCluster(seed = 1234): Blob[] {
  let s = seed >>> 0;
  const rnd = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
  const blobs: Blob[] = [];
  for (let i = 0; i < 24; i++) {
    blobs.push({ cx: 70 + rnd() * 116, cy: 70 + rnd() * 116, r: 5 + rnd() * 9, amp: 40 + rnd() * 80 });
  }
  return blobs;
}
const CLUSTER: Blob[] = texturedCluster();

// Confidence-weighted mean displacement over the cells that saw anything.
function meanFlow(flow: FlowField, minConf = 0.05): { u: number; v: number; peak: number } {
  let su = 0;
  let sv = 0;
  let sw = 0;
  let peak = 0;
  for (let i = 0; i < flow.u.length; i++) {
    const c = flow.confidence[i];
    if (c < minConf) continue;
    su += flow.u[i] * c;
    sv += flow.v[i] * c;
    sw += c;
    const m = Math.hypot(flow.u[i], flow.v[i]);
    if (m > peak) peak = m;
  }
  if (sw === 0) return { u: 0, v: 0, peak: 0 };
  return { u: su / sw, v: sv / sw, peak };
}

console.log('flowcheck — dense pyramidal LK + densifyFlow (flow/lk.ts)');

// --- 1-5. pure translations, five directions, 4-24 px -----------------------
// Recorded: recovered within 0.07-0.89 px -> assert error < 1.0 px.

const SIZE = 256;
const translations: Array<[number, number]> = [
  [4, 0],
  [0, -9],
  [-14, 7],
  [12, 12],
  [-20, -10],
];
const frameA = renderScene(SIZE, SIZE, CLUSTER);
for (const [dx, dy] of translations) {
  const frameB = renderScene(SIZE, SIZE, CLUSTER, dx, dy);
  const flow = computeFlow(frameA, frameB);
  const est = meanFlow(flow);
  const err = Math.hypot(est.u - dx, est.v - dy);
  check(
    `translation (${dx},${dy}) recovered`,
    err < 1.0,
    `est (${est.u.toFixed(2)},${est.v.toFixed(2)}), error ${err.toFixed(3)} px, bound < 1.0`
  );
}

// --- 6-7. growth in place ----------------------------------------------------
// Recorded: r x1.3, amp x1.35 -> 0.01 px net, peak 0.77 -> net < 0.1, peak < 1.0.

// A compact convective cell (r=5 on a 256 field) reproduces the recorded pair
// of numbers almost exactly: growth net 0.016/peak 0.72 vs recorded 0.01/0.77,
// decay net 0.024/peak 1.17 vs recorded 0.02/1.21.
{
  const a = renderScene(SIZE, SIZE, [{ cx: 128, cy: 128, r: 5, amp: 100 }]);
  const b = renderScene(SIZE, SIZE, [{ cx: 128, cy: 128, r: 5 * 1.3, amp: 135 }]);
  const est = meanFlow(computeFlow(a, b));
  const net = Math.hypot(est.u, est.v);
  check('growth in place: net translation', net < 0.1, `net ${net.toFixed(3)} px, bound < 0.1`);
  check('growth in place: peak cell', est.peak < 1.0, `peak ${est.peak.toFixed(3)} px, bound < 1.0`);
}

// --- 8-9. decay in place -----------------------------------------------------
// Recorded: r x0.75, amp x0.7 -> 0.02 px net, peak 1.21 -> net < 0.1, peak < 1.5.

{
  const a = renderScene(SIZE, SIZE, [{ cx: 128, cy: 128, r: 5, amp: 100 }]);
  const b = renderScene(SIZE, SIZE, [{ cx: 128, cy: 128, r: 5 * 0.75, amp: 70 }]);
  const est = meanFlow(computeFlow(a, b));
  const net = Math.hypot(est.u, est.v);
  check('decay in place: net translation', net < 0.1, `net ${net.toFixed(3)} px, bound < 0.1`);
  check('decay in place: peak cell', est.peak < 1.5, `peak ${est.peak.toFixed(3)} px, bound < 1.5`);
}

// --- 10. identical frames -> exactly zero ------------------------------------

{
  const flow = computeFlow(frameA, frameA);
  let allZero = true;
  for (let i = 0; i < flow.u.length; i++) {
    if (flow.u[i] !== 0 || flow.v[i] !== 0) allZero = false;
  }
  const est = meanFlow(flow);
  check(
    'identical frames: exactly zero',
    allZero,
    allZero ? 'every u,v cell === 0' : `nonzero cells present, mean (${est.u},${est.v})`
  );
}

// --- 11-12. opposing halves, +-10 px -----------------------------------------
// Recorded: signs correct, -8.94 / +9.98 -> assert sign + magnitude in [7,12].

{
  const top: Blob = { cx: 128, cy: 64, r: 18, amp: 100 };
  const bot: Blob = { cx: 128, cy: 192, r: 18, amp: 100 };
  const a = renderScene(SIZE, SIZE, [top, bot]);
  const b = renderScene(SIZE, SIZE, []);
  // Move the halves independently: top blob -10 px in x, bottom +10 px.
  for (const [blob, dx] of [
    [top, -10],
    [bot, 10],
  ] as Array<[Blob, number]>) {
    const shifted = renderScene(SIZE, SIZE, [blob], dx, 0);
    for (let i = 0; i < b.data.length; i++) b.data[i] += shifted.data[i];
  }
  const flow = computeFlow(a, b);
  // Mean u over confident cells in each half, skipping the middle band where
  // the confidence smoothing legitimately mixes the two motions.
  const half = (rowLo: number, rowHi: number) => {
    let su = 0;
    let sw = 0;
    for (let gy = rowLo; gy < rowHi; gy++) {
      for (let gx = 0; gx < flow.cols; gx++) {
        const i = gy * flow.cols + gx;
        const c = flow.confidence[i];
        if (c < 0.05) continue;
        su += flow.u[i] * c;
        sw += c;
      }
    }
    return sw > 0 ? su / sw : 0;
  };
  const uTop = half(0, 13);
  const uBot = half(19, flow.rows);
  check(
    'opposing halves: top -10 px',
    uTop < 0 && Math.abs(uTop) >= 7 && Math.abs(uTop) <= 12,
    `mean u ${uTop.toFixed(2)} (recorded -8.94), bound sign<0, |u| in [7,12]`
  );
  check(
    'opposing halves: bottom +10 px',
    uBot > 0 && uBot >= 7 && uBot <= 12,
    `mean u ${uBot.toFixed(2)} (recorded +9.98), bound sign>0, u in [7,12]`
  );
}

// --- 13. empty field ---------------------------------------------------------

{
  const a = renderScene(SIZE, SIZE, []);
  const b = renderScene(SIZE, SIZE, []);
  const flow = computeFlow(a, b);
  let finite = true;
  let allZero = true;
  for (let i = 0; i < flow.u.length; i++) {
    if (!Number.isFinite(flow.u[i]) || !Number.isFinite(flow.v[i]) || !Number.isFinite(flow.confidence[i]))
      finite = false;
    if (flow.u[i] !== 0 || flow.v[i] !== 0) allZero = false;
  }
  check('empty field: finite, all-zero, no NaNs', finite && allZero, `finite=${finite} allZero=${allZero}`);
}

// --- 14-15. confidence over echo vs empty sky --------------------------------
// Recorded: 0.33 vs 0.00 -> assert echo > 0.2, empty < 0.01.

{
  const flow = computeFlow(frameA, frameA);
  let echoConf = 0;
  for (let i = 0; i < flow.confidence.length; i++) {
    if (flow.confidence[i] > echoConf) echoConf = flow.confidence[i];
  }
  const emptyConf = flow.confidence[0]; // grid cell (0,0): empty corner of the scene
  check('confidence over echo', echoConf > 0.2, `max ${echoConf.toFixed(3)} (recorded ~0.33), bound > 0.2`);
  check('confidence over empty sky', emptyConf < 0.01, `corner cell ${emptyConf.toExponential(2)}, bound < 0.01`);
}

// --- 16-17. cost per pair (printed; only fails if wildly off) ----------------
// Recorded: 62 ms per 256^2 pair, 34 ms per 128^2. Machine-dependent, so the
// number is printed and only a >20x blowout fails.

{
  const b256 = renderScene(SIZE, SIZE, CLUSTER, 8, 4);
  computeFlow(frameA, b256); // warm up JIT before timing
  const t0 = performance.now();
  computeFlow(frameA, b256);
  const ms256 = performance.now() - t0;
  check('cost per 256^2 pair', ms256 < 62 * 20, `${ms256.toFixed(1)} ms (recorded 62 ms; fails only > 1240 ms)`);

  const a128 = renderScene(128, 128, [{ cx: 64, cy: 64, r: 14, amp: 100 }]);
  const b128 = renderScene(128, 128, [{ cx: 64, cy: 64, r: 14, amp: 100 }], 5, 3);
  computeFlow(a128, b128);
  const t1 = performance.now();
  computeFlow(a128, b128);
  const ms128 = performance.now() - t1;
  check('cost per 128^2 pair', ms128 < 34 * 20, `${ms128.toFixed(1)} ms (recorded 34 ms; fails only > 680 ms)`);
}

skip(
  'end-to-end decode -> cache -> merge -> solve',
  'needs the browser worker pipeline (workers, ImageBitmap, tile decode); covered by the ?radarflow=1 harness'
);

// --- densifyFlow (recorded in the PR 8 section) ------------------------------

// Hand-built 32x32 field: two measured cells in one corner, everything else
// silent. Chosen so the exact confidence-squared arithmetic is checkable:
//   dominant motion mu = (0.9^2 * 10 + 0.3^2 * 2) / (0.9^2 + 0.3^2) = 9.2,
// while plain-confidence weighting would give (0.9*10 + 0.3*2)/1.2 = 8.0,
// and a below-floor (0.10 < 0.15) cell with a huge vector must contribute 0.
function makeSparseField(): FlowField {
  const cols = 32;
  const rows = 32;
  const n = cols * rows;
  const f: FlowField = {
    cols,
    rows,
    u: new Float32Array(n),
    v: new Float32Array(n),
    confidence: new Float32Array(n),
  };
  const set = (x: number, y: number, u: number, c: number) => {
    const i = y * cols + x;
    f.u[i] = u;
    f.confidence[i] = c;
  };
  set(0, 0, 10, 0.9);
  set(1, 0, 2, 0.3);
  set(2, 0, 100, 0.1); // below the 0.15 confidence floor: must be ignored
  return f;
}

{
  const sparse = makeSparseField();
  const dense = densifyFlow(sparse);
  const at = (x: number, y: number) => y * dense.cols + x;

  // 18. a silent cell well away from the measurements gets a real vector
  const iNear = at(10, 10);
  const uNear = dense.u[iNear];
  check(
    'densify: spreads into empty cells',
    Number.isFinite(uNear) && uNear > 1 && Math.abs(dense.v[iNear]) < 0.5,
    `cell (10,10) u=${uNear.toFixed(2)} v=${dense.v[iNear].toFixed(2)} (was 0, conf 0)`
  );

  // 19-20. the far corner is beyond the 24-iteration spread radius, so it gets
  // exactly the dominant motion — which encodes both the c^2 weighting and the
  // confidence floor.
  const iFar = at(31, 31);
  const uFar = dense.u[iFar];
  check(
    'densify: confidence-squared weighting',
    Math.abs(uFar - 9.2) < 1e-3,
    `unreached cell u=${uFar.toFixed(4)}, c^2 predicts 9.2, linear-c would be 8.0`
  );
  check(
    'densify: below-floor cell contributes nothing',
    Math.abs(uFar - 9.2) < 1e-3,
    `u=${uFar.toFixed(4)}; including the conf-0.10 u=100 cell would give ~10.2`
  );

  // 21. a measured cell keeps its own answer exactly
  check(
    'densify: measured cell keeps its own vector',
    dense.u[at(0, 0)] === 10 && dense.v[at(0, 0)] === 0,
    `cell (0,0) u=${dense.u[at(0, 0)]}`
  );

  // 22. confidence passes through unchanged
  let confSame = dense.confidence.length === sparse.confidence.length;
  for (let i = 0; confSame && i < dense.confidence.length; i++) {
    if (dense.confidence[i] !== sparse.confidence[i]) confSame = false;
  }
  check('densify: confidence carried through unchanged', confSame, 'inferred vectors stay labelled as inferred');
}

// 23-24. the loud-failure contract: a mismatched confidence plane must be
// refused (throw or log-and-refuse), never silently densified into NaN.
{
  const bad = makeSparseField();
  (bad as { confidence: Float32Array }).confidence = new Float32Array(bad.cols * bad.rows - 1);

  let loud = false;
  let threw = false;
  let result: FlowField | undefined;
  const origError = console.error;
  console.error = (...args: unknown[]) => {
    loud = true;
    void args;
  };
  try {
    result = densifyFlow(bad);
  } catch {
    threw = true;
  } finally {
    console.error = origError;
  }
  check(
    'densify: mismatched confidence plane refused loudly',
    threw || loud,
    threw ? 'threw' : loud ? 'console.error fired, densify refused' : 'silent — the PR 8 bug is back'
  );
  let noNaN = true;
  if (result) {
    for (let i = 0; i < result.u.length; i++) {
      if (Number.isNaN(result.u[i]) || Number.isNaN(result.v[i])) noNaN = false;
    }
  }
  check(
    'densify: mismatched plane emits no NaN',
    noNaN && (threw || result === bad),
    threw ? 'threw before touching data' : `returned input unchanged, NaN-free=${noNaN}`
  );
}

// --- summary -----------------------------------------------------------------

const total = passed + failed;
console.log(`flowcheck: ${passed}/${total} passed${failed ? `, ${failed} FAILED` : ''}`);
process.exit(failed ? 1 : 0);
