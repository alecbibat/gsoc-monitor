// The warp-dissolve: what actually makes the radar move.
//
// A crossfade between two frames ten minutes apart shows a storm fading out in
// one place while an identical storm fades in six to fifteen kilometres away.
// The eye reads that as a blink, not travel. The warp instead carries the field
// along the measured flow: at time t between the frames, every pixel is pulled
// from where the echo WAS in A and from where it WILL BE in B, and the two are
// mixed. The storm slides.
//
// This is a backward (semi-Lagrangian) warp — for each output pixel, ask where
// its contents came from — because a forward scatter would leave holes wherever
// the flow diverges.
//
// With `flow` all zeros this reduces EXACTLY to the Stage A dissolve, which is
// why it is also the permanent fallback: flow failure, an undecoded region, or
// prefers-reduced-motion all land here with nothing special to do.

import type { RadarLut } from '../palettes';
import type { RadarField } from '../radarField';
import { sampleFlow, type FlowField } from './lk';

// Below this blurred coverage the normalized division amplifies the outermost
// fringe of the feather into noise — same floor the unwarped path uses.
const MIN_PRESENCE = 10;

export interface WarpOptions {
  /** Position between the two frames, 0 = A, 1 = B. */
  t: number;
  /**
   * Flow measured A→B, in the pixels of the plane LK ran on. Null renders the
   * plain dissolve.
   */
  flow: FlowField | null;
  /** Multiply flow by this to reach output-pixel units. */
  flowScale: number;
  lut: RadarLut;
  /** Write rows bottom-up for WebGL — see colorizeField's flipY note. */
  flipY: boolean;
}

// Warp, blend and colorize a region into `out` (RGBA, width*height*4).
//
// `a` and `b` must be the same size as the output — they are the region
// composites, not individual tiles, so the warp can pull pixels across what
// would otherwise be tile boundaries.
//
// The loop is written flat, with the flow resolved into full-resolution arrays
// up front. Per-pixel helper calls that return tuples cost an allocation each,
// and at a megapixel per rendered frame that dominated everything else.
export function warpBlend(
  a: RadarField,
  b: RadarField,
  out: Uint8ClampedArray,
  options: WarpOptions
): void {
  const w = a.width;
  const h = a.height;
  const t = options.t < 0 ? 0 : options.t > 1 ? 1 : options.t;
  const { flow, flowScale, lut, flipY } = options;
  const rain = lut.rain;
  const magA = a.mag;
  const presA = a.presence;
  const magB = b.mag;
  const presB = b.presence;
  out.fill(0);

  const [fu, fv] = resolveFlowTo(flow, w, h, flowScale);
  const back = -t;
  const fwd = 1 - t;

  for (let y = 0; y < h; y++) {
    const dstRow = (flipY ? h - 1 - y : y) * w;
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const du = fu[i];
      const dv = fv[i];

      // A's echo reaches this pixel only after travelling t of the way, so look
      // back along the flow; B's still has (1-t) to go, so look forward. At
      // t=0 A is unshifted and at t=1 B is, so the endpoints stay exactly
      // truthful — which is what keeps a scrub onto a real frame honest.
      let ax = x + du * back;
      let ay = y + dv * back;
      let bx = x + du * fwd;
      let by = y + dv * fwd;
      ax = ax < 0 ? 0 : ax > w - 1 ? w - 1 : ax;
      ay = ay < 0 ? 0 : ay > h - 1 ? h - 1 : ay;
      bx = bx < 0 ? 0 : bx > w - 1 ? w - 1 : bx;
      by = by < 0 ? 0 : by > h - 1 ? h - 1 : by;

      const ax0 = ax | 0;
      const ay0 = ay | 0;
      const ax1 = ax0 + 1 > w - 1 ? w - 1 : ax0 + 1;
      const ay1 = ay0 + 1 > h - 1 ? h - 1 : ay0 + 1;
      const atx = ax - ax0;
      const aty = ay - ay0;
      const a00 = ay0 * w + ax0;
      const a01 = ay0 * w + ax1;
      const a10 = ay1 * w + ax0;
      const a11 = ay1 * w + ax1;
      const aw00 = (1 - atx) * (1 - aty);
      const aw01 = atx * (1 - aty);
      const aw10 = (1 - atx) * aty;
      const aw11 = atx * aty;

      const bx0 = bx | 0;
      const by0 = by | 0;
      const bx1 = bx0 + 1 > w - 1 ? w - 1 : bx0 + 1;
      const by1 = by0 + 1 > h - 1 ? h - 1 : by0 + 1;
      const btx = bx - bx0;
      const bty = by - by0;
      const b00 = by0 * w + bx0;
      const b01 = by0 * w + bx1;
      const b10 = by1 * w + bx0;
      const b11 = by1 * w + bx1;
      const bw00 = (1 - btx) * (1 - bty);
      const bw01 = btx * (1 - bty);
      const bw10 = (1 - btx) * bty;
      const bw11 = btx * bty;

      // Magnitude and presence are only meaningful as a pair — magnitude is
      // stored pre-scaled by presence — so both are blended and divided after.
      // That is the normalized convolution carried into the time axis: echo
      // growing or fading between frames stays truthful instead of ghosting.
      const pa = presA[a00] * aw00 + presA[a01] * aw01 + presA[a10] * aw10 + presA[a11] * aw11;
      const pb = presB[b00] * bw00 + presB[b01] * bw01 + presB[b10] * bw10 + presB[b11] * bw11;
      const pres = pa + (pb - pa) * t;
      if (pres < MIN_PRESENCE) continue;

      const ma = magA[a00] * aw00 + magA[a01] * aw01 + magA[a10] * aw10 + magA[a11] * aw11;
      const mb = magB[b00] * bw00 + magB[b01] * bw01 + magB[b10] * bw10 + magB[b11] * bw11;
      const mag = ma + (mb - ma) * t;

      let m = Math.round((mag * 255) / pres) >> 1;
      if (m > 127) m = 127;
      const alpha = rain[m * 4 + 3];
      if (alpha === 0) continue;

      const edge = Math.pow(pres / 255, 1.3);
      const o = (dstRow + x) * 4;
      out[o] = rain[m * 4];
      out[o + 1] = rain[m * 4 + 1];
      out[o + 2] = rain[m * 4 + 2];
      out[o + 3] = alpha * edge;
    }
  }
}

// Expand a coarse flow grid to full resolution, in output-pixel units.
//
// Reused between calls so stepping t across a keyframe interval — the common
// case — costs one allocation, not one per rendered frame.
//
// TWO slots, not one. The warp resolves the field as measured while the
// advection nowcast resolves its densified version, and the motion layer asks
// for both over the same region. With a single slot those two evict each other
// on every call, and re-resolving means a bilinear sample per output pixel —
// four million of them on a full-size region, which measured an order of
// magnitude worse than the warp it was meant to serve.
interface ResolveSlot {
  w: number;
  h: number;
  fu: Float32Array;
  fv: Float32Array;
  token: unknown;
  scale: number;
}

const slots: ResolveSlot[] = [];
const MAX_SLOTS = 2;

export function resolveFlowTo(
  flow: FlowField | null,
  w: number,
  h: number,
  scale: number
): [Float32Array, Float32Array] {
  const hit = slots.findIndex(
    (s) => s.token === flow && s.scale === scale && s.w === w && s.h === h
  );
  if (hit >= 0) {
    // Most-recently-used first, so two alternating callers both stay resident.
    const [slot] = slots.splice(hit, 1);
    slots.unshift(slot);
    return [slot.fu, slot.fv];
  }

  // Reuse the oldest slot's buffers when they are the right size; the point of
  // the cache is to stop allocating a pair of full-resolution planes per frame.
  let slot = slots.length >= MAX_SLOTS ? slots.pop() : undefined;
  if (!slot || slot.w !== w || slot.h !== h) {
    slot = { w, h, fu: new Float32Array(w * h), fv: new Float32Array(w * h), token: null, scale };
  }
  slot.token = flow;
  slot.scale = scale;
  slots.unshift(slot);

  if (!flow) {
    slot.fu.fill(0);
    slot.fv.fill(0);
    return [slot.fu, slot.fv];
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const [u, v] = sampleFlow(flow, (x + 0.5) / w, (y + 0.5) / h);
      slot.fu[i] = u * scale;
      slot.fv[i] = v * scale;
    }
  }
  return [slot.fu, slot.fv];
}
