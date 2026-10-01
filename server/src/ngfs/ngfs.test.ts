import express from 'express';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNgfsRouter } from './index';
import { aggregatePixels, frameTimeMs, isWildlandType, parseFrame, type NgfsFrame } from './parse';
import { cookiesFrom, RealEarthClient, REALEARTH_BASE } from './realearth';
import { NgfsService, type NgfsProduct } from './service';

// Real NGFS detections (2026-10-01 20:01 UTC) in RealEarth's raw property
// names, with the literal "NULL" upstream uses for an absent value.
function feature(lon: number, lat: number, props: Record<string, unknown>) {
  return { type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] }, properties: props };
}
const DOME = feature(-119.61361, 37.65861, {
  FRP: 1253.47,
  FEATURE_FRP: 1253.47,
  FEATURE_TRACKING_ID: 'ID-2026-09-20T16:51:17.000Z_0002',
  ACQ_DATE_TIME: '2026-10-01T20:01:17.000Z',
  TYPE_DESCRIPTION: 'Known Wildland Fire Incident',
  CONFIDENCE: 'nominal',
  STATE: 'CA',
  COUNTY: 'Mariposa County',
  KNOWN_INCIDENT_NAME: 'DOME',
  KNOWN_INCIDENT_TYPE: 'WF',
  FUEL: 'FBFM8:49,FBFM5:30,FBFM10:17,Barren:2,FBFM9:1,FBFM4:1',
  LAND_COVER: 'Trees:76,Shrubs:21,Barren:2,Grass/Herbs:1',
});
const CROSS_COUNTY = feature(-90.68833, 35.33278, {
  FRP: 414.83,
  FEATURE_FRP: 414.83,
  FEATURE_TRACKING_ID: 'ID-2026-10-01T19:46:17.000Z_0042',
  ACQ_DATE_TIME: '2026-10-01T20:01:17.000Z',
  TYPE_DESCRIPTION: 'Possible Wildland Fire',
  CONFIDENCE: 'nominal',
  STATE: 'AR',
  COUNTY: 'Cross County',
  KNOWN_INCIDENT_NAME: 'NULL',
  KNOWN_INCIDENT_TYPE: 'NULL',
});
const FLARE = feature(-93.1, 18.2, { FRP: 30, TYPE_DESCRIPTION: 'Oil/Gas', STATE: 'Tabasco' });

describe('parseFrame', () => {
  const frameT = Date.UTC(2026, 9, 1, 20, 1, 17);

  it('reads position, attributes and the acquisition time', () => {
    const [dome, cross] = parseFrame({ type: 'FeatureCollection', features: [DOME, CROSS_COUNTY] }, 0);
    expect(dome).toMatchObject({
      lat: 37.65861,
      lon: -119.61361,
      t: frameT,
      frp: 1253.47,
      featureFrp: 1253.47,
      trackId: 'ID-2026-09-20T16:51:17.000Z_0002',
      type: 'Known Wildland Fire Incident',
      incident: 'DOME',
      incidentType: 'WF',
      state: 'CA',
      county: 'Mariposa County',
    });
    // "NULL" sentinels become null rather than an incident called "NULL".
    expect(cross.incident).toBeNull();
    expect(cross.incidentType).toBeNull();
  });

  it('falls back to the frame time and drops non-points and bad coordinates', () => {
    const obs = parseFrame(
      {
        features: [
          feature(-100, 40, { FRP: '12.5', ACQ_DATE_TIME: 'garbage' }),
          { geometry: { type: 'Polygon', coordinates: [] }, properties: {} },
          feature(NaN, 40, {}),
          feature(-100, 95, {}),
          null,
        ],
      },
      frameT
    );
    expect(obs).toHaveLength(1);
    expect(obs[0]).toMatchObject({ t: frameT, frp: 12.5, type: 'Unclassified', trackId: null });
  });

  it('rejects a body that is not a FeatureCollection', () => {
    expect(() => parseFrame({ error: 'no session' }, 0)).toThrow(/FeatureCollection/);
    expect(() => parseFrame(null, 0)).toThrow();
  });
});

describe('classification and stamps', () => {
  it('separates wildland fire from other heat sources', () => {
    expect(isWildlandType('Possible Wildland Fire')).toBe(true);
    expect(isWildlandType('Known Wildland Fire Incident')).toBe(true);
    expect(isWildlandType('Possible Wildland Fire Near a Solar Farm')).toBe(true);
    expect(isWildlandType('Oil/Gas')).toBe(false);
    expect(isWildlandType('Industrial')).toBe(false);
    expect(isWildlandType('Likely an Urban Source')).toBe(false);
    expect(isWildlandType('Volcano')).toBe(false);
  });

  it('parses RealEarth frame stamps as UTC', () => {
    expect(frameTimeMs('20261001.200117')).toBe(Date.UTC(2026, 9, 1, 20, 1, 17));
    expect(frameTimeMs('2026-10-01')).toBeNull();
  });
});

describe('aggregatePixels', () => {
  const T0 = Date.UTC(2026, 9, 1, 19, 0, 0);
  const obs = (t: number, frp: number | null, extra: Partial<ReturnType<typeof parseFrame>[number]> = {}) => ({
    ...parseFrame({ features: [CROSS_COUNTY] }, 0)[0],
    t,
    frp,
    ...extra,
  });
  const frame = (t: number, observations: NgfsFrame['observations'], slot: 'east' | 'west' = 'east'): NgfsFrame => ({
    slot,
    sat: slot === 'east' ? 'GOES-19' : 'GOES-18',
    t,
    observations,
  });

  it('folds repeat detections of a pixel into one record with persistence and peak FRP', () => {
    const frames = [
      frame(T0, [obs(T0, 100)]),
      frame(T0 + 300_000, [obs(T0 + 300_000, 400, { type: 'Known Wildland Fire Incident', incident: 'X' })]),
      frame(T0 + 600_000, [obs(T0 + 600_000, 250)]),
    ];
    const [px, ...rest] = aggregatePixels(frames, 0);
    expect(rest).toHaveLength(0);
    expect(px).toMatchObject({ first: T0, last: T0 + 600_000, frames: 3, frp: 250, maxFrp: 400, slot: 'east' });
    // Attributes follow the latest observation.
    expect(px.incident).toBeNull();
    expect(px.type).toBe('Possible Wildland Fire');
  });

  it('keeps frames out of the window and processes them in any order', () => {
    const frames = [
      frame(T0 + 600_000, [obs(T0 + 600_000, 5)]),
      frame(T0, [obs(T0, 900)]),
      frame(T0 + 300_000, [obs(T0 + 300_000, 7)]),
    ];
    const [px] = aggregatePixels(frames, T0 + 1);
    expect(px).toMatchObject({ first: T0 + 300_000, last: T0 + 600_000, frames: 2, frp: 5, maxFrp: 7 });
  });

  it('keeps each satellite’s view of the same ground separate and sorts newest first', () => {
    const frames = [
      frame(T0, [obs(T0, 10)], 'east'),
      frame(T0 + 60_000, [obs(T0 + 60_000, 20)], 'west'),
      frame(T0, [obs(T0, 1, { lat: 30, lon: -90, type: 'Oil/Gas' })], 'east'),
    ];
    const px = aggregatePixels(frames, 0);
    expect(px.map((p) => [p.slot, p.frp])).toEqual([
      ['west', 20],
      ['east', 10],
      ['east', 1],
    ]);
    expect(px[2].wildland).toBe(false);
  });
});

describe('cookiesFrom', () => {
  it('keeps name=value and ignores attributes', () => {
    const jar = cookiesFrom(['PHPSESSID=abc123; path=/; HttpOnly', 'SERVERID=re2|xyz; Path=/', 'junk']);
    expect([...jar]).toEqual([
      ['PHPSESSID', 'abc123'],
      ['SERVERID', 're2|xyz'],
    ]);
  });
});

// A fake RealEarth viewer: hands out a session, echoes the hash, and answers
// /api calls only when all three re-* headers and the cookie match.
function fakeRealEarth(opts: { times: Record<string, string[]>; shapes?: (product: string, time: string) => unknown }) {
  let sessions = 0;
  const registered = new Set<string>();
  const calls: string[] = [];
  const fetchFn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const h = new Headers(init?.headers);
    calls.push(url.pathname + url.search);
    if (url.pathname === '/') {
      sessions++;
      const res = new Response('<html></html>', { status: 200 });
      res.headers.append('set-cookie', `PHPSESSID=sess${sessions}; path=/`);
      res.headers.append('set-cookie', 'SERVERID=lb1; path=/');
      return res;
    }
    if (url.pathname === '/util/session.php') {
      const sh = url.searchParams.get('sh')!;
      if (!h.get('cookie')?.includes(`PHPSESSID=sess${sessions}`)) return new Response('', { status: 403 });
      registered.add(sh);
      return new Response(sh);
    }
    const ok =
      registered.has(h.get('re-session-hash') ?? '') &&
      h.get('re-session-id') === `sess${sessions}` &&
      h.get('re-access-key') === '' &&
      h.get('cookie')?.includes(`PHPSESSID=sess${sessions}`);
    if (!ok) return new Response('{}', { status: 500 });
    const product = url.searchParams.get('products')!;
    if (url.pathname === '/api/products') return Response.json([{ id: product, times: opts.times[product] ?? [] }]);
    if (url.pathname === '/api/shapes') {
      return Response.json(
        opts.shapes?.(product, `${url.searchParams.get('date')}T${url.searchParams.get('time')}`) ?? {
          type: 'FeatureCollection',
          features: [],
        }
      );
    }
    return new Response('', { status: 404 });
  });
  return { fetchFn, calls, sessionCount: () => sessions };
}

describe('RealEarthClient', () => {
  it('performs the viewer handshake and lists frames', async () => {
    const fake = fakeRealEarth({ times: { P: ['20261001.195617', '20261001.200117'] } });
    const client = new RealEarthClient(fake.fetchFn as unknown as typeof fetch);
    expect(await client.frameTimes('P')).toEqual(['20261001.195617', '20261001.200117']);
    expect(fake.calls[0]).toMatch(/^\/\?products=P/);
    expect(fake.calls[1]).toMatch(/^\/util\/session\.php\?sh=[0-9a-f]{32}&md5=[0-9a-f]{32}$/);
    expect(fake.fetchFn.mock.calls[0][0]).toMatch(new RegExp(`^${REALEARTH_BASE}/`));
  });

  it('asks for a frame by date and time', async () => {
    const shapes = vi.fn(() => ({ type: 'FeatureCollection', features: [DOME] }));
    const fake = fakeRealEarth({ times: {}, shapes });
    const client = new RealEarthClient(fake.fetchFn as unknown as typeof fetch);
    const body = (await client.frame('P', '20261001.200117')) as { features: unknown[] };
    expect(body.features).toHaveLength(1);
    expect(shapes).toHaveBeenCalledWith('P', '2026-10-01T20:01:17');
  });

  it('reuses one session, and opens a new one after an upstream rejection', async () => {
    const fake = fakeRealEarth({ times: { P: ['20261001.200117'] } });
    let now = 0;
    const client = new RealEarthClient(fake.fetchFn as unknown as typeof fetch, () => now);
    await Promise.all([client.frameTimes('P'), client.frameTimes('P')]);
    expect(fake.sessionCount()).toBe(1);
    now += 16 * 60_000; // past the session max age
    await client.frameTimes('P');
    expect(fake.sessionCount()).toBe(2);
  });

  it('retries once on a fresh session when a call on an established session is refused', async () => {
    const fake = fakeRealEarth({ times: { P: ['20261001.200117'] } });
    let now = 0;
    const client = new RealEarthClient(fake.fetchFn as unknown as typeof fetch, () => now);
    await client.frameTimes('P');
    now += 5 * 60_000;
    // Simulate SSEC dropping the session: the next /api call 500s once.
    const real = fake.fetchFn.getMockImplementation()!;
    fake.fetchFn.mockImplementationOnce(async () => new Response('{}', { status: 500 }));
    fake.fetchFn.mockImplementation(real);
    expect(await client.frameTimes('P')).toEqual(['20261001.200117']);
    expect(fake.sessionCount()).toBe(2);
  });

  it('does not open a new session per failed call while the upstream is erroring', async () => {
    const fake = fakeRealEarth({ times: { P: ['20261001.200117'] } });
    const client = new RealEarthClient(fake.fetchFn as unknown as typeof fetch, () => 0);
    await client.frameTimes('P');
    const real = fake.fetchFn.getMockImplementation()!;
    fake.fetchFn.mockImplementation(async (input, init) =>
      new URL(String(input)).pathname.startsWith('/api/') ? new Response('', { status: 503 }) : real(input, init)
    );
    for (let i = 0; i < 3; i++) {
      await expect(client.frame('P', '20261001.200117')).rejects.toMatchObject({ status: 503 });
    }
    expect(fake.sessionCount()).toBe(1);
  });

  it('fails clearly when the handshake is not echoed', async () => {
    const fetchFn = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname === '/') {
        const res = new Response('');
        res.headers.append('set-cookie', 'PHPSESSID=x');
        return res;
      }
      return new Response('nope');
    });
    const client = new RealEarthClient(fetchFn as unknown as typeof fetch);
    await expect(client.frameTimes('P')).rejects.toThrow(/handshake/);
  });
});

describe('NgfsService', () => {
  const EAST: NgfsProduct = { product: 'E', slot: 'east', sat: 'GOES-19' };
  const WEST: NgfsProduct = { product: 'W', slot: 'west', sat: 'GOES-18' };
  const NOW = Date.UTC(2026, 9, 1, 20, 5, 0);
  // Every 5 minutes for the last 7 hours, as RealEarth stamps.
  const stamps = Array.from({ length: 84 }, (_, i) => {
    const d = new Date(NOW - (84 - i) * 300_000);
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}.${p(d.getUTCHours())}${p(d.getUTCMinutes())}17`;
  });

  function setup(shapes?: (product: string, time: string) => unknown) {
    const fake = fakeRealEarth({
      times: { E: stamps, W: stamps },
      shapes:
        shapes ??
        ((product) => ({ type: 'FeatureCollection', features: [product === 'E' ? CROSS_COUNTY : DOME] })),
    });
    let now = NOW;
    const svc = new NgfsService(
      new RealEarthClient(fake.fetchFn as unknown as typeof fetch, () => now),
      [EAST, WEST],
      () => now,
      0
    );
    return { fake, svc, advance: (ms: number) => (now += ms) };
  }
  const shapeCalls = (calls: string[]) => calls.filter((c) => c.startsWith('/api/shapes')).length;

  it('answers with the newest frame first, then pages in history', async () => {
    const { fake, svc } = setup();
    await svc.ensureFresh();
    // Before backfill: just the newest frame per product.
    let snap = svc.snapshot(1);
    expect(snap.pixels.map((p) => p.sat).sort()).toEqual(['GOES-18', 'GOES-19']);
    expect(snap.products[0]).toMatchObject({ framesLoaded: 1, error: null, sat: 'GOES-19' });
    expect(snap.products[0].framesInWindow).toBe(12);
    await svc.settle();
    snap = svc.snapshot(1);
    // 1 + 12 backfilled frames cover the whole hour.
    expect(snap.products[0].framesLoaded).toBe(12);
    expect(snap.products[0].coveredFrom).toBeLessThanOrEqual(snap.windowStart + 300_000);
    expect(snap.pixels.find((p) => p.slot === 'east')!.frames).toBe(12);
    // The newest frame plus 12 backfilled, per product.
    expect(shapeCalls(fake.calls)).toBe(26);
  });

  it('only fetches frames it has not seen, and not more often than every 2 minutes', async () => {
    const { fake, svc, advance } = setup();
    await svc.ensureFresh();
    await svc.settle();
    const before = shapeCalls(fake.calls);
    advance(60_000);
    await svc.ensureFresh();
    expect(shapeCalls(fake.calls)).toBe(before); // within REFRESH_MS: no upstream call at all
    advance(90_000);
    await svc.ensureFresh();
    await svc.settle();
    // No new stamps upstream: only backlog frames are fetched (12 per product).
    expect(shapeCalls(fake.calls)).toBe(before + 24);
  });

  it('reports partial coverage while the 6 h backlog is still loading', async () => {
    const { svc } = setup();
    await svc.ensureFresh();
    await svc.settle();
    const snap = svc.snapshot(6);
    expect(snap.products[0].framesInWindow).toBe(72);
    expect(snap.products[0].framesLoaded).toBe(13);
    expect(snap.products[0].coveredFrom).toBeGreaterThan(snap.windowStart);
  });

  it('keeps serving one satellite when the other fails, and reports why', async () => {
    const { svc } = setup((product) => (product === 'W' ? { error: 'down' } : { features: [CROSS_COUNTY] }));
    await svc.ensureFresh();
    const snap = svc.snapshot(1);
    expect(snap.pixels.every((p) => p.slot === 'east')).toBe(true);
    expect(snap.products[1].framesLoaded).toBe(0);
    expect(snap.products[1].error).toMatch(/FeatureCollection/);
    expect(snap.products[0].error).toBeNull();
    expect(svc.empty).toBe(false);
  });

  it('backs off after a refresh that reached neither satellite', async () => {
    let up = false;
    const fetchFn = vi.fn(async () => {
      if (!up) throw new Error('ECONNRESET');
      return new Response('');
    });
    let now = NOW;
    const svc = new NgfsService(new RealEarthClient(fetchFn as unknown as typeof fetch), [EAST, WEST], () => now, 0);
    await svc.ensureFresh();
    expect(svc.empty).toBe(true);
    expect(svc.snapshot(1).products[0].error).toMatch(/ECONNRESET/);
    const n = fetchFn.mock.calls.length;
    now += 10_000;
    await svc.ensureFresh();
    expect(fetchFn.mock.calls.length).toBe(n); // still backing off
    now += 30_000;
    await svc.ensureFresh();
    expect(fetchFn.mock.calls.length).toBeGreaterThan(n);
  });
});

describe('GET /api/ngfs', () => {
  const EAST: NgfsProduct = { product: 'E', slot: 'east', sat: 'GOES-19' };
  let server: Server | null = null;
  afterEach(async () => {
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = null;
    vi.restoreAllMocks();
  });

  async function serve(fetchFn: typeof fetch, waits = { warmMs: 1_000, coldMs: 1_000 }) {
    const svc = new NgfsService(new RealEarthClient(fetchFn), [EAST], Date.now, 0);
    const app = express();
    app.use('/api/ngfs', createNgfsRouter(svc, waits));
    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => resolve());
    });
    return { svc, base: `http://127.0.0.1:${(server!.address() as AddressInfo).port}/api/ngfs` };
  }
  const recentStamp = () => {
    const d = new Date(Date.now() - 120_000);
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}.${p(d.getUTCHours())}${p(d.getUTCMinutes())}17`;
  };

  it('rejects an unsupported window', async () => {
    const { base } = await serve(fakeRealEarth({ times: {} }).fetchFn as unknown as typeof fetch);
    const r = await fetch(`${base}?hours=24`);
    expect(r.status).toBe(400);
  });

  it('answers a cold request with the newest frame', async () => {
    const fake = fakeRealEarth({
      times: { E: [recentStamp()] },
      shapes: () => ({ type: 'FeatureCollection', features: [CROSS_COUNTY, FLARE] }),
    });
    const { base } = await serve(fake.fetchFn as unknown as typeof fetch);
    const r = await fetch(`${base}?hours=3`);
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.windowHours).toBe(3);
    expect(body.warming).toBeUndefined();
    expect(body.pixels).toHaveLength(2);
    expect(body.pixels.map((p: { wildland: boolean }) => p.wildland).sort()).toEqual([false, true]);
    expect(body.products[0]).toMatchObject({ sat: 'GOES-19', framesLoaded: 1, error: null });
  });

  it('says the feed is down, and why, when nothing could be fetched', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchFn = vi.fn(async () => {
      throw new Error('getaddrinfo ENOTFOUND');
    });
    const { base } = await serve(fetchFn as unknown as typeof fetch);
    const r = await fetch(base);
    expect(r.status).toBe(502);
    expect((await r.json()).error).toMatch(/NGFS feed unavailable: .*ENOTFOUND/);
  });

  it('answers "warming" instead of hanging while a slow first fetch is still running', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const fake = fakeRealEarth({ times: { E: [recentStamp()] } });
    const slow = (async (input: string | URL | Request, init?: RequestInit) => {
      await gate;
      return fake.fetchFn(input, init);
    }) as unknown as typeof fetch;
    const { base, svc } = await serve(slow, { warmMs: 50, coldMs: 50 });
    const r = await fetch(base);
    expect(r.status).toBe(200);
    expect((await r.json()).warming).toBe(true);
    release();
    await vi.waitFor(() => expect(svc.empty).toBe(false));
    const again = await (await fetch(base)).json();
    expect(again.warming).toBeUndefined();
    expect(again.products[0].framesLoaded).toBe(1);
  });
});

describe('NgfsService catalog handling', () => {
  it('copes with an unsorted catalog that repeats stamps', async () => {
    const now = Date.UTC(2026, 9, 1, 20, 5, 0);
    const fake = fakeRealEarth({
      times: { E: ['20261001.200017', '20261001.195517', '20261001.200017', '20261001.195017'] },
      shapes: () => ({ type: 'FeatureCollection', features: [CROSS_COUNTY] }),
    });
    const svc = new NgfsService(
      new RealEarthClient(fake.fetchFn as unknown as typeof fetch, () => now),
      [{ product: 'E', slot: 'east', sat: 'GOES-19' }],
      () => now,
      0
    );
    await svc.ensureFresh();
    // The newest stamp is fetched first even though the catalog listed it first.
    expect(svc.snapshot(1).products[0]).toMatchObject({ newestFrame: Date.UTC(2026, 9, 1, 20, 0, 17), framesLoaded: 1 });
    await svc.settle();
    const status = svc.snapshot(1).products[0];
    expect(status).toMatchObject({ framesInWindow: 3, framesLoaded: 3, coveredFrom: Date.UTC(2026, 9, 1, 19, 50, 17) });
  });
});

describe('NgfsService failed frames', () => {
  it('gives up on a frame after repeated failures and reports it as skipped, not pending', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    let now = Date.UTC(2026, 9, 1, 20, 5, 0);
    const fake = fakeRealEarth({
      times: { E: ['20261001.195017', '20261001.195517', '20261001.200017'] },
      shapes: (_p, time) =>
        time === '2026-10-01T19:55:17' ? { error: 'corrupt' } : { type: 'FeatureCollection', features: [CROSS_COUNTY] },
    });
    const svc = new NgfsService(
      new RealEarthClient(fake.fetchFn as unknown as typeof fetch, () => now),
      [{ product: 'E', slot: 'east', sat: 'GOES-19' }],
      () => now,
      0
    );
    for (let i = 0; i < 3; i++) {
      await svc.ensureFresh();
      await svc.settle();
      now += 150_000; // past REFRESH_MS
    }
    const status = svc.snapshot(1).products[0];
    expect(status).toMatchObject({ framesInWindow: 3, framesLoaded: 2, framesSkipped: 1, error: null });
    // Coverage runs through the skipped scan to the oldest one.
    expect(status.coveredFrom).toBe(Date.UTC(2026, 9, 1, 19, 50, 17));
    const before = fake.calls.length;
    now += 150_000;
    await svc.ensureFresh();
    await svc.settle();
    expect(fake.calls.slice(before).filter((c) => c.startsWith('/api/shapes'))).toEqual([]);
    vi.restoreAllMocks();
  });
});

describe('NgfsService under upstream trouble', () => {
  const EAST: NgfsProduct = { product: 'E', slot: 'east', sat: 'GOES-19' };
  const WEST: NgfsProduct = { product: 'W', slot: 'west', sat: 'GOES-18' };
  const stampAt = (ms: number) => {
    const d = new Date(ms);
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}.${p(d.getUTCHours())}${p(d.getUTCMinutes())}17`;
  };
  // A catalog that follows the clock: a frame every 5 minutes for the last 24 h.
  const catalogAt = (now: number) => {
    const last = Math.floor((now - 17_000) / 300_000) * 300_000;
    return Array.from({ length: 288 }, (_, i) => stampAt(last - (287 - i) * 300_000));
  };

  function setup(opts: { shapesDown?: () => boolean; listsDown?: () => boolean; latencyMs?: number } = {}) {
    let now = Date.UTC(2026, 9, 1, 20, 3, 0);
    const shapeTimes: number[] = []; // frame time of every /api/shapes request
    const shapeAsked: number[] = []; // wall time of every /api/shapes request
    const listCalls: number[] = [];
    let sessions = 0;
    const fetchFn = (async (input: string | URL | Request) => {
      const url = new URL(String(input));
      now += opts.latencyMs ?? 0;
      if (url.pathname === '/') {
        sessions++;
        const res = new Response('');
        res.headers.append('set-cookie', `PHPSESSID=s${sessions}`);
        return res;
      }
      if (url.pathname === '/util/session.php') return new Response(url.searchParams.get('sh'));
      if (url.pathname === '/api/products') {
        listCalls.push(now);
        if (opts.listsDown?.()) return new Response('', { status: 502 });
        return Response.json([{ times: catalogAt(now) }]);
      }
      if (url.pathname === '/api/shapes') {
        shapeAsked.push(now);
        shapeTimes.push(Date.parse(`${url.searchParams.get('date')}T${url.searchParams.get('time')}Z`));
        if (opts.shapesDown?.()) return new Response('', { status: 503 });
        return Response.json({ type: 'FeatureCollection', features: [CROSS_COUNTY] });
      }
      return new Response('', { status: 404 });
    }) as typeof fetch;
    const svc = new NgfsService(new RealEarthClient(fetchFn, () => now), [EAST, WEST], () => now, 0);
    return {
      svc,
      shapeTimes,
      shapeAsked,
      listCalls,
      sessions: () => sessions,
      now: () => now,
      advance: (ms: number) => (now += ms),
      setNow: (ms: number) => (now = ms),
      poll: async () => {
        await svc.ensureFresh();
        await svc.settle();
      },
    };
  }

  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('never asks for frames older than 6 h and keeps the cache bounded over a long run', async () => {
    const h = setup();
    for (let i = 0; i < 200; i++) {
      await h.poll();
      h.advance(150_000);
    }
    // ~8 h of polling: every request was inside the 6 h window when made.
    h.shapeTimes.forEach((t, i) => expect(t).toBeGreaterThanOrEqual(h.shapeAsked[i] - 6 * 3_600_000));
    // Two products × at most one window of 5-minute frames (+ the frame at the edge).
    expect(h.svc.frameCount).toBeLessThanOrEqual(2 * 73);
    // Once the backlog is in, a refresh fetches only new frames: ≤ 1 per product per 5 min.
    const before = h.shapeTimes.length;
    for (let i = 0; i < 4; i++) {
      await h.poll();
      h.advance(150_000);
    }
    expect(h.shapeTimes.length - before).toBeLessThanOrEqual(2 * 3);
    const snap = h.svc.snapshot(6);
    expect(snap.products.every((p) => p.framesSkipped === 0 && p.coveredFrom! <= snap.windowStart + 300_000)).toBe(true);
  });

  it('refreshes on every 2-minute poll of a lone viewer, however long the round trips take', async () => {
    const h = setup({ latencyMs: 700 });
    const t0 = h.now();
    // The client polls on a fixed 2-minute interval, whatever the previous
    // refresh cost; each upstream call here takes 0.7 s of that.
    await h.svc.ensureFresh();
    const lists = h.listCalls.length;
    for (let k = 1; k <= 5; k++) {
      await h.svc.settle();
      h.setNow(t0 + k * 120_000);
      await h.svc.ensureFresh();
    }
    expect(h.listCalls.length - lists).toBe(5 * 2); // both products, every poll
  });

  it('rides out a frame-download outage without giving up on any frame', async () => {
    let down = false;
    const h = setup({ shapesDown: () => down });
    for (let i = 0; i < 8; i++) {
      await h.poll(); // warm: backlog loaded
      h.advance(150_000);
    }
    down = true;
    const before = h.shapeTimes.length;
    const sessionsBefore = h.sessions();
    for (let i = 0; i < 6; i++) {
      await h.poll(); // ~15 min of 503s from /api/shapes
      h.advance(150_000);
    }
    // Per refresh: the newest frame per product, then at most 2 backfill tries before stopping.
    expect(h.shapeTimes.length - before).toBeLessThanOrEqual(6 * (2 + 2));
    // No new PHP session per failure: at most the scheduled 15-minute renewal.
    expect(h.sessions() - sessionsBefore).toBeLessThanOrEqual(1);
    down = false;
    for (let i = 0; i < 3; i++) {
      await h.poll();
      h.advance(150_000);
    }
    const snap = h.svc.snapshot(6);
    for (const p of snap.products) {
      expect(p.framesSkipped).toBe(0);
      expect(p.framesLoaded).toBe(p.framesInWindow);
      expect(p.error).toBeNull();
    }
  });

  it('sends no frame requests at all while both frame lists are failing', async () => {
    let listsDown = false;
    const h = setup({ listsDown: () => listsDown });
    await h.poll(); // cold start: newest + 12 per product
    listsDown = true;
    const before = h.shapeTimes.length;
    for (let i = 0; i < 4; i++) {
      h.advance(31_000); // past the failure backoff each time
      await h.poll();
    }
    expect(h.shapeTimes.length).toBe(before);
    const snap = h.svc.snapshot(6);
    expect(snap.products.every((p) => p.framesSkipped === 0)).toBe(true);
    expect(snap.products[0].error).toMatch(/HTTP 502/);
  });
});

describe('NgfsService newest-frame reporting', () => {
  it('keeps reporting a failed newest frame after older frames load', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const now = Date.UTC(2026, 9, 1, 20, 5, 0);
    const fake = fakeRealEarth({
      times: { E: ['20261001.195017', '20261001.195517', '20261001.200017'] },
    });
    const real = fake.fetchFn.getMockImplementation()!;
    fake.fetchFn.mockImplementation(async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname === '/api/shapes' && url.searchParams.get('time') === '20:00:17') {
        return new Response('', { status: 500 });
      }
      return real(input, init);
    });
    const svc = new NgfsService(
      new RealEarthClient(fake.fetchFn as unknown as typeof fetch, () => now),
      [{ product: 'E', slot: 'east', sat: 'GOES-19' }],
      () => now,
      0
    );
    await svc.ensureFresh();
    await svc.settle();
    const status = svc.snapshot(1).products[0];
    expect(status).toMatchObject({
      framesLoaded: 2,
      framesInWindow: 3,
      coveredFrom: null,
      newestFrame: Date.UTC(2026, 9, 1, 20, 0, 17),
      newestLoaded: Date.UTC(2026, 9, 1, 19, 55, 17),
    });
    expect(status.error).toMatch(/HTTP 500/);
    vi.restoreAllMocks();
  });
});
