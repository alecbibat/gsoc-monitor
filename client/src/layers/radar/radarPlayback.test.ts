import { describe, expect, it } from 'vitest';
import { blendAlphas, blendAt, PlaybackClock, SNAP_TIMING, type PlaybackTiming } from './radarPlayback';

const TIMING: PlaybackTiming = {
  frameMs: 500,
  fade: 1,
  endHoldMs: 1000,
  startHoldMs: 200,
  wrapMs: 400,
};

// Composite alpha where both layers have echo whose effective alpha (layer
// alpha × pixel alpha) is given; painter's order, higher index on top.
function composite(lower: number, upper: number): number {
  return upper + (1 - upper) * lower;
}

describe('blendAlphas', () => {
  it('shows only the from frame at t = 0 and only the to frame at t = 1', () => {
    expect(blendAlphas(4, { from: 1, to: 2, t: 0 }, 0.9, 0.5)).toEqual([0, 0.9, 0, 0]);
    expect(blendAlphas(4, { from: 1, to: 2, t: 1 }, 0.9, 0.5)).toEqual([0, 0, 0.9, 0]);
    expect(blendAlphas(4, { from: 2, to: 2, t: 0.5 }, 0.9, 0.5)).toEqual([0, 0, 0.9, 0]);
  });

  it('keeps composite coverage constant through a forward blend at the typical echo alpha', () => {
    // Echo pixels of effective alpha k (layer opacity 1 × pixel alpha k).
    const k = 0.5;
    for (const t of [0.1, 0.25, 0.5, 0.75, 0.9]) {
      const a = blendAlphas(3, { from: 0, to: 1, t }, 1, k);
      expect(composite(a[0] * k, a[1] * k)).toBeCloseTo(k, 6);
    }
  });

  it('keeps coverage constant on the loop wrap (incoming frame is the lower layer)', () => {
    const k = 0.5;
    for (const t of [0.2, 0.5, 0.8]) {
      const a = blendAlphas(5, { from: 4, to: 0, t }, 1, k);
      expect(composite(a[0] * k, a[4] * k)).toBeCloseTo(k, 6);
      expect(a[4]).toBeCloseTo(1 - t, 6); // the outgoing (upper) frame fades linearly
    }
  });

  it('stays close to constant for echo lighter and heavier than the typical alpha', () => {
    // The worst case of the compensation is bounded: well under the ~25 %
    // dip of a naive symmetric crossfade across the realistic alpha range.
    for (const e of [0.3, 0.5, 0.8]) {
      const a = blendAlphas(2, { from: 0, to: 1, t: 0.5 }, 1, 0.5);
      const c = composite(a[0] * e, a[1] * e);
      expect(Math.abs(c - e) / e).toBeLessThan(0.2);
    }
  });

  it('fades echo present in only one frame monotonically', () => {
    const ts = [0.2, 0.4, 0.6, 0.8];
    const ins = ts.map((t) => blendAlphas(2, { from: 0, to: 1, t }, 1, 0.5)[1]);
    const outs = ts.map((t) => blendAlphas(2, { from: 0, to: 1, t }, 1, 0.5)[0]);
    expect([...ins].sort((a, b) => a - b)).toEqual(ins);
    expect([...outs].sort((a, b) => b - a)).toEqual(outs);
  });

  it('scales by opacity and tolerates an empty timeline', () => {
    expect(blendAlphas(2, { from: 0, to: 1, t: 0.5 }, 0.5, 0.25)[1]).toBeCloseTo(0.25, 6);
    expect(blendAlphas(0, { from: 0, to: 1, t: 0.5 }, 1, 0.5)).toEqual([]);
  });
});

describe('blendAt', () => {
  it('splits a fractional position into the frames either side', () => {
    expect(blendAt(2.25, 5)).toEqual({ from: 2, to: 3, t: 0.25 });
    expect(blendAt(4, 5)).toEqual({ from: 3, to: 4, t: 1 });
    expect(blendAt(-1, 5)).toEqual({ from: 0, to: 1, t: 0 });
    expect(blendAt(0.5, 1)).toEqual({ from: 0, to: 0, t: 0 });
  });
});

describe('PlaybackClock', () => {
  it('rests paused where it was put', () => {
    const c = new PlaybackClock(TIMING);
    c.reset(5, 4);
    expect(c.playing).toBe(false);
    const f = c.tick(10_000, 1);
    expect(f.position).toBe(4);
    expect(f.index).toBe(4);
  });

  it('steps forward continuously and linearly while playing', () => {
    const c = new PlaybackClock(TIMING);
    c.reset(5, 0);
    c.play();
    let f = c.tick(250, 1);
    expect(f.blend).toEqual({ from: 0, to: 1, t: 0.5 });
    expect(f.position).toBeCloseTo(0.5, 6);
    f = c.tick(125, 1);
    expect(f.position).toBeCloseTo(0.75, 6);
    f = c.tick(375, 1);
    expect(f.blend.from).toBe(1);
    expect(f.position).toBeCloseTo(1.5, 6);
  });

  it('honors playback speed', () => {
    const c = new PlaybackClock(TIMING);
    c.reset(5, 0);
    c.play();
    expect(c.tick(250, 2).position).toBeCloseTo(1, 6);
  });

  it('holds on the newest frame, wraps to the oldest, then dwells before stepping', () => {
    const c = new PlaybackClock(TIMING);
    c.reset(3, 0);
    c.play();
    let f = c.tick(1000, 1); // 0 → 1 → 2
    expect(f.position).toBe(2);
    f = c.tick(900, 1); // still holding
    expect(f.position).toBe(2);
    expect(f.playing).toBe(true);
    f = c.tick(300, 1); // 200 ms into the 400 ms wrap
    expect(f.blend).toEqual({ from: 2, to: 0, t: 0.5 });
    expect(f.position).toBeCloseTo(1, 6);
    f = c.tick(300, 1); // wrap done, 100 ms into the start dwell
    expect(f.position).toBe(0);
    expect(f.blend.t).toBe(0);
    f = c.tick(200, 1); // dwell over, 100 ms into 0 → 1
    expect(f.blend.from).toBe(0);
    expect(f.position).toBeCloseTo(0.2, 6);
  });

  it('restarts from the oldest frame when play is pressed on the newest', () => {
    const c = new PlaybackClock(TIMING);
    c.reset(4, 3);
    c.play();
    const f = c.tick(200, 1);
    expect(f.blend.from).toBe(3);
    expect(f.blend.to).toBe(0);
  });

  it('opens on the newest frame when started from the hold (autoplay)', () => {
    const c = new PlaybackClock(TIMING);
    c.reset(4, 3);
    c.play({ fromHold: true });
    expect(c.tick(900, 1).position).toBe(3);
    expect(c.tick(300, 1).blend.to).toBe(0); // then wraps
  });

  it('loops only over the playable window', () => {
    const c = new PlaybackClock(TIMING);
    c.reset(6, 5);
    c.setWindow(3, 5); // frames 0-2 not loaded yet
    c.play();
    let f = c.tick(200, 1); // wrap 5 → 3
    expect(f.blend).toEqual({ from: 5, to: 3, t: 0.5 });
    f = c.tick(200 + 200 + 250, 1); // wrap done, start dwell, halfway 3 → 4
    expect(f.blend.from).toBe(3);
    expect(f.position).toBeCloseTo(3.5, 6);
    c.setWindow(1, 5); // more frames arrived: the next wrap reaches further back
    f = c.tick(250 + 500 + 1000 + 200, 1);
    expect(f.blend).toEqual({ from: 5, to: 1, t: 0.5 });
  });

  it('does not play a window of one frame', () => {
    const c = new PlaybackClock(TIMING);
    c.reset(4, 3);
    c.setWindow(3, 3);
    c.play();
    expect(c.playing).toBe(false);
  });

  it('moves a playing phase that falls outside a shrunken window to its newest frame', () => {
    const c = new PlaybackClock(TIMING);
    c.reset(6, 0);
    c.play();
    c.tick(250, 1); // blending 0 → 1
    c.setWindow(3, 5);
    expect(c.current().position).toBe(5);
    expect(c.playing).toBe(true);
  });

  it('steps on to newer frames that join the window while it holds', () => {
    const c = new PlaybackClock(TIMING);
    c.reset(6, 0);
    c.play();
    c.tick(750, 1); // 0 → 1 done, halfway 1 → 2
    c.setWindow(1, 1); // the view moved: only the frame on screen is loaded
    expect(c.current().position).toBe(1);
    c.setWindow(0, 5); // the rest loaded: continue 1 → 2, not a wrap to 0
    const f = c.tick(250, 1);
    expect(f.blend).toEqual({ from: 1, to: 2, t: 0.5 });
  });

  it('keeps its phase across a manifest refresh that drops the oldest frame', () => {
    const c = new PlaybackClock(TIMING);
    c.reset(5, 1);
    c.play();
    c.tick(300, 1); // 1 → 2, 60 % blended
    c.remap(5, -1); // frame 0 dropped, a new frame appended
    const f = c.current();
    expect(f.blend.from).toBe(0);
    expect(f.blend.t).toBeCloseTo(0.6, 6);
  });

  it('names the frame mostly on screen mid-blend (where a pause lands)', () => {
    const c = new PlaybackClock(TIMING);
    c.reset(5, 0);
    c.play();
    const f = c.tick(400, 1); // 0.8 of the way to frame 1
    expect(f.blend.from).toBe(0);
    expect(f.index).toBe(1);
  });

  it('seeks to fractional positions as a blend (scrubbing)', () => {
    const c = new PlaybackClock(TIMING);
    c.reset(5, 0);
    c.seek(2.4);
    const f = c.current();
    expect(f.blend).toEqual({ from: 2, to: 3, t: expect.closeTo(0.4, 6) });
    expect(f.index).toBe(2);
    c.play(); // resumes from the nearer frame
    expect(c.tick(0, 1).blend.from).toBe(2);
  });

  it('dwells then blends linearly when fade < 1, with the knob gliding evenly', () => {
    const c = new PlaybackClock({ ...TIMING, fade: 0.5 });
    c.reset(3, 0);
    c.play();
    let f = c.tick(200, 1);
    expect(f.blend.t).toBe(0); // still in the dwell
    expect(f.position).toBeCloseTo(0.4, 6); // but the knob moves
    f = c.tick(175, 1); // halfway through the blend
    expect(f.blend.t).toBeCloseTo(0.5, 6);
  });

  it('cuts to the next frame at the end of the interval when not blending', () => {
    const c = new PlaybackClock({ ...SNAP_TIMING, frameMs: 500, endHoldMs: 1000 });
    c.reset(3, 0);
    c.play();
    expect(c.tick(499, 1).index).toBe(0);
    expect(c.tick(2, 1).index).toBe(1);
  });

  it('carries a long gap across phases without stalling', () => {
    const c = new PlaybackClock(TIMING);
    c.reset(3, 0);
    c.play();
    const f = c.tick(1000 + 1000 + 400 + 200 + 250, 1);
    expect(f.blend.from).toBe(0);
    expect(f.position).toBeCloseTo(0.5, 6);
  });
});
