import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { RadarFrame } from '../../types';
import { RadarPlayerView } from './RadarPlayer';
import { buildTimeline, formatClock } from './radarTimeline';

const T0 = 1_700_000_000; // frames every 10 minutes from here

function frames(count: number, start = T0): RadarFrame[] {
  return Array.from({ length: count }, (_, i) => ({ time: start + i * 600, path: `/v2/radar/p${start + i * 600}` }));
}

const noop = () => {};
const render = (timeline: ReturnType<typeof buildTimeline>, index: number, playing = true) =>
  renderToStaticMarkup(
    <RadarPlayerView timeline={timeline} index={index} playing={playing} onPlayingChange={noop} onSeek={noop} />
  );

describe('RadarPlayerView', () => {
  it('renders nothing until there are two frames to step between', () => {
    expect(render(buildTimeline([], [], 120), 0)).toBe('');
    expect(render(buildTimeline(frames(1), [], 120), 0)).toBe('');
  });

  it('is one line: play/pause, a scrub range over every frame, and the shown frame time', () => {
    const tl = buildTimeline(frames(13), [], 120);
    const html = render(tl, 4);
    expect(html).toContain('aria-label="Pause radar loop"');
    expect(html).toContain('max="12"');
    expect(html).toContain('value="4"');
    expect(html).toContain(`>${formatClock(T0 + 4 * 600)}<`);
    expect(html).toContain('title="−1h 20m"');
    expect(html).not.toContain('text-amber-300'); // no forecast here
    expect(render(tl, 4, false)).toContain('aria-label="Play radar loop"');
  });

  it('keeps an out-of-range index on the track', () => {
    const tl = buildTimeline(frames(13), [], 30);
    expect(render(tl, 12)).toContain('value="3"');
    expect(render(tl, 12)).toContain('title="Latest"');
  });

  it('marks forecast frames, on the track and in the time', () => {
    const tl = buildTimeline(frames(13), frames(3, T0 + 13 * 600), 120);
    const html = render(tl, 14);
    expect(html).toContain('bg-amber-300/35'); // the forecast stretch of the track
    expect(html).toContain('text-amber-300');
    expect(html).toContain('title="forecast +20 min"');
    expect(html).toContain(`>${formatClock(T0 + 14 * 600)}<`);
  });
});
