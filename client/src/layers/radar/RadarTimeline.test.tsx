import { afterEach, describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  ANNOUNCE_EVERY_MS,
  bubbleLeft,
  frameCaption,
  frameValueText,
  ghostLabelClear,
  nextAnnounced,
  playButtonLabel,
  RadarTimeline,
  Scrubber,
  speedLabel,
} from './RadarTimeline';
import { buildTimeline, formatClock, type TimelineFrame } from './radarTimeline';
import { radarPlayhead } from './radarPlayhead';

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
  it('names the action, and that the loop is still loading', () => {
    expect(playButtonLabel({ playing: false, ready: 13, total: 13 }, false)).toBe('Play radar loop');
    expect(playButtonLabel({ playing: true, ready: 13, total: 13 }, false)).toBe('Pause radar loop');
    expect(playButtonLabel({ playing: false, ready: 5, total: 13 }, false)).toBe('Play radar loop (loading)');
    expect(playButtonLabel({ playing: false, ready: 5, total: 13 }, true)).toBe(
      'Play radar loop (loading) · RainViewer busy'
    );
  });

  it('keeps the name steady as frames load, counting them only in the tooltip', () => {
    const name = (ready: number) => playButtonLabel({ playing: true, ready, total: 13 }, false);
    expect(name(4)).toBe(name(9));
    expect(playButtonLabel({ playing: false, ready: 5, total: 13 }, false, true)).toBe(
      'Play radar loop (loading 5 of 13 frames)'
    );
  });
});

describe('frameValueText (the slider value a screen reader speaks)', () => {
  const newest = frame(12);

  it('gives the clock time and where the frame sits', () => {
    expect(frameValueText(newest, newest, false)).toBe(`${formatClock(newest.time)}, latest frame`);
    expect(frameValueText(frame(9), newest, false)).toBe(`${formatClock(frame(9).time)}, −30 min`);
    expect(frameValueText(frame(14, true), newest, true)).toBe(`${formatClock(frame(14).time)}, forecast +20 min`);
  });
});

describe('nextAnnounced', () => {
  it('follows every frame while paused', () => {
    const a = nextAnnounced(null, 3, false, 1000);
    expect(a).toEqual({ index: 3, at: 1000 });
    expect(nextAnnounced(a, 4, false, 1100)).toEqual({ index: 4, at: 1100 });
  });

  it('moves at most every ANNOUNCE_EVERY_MS while the loop plays', () => {
    let a = nextAnnounced(null, 0, true, 0);
    a = nextAnnounced(a, 1, true, 600);
    expect(a.index).toBe(0);
    a = nextAnnounced(a, 7, true, ANNOUNCE_EVERY_MS - 1);
    expect(a.index).toBe(0);
    a = nextAnnounced(a, 8, true, ANNOUNCE_EVERY_MS);
    expect(a).toEqual({ index: 8, at: ANNOUNCE_EVERY_MS });
    // Pausing catches it up straight away.
    expect(nextAnnounced(a, 9, false, ANNOUNCE_EVERY_MS + 5).index).toBe(9);
  });

  it('keeps the same object while nothing changes', () => {
    const a = nextAnnounced(null, 2, false, 0);
    expect(nextAnnounced(a, 2, true, 50_000)).toBe(a);
  });
});

describe('bubble and hover ghost', () => {
  it('centres the bubble over the knob, clamped near the track ends', () => {
    expect(bubbleLeft(200, 80, 400)).toBe(160);
    expect(bubbleLeft(0, 80, 400)).toBe(-10);
    expect(bubbleLeft(400, 80, 400)).toBe(330);
  });

  it('drops the ghost label only where it would overlap the bubble', () => {
    // Bubble 160–240.
    expect(ghostLabelClear(200, 50, 160, 80)).toBe(false);
    expect(ghostLabelClear(110, 50, 160, 80)).toBe(false); // ends flush with it, inside the 4 px gap
    expect(ghostLabelClear(107, 50, 160, 80)).toBe(false); // 3 px short
    expect(ghostLabelClear(106, 50, 160, 80)).toBe(true); // exactly 4 px clear
    expect(ghostLabelClear(100, 50, 160, 80)).toBe(true);
    expect(ghostLabelClear(244, 50, 160, 80)).toBe(true); // 4 px past its right edge
    expect(ghostLabelClear(243, 50, 160, 80)).toBe(false);
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

describe('Scrubber markup', () => {
  // 13 observed frames ending `ageMin` minutes ago, then `forecast` nowcast
  // frames, with the playhead published as the engine would.
  function mount(o: { ageMin?: number; forecast?: number; index?: number; mask?: string; playing?: boolean }) {
    const newest = Math.floor(Date.now() / 1000) - (o.ageMin ?? 5) * 60;
    const past = Array.from({ length: 13 }, (_, i) => ({ time: newest - (12 - i) * 600, path: `/p${i}` }));
    const nowcast = Array.from({ length: o.forecast ?? 0 }, (_, i) => ({ time: newest + (i + 1) * 600, path: `/n${i}` }));
    const total = past.length + nowcast.length;
    radarPlayhead.set({
      position: o.index ?? 12,
      index: o.index ?? 12,
      playing: o.playing ?? false,
      buffering: false,
      ready: (o.mask ?? '1'.repeat(total)).split('').filter((c) => c === '1').length,
      total,
      readyMask: o.mask ?? '1'.repeat(total),
      live: (o.index ?? 12) === 12 && !o.playing,
    });
    return renderToStaticMarkup(<Scrubber timeline={buildTimeline(past, nowcast, 120)} />);
  }

  afterEach(() => radarPlayhead.reset());

  it('lights only the loaded frames on the bar', () => {
    const html = mount({ mask: '0000000000111' });
    // One lit segment, from half a frame before frame 10 to the end.
    const lit = html.match(/class="absolute inset-y-0 bg-accent\/60" style="left:([\d.]+)%;width:([\d.]+)%/);
    expect(lit).not.toBeNull();
    expect(Number(lit![1])).toBeCloseTo((9.5 / 12) * 100);
    expect(Number(lit![2])).toBeCloseTo((2.5 / 12) * 100);
  });

  it('names the newest frame one way in the bubble and the readout', () => {
    const fresh = mount({ index: 12 });
    expect(fresh.match(/>Now</g)).toHaveLength(2);
    expect(fresh).not.toContain('Latest<');
    expect(fresh).not.toContain('Delayed');
    radarPlayhead.reset();
    const stale = mount({ ageMin: 45, index: 12 });
    expect(stale.match(/>Latest</g)).toHaveLength(2);
    expect(stale).not.toContain('>Now<');
  });

  it('keeps the jump button out of a phone layout while resting on the newest frame', () => {
    const jump = (html: string) => html.match(/<button[^>]*aria-label="Jump to the latest radar frame"[^>]*>/)![0];
    expect(jump(mount({ index: 12 }))).toMatch(/class="hidden [^"]*sm:grid[^"]* invisible/);
    radarPlayhead.reset();
    expect(jump(mount({ index: 5 }))).toMatch(/class="grid [^"]* visible/);
    radarPlayhead.reset();
    // Playing, it keeps its slot from sm up only.
    expect(jump(mount({ index: 5, playing: true }))).toMatch(/class="hidden [^"]*sm:grid[^"]* visible/);
  });

  it('explains a delayed feed to screen readers, and drops "Forecast" beside the chip', () => {
    const html = mount({ ageMin: 45, forecast: 3, index: 14 });
    expect(html).toContain('<span class="sr-only">: The newest radar frame is 45 min old');
    expect(html).toContain('>+20 min</span>');
    expect(html).not.toContain('Forecast');
  });
});
