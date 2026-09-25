import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeClock } from './__fixtures__/fakeClock';
import { RadarTileClient, TileCancelled, type TileArgs } from './radarTileClient';
import { RadarTileService, type ServiceIn, type ServiceOut } from './radarTileService';

// The main-thread client against a scripted worker (or, when workers are
// unavailable, the real service inline), on virtual time with animation
// frames run by hand.

const T0 = 1_760_000_000_000;
const PNG = new Uint8Array(readFileSync(new URL('./__fixtures__/rainviewer-z7-67-45-0430Z.png', import.meta.url)));

class FakeWorker {
  static instances: FakeWorker[] = [];
  static failToConstruct = false;
  posted: ServiceIn[] = [];
  terminated = false;
  onmessage: ((e: { data: ServiceOut }) => void) | null = null;
  onerror: ((e: { message: string; preventDefault?: () => void }) => void) | null = null;
  constructor() {
    if (FakeWorker.failToConstruct) throw new Error('blocked by CSP');
    FakeWorker.instances.push(this);
  }
  postMessage(msg: ServiceIn) {
    this.posted.push(msg);
  }
  terminate() {
    this.terminated = true;
  }
  emit(msg: ServiceOut) {
    this.onmessage?.({ data: msg });
  }
  sent(type: ServiceIn['type']) {
    return this.posted.filter((m) => m.type === type);
  }
}

class FakeImageData {
  constructor(
    readonly data: Uint8ClampedArray,
    readonly width: number,
    readonly height: number
  ) {}
}

let clock: FakeClock;
let frames: Array<() => void>;
let doc: { hidden: boolean; addEventListener: (type: string, fn: () => void) => void; createElement: () => object };
let onVisibility: (() => void) | null;

// Run the pending animation frame(s), as the browser would next paint.
async function nextFrame(): Promise<void> {
  const due = frames;
  frames = [];
  for (const f of due) f();
  await clock.spin();
}

function args(frameKey: string, x = 67): TileArgs {
  const url = `https://tiles/${frameKey}/7/${x}/45.png`;
  return { frameKey, url, z: 7, x, y: 45, palette: 'classic', sigma: 0.8, snow: true };
}

// A promise's fate, readable synchronously.
function track<T>(p: Promise<T>) {
  const s: { state: 'pending' | 'resolved' | 'rejected'; value?: T; error?: unknown } = { state: 'pending' };
  p.then(
    (value) => Object.assign(s, { state: 'resolved', value }),
    (error) => Object.assign(s, { state: 'rejected', error })
  );
  return s;
}

beforeEach(() => {
  clock = new FakeClock(T0).install();
  FakeWorker.instances = [];
  FakeWorker.failToConstruct = false;
  frames = [];
  onVisibility = null;
  doc = {
    hidden: false,
    addEventListener: (type, fn) => {
      if (type === 'visibilitychange') onVisibility = fn;
    },
    createElement: () => ({ width: 0, height: 0 }),
  };
  vi.stubGlobal('Worker', FakeWorker);
  vi.stubGlobal('document', doc);
  vi.stubGlobal('ImageData', FakeImageData);
  vi.stubGlobal('requestAnimationFrame', (cb: () => void) => frames.push(cb));
  vi.stubGlobal('BroadcastChannel', undefined);
  vi.stubGlobal('caches', undefined);
  vi.stubGlobal('fetch', () => new Promise(() => {})); // the inline service's requests never land unless a test says so
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('RadarTileClient', () => {
  it('cancels a request the view no longer wants, even with its reply waiting to settle', async () => {
    const c = new RadarTileClient();
    const w = FakeWorker.instances[0];
    let wantA = true;
    let wantB = true;
    const a = track(c.requestTile(args('a'), () => wantA));
    const b = track(c.requestTile(args('b'), () => wantB));
    expect(w.sent('tile')).toEqual([
      { type: 'tile', req: { id: 1, ...args('a') } },
      { type: 'tile', req: { id: 2, ...args('b') } },
    ]);
    await clock.advance(500);
    expect(w.sent('cancel')).toEqual([]);
    w.emit({ type: 'tile', id: 2, empty: true }); // queued for the next frame
    wantA = wantB = false;
    await clock.advance(500);
    expect(a.state).toBe('rejected');
    expect(a.error).toBeInstanceOf(TileCancelled);
    expect(b.error).toBeInstanceOf(TileCancelled);
    expect(w.sent('cancel')).toEqual([
      { type: 'cancel', id: 1 },
      { type: 'cancel', id: 2 },
    ]);
    await nextFrame();
    expect(b.state).toBe('rejected');
    // A late reply for a cancelled request is dropped.
    w.emit({ type: 'tile', id: 1, empty: true });
    expect(frames).toEqual([]);
  });

  it('hands over at most four tiles per animation frame, most urgent frame first', async () => {
    const c = new RadarTileClient();
    const w = FakeWorker.instances[0];
    c.setRanks({ now: 0, later: 2 });
    const order: string[] = [];
    const keys = ['later', 'later', 'later', 'now', 'now', 'unranked'];
    const results = keys.map((k, i) => c.requestTile(args(k, 60 + i), () => true));
    results.forEach((p, i) => void p.then(() => order.push(`${keys[i]}${i + 1}`)));
    const rgba = new Uint8ClampedArray([1, 2, 3, 4]).buffer;
    w.emit({ type: 'tile', id: 1, empty: false, rgba, width: 1, height: 1 });
    for (let id = 2; id <= 6; id++) w.emit({ type: 'tile', id, empty: true });
    expect(frames).toHaveLength(1);
    await nextFrame();
    expect(order).toEqual(['now4', 'now5', 'later1', 'later2']);
    await nextFrame();
    expect(order).toEqual(['now4', 'now5', 'later1', 'later2', 'later3', 'unranked6']);
    expect(frames).toEqual([]);
    const painted = await results[0];
    expect(painted).toBeInstanceOf(FakeImageData);
    expect(painted).toMatchObject({ width: 1, height: 1, data: new Uint8ClampedArray([1, 2, 3, 4]) });
    expect(await results[1]).toEqual({ width: 1, height: 1 }); // the shared blank tile
  });

  it('pings a worker silent for 20 s with work outstanding, and restarts it after 10 s without an answer', async () => {
    const c = new RadarTileClient();
    const w1 = FakeWorker.instances[0];
    w1.emit({ type: 'hello' });
    w1.emit({ type: 'start', at: T0 - 70_000 }); // older than the rate window
    w1.emit({ type: 'start', at: T0 - 1000 });
    c.setRanks({ a: 0 });
    c.setVisible(['7/67/45']);
    void c.requestTile(args('a'), () => true);
    void c.requestTile(args('b'), () => true);
    await clock.advance(20_000);
    expect(w1.sent('ping')).toEqual([]);
    await clock.advance(500);
    expect(w1.sent('ping')).toHaveLength(1);
    await clock.advance(10_000);
    expect(FakeWorker.instances).toHaveLength(1);
    await clock.advance(500);
    expect(w1.terminated).toBe(true);
    const w2 = FakeWorker.instances[1];
    // Everything outstanding goes to the new worker, which inherits this minute's requests.
    expect(w2.posted).toEqual([
      { type: 'seed', starts: [T0 - 1000] },
      { type: 'ranks', ranks: { a: 0 } },
      { type: 'visible', keys: ['7/67/45'] },
      { type: 'hidden', hidden: false },
      { type: 'tile', req: { id: 1, ...args('a') } },
      { type: 'tile', req: { id: 2, ...args('b') } },
    ]);
  });

  it('counts silence from the last message, and never pings while the page is hidden', async () => {
    const c = new RadarTileClient();
    const w = FakeWorker.instances[0];
    w.emit({ type: 'hello' });
    void c.requestTile(args('a'), () => true);
    await clock.advance(20_500);
    expect(w.sent('ping')).toHaveLength(1);
    await clock.advance(4500);
    w.emit({ type: 'pong' }); // at 25 s
    await clock.advance(20_000);
    expect(w.sent('ping')).toHaveLength(1);
    await clock.advance(500);
    expect(w.sent('ping')).toHaveLength(2);
    w.emit({ type: 'pong' });
    doc.hidden = true;
    await clock.advance(5 * 60_000);
    expect(w.sent('ping')).toHaveLength(2);
    expect(FakeWorker.instances).toHaveLength(1);
  });

  it('falls back to decoding inline after three restarts', async () => {
    const fetches: string[] = [];
    vi.stubGlobal('fetch', (url: string) => {
      fetches.push(url);
      return new Promise(() => {});
    });
    const c = new RadarTileClient();
    FakeWorker.instances[0].emit({ type: 'hello' });
    void c.requestTile(args('a'), () => true);
    // Each worker: pinged after 20.5 s of silence, restarted 10.5 s later.
    await clock.advance(3 * 31_000);
    expect(FakeWorker.instances).toHaveLength(4);
    expect(fetches).toEqual([]);
    await clock.advance(31_000);
    expect(FakeWorker.instances).toHaveLength(4);
    expect(FakeWorker.instances.every((w) => w.terminated)).toBe(true);
    expect(fetches).toEqual([args('a').url]); // the inline service took the request over
  });

  it('replays to the inline service once when a restart cannot create a worker', async () => {
    const handle = vi.spyOn(RadarTileService.prototype, 'handle');
    const c = new RadarTileClient();
    void c.requestTile(args('a'), () => true);
    FakeWorker.failToConstruct = true;
    await clock.advance(31_000);
    const seen = handle.mock.calls.map(([m]) => m.type);
    expect(seen.filter((t) => t === 'seed')).toHaveLength(1);
    expect(seen.filter((t) => t === 'tile')).toHaveLength(1);
  });

  it('decodes inline when workers are unavailable', async () => {
    vi.stubGlobal('Worker', undefined);
    vi.stubGlobal('fetch', async () => new Response(PNG as Uint8Array<ArrayBuffer>));
    const c = new RadarTileClient();
    const tile = track(c.requestTile(args('a'), () => true));
    await clock.until(() => {
      void nextFrame();
      return tile.state !== 'pending';
    }, 'the tile');
    expect(tile.value).toMatchObject({ width: 256, height: 256 });
    expect(tile.value).toBeInstanceOf(FakeImageData);
  });

  it('falls back to inline when the worker fails before it starts, but not after', async () => {
    const fetches: string[] = [];
    vi.stubGlobal('fetch', (url: string) => {
      fetches.push(url);
      return new Promise(() => {});
    });
    const started = new RadarTileClient();
    const ok = FakeWorker.instances[0];
    ok.emit({ type: 'hello' });
    void started.requestTile(args('a'), () => true);
    ok.onerror!({ message: 'uncaught in a handler' });
    expect(ok.terminated).toBe(false);

    const c = new RadarTileClient();
    const bad = FakeWorker.instances[1];
    void c.requestTile(args('b'), () => true);
    const preventDefault = vi.fn();
    bad.onerror!({ message: 'module script failed', preventDefault });
    expect(preventDefault).toHaveBeenCalled();
    expect(bad.terminated).toBe(true);
    await clock.advance(0);
    expect(fetches).toEqual([args('b').url]);
  });

  it('resolves a probe with its answer, or with null after 2 s', async () => {
    const c = new RadarTileClient();
    const w = FakeWorker.instances[0];
    const answered = c.probe('a', 9.5, 46);
    expect(w.posted.at(-1)).toEqual({ type: 'probe', id: 1, frameKey: 'a', lon: 9.5, lat: 46 });
    w.emit({ type: 'probe', id: 1, result: { dbz: 32, snow: false } });
    expect(await answered).toEqual({ dbz: 32, snow: false });

    const unanswered = track(c.probe('a', 9.5, 46));
    await clock.advance(1999);
    expect(unanswered.state).toBe('pending');
    await clock.advance(1);
    expect(unanswered).toEqual({ state: 'resolved', value: null });
    w.emit({ type: 'probe', id: 2, result: { dbz: 40, snow: false } }); // too late: ignored
    expect(unanswered.value).toBeNull();
  });

  it('relays status, expired frames and page visibility', async () => {
    const c = new RadarTileClient();
    const w = FakeWorker.instances[0];
    const statuses: unknown[] = [];
    const gone: string[] = [];
    const stop = c.onStatus((s) => statuses.push(s));
    c.onGone((k) => gone.push(k));
    w.emit({ type: 'status', status: { coolingDownMs: 15_000, failing: false } });
    stop();
    w.emit({ type: 'status', status: { coolingDownMs: 0, failing: false } });
    expect(statuses).toEqual([{ coolingDownMs: 15_000, failing: false }]);
    const tile = c.requestTile(args('old'), () => true);
    w.emit({ type: 'tile', id: 1, empty: true, gone: true });
    expect(gone).toEqual(['old']);
    await nextFrame();
    expect(await tile).toEqual({ width: 1, height: 1 });
    doc.hidden = true;
    onVisibility!();
    expect(w.posted.at(-1)).toEqual({ type: 'hidden', hidden: true });
  });
});
