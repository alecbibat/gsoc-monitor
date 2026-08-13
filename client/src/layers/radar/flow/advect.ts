// Advection nowcast: where the echo will be if it keeps doing what it is doing.
//
// This is Lagrangian persistence — the standard short-range radar nowcast, and
// the same one pysteps and rainymotion use as their baseline. It assumes the
// field is carried along the measured flow without growing, decaying or
// changing shape. That assumption is decent for 10-30 minutes and poor beyond
// an hour, which is why the lead time is capped rather than offered open-ended.
//
// It is NOT a weather model. It cannot create a storm that has not formed,
// cannot dissipate one that is about to collapse, and cannot turn one that is
// about to turn. Everything about how this is surfaced has to keep saying so.
//
// Mechanically it is the same backward sampling as the warp: for each output
// pixel, integrate backwards along the flow to find where that parcel is now,
// and take its value. Backwards rather than forwards because a forward scatter
// leaves holes wherever the flow diverges.

import type { RadarLut } from '../palettes';
import type { RadarField } from '../radarField';
import { densifyFlow, type FlowField } from './lk';
import { resolveFlowTo } from './warp';

// Same floor the warp and the unwarped path use: below this blurred coverage,
// dividing by presence amplifies the feather into noise.
const MIN_PRESENCE = 10;

// Backward integration substeps per interval of lead time.
//
// One step per interval assumes a parcel travels in a straight line at a
// constant speed for the whole lead, which is wrong wherever the flow field
// curves or shears — exactly the situations worth forecasting. Subdividing
// follows the trajectory instead. Two per interval is where the improvement
// stops being visible on real fields and starts being a cost.
const SUBSTEPS_PER_INTERVAL = 2;

export interface AdvectOptions {
  /**
   * Lead time as a multiple of the flow's own interval. Flow measured between
   * two frames 10 minutes apart, asked for +30 minutes, is a lead of 3.
   */
  lead: number;
  /** Flow measured over the same region, in the pixels of the plane LK ran on. */
  flow: FlowField | null;
  /** Multiply flow by this to reach output-pixel units. */
  flowScale: number;
  /**
   * Intensity multiplier for this lead time, 0-1. Confidence in a persisted
   * echo falls with lead, and a forecast that renders at full strength claims
   * more than it knows.
   */
  decay: number;
  lut: RadarLut;
  /** Write rows bottom-up for WebGL — see colorizeField's flipY note. */
  flipY: boolean;
}

// Densifying is pure and deterministic per field, and the same flow is asked
// for at several lead times in a row, so the last answer is kept.
let denseSource: FlowField | null = null;
let denseResult: FlowField | null = null;
function densified(flow: FlowField): FlowField {
  if (denseSource === flow && denseResult) return denseResult;
  denseSource = flow;
  denseResult = densifyFlow(flow);
  return denseResult;
}

// Advect `src` forward by `options.lead` intervals and colorize into `out`.
//
// A pixel whose back-trajectory leaves the region renders TRANSPARENT rather
// than clamping to the edge. Clamping is what the warp does, and it is right
// there — both frames cover the same ground, so the edge value is real. Here it
// is not: upwind of the region boundary there is genuinely no data, and
// replicating the edge row would invent a rain shield stretching off the side
// of the forecast. Empty is the truth.
export function advectField(
  src: RadarField,
  out: Uint8ClampedArray,
  options: AdvectOptions
): void {
  const w = src.width;
  const h = src.height;
  const { flow, flowScale, lead, decay, lut, flipY } = options;
  const rain = lut.rain;
  const mag = src.mag;
  const pres = src.presence;
  out.fill(0);

  // Densified first: a back-trajectory for a forecast starts where the echo is
  // NOT yet, and the raw field has no motion there. See densifyFlow.
  const [fu, fv] = resolveFlowTo(flow ? densified(flow) : null, w, h, flowScale);
  const steps = Math.max(1, Math.round(Math.abs(lead) * SUBSTEPS_PER_INTERVAL));
  const dt = lead / steps;

  for (let y = 0; y < h; y++) {
    const dstRow = (flipY ? h - 1 - y : y) * w;
    for (let x = 0; x < w; x++) {
      // Walk backwards down the trajectory. Each step asks "where was this
      // parcel one substep ago", sampling the flow at the position reached so
      // far rather than at the destination — that is what makes a curved
      // trajectory curve.
      let sx = x;
      let sy = y;
      let escaped = false;
      for (let k = 0; k < steps; k++) {
        const gx = sx < 0 ? 0 : sx > w - 1 ? w - 1 : sx;
        const gy = sy < 0 ? 0 : sy > h - 1 ? h - 1 : sy;
        const gx0 = gx | 0;
        const gy0 = gy | 0;
        const gx1 = gx0 + 1 > w - 1 ? w - 1 : gx0 + 1;
        const gy1 = gy0 + 1 > h - 1 ? h - 1 : gy0 + 1;
        const tx = gx - gx0;
        const ty = gy - gy0;
        const i00 = gy0 * w + gx0;
        const i01 = gy0 * w + gx1;
        const i10 = gy1 * w + gx0;
        const i11 = gy1 * w + gx1;
        const w00 = (1 - tx) * (1 - ty);
        const w01 = tx * (1 - ty);
        const w10 = (1 - tx) * ty;
        const w11 = tx * ty;
        const u = fu[i00] * w00 + fu[i01] * w01 + fu[i10] * w10 + fu[i11] * w11;
        const v = fv[i00] * w00 + fv[i01] * w01 + fv[i10] * w10 + fv[i11] * w11;
        sx -= u * dt;
        sy -= v * dt;
        if (sx < 0 || sx > w - 1 || sy < 0 || sy > h - 1) {
          escaped = true;
          break;
        }
      }
      if (escaped) continue;

      const x0 = sx | 0;
      const y0 = sy | 0;
      const x1 = x0 + 1 > w - 1 ? w - 1 : x0 + 1;
      const y1 = y0 + 1 > h - 1 ? h - 1 : y0 + 1;
      const tx = sx - x0;
      const ty = sy - y0;
      const i00 = y0 * w + x0;
      const i01 = y0 * w + x1;
      const i10 = y1 * w + x0;
      const i11 = y1 * w + x1;
      const w00 = (1 - tx) * (1 - ty);
      const w01 = tx * (1 - ty);
      const w10 = (1 - tx) * ty;
      const w11 = tx * ty;

      // Magnitude is stored pre-scaled by presence, so the two travel together
      // and divide at the end — the same normalized convolution the warp uses.
      const p = pres[i00] * w00 + pres[i01] * w01 + pres[i10] * w10 + pres[i11] * w11;
      if (p < MIN_PRESENCE) continue;
      const m = mag[i00] * w00 + mag[i01] * w01 + mag[i10] * w10 + mag[i11] * w11;

      let idx = Math.round((m * decay * 255) / p) >> 1;
      if (idx > 127) idx = 127;
      if (idx < 0) idx = 0;
      const alpha = rain[idx * 4 + 3];
      if (alpha === 0) continue;

      const edge = Math.pow(p / 255, 1.3);
      const o = (dstRow + x) * 4;
      out[o] = rain[idx * 4];
      out[o + 1] = rain[idx * 4 + 1];
      out[o + 2] = rain[idx * 4 + 2];
      out[o + 3] = alpha * edge;
    }
  }
}
