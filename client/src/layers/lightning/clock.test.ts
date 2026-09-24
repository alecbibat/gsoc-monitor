import { describe, expect, it } from 'vitest';
import {
  CLOCK_CONFIRM_SAMPLES,
  CLOCK_CONFIRM_SPREAD_MS,
  CLOCK_EWMA_ALPHA,
  CLOCK_MAX_OFFSET_MS,
  createServerClock,
  foldOffset,
  offsetSample,
} from './clock';

const HOUR = 3_600_000;

describe('server clock', () => {
  it('measures the offset against the midpoint of the request', () => {
    // Request left at 1000, came back at 1400; the server stamped 5200 —
    // most likely at local 1200, so the server runs 4000 ms ahead.
    expect(offsetSample(5_200, 1_000, 1_400)).toBe(4_000);
    expect(offsetSample(1_000, 1_000, 3_000)).toBe(-1_000);
  });

  it('takes the first sample as is, then smooths with alpha = 0.3', () => {
    expect(CLOCK_EWMA_ALPHA).toBe(0.3);
    let o = foldOffset(null, 1_000);
    expect(o).toBe(1_000);
    o = foldOffset(o, 2_000);
    expect(o).toBeCloseTo(1_300, 9);
    o = foldOffset(o, 2_000);
    expect(o).toBeCloseTo(1_510, 9);
  });

  it('converges on a steady offset despite one outlier', () => {
    let o: number | null = null;
    for (let i = 0; i < 40; i++) o = foldOffset(o, i === 5 ? 30_000 : 2_000);
    expect(o!).toBeGreaterThan(1_990);
    expect(o!).toBeLessThan(2_010);
  });

  // A response whose server `now` is `skew` ahead of the local midpoint.
  const sampleAt = (clock: ReturnType<typeof createServerClock>, skew: number) =>
    clock.observe(1_000_000 + skew, 999_900, 1_000_100);

  it('rejects a single wild sample instead of folding it in', () => {
    expect(CLOCK_MAX_OFFSET_MS).toBe(HOUR);
    const clock = createServerClock(() => 0);
    sampleAt(clock, 2_000);
    sampleAt(clock, 5 * HOUR); // garbled or stale `now`
    expect(clock.offsetMs()).toBe(2_000);
    sampleAt(clock, 2_000);
    expect(clock.offsetMs()).toBe(2_000);
    // Wild from the very first response too: plain local time meanwhile.
    const fresh = createServerClock(() => 0);
    sampleAt(fresh, -5 * HOUR);
    expect(fresh.offsetMs()).toBe(0);
  });

  it(`believes an offset beyond ±1 h once ${CLOCK_CONFIRM_SAMPLES} samples in a row agree`, () => {
    expect([CLOCK_CONFIRM_SAMPLES, CLOCK_CONFIRM_SPREAD_MS]).toEqual([3, 5_000]);
    let local = 50_000;
    const clock = createServerClock(() => local);
    // This machine's clock is 2 h slow; the server says so on every poll.
    sampleAt(clock, 2 * HOUR);
    sampleAt(clock, 2 * HOUR + 3_000);
    expect(clock.offsetMs()).toBe(0);
    sampleAt(clock, 2 * HOUR - 1_500);
    expect(clock.offsetMs()).toBe(2 * HOUR + 500); // their mean
    local = 60_000;
    expect(clock.now()).toBe(60_000 + 2 * HOUR + 500);
    // From there it tracks the server as usual.
    sampleAt(clock, 2 * HOUR + 1_500);
    expect(clock.offsetMs()).toBeCloseTo(2 * HOUR + 800, 6);
    // And follows the local clock being fixed, again once confirmed.
    for (let i = 0; i < CLOCK_CONFIRM_SAMPLES - 1; i++) sampleAt(clock, 1_000);
    expect(clock.offsetMs()).toBeCloseTo(2 * HOUR + 800, 6);
    sampleAt(clock, 1_000);
    expect(clock.offsetMs()).toBe(1_000);
  });

  it('needs the far samples to agree and to be consecutive', () => {
    const clock = createServerClock(() => 0);
    sampleAt(clock, 0);
    // Three far samples, but spread over more than 5 s: all rejected.
    sampleAt(clock, 3 * HOUR);
    sampleAt(clock, 3 * HOUR + 4_000);
    sampleAt(clock, 3 * HOUR + 4_000 + CLOCK_CONFIRM_SPREAD_MS + 1);
    expect(clock.offsetMs()).toBe(0);
    // An in-range sample in between restarts the count.
    const c2 = createServerClock(() => 0);
    sampleAt(c2, 0);
    sampleAt(c2, 3 * HOUR);
    sampleAt(c2, 3 * HOUR);
    sampleAt(c2, 1_000);
    sampleAt(c2, 3 * HOUR);
    expect(c2.offsetMs()).toBeCloseTo(300, 6);
    // The last three agreeing is enough, whatever came before them.
    const c3 = createServerClock(() => 0);
    for (const s of [-7 * HOUR, 3 * HOUR, 3 * HOUR, 3 * HOUR]) sampleAt(c3, s);
    expect(c3.offsetMs()).toBe(3 * HOUR);
  });

  it('corrects now() once a response has been observed', () => {
    let local = 10_000;
    const clock = createServerClock(() => local);
    expect(clock.now()).toBe(10_000);
    clock.observe(70_000, 9_900, 10_100); // server is 60 s ahead
    expect(clock.offsetMs()).toBe(60_000);
    local = 11_000;
    expect(clock.now()).toBe(71_000);
    clock.observe(Number.NaN, 0, 0); // ignored
    expect(clock.offsetMs()).toBe(60_000);
  });
});
