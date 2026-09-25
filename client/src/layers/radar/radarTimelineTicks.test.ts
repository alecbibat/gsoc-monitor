import { describe, expect, it } from 'vitest';
import { bufferRuns, LABEL_MIN_GAP_PX, tickLabel, timelineTicks } from './radarTimelineTicks';

// Frame times built from local wall-clock times, so "on the hour" holds in
// whatever time zone the tests run in.
const at = (h: number, m: number) => new Date(2026, 8, 25, h, m).getTime() / 1000;
function frames(h: number, m: number, count: number, stepMin = 10): number[] {
  const start = at(h, m);
  return Array.from({ length: count }, (_, i) => start + i * stepMin * 60);
}

const labelled = (ticks: ReturnType<typeof timelineTicks>) => ticks.filter((t) => t.label).map((t) => t.index);

describe('timelineTicks', () => {
  it('is empty without a track to draw on', () => {
    expect(timelineTicks([], 300)).toEqual([]);
    expect(timelineTicks(frames(17, 0, 1), 300)).toEqual([]);
    expect(timelineTicks(frames(17, 0, 13), 0)).toEqual([]);
  });

  it('puts one tick per frame, taller on the hour, positioned by index', () => {
    const ticks = timelineTicks(frames(17, 0, 13), 400); // 5:00 → 7:00 PM
    expect(ticks).toHaveLength(13);
    expect(ticks.filter((t) => t.major).map((t) => t.index)).toEqual([0, 6, 12]);
    expect(ticks[3].at).toBeCloseTo(0.25);
    expect(ticks[12].at).toBe(1);
  });

  it('labels only the hours on a narrow (phone) track', () => {
    const ticks = timelineTicks(frames(17, 0, 13), 150);
    expect(labelled(ticks)).toEqual([0, 6, 12]);
    for (const t of ticks.filter((x) => x.label)) expect(t.major).toBe(true);
  });

  it('adds half-hour labels only when the track has room to spare', () => {
    expect(labelled(timelineTicks(frames(17, 0, 13), 400))).toEqual([0, 3, 6, 9, 12]);
    expect(labelled(timelineTicks(frames(17, 0, 13), 260))).toEqual([0, 6, 12]);
  });

  it('labels every frame of a short loop on a wide track', () => {
    expect(labelled(timelineTicks(frames(17, 10, 4), 400))).toEqual([0, 1, 2, 3]);
  });

  it('never packs labels closer than the minimum gap, at any width', () => {
    const times = frames(16, 40, 16); // 2 h loop + 3 forecast frames, starting off the hour
    for (let w = 60; w <= 900; w += 7) {
      const xs = timelineTicks(times, w)
        .filter((t) => t.label)
        .map((t) => t.at * w);
      for (let k = 1; k < xs.length; k++) expect(xs[k] - xs[k - 1]).toBeGreaterThanOrEqual(LABEL_MIN_GAP_PX);
    }
  });

  it('keeps end labels inside the track', () => {
    const ticks = timelineTicks(frames(17, 0, 13), 150);
    expect(ticks[0].align).toBe('start');
    expect(ticks[12].align).toBe('end');
    expect(ticks[6].align).toBe('center');
  });

  it('drops the per-frame ticks when they would smear together, keeping the hours', () => {
    const ticks = timelineTicks(frames(17, 0, 13), 36); // 3 px per frame
    expect(ticks.map((t) => t.index)).toEqual([0, 6, 12]);
  });

  it('has no hour ticks when no frame falls on the hour', () => {
    const ticks = timelineTicks(frames(17, 10, 4), 400);
    expect(ticks.some((t) => t.major)).toBe(false);
  });
});

describe('tickLabel', () => {
  it('names the hour on the hour and the minutes between', () => {
    // 12-hour clocks read "5 PM" on the hour; 24-hour clocks "17:00".
    expect(tickLabel(at(17, 0))).toMatch(/^(5\sPM|17:00)$/i);
    // Between the hours there's no AM/PM: its neighbours imply it.
    expect(tickLabel(at(17, 30))).toMatch(/^(5:30|17:30)$/);
  });
});

describe('bufferRuns', () => {
  it('groups loaded frames into runs', () => {
    expect(bufferRuns('')).toEqual([]);
    expect(bufferRuns('0000')).toEqual([]);
    expect(bufferRuns('1111')).toEqual([[0, 3]]);
    expect(bufferRuns('1100111010')).toEqual([
      [0, 1],
      [4, 6],
      [8, 8],
    ]);
  });
});
