import type { AddressInfo } from 'net';
import type { Server } from 'http';
import express from 'express';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import riversRouter, { buildRiversSnapshot, type NwpsGauge } from './rivers';

// One NWPS /gauges entry; `observed`/`forecast` are floodCategory strings.
function nwps(
  lid: string,
  observed: string | undefined,
  forecast: string | undefined,
  extra: Partial<NwpsGauge> & { validTime?: string } = {}
): NwpsGauge {
  const { validTime, ...rest } = extra;
  return {
    lid,
    name: `${lid} River at Somewhere`,
    latitude: 38.123456,
    longitude: -90.654321,
    state: { abbreviation: 'MO', name: 'Missouri' },
    status: {
      observed: { primary: 12.3, primaryUnit: 'ft', secondary: 4.5, secondaryUnit: 'kcfs', floodCategory: observed, validTime },
      forecast: { primary: 14, primaryUnit: 'ft', floodCategory: forecast },
    },
    ...rest,
  };
}

const ZERO = { major: 0, moderate: 0, minor: 0, action: 0, normal: 0, low: 0, none: 0 };

describe('buildRiversSnapshot', () => {
  it('keeps live gauges and their counts exactly as before', () => {
    const snap = buildRiversSnapshot(
      [
        nwps('LIVE1', 'minor', 'moderate'),
        nwps('LIVE2', 'no_flooding', 'fcst_not_current'),
        nwps('FLOW1', 'not_defined', 'no_flooding', {
          status: { observed: { primary: 81.2, primaryUnit: 'kcfs', secondary: -999, floodCategory: 'not_defined' } },
        }),
      ],
      1_000
    );
    expect(snap.gauges).toEqual([
      {
        lid: 'LIVE1',
        name: 'LIVE1 River at Somewhere',
        lat: 38.1235,
        lon: -90.6543,
        state: 'MO',
        cat: 'minor',
        fcat: 'moderate',
        stage: 12.3,
        unit: 'ft',
        flow: 4.5,
        flowUnit: 'kcfs',
        isFlow: false,
      },
      expect.objectContaining({ lid: 'LIVE2', cat: 'normal', fcat: null }),
      expect.objectContaining({ lid: 'FLOW1', cat: 'none', fcat: null, stage: 81.2, isFlow: true, flow: null, flowUnit: '' }),
    ]);
    expect(snap.counts).toEqual({ ...ZERO, minor: 1, normal: 1, none: 1 });
    expect(snap.offline).toEqual([]);
    expect(snap.updated).toBe(1_000);
  });

  it('lists out-of-service and stale gauges as offline, with their forecast category', () => {
    const snap = buildRiversSnapshot([
      nwps('DARK1', 'out_of_service', 'major', { validTime: '2026-09-28T06:00:00Z' }),
      nwps('STALE1', 'obs_not_current', 'moderate', { validTime: '2026-09-29T01:15:00Z' }),
      nwps('STALE2', 'obs_not_current', 'fcst_not_current', { validTime: '' }),
    ]);
    expect(snap.offline).toEqual([
      {
        lid: 'DARK1',
        name: 'DARK1 River at Somewhere',
        lat: 38.1235,
        lon: -90.6543,
        state: 'MO',
        status: 'out_of_service',
        fcat: 'major',
        obsTime: '2026-09-28T06:00:00Z',
      },
      expect.objectContaining({ lid: 'STALE1', status: 'stale', fcat: 'moderate', obsTime: '2026-09-29T01:15:00Z' }),
      // No current forecast → null, never "normal"; a blank time is no time.
      expect.objectContaining({ lid: 'STALE2', status: 'stale', fcat: null, obsTime: null }),
    ]);
    // Still off the map layer and its legend.
    expect(snap.gauges).toEqual([]);
    expect(snap.counts).toEqual(ZERO);
  });

  it('skips every other uncategorized state, and points without coordinates', () => {
    const snap = buildRiversSnapshot([
      nwps('MISS1', 'missing', 'major'),
      nwps('FCST1', 'fcst_not_current', 'minor'),
      nwps('NONE1', undefined, 'minor'),
      nwps('ODD1', 'constructor', 'minor'),
      { lid: 'BARE1', name: 'No status at all', latitude: 40, longitude: -100 },
      nwps('NOPOS', 'out_of_service', 'major', { latitude: NaN }),
    ]);
    expect(snap.offline).toEqual([]);
    expect(snap.gauges).toEqual([]);
    expect(snap.counts).toEqual(ZERO);
  });

  it('leaves the counts to live gauges when both kinds are present', () => {
    const snap = buildRiversSnapshot([
      nwps('LIVE1', 'major', 'major'),
      nwps('DARK1', 'out_of_service', 'major'),
      nwps('STALE1', 'obs_not_current', 'major'),
    ]);
    expect(snap.gauges.map((g) => g.lid)).toEqual(['LIVE1']);
    expect(snap.offline.map((g) => g.lid)).toEqual(['DARK1', 'STALE1']);
    expect(snap.counts).toEqual({ ...ZERO, major: 1 });
  });
});

describe('rivers route', () => {
  const realFetch = globalThis.fetch;
  let server: Server;
  let base = '';

  beforeAll(async () => {
    const app = express();
    app.use('/api/rivers', riversRouter);
    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => resolve());
    });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/rivers`;
  });
  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('answers warming with an empty offline list, then serves the snapshot with it', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const pulls: string[] = [];
    vi.stubGlobal('fetch', async (input: string | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.hostname === '127.0.0.1') return realFetch(input, init);
      pulls.push(url.pathname);
      await gate;
      return new Response(
        JSON.stringify({ gauges: [nwps('LIVE1', 'minor', 'minor'), nwps('DARK1', 'out_of_service', 'moderate')] }),
        { headers: { 'content-type': 'application/json' } }
      );
    });

    const cold = await realFetch(base);
    expect(await cold.json()).toEqual({ gauges: [], counts: ZERO, offline: [], updated: expect.any(Number), warming: true });
    expect(pulls).toEqual(['/nwps/v1/gauges']);

    release();
    await vi.waitFor(async () => {
      const body = (await (await realFetch(base)).json()) as Record<string, unknown>;
      expect(body.warming).toBeUndefined();
      expect((body.gauges as Array<{ lid: string }>).map((g) => g.lid)).toEqual(['LIVE1']);
      expect(body.offline).toEqual([expect.objectContaining({ lid: 'DARK1', status: 'out_of_service', fcat: 'moderate' })]);
    });
  });
});
