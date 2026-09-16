import { describe, expect, it } from 'vitest';
import { normalizeManifest } from './radar';

const good = {
  version: '2.0',
  generated: 1_789_252_526,
  host: 'https://tilecache.rainviewer.com',
  radar: {
    past: [
      { time: 1_789_245_600, path: '/v2/radar/b' },
      { time: 1_789_245_000, path: '/v2/radar/a' },
    ],
    nowcast: [{ time: 1_789_246_200, path: '/v2/radar/nowcast_c' }],
  },
  satellite: { infrared: [{ time: 1, path: '/v2/satellite/x' }] },
};

describe('normalizeManifest', () => {
  it('keeps host, timestamp and radar frames sorted oldest first; drops satellite', () => {
    const m = normalizeManifest(good);
    expect(m).toEqual({
      host: 'https://tilecache.rainviewer.com',
      generated: 1_789_252_526,
      past: [
        { time: 1_789_245_000, path: '/v2/radar/a' },
        { time: 1_789_245_600, path: '/v2/radar/b' },
      ],
      nowcast: [{ time: 1_789_246_200, path: '/v2/radar/nowcast_c' }],
    });
  });

  it('ignores malformed frames and a missing nowcast list', () => {
    const m = normalizeManifest({
      host: 'https://tilecache.rainviewer.com',
      radar: { past: [{ time: 5, path: '/ok' }, { time: 'x', path: '/bad' }, null, 'junk'] },
    });
    expect(m.past).toEqual([{ time: 5, path: '/ok' }]);
    expect(m.nowcast).toEqual([]);
    expect(typeof m.generated).toBe('number');
  });

  it('rejects payloads that could not drive the layer', () => {
    expect(() => normalizeManifest(null)).toThrow();
    expect(() => normalizeManifest({ ...good, host: 'tilecache.rainviewer.com' })).toThrow(/host/);
    expect(() => normalizeManifest({ ...good, radar: { past: [] } })).toThrow(/frames/);
  });
});
