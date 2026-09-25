// Pure playback model for the radar loop: a clock that moves a continuous
// position through the timeline, and the per-frame layer alphas that render
// a position as a crossfade. No React or Cesium, so it is unit-testable and
// drives both the imagery layers and the scrubber's playhead.

// What is on screen: frame `from` blending toward frame `to` by `t` (0 = only
// `from`, 1 = only `to`).
export interface Blend {
  from: number;
  to: number;
  t: number;
}

export interface PlaybackTiming {
  frameMs: number; // time from one frame to the next at 1× speed
  fade: number; // share of frameMs spent blending (after a short dwell); 0 = hard cut at the end
  endHoldMs: number; // dwell on the newest frame before the loop restarts
  startHoldMs: number; // dwell on the oldest frame after the loop restarts
  wrapMs: number; // blend from the newest frame back to the oldest
}

// An 800 ms linear rolling dissolve is the one playback this dashboard's
// users lived with happily; this is a touch quicker, still linear (easing
// every step makes the loop pulse "hop, hop, hop"), with a long look at the
// newest picture before a quick restart.
export const DEFAULT_TIMING: PlaybackTiming = {
  frameMs: 700,
  fade: 0.9,
  endHoldMs: 1800,
  startHoldMs: 300,
  wrapMs: 300,
};

// Stepped playback (reduced motion, software rendering): frames cut over at
// the end of each interval and the loop restarts without a blend.
export const SNAP_TIMING: PlaybackTiming = { ...DEFAULT_TIMING, fade: 0, wrapMs: 0 };

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

function clampFrame(i: number, n: number): number {
  return Math.min(Math.max(0, Math.floor(i)), n - 1);
}

// Layer alphas that render `blend`, one per timeline frame.
//
// Frames are stacked in timeline order (a later frame draws over an earlier
// one), so the two layers in a blend are an upper and a lower. Fading one out
// while the other fades in the naive way dips coverage mid-blend wherever
// both frames have echo, so the loop visibly "breathes" every step. Instead
// the upper layer carries its linear weight and the lower one is boosted so
// that where both frames have echo of effective alpha k (layer opacity ×
// typical echo pixel alpha) the composite stays exactly k:
//
//   up + (1 − up)·low = k,  up = w·k   ⇒   low = k·(1 − w) / (1 − w·k)
//
// Echo present in only one of the two frames still fades smoothly in or out.
export function blendAlphas(n: number, blend: Blend, opacity: number, overlap: number): number[] {
  const alphas = new Array<number>(n).fill(0);
  if (n <= 0) return alphas;
  const from = clampFrame(blend.from, n);
  const to = clampFrame(blend.to, n);
  const t = clamp01(blend.t);
  if (from === to || t <= 0) {
    alphas[from] = opacity;
    return alphas;
  }
  if (t >= 1) {
    alphas[to] = opacity;
    return alphas;
  }
  const upper = Math.max(from, to);
  const lower = Math.min(from, to);
  const w = upper === to ? t : 1 - t; // the upper layer's share of the blend
  const k = clamp01(overlap);
  alphas[upper] = opacity * w;
  alphas[lower] = opacity * clamp01((1 - w) / (1 - w * k));
  return alphas;
}

// A continuous timeline position (e.g. while dragging the scrubber) as a
// blend between the frames either side of it.
export function blendAt(position: number, n: number): Blend {
  if (n <= 1) return { from: 0, to: 0, t: 0 };
  const p = Math.min(Math.max(0, position), n - 1);
  const from = Math.min(Math.floor(p), n - 2);
  return { from, to: from + 1, t: p - from };
}

type Phase =
  | { kind: 'rest'; position: number } // paused: whole or fractional position
  | { kind: 'step'; from: number; elapsed: number } // from → from + 1
  | { kind: 'hold'; at: number; elapsed: number } // dwelling on the newest playable frame
  | { kind: 'wrap'; from: number; to: number; elapsed: number } // newest → oldest playable
  | { kind: 'start'; at: number; elapsed: number }; // dwelling on the oldest after a wrap

export interface ClockFrame {
  blend: Blend;
  position: number; // continuous playhead position, in frames
  index: number; // the frame the readout names (the one mostly on screen)
  playing: boolean;
}

// The playback clock. It loops over a *playable window* [lo, hi] of the
// timeline — the engine sets it to the run of frames whose tiles are loaded,
// so the loop never steps onto a frame that would draw holes; it just starts
// short and grows as frames arrive. `tick` advances real time; paused, the
// clock holds a position.
export class PlaybackClock {
  private n = 0;
  private lo = 0;
  private hi = -1;
  private phase: Phase = { kind: 'rest', position: 0 };

  constructor(private timing: PlaybackTiming = DEFAULT_TIMING) {}

  get playing(): boolean {
    return this.phase.kind !== 'rest';
  }

  get window(): [number, number] {
    return [this.lo, this.hi];
  }

  setTiming(timing: PlaybackTiming): void {
    this.timing = timing;
  }

  // Resize the timeline (whole window playable) and rest at `position`.
  reset(n: number, position: number): void {
    this.n = Math.max(0, n);
    this.lo = 0;
    this.hi = this.n - 1;
    this.seek(position);
  }

  // Frames were added/removed at the ends: re-index by `delta` (−k when k
  // old frames dropped off the front) without disturbing the phase, so a
  // manifest refresh mid-blend doesn't pop.
  remap(n: number, delta: number): void {
    this.n = Math.max(0, n);
    const max = Math.max(0, this.n - 1);
    const fix = (i: number) => Math.min(Math.max(0, i + delta), max);
    const ph = this.phase;
    switch (ph.kind) {
      case 'rest':
        ph.position = Math.min(Math.max(0, ph.position + delta), max);
        break;
      case 'step':
        if (ph.from + delta < 0) {
          // The frame it was leaving expired: carry on from the oldest.
          this.phase = { kind: 'start', at: 0, elapsed: 0 };
          break;
        }
        ph.from = fix(ph.from);
        if (ph.from + 1 > max) this.phase = { kind: 'hold', at: max, elapsed: 0 };
        break;
      case 'hold':
      case 'start':
        ph.at = fix(ph.at);
        break;
      case 'wrap':
        ph.from = fix(ph.from);
        ph.to = fix(ph.to);
        break;
    }
    this.lo = Math.min(Math.max(0, this.lo + delta), max);
    this.hi = Math.min(Math.max(-1, this.hi + delta), this.n - 1);
  }

  // The playable window. While playing, a phase that fell outside it moves to
  // the window's newest frame.
  setWindow(lo: number, hi: number): void {
    const max = this.n - 1;
    this.lo = Math.min(Math.max(0, lo), Math.max(0, max));
    this.hi = Math.min(Math.max(-1, hi), max);
    const ph = this.phase;
    if (ph.kind === 'rest' || this.hi < this.lo) return;
    const inside = (i: number) => i >= this.lo && i <= this.hi;
    if (
      (ph.kind === 'step' && (!inside(ph.from) || !inside(ph.from + 1))) ||
      ((ph.kind === 'hold' || ph.kind === 'start') && !inside(ph.at)) ||
      (ph.kind === 'wrap' && (!inside(ph.from) || !inside(ph.to)))
    ) {
      this.phase = { kind: 'hold', at: this.hi, elapsed: 0 };
    }
  }

  // Pause at a position (whole or fractional).
  seek(position: number): void {
    const max = Math.max(0, this.n - 1);
    this.phase = { kind: 'rest', position: Math.min(Math.max(0, position), max) };
  }

  // Play from the frame under the playhead. From the newest playable frame
  // the loop restarts at once — or, with `fromHold`, first dwells on it (how
  // autoplay opens: current conditions first).
  play(opts: { fromHold?: boolean } = {}): void {
    if (this.phase.kind !== 'rest' || this.hi <= this.lo) return;
    const i = Math.round(this.phase.position);
    if (i >= this.hi) {
      this.phase = opts.fromHold
        ? { kind: 'hold', at: this.hi, elapsed: 0 }
        : { kind: 'wrap', from: Math.min(i, this.n - 1), to: this.lo, elapsed: 0 };
    } else if (i < this.lo) {
      this.phase = { kind: 'start', at: this.lo, elapsed: 0 };
    } else {
      this.phase = { kind: 'step', from: i, elapsed: 0 };
    }
  }

  // Pause on the frame mostly on screen.
  pause(): void {
    if (this.phase.kind === 'rest') return;
    this.seek(this.current().index);
  }

  // Advance by `dtMs` of real time at `speed`.
  tick(dtMs: number, speed: number): ClockFrame {
    if (this.phase.kind === 'rest' || this.hi <= this.lo) return this.current();
    const { frameMs, endHoldMs, startHoldMs, wrapMs } = this.timing;
    let dt = Math.max(0, dtMs) * Math.max(0, speed);
    // A long gap (background tab) can carry across several phases; the guard
    // bounds the work if a timing is ever configured to zero.
    for (let guard = 0; guard < 64 && dt > 0; guard++) {
      const ph = this.phase as Exclude<Phase, { kind: 'rest' }>;
      const span =
        ph.kind === 'step' ? frameMs : ph.kind === 'hold' ? endHoldMs : ph.kind === 'wrap' ? wrapMs : startHoldMs;
      const left = span - ph.elapsed;
      if (dt < left) {
        ph.elapsed += dt;
        break;
      }
      dt -= Math.max(0, left);
      this.advancePhase();
    }
    return this.current();
  }

  private advancePhase(): void {
    const ph = this.phase;
    switch (ph.kind) {
      case 'step': {
        const next = ph.from + 1;
        this.phase =
          next >= this.hi ? { kind: 'hold', at: this.hi, elapsed: 0 } : { kind: 'step', from: next, elapsed: 0 };
        break;
      }
      case 'hold':
        this.phase = { kind: 'wrap', from: ph.at, to: this.lo, elapsed: 0 };
        break;
      case 'wrap':
        this.phase = { kind: 'start', at: this.lo, elapsed: 0 };
        break;
      case 'start':
        this.phase =
          ph.at >= this.hi ? { kind: 'hold', at: this.hi, elapsed: 0 } : { kind: 'step', from: ph.at, elapsed: 0 };
        break;
    }
  }

  current(): ClockFrame {
    const n = this.n;
    const ph = this.phase;
    const playing = ph.kind !== 'rest';
    if (n === 0) return { blend: { from: 0, to: 0, t: 0 }, position: 0, index: 0, playing };
    const { frameMs, fade, wrapMs } = this.timing;
    switch (ph.kind) {
      case 'step': {
        const f = clamp01(fade);
        const u = frameMs > 0 ? clamp01(ph.elapsed / frameMs) : 1;
        // A short dwell on the sharp frame, then a linear blend. With no
        // fade the next frame cuts in at the end of the interval.
        const t = f <= 0 ? 0 : clamp01((u - (1 - f)) / f);
        return {
          blend: { from: ph.from, to: ph.from + 1, t },
          position: ph.from + u, // the knob glides evenly regardless of the dwell
          index: t < 0.5 ? ph.from : ph.from + 1,
          playing,
        };
      }
      case 'wrap': {
        const t = wrapMs > 0 ? clamp01(ph.elapsed / wrapMs) : 1;
        return {
          blend: { from: ph.from, to: ph.to, t },
          // The knob sweeps back to the start as the newest frame dissolves.
          position: ph.from + (ph.to - ph.from) * t,
          index: t < 0.5 ? ph.from : ph.to,
          playing,
        };
      }
      case 'hold':
      case 'start':
        return { blend: { from: ph.at, to: ph.at, t: 0 }, position: ph.at, index: ph.at, playing };
      default:
        return {
          blend: blendAt(ph.position, n),
          position: ph.position,
          index: Math.round(ph.position),
          playing,
        };
    }
  }
}
