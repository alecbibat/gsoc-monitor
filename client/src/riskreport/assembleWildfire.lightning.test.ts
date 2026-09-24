import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SnapshotOptions } from './mapSnapshot';
import type { LightningHistoryResponse } from '../types';
import type { LightningNearResponse } from '../types/lightning';

// The lightning path through the whole report: the section reaches the report,
// its caveats reach the bottom line even at Low, an older server falls back to
// legacy history, and the map draws each live strike as an X. Hotspots answer
// with none nearby (so a report always assembles) and every other feed is
// stubbed down, which keeps the BLUF free of anything but lightning and the
// down-feeds line.

const snapshots: SnapshotOptions[] = [];

vi.mock('../layers/fires/firesData', () => ({
  fetchHotspotsNearPins: async () => ({ hotspots: [], error: null }),
}));
vi.mock('../layers/wildfires/wildfiresData', () => ({
  fetchWildfires: async () => ({ fires: [], error: 'stubbed' }),
  containmentColor: () => '#ffffff',
}));
vi.mock('../layers/alerts/alertsData', () => ({
  fetchActiveAlerts: async () => {
    throw new Error('stubbed');
  },
  loadCounties: async () => {
    throw new Error('stubbed');
  },
  alertRings: () => [],
  severityRank: () => 0,
  alertColorHex: () => '#ffffff',
}));
vi.mock('../fuelzone/zonalStats', () => ({
  analyzeFuelZone: async () => {
    throw new Error('stubbed');
  },
}));
vi.mock('./mapSnapshot', () => ({
  renderMapSnapshot: async (opts: SnapshotOptions) => {
    snapshots.push(opts);
    return null;
  },
  drawFlame: () => {},
  drawHatchedPolygon: () => {},
  drawPin: () => {},
  drawPolygon: () => {},
  drawRing: () => {},
}));

const { assembleWildfireReport } = await import('./assembleWildfire');

const TARGET = { key: 'k', name: 'Estes Lodge', lat: 40.37, lon: -105.52 };

function nearResp(nowMs: number, o: Partial<LightningNearResponse> = {}): LightningNearResponse {
  const nowS = nowMs / 1000;
  return {
    v: 1,
    now: nowMs,
    lat: TARGET.lat,
    lon: TARGET.lon,
    radiusMi: 130,
    hours: 24,
    counts: { le5: 0, le25: 0, le100: 3, inRadius: 3, exact: true },
    nearest: { mi: 60, ageS: 3600, lat: 41.2, lon: -105.5 },
    points: {
      // One expired (25 h old — past the 24 h ramp), two live.
      lat: [41.2, 41.3, 41.1],
      lon: [-105.5, -105.4, -105.6],
      t: [nowS - 25 * 3600, nowS - 3600, nowS - 30],
      sampled: false,
    },
    fidelity: { legacyBeforeMs: null, evictedBeforeMs: null },
    coverage: {
      windowMin: 1440,
      coveredMin: 1440 - 90,
      gaps: [{ fromMs: nowMs - 6 * 3_600_000, toMs: nowMs - 4.5 * 3_600_000 }],
      restoring: false,
      restoredBackToMs: null,
    },
    collector: { connected: true, downSince: null, lastStrikeAgeS: 1, ratePerMin: 6000 },
    ...o,
  };
}

function stubFetch(lightning: (path: string) => { status: number; body: unknown }) {
  vi.stubGlobal('fetch', async (url: string) => {
    const path = String(url);
    // Every non-lightning feed (outlook, wind, daily, smoke, WPC) is down.
    const r = path.startsWith('/api/lightning') ? lightning(path) : { status: 503, body: {} };
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => r.body,
    } as unknown as Response;
  });
}

beforeEach(() => {
  snapshots.length = 0;
});
afterEach(() => vi.unstubAllGlobals());

describe('assembleWildfireReport — lightning', () => {
  it('surfaces the blind-spot caveat in the bottom line while lightning stays Low', async () => {
    const now = Date.now();
    stubFetch(() => ({ status: 200, body: nearResp(now) }));
    const report = await assembleWildfireReport(TARGET);

    const sec = report.sections.find((s) => s.id === 'lightning')!;
    expect(sec.unavailable).toBeUndefined();
    expect(sec.level).toBe('low');
    expect(sec.countLabel).toBe('None ≤25 mi');
    expect(report.overall.level).toBe('low');
    const blind = report.overall.drivers.filter((d) => d.startsWith('⚠ Lightning collector blind for 1h30m'));
    expect(blind).toHaveLength(1);
    // The count driver of a Low section stays out of the bottom line.
    expect(report.overall.drivers.some((d) => d.includes('within 100 mi'))).toBe(false);
    expect(report.lightning.strikes100mi).toBe(3);
    expect(report.lightning.coverage?.gaps).toHaveLength(1);
  });

  it('does not repeat a caveat that an elevated section already put in the bottom line', async () => {
    const now = Date.now();
    stubFetch(() => ({
      status: 200,
      body: nearResp(now, { nearest: { mi: 2, ageS: 600, lat: 40.39, lon: -105.52 } }),
    }));
    const report = await assembleWildfireReport(TARGET);
    expect(report.overall.level).toBe('elevated');
    expect(report.overall.drivers[0]).toBe('Strike 2 mi from the property 10 min ago — direct ignition source');
    expect(report.overall.drivers.filter((d) => d.startsWith('⚠ Lightning collector blind'))).toHaveLength(1);
  });

  it('draws each unexpired strike as an X, skipping the expired one', async () => {
    const now = Date.now();
    stubFetch(() => ({ status: 200, body: nearResp(now) }));
    await assembleWildfireReport(TARGET);
    const snap = snapshots.find((s) => s.attribution?.includes('Blitzortung'));
    expect(snap).toBeDefined();
    const calls: string[] = [];
    const ctx = new Proxy(
      {},
      {
        get: (_t, prop) => (prop in _t ? undefined : (...args: unknown[]) => void calls.push(`${String(prop)}(${args.length})`)),
        set: () => true,
      }
    ) as unknown as CanvasRenderingContext2D;
    const proj = { toXY: (lon: number, lat: number) => [lon, lat] } as unknown as Parameters<NonNullable<SnapshotOptions['draw']>>[1];
    snap!.draw!(ctx, proj);
    // drawStrikeX saves/restores once per X.
    expect(calls.filter((c) => c.startsWith('save'))).toHaveLength(2);
  });

  it('falls back to legacy history when the server has no /near', async () => {
    const nowS = Date.now() / 1000;
    const legacy: LightningHistoryResponse = {
      lat: [40.4],
      lon: [-105.52],
      t: [nowS - 600],
      windowMin: 1440,
      totalInWindow: 1,
      returned: 1,
      thinned: false,
      coverageMin: 1440,
      connected: true,
      updated: Math.round(nowS),
    };
    const paths: string[] = [];
    stubFetch((p) => {
      paths.push(p);
      return p.startsWith('/api/lightning/near') ? { status: 404, body: {} } : { status: 200, body: legacy };
    });
    const report = await assembleWildfireReport(TARGET);
    expect(paths.map((p) => p.split('?')[0])).toEqual(['/api/lightning/near', '/api/lightning']);
    const sec = report.sections.find((s) => s.id === 'lightning')!;
    expect(sec.unavailable).toBeUndefined();
    expect(sec.level).toBe('elevated');
    expect(report.lightning.strikes25mi).toBe(1);
  });

  it('a failing /near (not a missing route) makes the section unavailable, never Low', async () => {
    const paths: string[] = [];
    stubFetch((p) => {
      paths.push(p);
      return { status: 500, body: {} };
    });
    const report = await assembleWildfireReport(TARGET);
    expect(paths).toHaveLength(1); // no legacy retry for a server error
    const sec = report.sections.find((s) => s.id === 'lightning')!;
    expect(sec.unavailable).toMatch(/^Lightning history unavailable \(.*500/);
    expect(report.lightning.unavailable).toBe(sec.unavailable);
    expect(report.maps.lightning).toBeNull();
    expect(snapshots.some((s) => s.attribution?.includes('Blitzortung'))).toBe(false);
  });
});
