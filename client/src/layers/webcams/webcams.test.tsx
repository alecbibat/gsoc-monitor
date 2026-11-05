import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { WebcamInfo } from '../../types';
import { WebcamDetails } from './WebcamDetails';
import { ageText, refreshText, staleAfterMs, webcamIcon } from './webcamMeta';

const cam: WebcamInfo = {
  id: 'yell-old-faithful',
  parkCode: 'yell',
  park: 'Yellowstone',
  name: 'Old Faithful',
  operator: 'NPS',
  pageUrl: 'https://www.nps.gov/yell/learn/photosmultimedia/webcams.htm',
  kind: 'image',
  embedUrl: null,
  lat: 44.4605,
  lon: -110.8281,
  approxLocation: true,
  refreshSec: 60,
  imagePath: '/api/webcams/yell-old-faithful/image',
  note: 'Faces Old Faithful Geyser from the visitor education center.',
  status: null,
};

describe('webcam wording', () => {
  it('says how old a picture is', () => {
    expect(ageText(20_000)).toBe('just now');
    expect(ageText(4 * 60_000)).toBe('4 min ago');
    expect(ageText(3 * 3_600_000)).toBe('3 h ago');
    expect(ageText(3 * 86_400_000)).toBe('3 days ago');
  });

  it('calls a picture stale after four refreshes, never under half an hour', () => {
    expect(staleAfterMs(60)).toBe(30 * 60_000);
    expect(staleAfterMs(3600)).toBe(4 * 3_600_000);
  });

  it('names the refresh cadence', () => {
    expect(refreshText(60)).toBe('Updates every minute');
    expect(refreshText(300)).toBe('Updates every 5 min');
    expect(refreshText(3600)).toBe('Updates hourly');
  });

  it('marks live-video cameras on the map', () => {
    expect(decodeURIComponent(webcamIcon('stream'))).toContain('#ef4444');
    expect(decodeURIComponent(webcamIcon('image'))).not.toContain('#ef4444');
  });
});

describe('WebcamDetails', () => {
  it('shows a still camera with its operator, cadence, note and source', () => {
    const html = renderToStaticMarkup(<WebcamDetails payload={cam} />);
    expect(html).toContain('Loading camera…');
    expect(html).toContain('Yellowstone');
    expect(html).toContain('NPS');
    expect(html).toContain('Updates every minute');
    expect(html).toContain('Faces Old Faithful Geyser');
    expect(html).toContain('href="https://www.nps.gov/yell/learn/photosmultimedia/webcams.htm"');
    expect(html).toContain('Marked at the place it shows');
    expect(html).not.toContain('<iframe');
  });

  it('embeds a live-video camera', () => {
    const html = renderToStaticMarkup(
      <WebcamDetails
        payload={{ ...cam, kind: 'stream', imagePath: null, embedUrl: 'https://www.youtube.com/embed/abc123?autoplay=1&mute=1', approxLocation: false }}
      />
    );
    expect(html).toContain('<iframe');
    expect(html).toContain('src="https://www.youtube.com/embed/abc123?autoplay=1&amp;mute=1"');
    expect(html).toContain('Live video');
    expect(html).not.toContain('Marked at the place it shows');
  });
});
