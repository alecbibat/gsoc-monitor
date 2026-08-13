// advectcheck — permanent recreation of the Stage C PR 8 synthetic advection
// nowcast suite.
//
// Exercises the REAL Lagrangian-persistence nowcast from
// client/src/layers/radar/flow/advect.ts, the flow measurement + densifyFlow
// from flow/lk.ts, and the pure forecast-frame logic in nowcast/forecast.ts,
// against synthesized radar fields. Asserts the bounds recorded in
// docs/radar-motion-engine-plan.md ("Stage C PR 8 — advection nowcast").
//
// Run from the repo root:  ./node_modules/.bin/tsx client/scripts/radar-checks/advectcheck.ts

import { advectField } from '../../src/layers/radar/flow/advect';
import { computeFlow, type FlowField, type Plane } from '../../src/layers/radar/flow/lk';
import {
  buildForecastFrames,
  FORECAST_LEADS_MIN,
  FORECAST_MAX_LEAD_MIN,
  forecastDecay,
  forecastFramePath,
  forecastLeadMinutes,
  isForecastPath,
} from '../../src/layers/radar/nowcast/forecast';
import { getRadarLut } from '../../src/layers/radar/palettes';
import type { RadarField } from '../../src/layers/radar/radarField';
import { colorizeField } from '../../src/layers/radar/radarField';

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

const SIZE = 256;
const LUT = getRadarLut('storm');

// A single broad Gaussian storm travelling about its own radius per frame —
// the exact scenario the plan's 88/88/87% distance figures were measured on
// (finer-structured fields track at 95-99%, see the PR 8 "what still needs
// real hardware" note).
const R = 18;
const VX = 15;
const VY = -9;
const SPEED = Math.hypot(VX, VY); // ~17.5 px/frame ~= the storm radius
const C0 = { x: 80, y: 170 };
const CUTOFF = 0.12; // echo extent: g >= CUTOFF, i.e. radius ~2.06*R ~= 37 px

// Analytic evaluation so a shifted frame is exact at fractional displacement.
// presence feathers over the outer rim (g in [CUTOFF, CUTOFF+0.2]); mag is
// stored pre-scaled by presence, matching the decode pipeline's convention.
function makeStormField(cx: number, cy: number): RadarField {
  const mag = new Uint8Array(SIZE * SIZE);
  const presence = new Uint8Array(SIZE * SIZE);
  const inv = 1 / (2 * R * R);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const g = Math.exp(-((x - cx) ** 2 + (y - cy) ** 2) * inv);
      if (g < CUTOFF) continue;
      const p = Math.min(255, Math.round(255 * Math.min(1, (g - CUTOFF) / 0.2)));
      if (p === 0) continue;
      const dbz = 45 * g;
      const i = y * SIZE + x;
      presence[i] = p;
      mag[i] = Math.round((2 * (dbz + 32) * p) / 255);
    }
  }
  return { width: SIZE, height: SIZE, mag, presence };
}

// The intensity plane LK tracks on: same analytic storm, smooth support.
function makeStormPlane(cx: number, cy: number): Plane {
  const data = new Float32Array(SIZE * SIZE);
  const inv = 1 / (2 * R * R);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const g = Math.exp(-((x - cx) ** 2 + (y - cy) ** 2) * inv);
      if (g >= 0.01) data[y * SIZE + x] = 200 * g;
    }
  }
  return { width: SIZE, height: SIZE, data };
}

function advect(src: RadarField, lead: number, flow: FlowField | null, decay = 1): Uint8ClampedArray {
  const out = new Uint8ClampedArray(SIZE * SIZE * 4);
  advectField(src, out, { lead, flow, flowScale: 1, decay, lut: LUT, flipY: false });
  return out;
}

function colorize(src: RadarField): Uint8ClampedArray {
  const out = new Uint8ClampedArray(SIZE * SIZE * 4);
  colorizeField(src, LUT, out, false);
  return out;
}

// Alpha-weighted centroid of a colorized frame.
function centroid(rgba: Uint8ClampedArray): { x: number; y: number; weight: number } {
  let sx = 0;
  let sy = 0;
  let sw = 0;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const a = rgba[(y * SIZE + x) * 4 + 3];
      if (a === 0) continue;
      sx += x * a;
      sy += y * a;
      sw += a;
    }
  }
  return sw > 0 ? { x: sx / sw, y: sy / sw, weight: sw } : { x: 0, y: 0, weight: 0 };
}

function litInDisk(rgba: Uint8ClampedArray, cx: number, cy: number, r: number): number {
  let lit = 0;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 > r * r) continue;
      if (rgba[(y * SIZE + x) * 4 + 3] > 0) lit++;
    }
  }
  return lit;
}

function bytesEqual(a: Uint8ClampedArray, b: Uint8ClampedArray): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

console.log('advectcheck — Lagrangian persistence nowcast (flow/advect.ts + flow/lk.ts + nowcast/forecast.ts)');

// Three observed frames on the known track; flow measured on 0 -> 1 ONLY, so
// frame 2 stays held out for the beats-persistence check.
const field0 = makeStormField(C0.x, C0.y);
const field1 = makeStormField(C0.x + VX, C0.y + VY);
const field2 = makeStormField(C0.x + 2 * VX, C0.y + 2 * VY);
const flow01 = computeFlow(makeStormPlane(C0.x, C0.y), makeStormPlane(C0.x + VX, C0.y + VY));
const obs = colorize(field1);
const obsCentroid = centroid(obs);

// --- 1. lead 0 reproduces the observed frame ---------------------------------
// Recorded: exact. dt is 0, decay is 1, so the output must be byte-identical
// to the plain colorize of the newest observed frame.

{
  const lead0 = advect(field1, 0, flow01, forecastDecay(0));
  check('lead 0 reproduces the observed frame', bytesEqual(lead0, obs), 'byte-identical to colorizeField of the newest observed frame');
}

// --- 2-8. +1 / +2 / +3 direction and distance --------------------------------
// Recorded: direction cosine 1.0000 at every lead -> assert > 0.999.
// Recorded: distance 88% / 88% / 87% of true -> assert in [0.80, 1.0], and
// roughly flat across leads (recorded spread is 1 point -> assert < 0.05).

const ratios: number[] = [];
for (const lead of [1, 2, 3]) {
  const fc = advect(field1, lead, flow01);
  const c = centroid(fc);
  const dx = c.x - obsCentroid.x;
  const dy = c.y - obsCentroid.y;
  const dist = Math.hypot(dx, dy);
  const cos = (dx * VX + dy * VY) / (dist * SPEED);
  const ratio = dist / (lead * SPEED);
  ratios.push(ratio);
  check(`+${lead} direction cosine`, cos > 0.999, `cosine ${cos.toFixed(4)} (recorded 1.0000), bound > 0.999`);
  check(
    `+${lead} distance vs true`,
    ratio >= 0.8 && ratio <= 1.0,
    `${(ratio * 100).toFixed(1)}% of true (recorded ${[88, 88, 87][lead - 1]}%), bound [80%, 100%]`
  );
}
{
  const spread = Math.max(...ratios) - Math.min(...ratios);
  check(
    'distance bias roughly flat across leads',
    spread < 0.05,
    `spread ${(spread * 100).toFixed(1)} points across +1/+2/+3 (recorded 1 point), bound < 5`
  );
}

// --- 9. ground the storm vacated ---------------------------------------------
// Recorded: 0 lit pixels — nothing smeared. A disk in the trailing half of the
// OBSERVED echo (solidly lit at lead 0) must be fully dark in the +3 forecast.

{
  const ux = VX / SPEED;
  const uy = VY / SPEED;
  const vx = C0.x + VX - 20 * ux; // 20 px upwind of the observed centre: g ~ 0.54, well inside the echo
  const vy = C0.y + VY - 20 * uy;
  const before = litInDisk(obs, vx, vy, 8);
  const after = litInDisk(advect(field1, 3, flow01), vx, vy, 8);
  check(
    'ground the storm vacated: 0 lit pixels',
    before > 0 && after === 0,
    `trailing disk lit in observed frame (${before} px), lit in +3 forecast: ${after} (recorded 0)`
  );
}

// --- 10. upwind border renders transparent -----------------------------------
// Recorded: 0 lit pixels — nothing invented. Full-coverage echo, uniform flow
// to the right: every back-trajectory starting within lead*u of the left edge
// leaves the region and must render TRANSPARENT (the warp would clamp and
// paint a rain shield there instead).

{
  const full: RadarField = {
    width: SIZE,
    height: SIZE,
    mag: new Uint8Array(SIZE * SIZE).fill(120),
    presence: new Uint8Array(SIZE * SIZE).fill(255),
  };
  const n = 32 * 32;
  const uniform: FlowField = {
    cols: 32,
    rows: 32,
    u: new Float32Array(n).fill(10),
    v: new Float32Array(n),
    confidence: new Float32Array(n).fill(1),
  };
  const fc = advect(full, 2, uniform); // 20 px of travel
  let upwindLit = 0;
  let interiorLit = 0;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < 20; x++) if (fc[(y * SIZE + x) * 4 + 3] > 0) upwindLit++;
    if (fc[(y * SIZE + 40) * 4 + 3] > 0) interiorLit++;
  }
  check(
    'upwind border: 0 lit pixels',
    upwindLit === 0 && interiorLit === SIZE,
    `escaped band lit: ${upwindLit} of ${20 * SIZE} (recorded 0); interior column lit: ${interiorLit}/${SIZE}`
  );
}

// --- 11-12. decay lowers intensity, moves the storm 0 px ---------------------

{
  const fullStrength = advect(field1, 2, flow01, 1);
  const decayed = advect(field1, 2, flow01, forecastDecay(FORECAST_MAX_LEAD_MIN)); // 0.8, the ceiling's decay
  let alphaFull = 0;
  let alphaDecayed = 0;
  for (let i = 3; i < fullStrength.length; i += 4) {
    alphaFull += fullStrength[i];
    alphaDecayed += decayed[i];
  }
  check(
    'decay lowers intensity',
    alphaDecayed < alphaFull,
    `total alpha ${alphaDecayed} < ${alphaFull} at decay ${forecastDecay(FORECAST_MAX_LEAD_MIN)}`
  );
  const cFull = centroid(fullStrength);
  const cDecayed = centroid(decayed);
  const moved = Math.hypot(cFull.x - cDecayed.x, cFull.y - cDecayed.y);
  check('decay moves the storm 0 px', moved < 0.5, `centroid shift ${moved.toFixed(4)} px (recorded 0 px), bound < 0.5`);
}

// --- 13. no flow -> persistence in place, unmoved ----------------------------

{
  const noFlow = advect(field1, 3, null, 1);
  check('no flow: persistence in place, unmoved', bytesEqual(noFlow, obs), 'byte-identical to the observed frame at lead 3 with null flow');
}

// --- 14. beats persistence against a HELD-OUT observed frame -----------------
// Recorded: error 1.58 vs 6.09 — 74% better. Flow was measured from frames 0
// and 1 only; forecast frame 2 and score against the real frame 2 the
// measurement never saw, vs the null hypothesis that nothing moves. The
// absolute numbers depend on the error metric, so the assertion is the
// recorded RELATIVE claim: advect error < 0.5x persistence error.

{
  const truth = colorize(field2);
  const fc = advect(field1, 1, flow01, 1);
  const persist = obs;
  let errAdvect = 0;
  let errPersist = 0;
  for (let i = 0; i < truth.length; i++) {
    errAdvect += Math.abs(fc[i] - truth[i]);
    errPersist += Math.abs(persist[i] - truth[i]);
  }
  errAdvect /= truth.length;
  errPersist /= truth.length;
  check(
    'beats persistence on a held-out frame',
    errAdvect < 0.5 * errPersist,
    `mean abs RGBA error ${errAdvect.toFixed(3)} vs persistence ${errPersist.toFixed(3)} ` +
      `(${((1 - errAdvect / errPersist) * 100).toFixed(0)}% better; recorded 1.58 vs 6.09, 74% better)`
  );
}

// --- 15. cost (printed; fails only if wildly off) ----------------------------
// Recorded: 185 ms/megapixel at lead 3. Machine-dependent, so the number is
// printed and only a >20x blowout fails.

{
  advect(field1, 3, flow01); // warm up JIT and the flow-resolution cache miss
  const t0 = performance.now();
  const RUNS = 4;
  for (let i = 0; i < RUNS; i++) advect(field1, 3, flow01);
  const msPerMegapixel = ((performance.now() - t0) / RUNS) * (1e6 / (SIZE * SIZE));
  check(
    'cost at lead 3',
    msPerMegapixel < 185 * 20,
    `${msPerMegapixel.toFixed(0)} ms/megapixel (recorded 185; fails only > 3700)`
  );
}

// --- 16-17. the NaN trap stays closed ----------------------------------------
// The PR 8 bug: a flow grid without a matching confidence plane made every
// densified vector NaN, every back-trajectory NaN, and the forecast rendered
// completely empty while every status field reported success. Advecting along
// a deliberately mismatched grid must fail loudly or refuse — never return a
// silently empty field.

{
  const n = 32 * 32;
  const bad: FlowField = {
    cols: 32,
    rows: 32,
    u: new Float32Array(n).fill(8),
    v: new Float32Array(n),
    confidence: new Float32Array(n - 1).fill(1), // deliberately mismatched
  };
  let loud = false;
  let threw = false;
  let out: Uint8ClampedArray | null = null;
  const origError = console.error;
  console.error = (...args: unknown[]) => {
    loud = true;
    void args;
  };
  try {
    out = advect(field1, 2, bad);
  } catch {
    threw = true;
  } finally {
    console.error = origError;
  }
  check(
    'mismatched confidence plane refused loudly',
    threw || loud,
    threw ? 'threw' : loud ? 'console.error fired' : 'silent — the PR 8 bug is back'
  );
  let lit = 0;
  if (out) for (let i = 3; i < out.length; i += 4) if (out[i] > 0) lit++;
  check(
    'mismatched plane never yields a silently empty field',
    threw || lit > 0,
    threw ? 'refused outright' : `fell back to a non-empty render (${lit} lit px), not a blank success`
  );
}

// --- 18-23. nowcast/forecast.ts pure logic -----------------------------------

{
  check(
    'lead ladder is +10/+20/+30 with a +60 ceiling',
    FORECAST_LEADS_MIN.length === 3 &&
      FORECAST_LEADS_MIN[0] === 10 &&
      FORECAST_LEADS_MIN[1] === 20 &&
      FORECAST_LEADS_MIN[2] === 30 &&
      FORECAST_MAX_LEAD_MIN === 60 &&
      FORECAST_LEADS_MIN.every((l) => l <= FORECAST_MAX_LEAD_MIN),
    `leads [${FORECAST_LEADS_MIN.join(', ')}], ceiling ${FORECAST_MAX_LEAD_MIN}`
  );

  // An anchor far in the past: if the frames land exactly on anchor+leads, the
  // wall clock cannot be involved.
  const anchor = 1_600_000_000; // 2020, seconds — nowhere near today's clock
  const frames = buildForecastFrames(anchor);
  check(
    'forecast frames anchored to the newest observed frame, not the wall clock',
    frames.length === 3 && frames.every((f, i) => f.time === anchor + FORECAST_LEADS_MIN[i] * 60),
    `times are anchor + ${FORECAST_LEADS_MIN.map((l) => l * 60).join('/')} s for a 2020 anchor`
  );

  check(
    'forecast path marker round-trips and cannot collide with a CDN path',
    frames.every((f, i) => isForecastPath(f.path) && forecastLeadMinutes(f.path) === FORECAST_LEADS_MIN[i]) &&
      !forecastFramePath(10).startsWith('/'),
    `paths [${frames.map((f) => f.path).join(', ')}], none begins with a slash`
  );

  const realPath = '/v2/radar/1700000000/512/4/8/5/4/1_1.png';
  check(
    'real frame path is not a forecast',
    !isForecastPath(realPath) && forecastLeadMinutes(realPath) === null,
    'RainViewer-style path: isForecastPath false, lead null'
  );

  const d = FORECAST_LEADS_MIN.map((l) => forecastDecay(l));
  check(
    'decay: 1 at lead 0, 0.90 at +30, strictly falling with lead',
    forecastDecay(0) === 1 && Math.abs(forecastDecay(30) - 0.9) < 1e-12 && d[0] > d[1] && d[1] > d[2],
    `decay(0)=1, decay(10/20/30)=${d.map((x) => x.toFixed(4)).join('/')}`
  );
  check(
    'decay floors at 0.5',
    forecastDecay(150) === 0.5 && forecastDecay(600) === 0.5,
    `decay(150)=${forecastDecay(150)}, decay(600)=${forecastDecay(600)} — a stale forecast softens, it never vanishes`
  );
}

// --- browser rows from the recorded table cannot run here --------------------

skip(
  'forecast zone / playhead extrapolation / real-weather pixel share / forecast-vs-observation / readout / motion-disabled rows',
  'need the browser (Cesium globe, workers, canvas readback); covered by the ?radarmotion browser harness'
);

// --- summary -----------------------------------------------------------------

const total = passed + failed;
console.log(`advectcheck: ${passed}/${total} passed${failed ? `, ${failed} FAILED` : ''}`);
process.exit(failed ? 1 : 0);
