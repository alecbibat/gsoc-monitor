import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { WebcamInfo } from '../../types';
import { WebcamDetails } from './WebcamDetails';
import { ageText, directImageSrc, refreshText, siteOf, staleAfterMs, webcamFreshness, webcamIcon } from './webcamMeta';

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
  directUrl: null,
  directBustCache: false,
  note: 'Faces Old Faithful Geyser from the visitor education center.',
  timeOnImage: false,
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

describe('webcamFreshness', () => {
  const NOW = 10_000_000_000;
  const MIN = 60_000;
  it('reads a fresh picture as fresh', () => {
    expect(webcamFreshness({ updated: NOW - 3 * MIN, unchangedSince: NOW - 2 * MIN, refreshSec: 60, now: NOW })).toEqual({
      stale: false,
      text: 'Updated 3 min ago',
    });
  });

  it('calls an old picture stale', () => {
    expect(webcamFreshness({ updated: NOW - 90 * MIN, unchangedSince: NOW - 5 * MIN, refreshSec: 60, now: NOW })).toEqual({
      stale: true,
      text: 'Last new image 2 h ago',
    });
  });

  it("calls a picture stale when its bytes haven't changed, whatever the header claims", () => {
    expect(webcamFreshness({ updated: NOW - 2 * MIN, unchangedSince: NOW - 45 * MIN, refreshSec: 60, now: NOW })).toEqual({
      stale: true,
      text: 'No new image for 45 min',
    });
  });

  it('says where the time is when the camera only prints it', () => {
    expect(webcamFreshness({ updated: null, unchangedSince: NOW, refreshSec: 900, now: NOW, timeOnImage: true }).text).toBe(
      'Capture time is printed on the image'
    );
    expect(webcamFreshness({ updated: null, unchangedSince: NOW, refreshSec: 900, now: NOW }).text).toBeNull();
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

  it('offers a Still / Live video switch when the operator also streams the camera', () => {
    const html = renderToStaticMarkup(
      <WebcamDetails payload={{ ...cam, embedUrl: 'https://pixelcaster.com/live/grandcanyon/cam2.html' }} />
    );
    expect(html).toContain('aria-label="Camera view"');
    expect(html).toContain('Live video');
    expect(html).toContain('Loading camera…');
    expect(html).not.toContain('<iframe');
  });

  it('sends a link-out camera to its operator, embedding nothing', () => {
    const html = renderToStaticMarkup(
      <WebcamDetails
        payload={{
          ...cam,
          kind: 'link',
          imagePath: null,
          operator: 'NPS and Yellowstone Forever',
          pageUrl: 'https://www.nps.gov/yell/learn/photosmultimedia/webcams.htm',
        }}
      />
    );
    expect(html).toContain('Watch on nps.gov');
    expect(html).toContain("it can&#x27;t be embedded here");
    expect(html).not.toContain('<iframe');
    expect(html).not.toContain('Loading camera');
    expect(siteOf('https://www.earthcam.com/usa/southdakota/keystone/mountrushmore/')).toBe('earthcam.com');
  });

  it('loads a browser-direct camera from its host, with a timestamp against stale CDN frames', () => {
    expect(directImageSrc('https://glacier.org/webcam/lpp_nps.jpg', true, 5)).toBe('https://glacier.org/webcam/lpp_nps.jpg?_=5');
    expect(directImageSrc('https://glacier.org/webcam/lpp_nps.jpg', false, 5)).toBe('https://glacier.org/webcam/lpp_nps.jpg');
    const html = renderToStaticMarkup(
      <WebcamDetails
        payload={{ ...cam, imagePath: null, directUrl: 'https://glacier.org/webcam/lpp_nps.jpg', directBustCache: true }}
      />
    );
    expect(html).toMatch(/<img src="https:\/\/glacier\.org\/webcam\/lpp_nps\.jpg\?_=\d+"/);
    expect(html).not.toContain('Loading camera…');
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
