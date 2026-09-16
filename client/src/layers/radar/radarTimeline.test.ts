import { describe, expect, it } from 'vitest';
import type { RadarFrame } from '../../types';
import {
  buildTimeline,
  clampIndex,
  formatOffset,
  manifestSignature,
  nextIndex,
  nowIndex,
  windowLabel,
} from './radarTimeline';

const T0 = 1_700_000_000; // an arbitrary epoch, frames every 10 minutes

function frames(count: number, start = T0, prefix = 'p'): RadarFrame[] {
  return Array.from({ length: count }, (_, i) => ({
    time: start + i * 600,
    path: `/v2/radar/${prefix}${i}`,
  }));
}

describe('buildTimeline', () => {
  const past = frames(13); // 2 h of history

  it('is empty without observed frames, even if a forecast exists', () => {
    expect(buildTimeline([], frames(3, T0 + 13 * 600), 120)).toEqual([]);
  });

  it('keeps the observed frames within the window, newest included', () => {
    const tl = buildTimeline(past, [], 30);
    expect(tl.map((t) => t.frame.path)).toEqual(['/v2/radar/p9', '/v2/radar/p10', '/v2/radar/p11', '/v2/radar/p12']);
    expect(tl.every((t) => !t.forecast)).toBe(true);
    expect(buildTimeline(past, [], 60)).toHaveLength(7);
    expect(buildTimeline(past, [], 120)).toHaveLength(13);
  });

  it('measures the window from the newest frame, not the wall clock', () => {
    const stale = frames(13, T0 - 86_400); // yesterday's manifest
    expect(buildTimeline(stale, [], 30)).toHaveLength(4);
  });

  it('appends forecast frames after the newest observed one, flagged', () => {
    const nowcast = frames(3, T0 + 13 * 600, 'n');
    const tl = buildTimeline(past, nowcast, 30);
    expect(tl).toHaveLength(7);
    expect(tl.slice(0, 4).every((t) => !t.forecast)).toBe(true);
    expect(tl.slice(4).every((t) => t.forecast)).toBe(true);
    expect(tl[6].time).toBe(T0 + 15 * 600);
  });

  it('drops forecast frames that are not newer than the latest observation', () => {
    const overlapping = frames(3, T0 + 11 * 600, 'n'); // first two overlap history
    const tl = buildTimeline(past, overlapping, 120);
    expect(tl.filter((t) => t.forecast)).toHaveLength(1);
  });
});

describe('nowIndex', () => {
  it('points at the newest observed frame, before any forecast', () => {
    const tl = buildTimeline(frames(13), frames(3, T0 + 13 * 600, 'n'), 60);
    expect(nowIndex(tl)).toBe(6);
    expect(tl[6].forecast).toBe(false);
    expect(tl[7].forecast).toBe(true);
  });

  it('is the last frame when there is no forecast', () => {
    expect(nowIndex(buildTimeline(frames(13), [], 60))).toBe(6);
  });

  it('is 0 for an empty timeline', () => {
    expect(nowIndex([])).toBe(0);
  });
});

describe('clampIndex / nextIndex', () => {
  it('clamps into range and floors fractional input', () => {
    expect(clampIndex(-3, 5)).toBe(0);
    expect(clampIndex(9, 5)).toBe(4);
    expect(clampIndex(2.7, 5)).toBe(2);
    expect(clampIndex(3, 0)).toBe(0);
  });

  it('advances and wraps', () => {
    expect(nextIndex(0, 5)).toBe(1);
    expect(nextIndex(4, 5)).toBe(0);
    expect(nextIndex(9, 5)).toBe(0); // out-of-range input is clamped first
    expect(nextIndex(0, 0)).toBe(0);
  });
});

describe('manifestSignature', () => {
  it('changes only when the host or the frame set changes', () => {
    const a = manifestSignature('h', frames(2), []);
    expect(manifestSignature('h', frames(2), [])).toBe(a);
    expect(manifestSignature('h', frames(2), frames(1, T0, 'n'))).not.toBe(a);
    expect(manifestSignature('h', frames(3), [])).not.toBe(a);
    expect(manifestSignature('other', frames(2), [])).not.toBe(a);
  });
});

describe('labels', () => {
  it('formats offsets relative to the latest frame', () => {
    expect(formatOffset(0)).toBe('Latest');
    expect(formatOffset(20)).toBe('Latest'); // rounds to the minute
    expect(formatOffset(-1200)).toBe('−20 min');
    expect(formatOffset(600)).toBe('+10 min');
    expect(formatOffset(-4200)).toBe('−1h 10m');
    expect(formatOffset(-7200)).toBe('−2 hr');
  });

  it('labels windows in minutes or hours', () => {
    expect(windowLabel(30)).toBe('30 min');
    expect(windowLabel(60)).toBe('1 hr');
    expect(windowLabel(120)).toBe('2 hr');
  });
});
