import * as Cesium from 'cesium';
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
    // Cesium clamps to maximumLevel first and minimumLevel second, so a
    // minimum above the cap would override it.
    expect(provider.minimumLevel).toBeLessThanOrEqual(MAX_LEVEL);
  });

  // The cap is only a cap on the URL's {z} if Cesium's level is the XYZ zoom:
  // a single level-0 Web Mercator tile, and {z} rather than {reverseZ}.
  it("maps Cesium's level straight onto RainViewer's XYZ zoom", () => {
    const scheme = makeRadarProvider(HOST, FRAME).tilingScheme;
    expect(scheme).toBeInstanceOf(Cesium.WebMercatorTilingScheme);
    expect(scheme.getNumberOfXTilesAtLevel(0)).toBe(1);
    expect(scheme.getNumberOfYTilesAtLevel(0)).toBe(1);
    expect(radarTileUrl(HOST, FRAME)).toContain('/{z}/{x}/{y}/');
  });
});
