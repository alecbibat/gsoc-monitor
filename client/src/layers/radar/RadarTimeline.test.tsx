import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { frameCaption, playButtonLabel, RadarTimeline, speedLabel } from './RadarTimeline';
import { formatClock, type TimelineFrame } from './radarTimeline';

const T0 = 1_700_000_000;
const frame = (i: number, forecast = false): TimelineFrame => ({
  frame: { time: T0 + i * 600, path: `/v2/radar/${i}` },
  time: T0 + i * 600,
  forecast,
});

describe('frameCaption (the time bubble)', () => {
  const newest = frame(12);

  it('reads "Now" on the newest observed frame', () => {
    expect(frameCaption(newest, newest, false)).toEqual({
      kind: 'now',
      lead: 'Now',
      text: formatClock(newest.time),
      offset: 'Latest',
    });
  });

  it('says "Latest" instead when the feed has stalled', () => {
    expect(frameCaption(newest, newest, true)).toMatchObject({ kind: 'latest', lead: 'Latest' });
  });

  it('shows the clock time for older frames', () => {
    expect(frameCaption(frame(9), newest, false)).toEqual({
      kind: 'past',
      lead: null,
      text: formatClock(frame(9).time),
      offset: '−30 min',
    });
  });

  it('shows the lead time for forecast frames', () => {
    expect(frameCaption(frame(13, true), newest, false)).toMatchObject({ kind: 'forecast', text: '+10 min' });
  });
});

describe('playButtonLabel', () => {
  it('names the action, and the loading progress while the loop loads', () => {
    expect(playButtonLabel({ playing: false, ready: 13, total: 13 }, false)).toBe('Play radar loop');
    expect(playButtonLabel({ playing: true, ready: 13, total: 13 }, false)).toBe('Pause radar loop');
    expect(playButtonLabel({ playing: false, ready: 5, total: 13 }, false)).toBe(
      'Play radar loop (loading 5 of 13 frames)'
    );
    expect(playButtonLabel({ playing: false, ready: 5, total: 13 }, true)).toContain('RainViewer busy');
  });
});

describe('RadarTimeline', () => {
  it('renders nothing while the radar layer is off', () => {
    expect(renderToStaticMarkup(<RadarTimeline />)).toBe('');
  });

  it('labels speeds', () => {
    expect([0.5, 1, 2].map((s) => speedLabel(s as 0.5 | 1 | 2))).toEqual(['½×', '1×', '2×']);
  });
});
