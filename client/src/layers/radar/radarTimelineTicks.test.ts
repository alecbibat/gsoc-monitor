import { describe, expect, it } from 'vitest';
import { bufferRuns, bufferSegments, LABEL_MIN_GAP_PX, tickLabel, timelineTicks } from './radarTimelineTicks';

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

  it('adds half-hour labels once they fit', () => {
    expect(labelled(timelineTicks(frames(17, 0, 13), 400))).toEqual([0, 3, 6, 9, 12]);
    expect(labelled(timelineTicks(frames(17, 0, 13), 200))).toEqual([0, 3, 6, 9, 12]);
    expect(labelled(timelineTicks(frames(17, 0, 13), 150))).toEqual([0, 6, 12]);
  });

  it('labels every frame of a short loop on a wide track', () => {
    expect(labelled(timelineTicks(frames(17, 10, 4), 400))).toEqual([0, 1, 2, 3]);
  });

  it('spaces short labels by their width, not a fixed gap', () => {
    // A 30 min loop on a phone track and a 1 h loop on a desktop one are
    // labelled frame by frame: "5:10" needs ~30 px, not a sub-hour minimum.
    expect(labelled(timelineTicks(frames(17, 10, 4), 180))).toEqual([0, 1, 2, 3]);
    expect(labelled(timelineTicks(frames(17, 0, 7), 430))).toEqual([0, 1, 2, 3, 4, 5, 6]);
    // …until they would crowd: 30 px per frame falls back to the half-hours.
    expect(labelled(timelineTicks(frames(17, 0, 7), 180))).toEqual([0, 3, 6]);
  });

  it('never packs labels closer than the minimum gap, at any width', () => {
    const times = frames(16, 40, 16); // 2 h loop + 3 forecast frames, starting off the hour
    for (let w = 60; w <= 900; w += 7) {
      const xs = timelineTicks(times, w)
        .filter((t) => t.label)
        .map((t) => t.at * w);
      for (let k = 1; k < xs.length; k++) expect(xs[k] - xs[k - 1]).toBeGreaterThanOrEqual(LABEL_MIN_GAP_PX - 1e-9);
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

  it('still labels frames that never land on a whole ten minutes (UTC+5:45 and friends)', () => {
    // Frames at :05, :15 … local, as RainViewer's 10-minute grid falls in a
    // :45 time zone. Built from local wall-clock times like the rest, so this
    // holds whatever zone the tests run in.
    const times = frames(17, 5, 13); // 5:05 → 7:05 PM
    const wide = timelineTicks(times, 400);
    expect(labelled(wide)).toEqual([0, 3, 6, 9, 12]);
    expect(wide.filter((t) => t.major).map((t) => t.index)).toEqual([0, 6, 12]);
    expect(wide[3].label).toMatch(/^(5:35|17:35)$/);
    expect(labelled(timelineTicks(times, 150))).toEqual([0, 6, 12]);
    expect(labelled(timelineTicks(frames(17, 15, 4), 180))).toEqual([0, 1, 2, 3]);
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

describe('bufferSegments', () => {
  it('spans half a frame either side of each loaded run', () => {
    expect(bufferSegments('', 0)).toEqual([]);
    expect(bufferSegments('0000', 3)).toEqual([]);
    expect(bufferSegments('1111', 3)).toEqual([{ from: 0, to: 3, forecast: false }]);
    expect(bufferSegments('0000000000111', 12)).toEqual([{ from: 9.5, to: 12, forecast: false }]);
    expect(bufferSegments('1101', 3)).toEqual([
      { from: 0, to: 1.5, forecast: false },
      { from: 2.5, to: 3, forecast: false },
    ]);
  });

  it('splits runs at the newest observed frame', () => {
    // Frames 0–3 observed, 4–5 forecast.
    expect(bufferSegments('011110', 3)).toEqual([
      { from: 0.5, to: 3, forecast: false },
      { from: 3, to: 4.5, forecast: true },
    ]);
    expect(bufferSegments('000011', 3)).toEqual([{ from: 3.5, to: 5, forecast: true }]);
  });
});
