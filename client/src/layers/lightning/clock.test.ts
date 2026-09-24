import { describe, expect, it } from 'vitest';
import {
  CLOCK_EWMA_ALPHA,
  CLOCK_MAX_OFFSET_MS,
  createServerClock,
  foldOffset,
  offsetSample,
} from './clock';

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

  it('clamps to ±1 h', () => {
    expect(foldOffset(null, 5 * 3_600_000)).toBe(CLOCK_MAX_OFFSET_MS);
    expect(foldOffset(null, -5 * 3_600_000)).toBe(-CLOCK_MAX_OFFSET_MS);
    let o: number | null = null;
    for (let i = 0; i < 50; i++) o = foldOffset(o, 1e12);
    expect(o).toBe(CLOCK_MAX_OFFSET_MS);
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
