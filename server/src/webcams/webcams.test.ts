import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WEBCAMS, catalogProblems } from './catalog';
import { MAX_IMAGE_BYTES, getWebcamImage, imageFetchUrl, imageTtlMs, resetWebcamCache, webcamStatus } from './proxy';
import type { WebcamDef } from './types';
import { webcamInfo } from '../routes/webcams';

const cam: WebcamDef = {
  id: 'test-cam',
  parkCode: 'yell',
  name: 'Test Cam',
  operator: 'NPS',
  pageUrl: 'https://www.nps.gov/yell/learn/photosmultimedia/webcams.htm',
  kind: 'image',
  imageUrl: 'https://example.com/cam.jpg',
  lat: 44.46,
  lon: -110.83,
  refreshSec: 60,
};

const jpeg = (bytes = 10, headers: Record<string, string> = {}) =>
  new Response(new Uint8Array(bytes).fill(7), {
    status: 200,
    headers: { 'content-type': 'image/jpeg', 'last-modified': 'Thu, 05 Nov 2026 15:58:00 GMT', ...headers },
  });

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  resetWebcamCache();
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('webcam image proxy', () => {
  it('fetches once per freshness window and shares it', async () => {
    fetchMock.mockResolvedValue(jpeg());
    let t = 1_000_000;
    const now = () => t;
    const [a, b] = await Promise.all([getWebcamImage(cam, now), getWebcamImage(cam, now)]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(a.body.length).toBe(10);
    expect(b.contentType).toBe('image/jpeg');
    expect(a.imageUpdated).toBe(Date.parse('Thu, 05 Nov 2026 15:58:00 GMT'));
    t += imageTtlMs(cam) - 1;
    await getWebcamImage(cam, now);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    t += 2;
    fetchMock.mockResolvedValue(jpeg(12));
    expect((await getWebcamImage(cam, now)).body.length).toBe(12);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('serves the last good image, flagged stale, when a refresh fails', async () => {
    let t = 1_000_000;
    const now = () => t;
    fetchMock.mockResolvedValueOnce(jpeg());
    await getWebcamImage(cam, now);
    t += imageTtlMs(cam) + 1;
    fetchMock.mockResolvedValueOnce(new Response('down', { status: 503 }));
    const img = await getWebcamImage(cam, now);
    expect(img.stale).toBe(true);
    expect(img.body.length).toBe(10);
    expect(webcamStatus(cam.id)).toMatchObject({ ok: false, error: 'HTTP 503' });
  });

  it('throws with nothing to fall back on, and records why', async () => {
    fetchMock.mockResolvedValueOnce(new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } }));
    await expect(getWebcamImage(cam)).rejects.toThrow(/not an image/);
    expect(webcamStatus(cam.id)).toMatchObject({ ok: false });
  });

  it('refuses an oversized image', async () => {
    fetchMock.mockResolvedValueOnce(jpeg(10, { 'content-length': String(MAX_IMAGE_BYTES + 1) }));
    await expect(getWebcamImage(cam)).rejects.toThrow(/too large/);
  });

  it('sends the Referer a host expects, and a browser-like agent', async () => {
    fetchMock.mockResolvedValueOnce(jpeg());
    await getWebcamImage({ ...cam, referer: 'https://www.example.org/cams/' });
    const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>;
    expect(headers.Referer).toBe('https://www.example.org/cams/');
    expect(headers['User-Agent']).toMatch(/Mozilla/);
  });

  it('records a good fetch with when the image last changed', async () => {
    fetchMock.mockResolvedValueOnce(jpeg());
    await getWebcamImage(cam);
    expect(webcamStatus(cam.id)).toMatchObject({ ok: true, imageUpdated: '2026-11-05T15:58:00.000Z', error: null });
  });

  it("doesn't take a re-stamping host's word: age comes from seeing the bytes change", async () => {
    const restamper = { ...cam, id: 'restamper', trustLastModified: false };
    let t = 1_000_000;
    const now = () => t;
    // Same bytes every time, but Last-Modified always "just now".
    fetchMock.mockImplementation(async () => jpeg(10, { 'last-modified': new Date(t).toUTCString() }));
    const first = await getWebcamImage(restamper, now);
    expect(first.imageUpdated).toBeNull();
    expect(first.unchangedSince).toBe(1_000_000);
    t += imageTtlMs(restamper) + 1;
    const second = await getWebcamImage(restamper, now);
    expect(second.imageUpdated).toBeNull();
    expect(second.unchangedSince).toBe(1_000_000);
    // New bytes: the change is the image's time.
    t += imageTtlMs(restamper) + 1;
    fetchMock.mockImplementation(async () => jpeg(11));
    const third = await getWebcamImage(restamper, now);
    expect(third.imageUpdated).toBe(t);
    expect(third.unchangedSince).toBe(t);
  });

  it('keeps counting unchanged time even when Last-Modified is trusted', async () => {
    let t = 1_000_000;
    const now = () => t;
    fetchMock.mockImplementation(async () => jpeg(10));
    await getWebcamImage(cam, now);
    t += 3 * imageTtlMs(cam);
    const later = await getWebcamImage(cam, now);
    expect(later.imageUpdated).toBe(Date.parse('Thu, 05 Nov 2026 15:58:00 GMT'));
    expect(later.unchangedSince).toBe(1_000_000);
    expect(webcamStatus(cam.id)?.unchangedSince).toBe(new Date(1_000_000).toISOString());
  });

  it('adds a timestamp for hosts whose CDN would serve an old frame', async () => {
    expect(imageFetchUrl({ imageUrl: 'https://glacier.org/webcam/lpp_nps.jpg', bustCache: true }, 123)).toBe(
      'https://glacier.org/webcam/lpp_nps.jpg?_=123'
    );
    expect(imageFetchUrl({ imageUrl: 'https://x.example/cam.jpg?size=l', bustCache: true }, 9)).toBe('https://x.example/cam.jpg?size=l&_=9');
    expect(imageFetchUrl({ imageUrl: 'https://x.example/cam.jpg' }, 9)).toBe('https://x.example/cam.jpg');
    fetchMock.mockResolvedValueOnce(jpeg());
    await getWebcamImage({ ...cam, id: 'busted', bustCache: true }, () => 42);
    expect(fetchMock.mock.calls[0][0]).toBe('https://example.com/cam.jpg?_=42');
  });

  it('keeps a fetch between 20 s and 2 min', () => {
    expect(imageTtlMs({ refreshSec: 10 })).toBe(20_000);
    expect(imageTtlMs({ refreshSec: 60 })).toBe(30_000);
    expect(imageTtlMs({ refreshSec: 3600 })).toBe(120_000);
  });
});

describe('webcam catalog', () => {
  it('is well formed', () => {
    expect(catalogProblems(WEBCAMS)).toEqual([]);
  });

  it('catches the mistakes that matter', () => {
    const bad: WebcamDef[] = [
      { ...cam, id: 'Bad Id' },
      { ...cam, id: 'dup' },
      { ...cam, id: 'dup' },
      { ...cam, id: 'no-park', parkCode: 'zion' },
      { ...cam, id: 'no-image', imageUrl: undefined },
      { ...cam, id: 'no-embed', kind: 'stream', embedUrl: 'http://insecure.example/embed' },
      { ...cam, id: 'null-island', lat: 0, lon: 0 },
      { ...cam, id: 'plain-embed', embedUrl: 'http://player.example/cam' },
      { ...cam, id: 'leaky-link', kind: 'link' },
      { ...cam, id: 'plain-direct', browserDirect: true, imageUrl: 'http://cam.example/a.jpg' },
      { ...cam, id: 'margin-no-embed', embedMarginPx: 8 },
      { ...cam, id: 'huge-margin', embedUrl: 'https://player.example/cam', embedMarginPx: 400 },
    ];
    const problems = catalogProblems(bad).join('\n');
    expect(problems).toMatch(/Bad Id: id must be a lowercase slug/);
    expect(problems).toMatch(/dup: duplicate id/);
    expect(problems).toMatch(/no-park: unknown park zion/);
    expect(problems).toMatch(/no-image: image camera without imageUrl/);
    expect(problems).toMatch(/no-embed: stream camera without an https embedUrl/);
    expect(problems).toMatch(/null-island: bad coordinates/);
    expect(problems).toMatch(/plain-embed: embedUrl must be https/);
    expect(problems).toMatch(/leaky-link: a link camera must not be fetched or embedded/);
    expect(problems).toMatch(/plain-direct: a browser-direct camera needs an https image/);
    expect(problems).toMatch(/margin-no-embed: embedMarginPx needs an embedUrl/);
    expect(problems).toMatch(/huge-margin: embedMarginPx needs an embedUrl and 0–24 px/);
  });
});

describe('webcamInfo', () => {
  it("passes on the embed page's margin for the panel to crop, only for a camera with an embed", () => {
    expect(webcamInfo({ ...cam, embedUrl: 'https://player.example/cam', embedMarginPx: 8 }).embedMarginPx).toBe(8);
    expect(webcamInfo({ ...cam, embedMarginPx: 8 }).embedMarginPx).toBe(0);
    expect(webcamInfo(cam).embedMarginPx).toBe(0);
    const conservancy = WEBCAMS.filter((c) => c.embedUrl?.startsWith('https://pixelcaster.com/'));
    expect(conservancy.length).toBeGreaterThan(0);
    expect(conservancy.every((c) => webcamInfo(c).embedMarginPx === 8)).toBe(true);
  });
});
