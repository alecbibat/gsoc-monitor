import { describe, expect, it } from 'vitest';
import { MAX_LEVEL, makeRadarProvider, radarTileUrl } from './rainviewer';

const HOST = 'https://tilecache.rainviewer.com';
const FRAME = { time: 1_700_000_000, path: '/v2/radar/abc123' };

describe('radarTileUrl', () => {
  it('builds the RainViewer tile template for a frame', () => {
    expect(radarTileUrl(HOST, FRAME)).toBe(
      `${HOST}/v2/radar/abc123/512/{z}/{x}/{y}/2/1_1.png`
    );
  });
});

describe('makeRadarProvider', () => {
  // Above z7 the free tier answers with a "Zoom Level Not Supported"
  // placeholder tile; Cesium never requests past the provider's maximumLevel
  // and magnifies that level's tiles instead.
  it('never asks RainViewer for a level past its z7 cap', () => {
    expect(MAX_LEVEL).toBe(7);
    const provider = makeRadarProvider(HOST, FRAME);
    expect(provider.maximumLevel).toBe(MAX_LEVEL);
  });

  it('has no minimum level, so the layer shows from the whole-globe view down', () => {
    expect(makeRadarProvider(HOST, FRAME).minimumLevel).toBe(0);
  });
});
