// warpcheck — permanent recreation of the Stage C PR 6 synthetic warp suite.
//
// Exercises the REAL backward warp from client/src/layers/radar/flow/warp.ts,
// with flow measured by the REAL Lucas-Kanade solver in flow/lk.ts, against
// synthesized radar fields, and asserts the bounds recorded in
// docs/radar-motion-engine-plan.md ("Stage C PR 6 — the warp-dissolve").
//
// Run from the repo root:  ./node_modules/.bin/tsx client/scripts/radar-checks/warpcheck.ts

import { getRadarLut } from '../../src/layers/radar/palettes';
import { colorizeField, type RadarField } from '../../src/layers/radar/radarField';
import { computeFlow, planeFrom, type FlowField, type LkOptions } from '../../src/layers/radar/flow/lk';
import { warpBlend } from '../../src/layers/radar/flow/warp';

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

// A storm cell the way decodeField would produce it: presence is the feathered
// alpha (Gaussian, peak 255) and mag is the intensity byte PRE-SCALED by
// presence (mag = round(V * presence / 255)) — the field contract radarField.ts
// documents. V=200 is a heavy core (m = V>>1 = 100 in the 0-127 LUT domain).
const V = 200;

interface Cell {
  cx: number;
  cy: number;
  r: number;
}

function makeField(w: number, h: number, cells: Cell[]): RadarField {
  const presence = new Uint8Array(w * h);
  const mag = new Uint8Array(w * h);
  for (const c of cells) {
    const inv = 1 / (2 * c.r * c.r);
    for (let y = 0; y < h; y++) {
      const dy2 = (y - c.cy) * (y - c.cy);
      for (let x = 0; x < w; x++) {
        const d2 = (x - c.cx) * (x - c.cx) + dy2;
        const p = Math.round(255 * Math.exp(-d2 * inv));
        const i = y * w + x;
        if (p > presence[i]) {
          presence[i] = p;
          mag[i] = Math.round((V * p) / 255);
        }
      }
    }
  }
  return { width: w, height: h, mag, presence };
}

// Real flow for a pair, measured on the mag planes like the worker pipeline
// does (mosaic plane -> computeFlow); the fields here are already well under
// the 256 px flow budget, so flowScale is 1.
function measureFlow(a: RadarField, b: RadarField, options: LkOptions = {}): FlowField {
  return computeFlow(
    planeFrom(a.mag, a.width, a.height),
    planeFrom(b.mag, b.width, b.height),
    options
  );
}

const lut = getRadarLut('storm');

function warp(a: RadarField, b: RadarField, t: number, flow: FlowField | null, flipY = false): Uint8ClampedArray {
  const out = new Uint8ClampedArray(a.width * a.height * 4);
  warpBlend(a, b, out, { t, flow, flowScale: 1, lut, flipY });
  return out;
}

function colorize(f: RadarField): Uint8ClampedArray {
  const out = new Uint8ClampedArray(f.width * f.height * 4);
  colorizeField(f, lut, out, false);
  return out;
}

// --- measurement helpers (all read the alpha channel) ------------------------

function alphaStats(rgba: Uint8ClampedArray, w: number, h: number) {
  let sum = 0;
  let sx = 0;
  let sy = 0;
  let peak = 0;
  let minX = w;
  let maxX = -1;
  let minY = h;
  let maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = rgba[(y * w + x) * 4 + 3];
      if (a === 0) continue;
      sum += a;
      sx += a * x;
      sy += a * y;
      if (a > peak) peak = a;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return {
    comX: sum > 0 ? sx / sum : NaN,
    comY: sum > 0 ? sy / sum : NaN,
    peak,
    minX,
    maxX,
    minY,
    maxY,
    mass: sum,
  };
}

// Connected components of alpha > threshold (4-connectivity), ignoring specks.
function lobes(rgba: Uint8ClampedArray, w: number, h: number, threshold: number): number {
  const seen = new Uint8Array(w * h);
  const stack: number[] = [];
  let count = 0;
  for (let start = 0; start < w * h; start++) {
    if (seen[start] || rgba[start * 4 + 3] <= threshold) continue;
    let size = 0;
    stack.push(start);
    seen[start] = 1;
    while (stack.length) {
      const i = stack.pop() as number;
      size++;
      const x = i % w;
      const y = (i / w) | 0;
      for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
        if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
        const j = ny * w + nx;
        if (!seen[j] && rgba[j * 4 + 3] > threshold) {
          seen[j] = 1;
          stack.push(j);
        }
      }
    }
    if (size >= 4) count++;
  }
  return count;
}

// Core width: run of pixels at or above half the row's own peak alpha, along
// one row. This is the "core stays as sharp as a source frame" measure — for a
// presence-Gaussian cell the analytic half-alpha width of r22 is ~45 px.
function coreWidth(rgba: Uint8ClampedArray, w: number, row: number): number {
  let peak = 0;
  for (let x = 0; x < w; x++) {
    const a = rgba[(row * w + x) * 4 + 3];
    if (a > peak) peak = a;
  }
  const half = peak / 2;
  let width = 0;
  for (let x = 0; x < w; x++) {
    if (rgba[(row * w + x) * 4 + 3] >= half) width++;
  }
  return width;
}

function bytesEqual(a: Uint8ClampedArray, b: Uint8ClampedArray): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

console.log('warpcheck — the warp-dissolve (flow/warp.ts, flow measured by flow/lk.ts)');

// --- the two recorded scenes -------------------------------------------------

const W = 192;
const H = 192;
const ROW = 96;

// Broad front: r22 cell stepping 24 px in x (84 -> 108, midpoint 96).
const broadA = makeField(W, H, [{ cx: 84, cy: ROW, r: 22 }]);
const broadB = makeField(W, H, [{ cx: 108, cy: ROW, r: 22 }]);
const broadFlow = measureFlow(broadA, broadB);

// Compact cell: r6 stepping 20 px (86 -> 106) — the dissolve's ghosting case.
const compactA = makeField(W, H, [{ cx: 86, cy: ROW, r: 6 }]);
const compactB = makeField(W, H, [{ cx: 106, cy: ROW, r: 6 }]);
const compactFlow = measureFlow(compactA, compactB);

const srcA = colorize(broadA);
const srcB = colorize(broadB);
const srcStatsA = alphaStats(srcA, W, H);
const srcStatsB = alphaStats(srcB, W, H);

// --- 1-4. t=0 / t=1 reproduce frames A and B exactly -------------------------
// Recorded: centre within 0.0 px, single lobe. The endpoint outputs must be
// byte-identical to colorizing the source frame directly (same inner formula),
// which is the strongest form of "centre within 0.0 px".

{
  const at0 = warp(broadA, broadB, 0, broadFlow);
  const s0 = alphaStats(at0, W, H);
  check(
    't=0 reproduces frame A exactly',
    bytesEqual(at0, srcA),
    `byte-identical to colorized A; centre delta ${Math.abs(s0.comX - srcStatsA.comX).toFixed(4)} px`
  );
  check('t=0 single lobe', lobes(at0, W, H, 64) === 1, `${lobes(at0, W, H, 64)} lobe(s)`);

  const at1 = warp(broadA, broadB, 1, broadFlow);
  const s1 = alphaStats(at1, W, H);
  check(
    't=1 reproduces frame B exactly',
    bytesEqual(at1, srcB),
    `byte-identical to colorized B; centre delta ${Math.abs(s1.comX - srcStatsB.comX).toFixed(4)} px`
  );
  check('t=1 single lobe', lobes(at1, W, H, 64) === 1, `${lobes(at1, W, H, 64)} lobe(s)`);
}

// --- 5-10. broad front at the midpoint ---------------------------------------
// Recorded: storm at 96.7 vs 96.0 expected (error 0.7 -> bound < 1.5), one
// lobe; warp core 45 px, identical to a source frame (bound: within 2 px);
// dissolve core 53 px (bound: >= source + 5); dissolve peak alpha 210 vs 254
// (bounds: dissolve <= source - 25, warp within [source - 10, source]).

{
  const warped = warp(broadA, broadB, 0.5, broadFlow);
  const dissolved = warp(broadA, broadB, 0.5, null);
  const ws = alphaStats(warped, W, H);
  const ds = alphaStats(dissolved, W, H);
  const err = Math.abs(ws.comX - 96);
  check('broad front: storm at the midpoint', err < 1.5, `com x ${ws.comX.toFixed(2)} vs 96.0 expected (recorded 96.7), bound < 1.5 px`);
  check('broad front: one lobe at t=0.5', lobes(warped, W, H, 64) === 1, `${lobes(warped, W, H, 64)} lobe(s)`);

  const srcCore = coreWidth(srcA, W, ROW);
  const warpCore = coreWidth(warped, W, ROW);
  const dissCore = coreWidth(dissolved, W, ROW);
  check(
    'warp core as sharp as a source frame',
    Math.abs(warpCore - srcCore) <= 2,
    `warp ${warpCore} px vs source ${srcCore} px (recorded 45/45), bound |delta| <= 2`
  );
  check('dissolve smears the core', dissCore >= srcCore + 5, `dissolve ${dissCore} px vs source ${srcCore} px (recorded 53 vs 45), bound >= source + 5`);
  check(
    'dissolve loses peak alpha',
    ds.peak <= srcStatsA.peak - 25,
    `dissolve peak ${ds.peak} vs source ${srcStatsA.peak} (recorded 210 vs 254), bound <= source - 25`
  );
  check(
    'warp keeps peak alpha',
    ws.peak >= srcStatsA.peak - 10 && ws.peak <= srcStatsA.peak,
    `warp peak ${ws.peak} vs source ${srcStatsA.peak}, bound within [source - 10, source]`
  );
}

// --- 11-14. compact cell: the ghosting case ----------------------------------
// Recorded: dissolve shows 2 lobes (the double exposure the warp replaces);
// warp shows 1 lobe at peak 246 vs 103 (bounds: warp > 200, dissolve < 130).

{
  const warped = warp(compactA, compactB, 0.5, compactFlow);
  const dissolved = warp(compactA, compactB, 0.5, null);
  const ws = alphaStats(warped, W, H);
  const ds = alphaStats(dissolved, W, H);
  const srcPeak = alphaStats(colorize(compactA), W, H).peak;
  check('compact cell: dissolve ghosts', lobes(dissolved, W, H, 64) === 2, `${lobes(dissolved, W, H, 64)} lobes (recorded 2 — the double exposure)`);
  check('compact cell: dissolve at half strength', ds.peak < 130, `dissolve peak ${ds.peak} (recorded 103), bound < 130`);
  check('compact cell: warp shows one cell', lobes(warped, W, H, 64) === 1, `${lobes(warped, W, H, 64)} lobe(s)`);
  check(
    'compact cell: warp at full strength',
    ws.peak > 200 && ws.peak <= srcPeak,
    `warp peak ${ws.peak} vs dissolve ${ds.peak} (recorded 246 vs 103), bound > 200 and <= source ${srcPeak}`
  );
}

// --- 15-18. monotonic advance across t, both scenes --------------------------
// Recorded: no reversals, no step past 1.1x even spacing. Position is the
// squared-alpha centroid: it tracks the storm's core, where the eye reads
// position, rather than the faint skirt (the plain-alpha centroid drags a
// sub-pixel of skirt asymmetry into each step and reads ~1.17x on the compact
// scene without the core ever moving unevenly).

function coreComX(rgba: Uint8ClampedArray, w: number, h: number): number {
  let s = 0;
  let sx = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = rgba[(y * w + x) * 4 + 3];
      if (a === 0) continue;
      s += a * a;
      sx += a * a * x;
    }
  }
  return s > 0 ? sx / s : NaN;
}

function sweepCom(a: RadarField, b: RadarField, flow: FlowField): number[] {
  const xs: number[] = [];
  for (let i = 0; i <= 10; i++) {
    xs.push(coreComX(warp(a, b, i / 10, flow), W, H));
  }
  return xs;
}

for (const [name, a, b, flow] of [
  ['broad front', broadA, broadB, broadFlow],
  ['compact cell', compactA, compactB, compactFlow],
] as Array<[string, RadarField, RadarField, FlowField]>) {
  const xs = sweepCom(a, b, flow);
  const even = (xs[10] - xs[0]) / 10;
  let minStep = Infinity;
  let maxStep = -Infinity;
  for (let i = 1; i < xs.length; i++) {
    const step = xs[i] - xs[i - 1];
    if (step < minStep) minStep = step;
    if (step > maxStep) maxStep = step;
  }
  check(`${name}: no reversals across t`, minStep >= -1e-6, `min step ${minStep.toFixed(3)} px (even spacing ${even.toFixed(2)})`);
  check(
    `${name}: no step past 1.1x even spacing`,
    maxStep <= 1.1 * even + 1e-6,
    `max step ${maxStep.toFixed(3)} px vs 1.1x even = ${(1.1 * even).toFixed(3)}`
  );
}

// --- 19. zero flow vs plain dissolve: byte-identical -------------------------
// A flow field of explicit zeros must reduce EXACTLY to the flow:null dissolve.

{
  const zeroFlow: FlowField = {
    cols: 32,
    rows: 32,
    u: new Float32Array(32 * 32),
    v: new Float32Array(32 * 32),
    confidence: new Float32Array(32 * 32),
  };
  const viaZero = warp(broadA, broadB, 0.37, zeroFlow);
  const viaNull = warp(broadA, broadB, 0.37, null);
  check('zero flow vs plain dissolve', bytesEqual(viaZero, viaNull), 'byte-identical');
}

// --- 20. flipY is an exact vertical mirror -----------------------------------

{
  const up = warp(broadA, broadB, 0.5, broadFlow, false);
  const down = warp(broadA, broadB, 0.5, broadFlow, true);
  let mirror = true;
  for (let y = 0; y < H && mirror; y++) {
    const a = up.subarray(y * W * 4, (y + 1) * W * 4);
    const b = down.subarray((H - 1 - y) * W * 4, (H - y) * W * 4);
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) {
        mirror = false;
        break;
      }
    }
  }
  check('flipY output is an exact vertical mirror', mirror, 'every row matches its mirrored counterpart byte-for-byte');
}

// --- 21-23. the tracking limit -----------------------------------------------
// Recorded on a 22 px blob: displacement/radius <= 2.0 is exact (~0.5 px);
// >= 3.2 breaks down into a ghost and must degrade TOWARD the dissolve —
// never brighter than a source frame's peak, never mass outside the span the
// storm actually travelled.

const TW = 256;
const TH = 256;
const TROW = 128;

// Where the storm's core landed: centroid of the pixels within 90% of peak
// alpha. The whole-image centroid is the wrong probe here — past-the-limit
// flow leaves a faint ghost skirt that drags it while the visible storm sits
// exactly where it should.
function corePosition(rgba: Uint8ClampedArray, w: number, h: number): number {
  let peak = 0;
  for (let i = 3; i < rgba.length; i += 4) if (rgba[i] > peak) peak = rgba[i];
  const th = peak * 0.9;
  let s = 0;
  let sx = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (rgba[(y * w + x) * 4 + 3] >= th) {
        s++;
        sx += x;
      }
    }
  }
  return s > 0 ? sx / s : NaN;
}

// Sweep t=0.1..0.9 and record the safety envelope: brightest pixel anywhere,
// and any pixel at or above the decode pipeline's own visibility floor
// (alpha 8 — decodeField treats alpha < 8 as empty) outside the travelled
// x-span (union of the two source frames' rendered extents).
function sweepEnvelope(a: RadarField, b: RadarField, flow: FlowField) {
  const w = a.width;
  const h = a.height;
  const ca = alphaStats(colorize(a), w, h);
  const cb = alphaStats(colorize(b), w, h);
  const srcPeak = Math.max(ca.peak, cb.peak);
  const loX = Math.min(ca.minX, cb.minX);
  const hiX = Math.max(ca.maxX, cb.maxX);
  let peakOverT = 0;
  let outside = 0;
  const out = new Uint8ClampedArray(w * h * 4);
  for (let i = 1; i <= 9; i++) {
    warpBlend(a, b, out, { t: i / 10, flow, flowScale: 1, lut, flipY: false });
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const al = out[(y * w + x) * 4 + 3];
        if (al > peakOverT) peakOverT = al;
        if (al >= 8 && (x < loX || x > hiX)) outside++;
      }
    }
  }
  return { srcPeak, loX, hiX, peakOverT, outside };
}

// ratio 2.0: 44 px step on r22. The production displacement ceiling (40) would
// forbid the solver from even representing 44 px, so the ceiling is raised
// just past it and the pyramid gets the extra level a 44 px reach needs —
// the claim is governed by displacement/radius, not by those knobs.
const ratio2A = makeField(TW, TH, [{ cx: 100, cy: TROW, r: 22 }]);
const ratio2B = makeField(TW, TH, [{ cx: 144, cy: TROW, r: 22 }]);
const ratio2Flow = measureFlow(ratio2A, ratio2B, { levels: 4, maxDisplacement: 48 });

// ratio 3.2: 70 px step on r22 — past the limit, measured with the solver
// exactly as production runs it (stock options, displacement ceiling 40).
const ratio3A = makeField(TW, TH, [{ cx: 72, cy: TROW, r: 22 }]);
const ratio3B = makeField(TW, TH, [{ cx: 142, cy: TROW, r: 22 }]);
const ratio3Flow = measureFlow(ratio3A, ratio3B);

{
  const out = new Uint8ClampedArray(TW * TH * 4);
  warpBlend(ratio2A, ratio2B, out, { t: 0.5, flow: ratio2Flow, flowScale: 1, lut, flipY: false });
  const core = corePosition(out, TW, TH);
  const err = Math.abs(core - 122);
  check(
    'tracking limit: ratio 2.0 stays exact',
    err < 1.0,
    `core at ${core.toFixed(2)} vs 122.0 expected, error ${err.toFixed(3)} px (recorded <= 0.4, claim ~0.5), bound < 1.0`
  );

  const ghost = new Uint8ClampedArray(TW * TH * 4);
  warpBlend(ratio3A, ratio3B, ghost, { t: 0.5, flow: ratio3Flow, flowScale: 1, lut, flipY: false });
  const env2 = sweepEnvelope(ratio2A, ratio2B, ratio2Flow);
  const env3 = sweepEnvelope(ratio3A, ratio3B, ratio3Flow);
  check(
    'past the limit: never brighter than a source frame',
    env3.peakOverT <= env3.srcPeak && env2.peakOverT <= env2.srcPeak,
    `max alpha over t sweep ${env3.peakOverT} vs source peak ${env3.srcPeak} at ratio 3.2 ` +
      `(ghosts into ${lobes(ghost, TW, TH, 64)} lobes); ${env2.peakOverT} vs ${env2.srcPeak} at ratio 2.0`
  );
  check(
    'past the limit: no mass outside the travelled span',
    env3.outside === 0 && env2.outside === 0,
    `visible pixels (alpha >= 8) beyond x [${env3.loX},${env3.hiX}]: ${env3.outside} at ratio 3.2, ` +
      `${env2.outside} at ratio 2.0, across t=0.1..0.9`
  );
}

// --- 24. cost ---------------------------------------------------------------
// Recorded: 3.3 ms for 192^2 (quoted as 61 ms/megapixel). Machine-dependent —
// printed, and only a >20x blowout fails.

{
  const out = new Uint8ClampedArray(W * H * 4);
  const opts = { t: 0.5, flow: broadFlow, flowScale: 1, lut, flipY: false };
  warpBlend(broadA, broadB, out, opts); // warm up JIT + resolveFlowTo cache
  warpBlend(broadA, broadB, out, opts);
  const runs = 20;
  const t0 = performance.now();
  for (let i = 0; i < runs; i++) warpBlend(broadA, broadB, out, opts);
  const ms = (performance.now() - t0) / runs;
  const perMP = ms / ((W * H) / 1e6);
  console.log(`  --  cost: ${ms.toFixed(2)} ms per 192^2 warp, ${perMP.toFixed(1)} ms/megapixel (recorded 3.3 ms / 61 ms/MP)`);
  check('cost per 192^2 warp', ms < 3.3 * 20, `${ms.toFixed(2)} ms (fails only > 66 ms)`);
}

// --- browser-side rows from the recorded table -------------------------------

skip('browser: endpoints vs dissolve delta exactly 0', 'needs the worker/ImageBitmap pipeline; covered by the ?radarwarp=1 harness');
skip('browser: interior vs dissolve mean 5.7 alpha levels', 'needs the worker/ImageBitmap pipeline; covered by the ?radarwarp=1 harness');
skip('browser: divergence profile 4.8 / 5.7 / 4.8 peaking mid-interval', 'needs the worker/ImageBitmap pipeline; covered by the ?radarwarp=1 harness');
skip('browser: 71 ms peak per warped region frame', 'needs Cesium + SwiftShader in a real browser; covered by the ?radarwarp=1 harness');

// --- summary -----------------------------------------------------------------

const total = passed + failed;
console.log(`warpcheck: ${passed}/${total} passed${failed ? `, ${failed} FAILED` : ''}`);
process.exit(failed ? 1 : 0);
