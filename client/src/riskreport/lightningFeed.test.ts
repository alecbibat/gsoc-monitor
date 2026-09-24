import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchLightningFeed, lightningSectionFromFeed } from './lightningFeed';
import type { LightningHistoryResponse } from '../types';
import type { LightningNearResponse } from '../types/lightning';

// /near first; an older server (no /near) gets the legacy history instead.
// In production that older server answers /near with its SPA index.html (200),
// not a 404 — both must fall back, and nothing else may.

const TARGET = { key: 'k', name: 'Lodge', lat: 40.12345, lon: -105.5 };
const NOW = Date.UTC(2026, 8, 24, 18, 0, 0);

const NEAR: LightningNearResponse = {
  v: 1,
  now: NOW,
  lat: 40.123,
  lon: -105.5,
  radiusMi: 130,
  hours: 24,
  counts: { le5: 0, le25: 7, le100: 70, inRadius: 99, exact: true },
  nearest: { mi: 11, ageS: 900, lat: 40.2, lon: -105.4 },
  points: { lat: [40.2], lon: [-105.4], t: [NOW / 1000 - 900], sampled: false },
  fidelity: { legacyBeforeMs: null, evictedBeforeMs: null },
  coverage: { windowMin: 1440, coveredMin: 1440, gaps: [], restoring: false, restoredBackToMs: null },
  collector: { connected: true, downSince: null, lastStrikeAgeS: 2, ratePerMin: 6000 },
};

const LEGACY: LightningHistoryResponse = {
  lat: [40.2],
  lon: [-105.4],
  t: [NOW / 1000 - 900],
  windowMin: 1440,
  totalInWindow: 1,
  returned: 1,
  thinned: false,
  coverageMin: 1440,
  connected: true,
  updated: NOW / 1000,
};

type Reply = { status: number; body: unknown } | { status: number; html: string };

function stubFetch(byPath: (path: string) => Reply) {
  const calls: string[] = [];
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    if (init?.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    calls.push(url);
    const r = byPath(url);
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      json: async () => ('html' in r ? JSON.parse(r.html) : r.body),
    } as unknown as Response;
  });
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe('fetchLightningFeed', () => {
  it('uses /near with the report radius, window and point budget', async () => {
    const calls = stubFetch(() => ({ status: 200, body: NEAR }));
    const feed = await fetchLightningFeed(TARGET);
    expect(feed).toEqual({ kind: 'near', near: NEAR });
    expect(calls).toHaveLength(1);
    const u = new URL(calls[0], 'http://x');
    expect(u.pathname).toBe('/api/lightning/near');
    expect(Object.fromEntries(u.searchParams)).toEqual({
      lat: '40.123',
      lon: '-105.500',
      radiusMi: '130',
      hours: '24',
      maxPoints: '6000',
    });
  });

  it('falls back to legacy history on a 404', async () => {
    const calls = stubFetch((p) =>
      p.startsWith('/api/lightning/near') ? { status: 404, body: {} } : { status: 200, body: LEGACY }
    );
    const feed = await fetchLightningFeed(TARGET);
    expect(feed).toEqual({ kind: 'legacy', history: LEGACY });
    expect(calls[1]).toBe('/api/lightning?minutes=1440&lat=40.123&lon=-105.500&radiusMi=130');
  });

  it("falls back when an older server's SPA fallback answers /near with index.html", async () => {
    stubFetch((p) =>
      p.startsWith('/api/lightning/near')
        ? { status: 200, html: '<!doctype html><html></html>' }
        : { status: 200, body: LEGACY }
    );
    expect((await fetchLightningFeed(TARGET)).kind).toBe('legacy');
  });

  it('a server error is not an older server — it propagates (section unavailable)', async () => {
    const calls = stubFetch(() => ({ status: 503, body: {} }));
    await expect(fetchLightningFeed(TARGET)).rejects.toThrow(/503/);
    expect(calls).toHaveLength(1);
  });

  it('an aborted report does not start the fallback', async () => {
    const calls = stubFetch(() => ({ status: 200, body: NEAR }));
    const ac = new AbortController();
    ac.abort();
    await expect(fetchLightningFeed(TARGET, ac.signal)).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });
});

describe('lightningSectionFromFeed', () => {
  it('routes each feed kind to its builder', () => {
    const a = lightningSectionFromFeed({ kind: 'near', near: NEAR }, TARGET, NOW);
    expect(a.section.level).toBe('guarded');
    expect(a.lightning.strikes25mi).toBe(7); // the server's count, not the one point
    const b = lightningSectionFromFeed({ kind: 'legacy', history: LEGACY }, TARGET, NOW);
    expect(b.lightning.strikes25mi).toBe(1);
  });
});
