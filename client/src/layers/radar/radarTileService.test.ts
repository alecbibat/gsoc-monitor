import { readFileSync } from 'node:fs';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { solidRgbaPng } from './__fixtures__/encodePng';
import { FakeClock } from './__fixtures__/fakeClock';
import { decodePng } from './pngDecode';
import { decodeRadarRgba } from './radarDecode';
import { RadarTileService, type ServiceOut, type ServiceStatus, type TileRequest } from './radarTileService';

// The service end to end — scheduler, single flight, caches, decode and
// paint — against a stubbed fetch serving a real RainViewer tile, on virtual
// time (see FakeClock).

const T0 = 1_760_000_000_000;
const PNG = new Uint8Array(readFileSync(new URL('./__fixtures__/rainviewer-z7-67-45-0430Z.png', import.meta.url)));
const tileUrl = (frame: string, x = 67) => `https://tilecache.rainviewer.com/v2/radar/${frame}/512/7/${x}/45/2/1_1.png`;

type TileOut = Extract<ServiceOut, { type: 'tile' }>;

function req(id: number, over: Partial<TileRequest> = {}): TileRequest {
  const frameKey = over.frameKey ?? '100';
  const base = { z: 7, x: 67, y: 45, palette: 'classic', sigma: 0.8, snow: true } as const;
  return { id, frameKey, url: tileUrl(frameKey, over.x), ...base, ...over };
}

const png = () => new Response(PNG as Uint8Array<ArrayBuffer>, { status: 200 });
const httpStatus = (code: number, headers?: Record<string, string>) => new Response(null, { status: code, headers });

interface Call {
  url: string;
  at: number; // ms since T0
  signal: AbortSignal;
  resolve: (r: Response) => void;
}

// Every fetch is recorded; `reply` answers it at once (a Response, or an
// Error to reject with) or leaves it hanging (undefined) for the test.
let calls: Call[];
let reply: (url: string, n: number) => Response | Error | undefined;
let clock: FakeClock;

function setup() {
  const out: ServiceOut[] = [];
  const svc = new RadarTileService((m) => out.push(m));
  const tiles = () => out.filter((m): m is TileOut => m.type === 'tile');
  return {
    svc,
    out,
    tiles,
    tile: (id: number) => tiles().find((t) => t.id === id),
    starts: () => out.flatMap((m) => (m.type === 'start' ? [m.at - T0] : [])),
    statuses: () => out.flatMap((m) => (m.type === 'status' ? [m.status] : [])),
  };
}
type Harness = ReturnType<typeof setup>;

let probeId = 1000;
async function probe(h: Harness, frameKey: string, at: { lon: number; lat: number }) {
  const id = probeId++;
  h.svc.handle({ type: 'probe', id, frameKey, ...at });
  let answer: ServiceOut | undefined;
  await clock.until(() => !!(answer = h.out.find((m) => m.type === 'probe' && m.id === id)), 'a probe answer');
  return (answer as Extract<ServiceOut, { type: 'probe' }>).result;
}

// The fixture's strongest echo, and where it is.
let peak: { lon: number; lat: number; dbz: number };

beforeAll(async () => {
  const img = await decodePng(PNG);
  const grid = decodeRadarRgba(img.data, img.width, img.height);
  let best = 0;
  for (let i = 1; i < grid.dbz.length; i++) if (grid.dbz[i] > grid.dbz[best]) best = i;
  const px = best % img.width;
  const py = Math.floor(best / img.width);
  const lon = ((67 + (px + 0.5) / img.width) / 128) * 360 - 180;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (45 + (py + 0.5) / img.height)) / 128))) * 180) / Math.PI;
  peak = { lon, lat, dbz: grid.dbz[best] };
});

beforeEach(() => {
  clock = new FakeClock(T0).install();
  vi.stubGlobal('BroadcastChannel', undefined);
  vi.stubGlobal('caches', undefined);
  calls = [];
  reply = () => png();
  vi.stubGlobal('fetch', (url: string, init: RequestInit) => {
    return new Promise<Response>((resolve, reject) => {
      const signal = init.signal!;
      calls.push({ url, at: Date.now() - T0, signal, resolve });
      signal.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')));
      const r = reply(url, calls.length - 1);
      if (r instanceof Error) reject(r);
      else if (r) resolve(r);
    });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('RadarTileService', () => {
  it('fetches a tile once for concurrent requests and paints it for each', async () => {
    // Regression: the job's URL must be registered before it is queued, since
    // a free slot starts it at once.
    const h = setup();
    h.svc.handle({ type: 'tile', req: req(1) });
    h.svc.handle({ type: 'tile', req: req(2) });
    await clock.until(() => h.tiles().length === 2, 'both tiles');
    expect(calls.map((c) => c.url)).toEqual([tileUrl('100')]);
    for (const t of h.tiles()) {
      expect(t).toMatchObject({ empty: false, width: 256, height: 256 });
      expect(t.gone).toBeUndefined();
      expect(new Uint8Array(t.rgba!).some((v, i) => i % 4 === 3 && v > 0)).toBe(true);
    }
    expect(h.starts()).toEqual([0]); // one network request, one 'start'
  });

  it('answers every waiter with an empty, gone tile on 404 or 410', async () => {
    for (const code of [404, 410]) {
      reply = () => httpStatus(code);
      calls = [];
      const h = setup();
      h.svc.handle({ type: 'tile', req: req(1) });
      h.svc.handle({ type: 'tile', req: req(2) });
      await clock.until(() => h.tiles().length === 2, 'both tiles');
      expect(h.tiles()).toEqual([
        { type: 'tile', id: 1, empty: true, gone: true },
        { type: 'tile', id: 2, empty: true, gone: true },
      ]);
      await clock.advance(10 * 60_000);
      expect(calls).toHaveLength(1); // not retried
    }
  });

  it('answers past the free-tier zoom with an empty tile and no fetch', async () => {
    const h = setup();
    h.svc.handle({ type: 'tile', req: req(1, { z: 8 }) });
    expect(h.tiles()).toEqual([{ type: 'tile', id: 1, empty: true }]);
    await clock.advance(0);
    expect(calls).toEqual([]);
  });

  it('drops a cancelled job that has not started, and never fetches it', async () => {
    reply = () => undefined; // hold every fetch
    const h = setup();
    // Cancelled while still checking the cache.
    h.svc.handle({ type: 'tile', req: req(1, { x: 60 }) });
    h.svc.handle({ type: 'cancel', id: 1 });
    await clock.advance(0);
    expect(calls).toEqual([]);
    // Cancelled while queued behind six requests in flight.
    for (let i = 0; i < 6; i++) h.svc.handle({ type: 'tile', req: req(10 + i, { x: 70 + i }) });
    h.svc.handle({ type: 'tile', req: req(2, { x: 61 }) });
    await clock.advance(0);
    expect(calls).toHaveLength(6);
    h.svc.handle({ type: 'cancel', id: 2 });
    for (const c of calls) c.resolve(httpStatus(404));
    await clock.advance(60_000);
    expect(h.tiles()).toHaveLength(6);
    expect(calls.map((c) => c.url)).not.toContain(tileUrl('100', 61));
    expect(h.tile(2)).toBeUndefined();
    // Asked for again, it gets a fresh job.
    h.svc.handle({ type: 'tile', req: req(3, { x: 61 }) });
    await clock.advance(0);
    expect(calls.at(-1)!.url).toBe(tileUrl('100', 61));
  });

  it('keeps an in-flight fetch for the waiters still wanting it, and lets new ones join', async () => {
    reply = () => undefined;
    const h = setup();
    h.svc.handle({ type: 'tile', req: req(1) });
    h.svc.handle({ type: 'tile', req: req(2) });
    await clock.advance(0);
    expect(calls).toHaveLength(1);
    h.svc.handle({ type: 'cancel', id: 1 });
    calls[0].resolve(png());
    await clock.until(() => h.tiles().length === 1, 'the tile');
    expect(h.tile(2)).toMatchObject({ empty: false });

    // Everyone cancels a fetch in flight; a later request joins it rather than fetching twice.
    h.svc.handle({ type: 'tile', req: req(3, { frameKey: '200' }) });
    await clock.advance(0);
    h.svc.handle({ type: 'cancel', id: 3 });
    h.svc.handle({ type: 'tile', req: req(4, { frameKey: '200' }) });
    await clock.advance(0);
    expect(calls).toHaveLength(2);
    calls[1].resolve(png());
    await clock.until(() => !!h.tile(4), 'the second tile');
    expect(h.tile(4)).toMatchObject({ empty: false });
    expect(h.tile(1)).toBeUndefined();
    expect(h.tile(3)).toBeUndefined();
  });

  it("evicts other frames' tiles and grids on 'retain'", async () => {
    const h = setup();
    h.svc.handle({ type: 'tile', req: req(1, { frameKey: '100' }) });
    h.svc.handle({ type: 'tile', req: req(2, { frameKey: '200' }) });
    await clock.until(() => h.tiles().length === 2, 'both tiles');
    expect(await probe(h, '200', peak)).toMatchObject({ dbz: peak.dbz });
    h.svc.handle({ type: 'retain', frameKeys: ['100'] });
    expect(await probe(h, '200', peak)).toBeNull();
    expect(await probe(h, '100', peak)).toMatchObject({ dbz: peak.dbz });
    h.svc.handle({ type: 'tile', req: req(3, { frameKey: '100' }) });
    h.svc.handle({ type: 'tile', req: req(4, { frameKey: '200' }) });
    await clock.until(() => h.tiles().length === 4, 'the re-requested tiles');
    expect(calls.map((c) => c.url)).toEqual([tileUrl('100'), tileUrl('200'), tileUrl('200')]);
  });

  it('gives up on a 4xx after three attempts, but retries a 408', async () => {
    reply = () => httpStatus(403);
    let h = setup();
    h.svc.handle({ type: 'tile', req: req(1) });
    await clock.advance(10 * 60_000);
    expect(calls.map((c) => c.at)).toEqual([0, 2000, 6000]);
    expect(h.tiles()).toEqual([{ type: 'tile', id: 1, empty: true, gone: false }]);

    reply = () => httpStatus(408);
    calls = [];
    const start = Date.now() - T0;
    h = setup();
    h.svc.handle({ type: 'tile', req: req(1) });
    await clock.advance(20_000);
    expect(calls.map((c) => c.at - start)).toEqual([0, 2000, 6000, 14_000]);
    expect(h.tiles()).toEqual([]);
  });

  it('retries 5xx and network errors up to ten times, reporting each start', async () => {
    const schedule = [0, 2000, 6000, 14_000, 30_000, 62_000, 126_000, 254_000, 510_000, 810_000];
    for (const failure of [() => httpStatus(503), () => new TypeError('Failed to fetch')]) {
      reply = failure;
      calls = [];
      const start = Date.now() - T0;
      const h = setup();
      h.svc.handle({ type: 'tile', req: req(1) });
      await clock.advance(20 * 60_000);
      expect(calls.map((c) => c.at - start)).toEqual(schedule);
      expect(h.starts().map((at) => at - start)).toEqual(schedule);
      expect(h.tiles()).toEqual([{ type: 'tile', id: 1, empty: true, gone: false }]);
    }
  });

  it('aborts a fetch after 20 s and retries it as an error', async () => {
    reply = (_url, n) => (n === 0 ? undefined : png());
    const h = setup();
    h.svc.handle({ type: 'tile', req: req(1) });
    await clock.advance(19_999);
    expect(calls[0].signal.aborted).toBe(false);
    await clock.advance(1);
    expect(calls[0].signal.aborted).toBe(true);
    await clock.advance(1999);
    expect(calls).toHaveLength(1);
    await clock.advance(1);
    expect(calls.map((c) => c.at)).toEqual([0, 22_000]);
    await clock.until(() => h.tiles().length === 1, 'the tile');
    expect(h.tile(1)).toMatchObject({ empty: false });
  });

  it("draws the grey 'zoom level not supported' image empty, and never caches it", async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const cache = new FakeCache();
    vi.stubGlobal('caches', { open: async () => cache });
    const grey = solidRgbaPng(64, 64, [240, 240, 240, 255]);
    reply = () => new Response(grey as Uint8Array<ArrayBuffer>, { status: 200 });
    const h = setup();
    h.svc.handle({ type: 'tile', req: req(1) });
    await clock.until(() => h.tiles().length === 1, 'the tile');
    expect(h.tile(1)).toEqual({ type: 'tile', id: 1, empty: true, gone: false });
    // Nor any other body that isn't a radar tile; each is fetched afresh.
    reply = () => new Response('<html>busy</html>', { status: 200 });
    h.svc.handle({ type: 'tile', req: req(2) });
    await clock.until(() => h.tiles().length === 2, 'the second tile');
    expect(h.tile(2)).toEqual({ type: 'tile', id: 2, empty: true, gone: false });
    expect(calls).toHaveLength(2);
    expect(cache.puts).toEqual([]);
  });

  it('keeps fetched tiles in Cache Storage for the next session, and prunes old ones', async () => {
    const cache = new FakeCache();
    const old = 'https://tilecache.rainviewer.com/v2/radar/1/old.png';
    const recent = 'https://tilecache.rainviewer.com/v2/radar/2/recent.png';
    cache.seed(old, PNG, T0 - 3 * 3600_000 - 1);
    cache.seed(recent, PNG, T0 - 3 * 3600_000 + 1);
    vi.stubGlobal('caches', { open: async () => cache });
    const first = setup();
    first.svc.handle({ type: 'tile', req: req(1) });
    await clock.until(() => first.tiles().length === 1 && cache.puts.length === 1, 'the tile to be cached');
    expect(cache.puts).toEqual([tileUrl('100')]);
    expect(cache.urls()).toEqual([recent, tileUrl('100')]);

    const second = setup();
    second.svc.handle({ type: 'tile', req: req(1) });
    await clock.until(() => second.tiles().length === 1, 'the cached tile');
    expect(second.tile(1)).toMatchObject({ empty: false, width: 256 });
    expect(calls).toHaveLength(1);
  });

  it("holds painting while the page is 'hidden' and resumes when shown", async () => {
    const h = setup();
    h.svc.handle({ type: 'hidden', hidden: true });
    h.svc.handle({ type: 'tile', req: req(1) });
    await clock.until(async () => (await probe(h, '100', peak)) !== null, 'the tile to load');
    await clock.advance(5000);
    expect(h.tiles()).toEqual([]);
    h.svc.handle({ type: 'hidden', hidden: false });
    await clock.until(() => h.tiles().length === 1, 'the tile');
    expect(h.tile(1)).toMatchObject({ empty: false });
  });

  it("inherits a previous worker's request starts from 'seed'", async () => {
    reply = () => httpStatus(404);
    const h = setup();
    h.svc.handle({ type: 'seed', starts: Array.from({ length: 79 }, () => T0 - 50_000) });
    h.svc.handle({ type: 'tile', req: req(1, { x: 60 }) });
    h.svc.handle({ type: 'tile', req: req(2, { x: 61 }) });
    await clock.advance(9_999);
    expect(calls.map((c) => c.at)).toEqual([0]); // the 80th request this minute
    await clock.advance(1);
    expect(calls.map((c) => c.at)).toEqual([0, 10_000]);
  });

  it("inherits a previous worker's cool-down from 'seed'", async () => {
    const h = setup();
    h.svc.handle({ type: 'seed', starts: [], cooldownUntil: T0 + 20_000 });
    h.svc.handle({ type: 'tile', req: req(1) });
    await clock.advance(19_999);
    expect(calls).toEqual([]);
    await clock.advance(1);
    expect(calls.map((c) => c.at)).toEqual([20_000]);
  });

  it("answers 'ping' with 'pong'", () => {
    const h = setup();
    h.svc.handle({ type: 'ping' });
    expect(h.out).toEqual([{ type: 'pong' }]);
  });

  it('reports a rate-limit cool-down as it counts down, in 5 s steps', async () => {
    reply = (_url, n) => (n === 0 ? httpStatus(429, { 'retry-after': '30' }) : png());
    const h = setup();
    h.svc.handle({ type: 'tile', req: req(1) });
    await clock.advance(30_000);
    expect(calls.map((c) => c.at)).toEqual([0, 30_000]);
    await clock.until(() => h.tiles().length === 1, 'the tile');
    const countdown = [29_500, 25_000, 20_000, 15_000, 10_000, 5000, 0];
    expect(h.statuses()).toEqual(countdown.map((ms): ServiceStatus => ({ coolingDownMs: ms, failing: false })));
  });

  it('reports failing only after errors with no success for two minutes', async () => {
    reply = (_url, n) => (n < 6 ? httpStatus(503) : png());
    const h = setup();
    h.svc.handle({ type: 'tile', req: req(1) });
    await clock.advance(120_499);
    expect(h.statuses()).toEqual([{ coolingDownMs: 0, failing: false }]);
    await clock.advance(1);
    expect(h.statuses().at(-1)).toEqual({ coolingDownMs: 0, failing: true });
    // The seventh attempt (at 126 s) succeeds.
    await clock.advance(126_000 - 120_500);
    await clock.until(() => h.tiles().length === 1, 'the tile');
    await clock.advance(500);
    expect(h.statuses().at(-1)).toEqual({ coolingDownMs: 0, failing: false });
  });

  it('times failing from the start of a run of failures, not from the last success', async () => {
    reply = (url, n) => (n === 1 ? httpStatus(503) : png());
    const h = setup();
    h.svc.handle({ type: 'tile', req: req(1) });
    await clock.until(() => h.tiles().length === 1, 'the first tile');
    await clock.advance(10 * 60_000); // a quiet stretch: nothing to fetch
    h.svc.handle({ type: 'tile', req: req(2, { x: 60 }) }); // fails once, then loads
    await clock.advance(10_000);
    await clock.until(() => h.tiles().length === 2, 'the second tile');
    expect(calls).toHaveLength(3);
    expect(h.statuses().some((s) => s.failing)).toBe(false);
  });

  it('shares request starts and cool-downs with other tabs', async () => {
    const channels: FakeChannel[] = [];
    class FakeChannel {
      sent: unknown[] = [];
      onmessage: ((e: { data: unknown }) => void) | null = null;
      constructor(readonly name: string) {
        channels.push(this);
      }
      postMessage(data: unknown) {
        this.sent.push(data);
      }
    }
    vi.stubGlobal('BroadcastChannel', FakeChannel);
    reply = (_url, n) => (n === 0 ? httpStatus(429) : png());
    const h = setup();
    const ch = channels[0];
    expect(ch.name).toBe('gsoc-radar-budget');
    for (let i = 0; i < 79; i++) ch.onmessage!({ data: { start: T0 } }); // another tab's minute
    // Relayed to the main thread, so a restarted worker is seeded with them.
    expect(h.starts()).toEqual(Array(79).fill(0));
    h.svc.handle({ type: 'tile', req: req(1) });
    await clock.advance(0);
    // Our request, and the 429 it got, go out to the other tabs.
    expect(ch.sent).toEqual([{ start: T0 }, { cooldown: T0 + 15_000 }]);
    // Our cool-down ends at 15 s, but the other tab's requests hold the (now halved) budget until 60 s...
    await clock.advance(30_000);
    expect(calls).toHaveLength(1);
    // ...and then its own cool-down holds us too.
    ch.onmessage!({ data: { cooldown: T0 + 90_000 } });
    await clock.advance(90_000 - 30_000 - 1);
    expect(calls).toHaveLength(1);
    await clock.advance(1);
    expect(calls.map((c) => c.at)).toEqual([0, 90_000]);
    await clock.until(() => h.tiles().length === 1, 'the tile');
  });
});

// Cache Storage stand-in: enough of Cache for the service.
class FakeCache {
  private store = new Map<string, { body: Uint8Array; headers: Headers }>();
  puts: string[] = [];
  seed(url: string, body: Uint8Array, cachedAt: number) {
    this.store.set(url, { body, headers: new Headers({ 'x-gsoc-cached-at': String(cachedAt) }) });
  }
  urls() {
    return [...this.store.keys()];
  }
  async match(req: string | { url: string }) {
    const e = this.store.get(typeof req === 'string' ? req : req.url);
    return e ? new Response(e.body as Uint8Array<ArrayBuffer>, { headers: e.headers }) : undefined;
  }
  async put(url: string, res: Response) {
    this.store.set(url, { body: new Uint8Array(await res.arrayBuffer()), headers: res.headers });
    this.puts.push(url);
  }
  async delete(req: string | { url: string }) {
    return this.store.delete(typeof req === 'string' ? req : req.url);
  }
  async keys() {
    return [...this.store.keys()].map((url) => ({ url }));
  }
}
