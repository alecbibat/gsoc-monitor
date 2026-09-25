import * as Cesium from 'cesium';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLabelOverlay } from '../../cesium/labelOverlay';
import { RadarEngine, type EngineSettings } from './radarEngine';
import { DEFAULT_TIMING, type PlaybackClock } from './radarPlayback';
import { radarControl, radarPlayhead } from './radarPlayhead';
import type { RadarPaletteId } from './radarPalettes';
import { TileCancelled, type RadarTileClient, type TileArgs } from './radarTileClient';
import type { TimelineFrame } from './radarTimeline';
import { RadarImageryProvider, type RadarProviderOptions } from './rainviewer';

// The radar engine end to end against a stand-in viewer: real Cesium imagery
// layers (they need no WebGL until drawn), a real Globe whose last render is
// faked as the tiles and imagery states the engine scans, and a fake tile
// client. Time is a mocked performance.now; a tick is scene.preUpdate, which
// Cesium raises every animation frame whether or not it renders.

// ── Cesium internals ─────────────────────────────────────────────────────────
// Exported at runtime but left out of Cesium's typings (all marked private).

interface ImageryLike {
  imageryLayer: Cesium.ImageryLayer;
  state: number;
  x: number;
  y: number;
  level: number;
}
interface Imagery extends ImageryLike {
  parent?: Imagery;
  request?: Cesium.Request;
  releaseReference(): void;
}
interface TileImageryLike {
  readyImagery?: ImageryLike;
  loadingImagery?: ImageryLike;
}
interface LayerInternals {
  _imageryCache: Record<string, Imagery>;
  getImageryFromCache(x: number, y: number, level: number): Imagery;
  removeImageryFromCache(imagery: Imagery): void;
  _requestImagery(imagery: Imagery): void;
}
interface SurfaceInternals {
  _tilesToRender: unknown[];
  _tileLoadQueueHigh: unknown[];
  _tileLoadQueueMedium: unknown[];
  _tileLoadQueueLow: unknown[];
}
const CesiumPrivate = Cesium as unknown as {
  ImageryState: Record<
    'UNLOADED' | 'TRANSITIONING' | 'RECEIVED' | 'TEXTURE_LOADED' | 'READY' | 'FAILED' | 'INVALID' | 'PLACEHOLDER',
    number
  >;
  TileImagery: new (imagery: Imagery, texCoords: Cesium.Cartesian4, useWebMercatorT: boolean) => {
    readyImagery?: Imagery;
    loadingImagery?: Imagery;
    processStateMachine(tile: unknown, frameState: unknown, skipLoading: boolean): boolean;
  };
  QuadtreeTile: new (o: { tilingScheme: Cesium.TilingScheme; x: number; y: number; level: number }) => {
    rectangle: Cesium.Rectangle;
    data: unknown;
  };
  GlobeSurfaceTile: new () => { imagery: TileImageryLike[] };
};
const { ImageryState } = CesiumPrivate;
const internals = (layer: Cesium.ImageryLayer) => layer as unknown as LayerInternals;
// Typed read-only (state) or left out (cancelled, cancel) of the public Request.
const requestInternals = (r: Cesium.Request) => r as unknown as { state: number; cancelled: boolean; cancel(): void };
const surfaceOf = (globe: Cesium.Globe) => (globe as unknown as { _surface: SurfaceInternals })._surface;

// ── fixtures ─────────────────────────────────────────────────────────────────

const HOST = 'https://tilecache.rainviewer.com';
const T0 = 1_790_000_000; // epoch seconds
const TIMES = Array.from({ length: 6 }, (_, i) => T0 + i * 600);
const T6 = T0 + 6 * 600; // the next frame RainViewer publishes
const OPACITY = 0.8;
const QUANTUM = 1 / 512; // the engine rounds layer alpha to this step
const DRAWN = 0.01; // above the near-invisible pre-warm alpha
const SCAN = 160; // one readiness scan: they run at most every 150 ms, and ticks come every 16

const SETTINGS: EngineSettings = {
  palette: 'classic',
  opacity: OPACITY,
  speed: 1,
  sigma: 0.8,
  snow: true,
  tileWidth: 1024,
  timing: DEFAULT_TIMING,
  autoplay: true,
};

// Frames from `forecastFrom` on are nowcast frames (their own tile paths).
function timeline(times: number[], forecastFrom = Infinity): TimelineFrame[] {
  return times.map((time, i) => {
    const forecast = i >= forecastFrom;
    return { frame: { time, path: `/v2/radar/${forecast ? 'nowcast_' : ''}${time}` }, time, forecast };
  });
}

type Coords = [x: number, y: number, level: number];
const AT: Coords = [7, 12, 5]; // the radar imagery tile over the drawn globe tile
const OKLAHOMA = Cesium.Rectangle.fromDegrees(-101.25, 31.95, -95.625, 36.6);
const TEXAS = Cesium.Rectangle.fromDegrees(-101.25, 27.06, -95.625, 31.95);
const ARCTIC = Cesium.Rectangle.fromDegrees(0, 85.5, 11.25, 90); // beyond Web Mercator's 85.05° N

const imagery = (layer: Cesium.ImageryLayer, state: number, [x, y, level]: Coords = AT): ImageryLike => ({
  imageryLayer: layer,
  state,
  x,
  y,
  level,
});
const loaded = (layer: Cesium.ImageryLayer, at: Coords = AT): TileImageryLike => ({
  readyImagery: imagery(layer, ImageryState.READY, at),
});
// While a tile's own imagery loads, Cesium draws a stretched ancestor.
const loading = (layer: Cesium.ImageryLayer, state = ImageryState.TRANSITIONING, at: Coords = AT): TileImageryLike => ({
  readyImagery: imagery(layer, ImageryState.READY, [at[0] >> 1, at[1] >> 1, at[2] - 1]),
  loadingImagery: imagery(layer, state, at),
});
interface FakeTile {
  rectangle: Cesium.Rectangle;
  data: { imagery: TileImageryLike[] };
}
const tile = (list: TileImageryLike[], rectangle = OKLAHOMA): FakeTile => ({ rectangle, data: { imagery: list } });

// A mask with just frame `i` loaded.
const only = (i: number, n = 6) => Array.from({ length: n }, (_, k) => (k === i ? '1' : '0')).join('');
const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};
const same = (a: unknown[], b: unknown[]) => a.length === b.length && a.every((x, i) => x === b[i]);
const windowOf = (engine: RadarEngine) => (engine as unknown as { clock: PlaybackClock }).clock.window;

interface TileCall {
  args: TileArgs;
  wanted: () => boolean;
  resolve: (image: unknown) => void;
  reject: (err: unknown) => void;
}

function fakeClient() {
  const calls: TileCall[] = [];
  return {
    calls,
    last: () => calls[calls.length - 1],
    requestTile: vi.fn(
      (args: TileArgs, wanted: () => boolean) =>
        new Promise((resolve, reject) => calls.push({ args, wanted, resolve, reject }))
    ),
    setRanks: vi.fn(),
    setVisible: vi.fn(),
    retain: vi.fn(),
    probe: vi.fn(async () => ({ dbz: 42, snow: false })),
  };
}

interface RadarLayer {
  layer: Cesium.ImageryLayer;
  provider: RadarImageryProvider;
  key: string;
  time: number;
  palette: RadarPaletteId;
  index: number; // its frame's place among the frame times on the globe, oldest first
}

const engines: RadarEngine[] = [];
let now = 0;

function mount(over: Partial<EngineSettings> = {}) {
  const globe = new Cesium.Globe();
  const surface = surfaceOf(globe);
  const camera = { moveStart: new Cesium.Event(), moveEnd: new Cesium.Event() };
  const scene = { globe, camera, preUpdate: new Cesium.Event(), requestRender: vi.fn() };
  const layers = new Cesium.ImageryLayerCollection();
  const viewer = { scene, imageryLayers: layers, isDestroyed: () => false } as unknown as Cesium.Viewer;
  const client = fakeClient();
  const engine = new RadarEngine(viewer, () => client as unknown as RadarTileClient, { ...SETTINGS, ...over });
  engines.push(engine);

  const frame = (ms = 16) => {
    now += ms;
    scene.preUpdate.raiseEvent();
  };
  const run = (ms: number) => {
    for (let t = 0; t < ms; t += 16) frame();
  };
  const runUntil = (done: () => boolean) => {
    for (let t = 0; t < 30_000; t += 16) {
      if (done()) return;
      frame();
    }
    throw new Error('runUntil: never happened');
  };

  // The radar layers on the globe, bottom → top.
  const radar = (): RadarLayer[] => {
    const out: RadarLayer[] = [];
    for (let i = 0; i < layers.length; i++) {
      const layer = layers.get(i);
      const provider = layer.imageryProvider;
      if (!(provider instanceof RadarImageryProvider)) continue;
      const o = (provider as unknown as { radar: RadarProviderOptions }).radar;
      const time = Number(/\d+$/.exec(o.source.path)![0]);
      out.push({ layer, provider, key: o.frameKey, time, palette: o.palette, index: 0 });
    }
    const times = [...new Set(out.map((l) => l.time))].sort((a, b) => a - b);
    for (const l of out) l.index = times.indexOf(l.time);
    return out;
  };
  // Cesium's last render: the tiles it drew and the ones queued for loading.
  const paint = (drawn: FakeTile[], queued: { high?: FakeTile[]; medium?: FakeTile[]; low?: FakeTile[] } = {}) => {
    surface._tilesToRender = drawn;
    surface._tileLoadQueueHigh = queued.high ?? [];
    surface._tileLoadQueueMedium = queued.medium ?? [];
    surface._tileLoadQueueLow = queued.low ?? [];
  };
  // One drawn tile carrying every radar layer's imagery: loaded where `ready`
  // says (a mask over the frame times, oldest first), loading elsewhere.
  const view = (ready: string | ((l: RadarLayer) => boolean)) => {
    const isReady = typeof ready === 'string' ? (l: RadarLayer) => ready[l.index] === '1' : ready;
    paint([tile(radar().map((l) => (isReady(l) ? loaded(l.layer) : loading(l.layer))))]);
  };
  const alphas = () => radar().map((l) => l.layer.alpha);
  const drawn = () => radar().filter((l) => l.layer.alpha > DRAWN);
  const head = () => radarPlayhead.get();
  return {
    engine,
    viewer,
    scene,
    camera,
    surface,
    layers,
    client,
    frame,
    run,
    runUntil,
    radar,
    paint,
    view,
    alphas,
    drawn,
    head,
  };
}

// Part-way through the loop's step from frame `from` to the next (not the
// wrap, whose playhead sweeps back across the same positions).
function midStep(h: ReturnType<typeof mount>, from: number) {
  return () => {
    const p = h.head().position;
    return same(h.drawn().map((l) => l.index), [from, from + 1]) && p > from + 0.3 && p < from + 0.7;
  };
}

function start(over: Partial<EngineSettings> = {}, times = TIMES) {
  const h = mount(over);
  h.engine.setActive(true);
  h.engine.setTimeline(HOST, timeline(times));
  return h;
}

beforeEach(() => {
  now = 10_000;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
});
afterEach(() => {
  for (const e of engines.splice(0)) e.destroy();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('radar engine: readiness', () => {
  it('marks a frame ready only once every tile Cesium draws or loads holds its own settled imagery', () => {
    const h = start({ autoplay: false });
    const [f0, f1, f2, f3, f4, f5] = h.radar().map((l) => l.layer);
    const all = [f0, f1, f2, f3, f4, f5];
    const mask = () => {
      h.run(SCAN);
      return h.head().readyMask;
    };

    h.paint([tile(all.map((l) => loaded(l))), tile(all.map((l) => loaded(l)), TEXAS)]);
    expect(mask()).toBe('111111');
    // Frame 5 is still loading on one tile (a stretched ancestor stands in).
    h.paint([
      tile(all.map((l) => loaded(l))),
      tile([f0, f1, f2, f3, f4].map((l) => loaded(l)).concat(loading(f5)), TEXAS),
    ]);
    expect(mask()).toBe('111110');
    // Frame 4 has no imagery at all on a drawn tile yet.
    h.paint([tile(all.map((l) => loaded(l))), tile([f0, f1, f2, f3, f5].map((l) => loaded(l)), TEXAS)]);
    expect(mask()).toBe('111101');
    // Radar tiles stop at Web Mercator's edge: a polar tile without them is no hole.
    h.paint([tile(all.map((l) => loaded(l))), tile([], ARCTIC)]);
    expect(mask()).toBe('111111');
    // Tiles queued for loading count as well; queued tiles without radar imagery don't.
    h.paint([tile(all.map((l) => loaded(l)))], { medium: [tile([loading(f3)], TEXAS)], low: [tile([], TEXAS)] });
    expect(mask()).toBe('111011');
    h.paint([tile(all.map((l) => loaded(l)))], { high: [tile([loading(f1)], TEXAS)] });
    expect(mask()).toBe('101111');
    // Failed and invalid imagery is settled (nothing better is coming); a
    // placeholder or not-yet-requested imagery isn't.
    h.paint([
      tile([
        loading(f0, ImageryState.FAILED),
        loading(f1, ImageryState.INVALID),
        loading(f2, ImageryState.PLACEHOLDER),
        loading(f3, ImageryState.UNLOADED),
        loaded(f4),
        loaded(f5),
      ]),
    ]);
    expect(mask()).toBe('110011');
    // Nothing drawn, nothing ready.
    h.paint([]);
    expect(mask()).toBe('000000');
  });

  it('plays the contiguous run of ready frames ending at the newest ready one', () => {
    const h = start({ autoplay: false });
    const cases: Array<[string, [number, number]]> = [
      ['000011', [4, 5]],
      ['001111', [2, 5]],
      ['101011', [4, 5]], // a gap breaks the run
      ['111110', [0, 4]],
      ['011100', [1, 3]],
    ];
    for (const [mask, window] of cases) {
      h.view(mask);
      h.run(SCAN);
      expect(h.head().readyMask).toBe(mask);
      expect(windowOf(h.engine)).toEqual(window);
    }

    // Playing never draws a frame outside the window.
    h.view('001111');
    h.run(SCAN);
    h.engine.play();
    const seen = new Set<number>();
    for (let t = 0; t < 8000; t += 16) {
      h.frame();
      for (const l of h.drawn()) seen.add(l.index);
    }
    expect([...seen].sort()).toEqual([2, 3, 4, 5]);
  });

  it('treats every frame as loaded if the globe internals it scans are gone', () => {
    const h = start();
    (h.scene.globe as unknown as { _surface?: unknown })._surface = undefined;
    h.run(SCAN);
    expect(h.head()).toMatchObject({ readyMask: '111111', playing: true });
  });
});

describe('radar engine: autoplay', () => {
  it('waits for four loaded frames, then opens on the newest', () => {
    const h = start();
    h.view('000001');
    h.run(SCAN);
    expect(h.head()).toMatchObject({ playing: false, buffering: true, index: 5 });
    h.view('000111');
    h.run(SCAN);
    expect(h.head()).toMatchObject({ playing: false, buffering: true, index: 5 });
    h.view('001111');
    h.run(SCAN);
    expect(h.head()).toMatchObject({ playing: true, buffering: false, index: 5, position: 5, live: false });
    // Current conditions first: a long look at the newest frame, then the
    // loop restarts from the oldest loaded one.
    h.run(1500);
    expect(h.head().position).toBe(5);
    h.run(600);
    expect(h.head().position).toBe(2);
  });

  it('needs min(4, n) frames on a short timeline, and never plays a single frame', () => {
    const autoplays = (times: number[], mask: string) => {
      const h = start({}, times);
      h.view(mask);
      h.run(3000);
      const playing = h.head().playing;
      h.engine.destroy();
      return playing;
    };
    expect(autoplays(TIMES.slice(3), '011')).toBe(false);
    expect(autoplays(TIMES.slice(3), '111')).toBe(true);
    expect(autoplays(TIMES.slice(4), '11')).toBe(true);
    expect(autoplays(TIMES.slice(5), '1')).toBe(false);
  });

  it('stays on the newest frame without autoplay (reduced motion)', () => {
    const h = start({ autoplay: false });
    h.view('111111');
    h.run(5000);
    expect(h.head()).toMatchObject({ playing: false, buffering: false, index: 5, live: true });
    expect(h.alphas().map((a) => +a.toFixed(2))).toEqual([0, 0, 0, 0, 0, OPACITY]);
  });
});

describe('radar engine: camera motion', () => {
  // Autoplaying with everything loaded, part-way through the step from frame 1 to 2.
  function midLoop() {
    const h = start();
    h.view('111111');
    h.runUntil(midStep(h, 1));
    return h;
  }

  it('holds through a short move and until the new view has been checked', () => {
    const h = midLoop();
    const before = h.head();
    h.camera.moveStart.raiseEvent();
    h.view('000000'); // flying over ground nothing has loaded for
    h.run(50); // layer alphas redraw at most every 33 ms: let them catch up with the held blend
    const alphas = h.alphas();
    h.run(1000);
    expect(h.head().position).toBe(before.position);
    expect(h.head().readyMask).toBe('111111'); // no scans mid-flight
    expect(h.alphas()).toEqual(alphas);

    // It lands where only the frame on screen has loaded. The old view's
    // readiness no longer counts, so the loop waits for the first scan.
    h.view(only(before.index));
    h.camera.moveEnd.raiseEvent();
    h.run(320);
    expect(h.head().position).toBe(before.position);
    expect(h.alphas()).toEqual(alphas);
    h.run(SCAN);
    expect(h.head()).toMatchObject({
      readyMask: only(before.index),
      index: before.index,
      playing: true,
      buffering: true,
    });
    expect(h.drawn().map((l) => l.index)).toEqual([before.index]);

    // The rest arrives: the loop picks up again.
    h.view('111111');
    h.run(SCAN);
    const p = h.head().position;
    h.run(2500);
    expect(h.head().position).not.toBe(p);
    expect(h.head().buffering).toBe(false);
  });

  it('keeps playing over loaded frames through motion that never ends (a screensaver orbit)', () => {
    const h = midLoop();
    const p0 = h.head().position;
    h.camera.moveStart.raiseEvent(); // no moveEnd will come
    h.run(1400);
    expect(h.head().position).toBe(p0);
    h.run(200);
    expect(h.head().position).toBeGreaterThan(p0);

    const loop = (ms: number) => {
      const indexes = new Set<number>();
      const positions = new Set<number>();
      for (let t = 0; t < ms; t += 16) {
        h.frame();
        indexes.add(h.head().index);
        positions.add(h.head().position);
      }
      return { indexes: [...indexes].sort(), positions: positions.size };
    };
    expect(loop(6000)).toEqual({ indexes: [0, 1, 2, 3, 4, 5], positions: expect.any(Number) });
    // The moving view is still checked: the loop narrows to what has loaded
    // under it, and keeps going.
    h.view('000111');
    h.run(SCAN);
    expect(h.head().readyMask).toBe('000111');
    const narrowed = loop(6000);
    expect(narrowed.indexes).toEqual([3, 4, 5]);
    expect(narrowed.positions).toBeGreaterThan(100);
  });

  it('only requests tiles for the frame on screen (and its blend partner) while the camera moves', () => {
    const h = start({ autoplay: false });
    h.view('111111');
    h.run(600);
    const requests = () =>
      h.radar().map((l) => l.provider.requestImage(AT[0], AT[1], AT[2], new Cesium.Request()) !== undefined);
    expect(requests()).toEqual([true, true, true, true, true, true]);
    h.camera.moveStart.raiseEvent();
    expect(requests()).toEqual([false, false, false, false, false, true]);
    h.engine.scrub(2.5);
    expect(requests()).toEqual([false, false, true, true, false, false]);
    h.engine.scrub(2);
    expect(requests()).toEqual([false, false, true, false, false, false]);
    // A long motion is the new normal: every frame loads again.
    h.run(1600);
    expect(requests()).toEqual([true, true, true, true, true, true]);
    expect(h.client.requestTile).toHaveBeenCalledTimes(6 + 1 + 2 + 1 + 6);
  });
});

describe('radar engine: tile requests', () => {
  it('keeps a request while it is young or its tile is still loading in a recent scan', () => {
    const h = start({ autoplay: false });
    const f5 = h.radar()[5];
    const others = h.radar().slice(0, 5);
    const at: Coords = [9, 12, 5];
    internals(f5.layer).getImageryFromCache(...at); // Cesium holds imagery for the tile
    const listed = () =>
      h.paint([tile([...others.map((l) => loaded(l.layer)), loading(f5.layer, ImageryState.TRANSITIONING, at)])]);
    const gone = () => h.paint([tile(h.radar().map((l) => loaded(l.layer)))]);
    const request = () => {
      f5.provider.requestImage(...at, new Cesium.Request());
      return h.client.last().wanted;
    };

    // Never listed: wanted until three scans and a second have passed.
    gone();
    const young = request();
    h.run(3 * SCAN);
    expect(young()).toBe(true);
    h.run(600);
    expect(young()).toBe(false);

    // Listed while Cesium loads it; dropped once it is missing from the last three scans.
    listed();
    const wanted = request();
    h.run(1200);
    expect(wanted()).toBe(true);
    gone();
    h.run(SCAN);
    expect(wanted()).toBe(true);
    h.run(SCAN);
    expect(wanted()).toBe(true);
    h.run(SCAN);
    expect(wanted()).toBe(false);

    // No scans run while the camera moves, so nothing ages out mid-flight.
    h.camera.moveStart.raiseEvent();
    const inFlight = request();
    h.run(1400);
    expect(inFlight()).toBe(true);
  });

  it('drops a request once Cesium lets go of its imagery or the frame goes', () => {
    const h = start({ autoplay: false });
    const [f0, , , , , f5] = h.radar();
    const held = internals(f5.layer).getImageryFromCache(1, 1, 2);
    f5.provider.requestImage(1, 1, 2, new Cesium.Request());
    const wanted = h.client.last().wanted;
    expect(wanted()).toBe(true);
    held.releaseReference(); // the last tile using it went: Cesium deletes the cache entry
    expect(wanted()).toBe(false);

    internals(f5.layer).getImageryFromCache(1, 1, 2);
    const request = new Cesium.Request();
    f5.provider.requestImage(1, 1, 2, request);
    const cancelled = h.client.last().wanted;
    expect(cancelled()).toBe(true);
    requestInternals(request).cancel();
    expect(cancelled()).toBe(false);

    internals(f0.layer).getImageryFromCache(1, 1, 2);
    f0.provider.requestImage(1, 1, 2, new Cesium.Request());
    const expired = h.client.last().wanted;
    expect(expired()).toBe(true);
    h.engine.setTimeline(HOST, timeline(TIMES.slice(1)));
    expect(f0.layer.isDestroyed()).toBe(true);
    expect(expired()).toBe(false);
  });

  it('hands a cancelled tile back to Cesium as not loaded rather than failed', async () => {
    const h = start({ autoplay: false });
    const { layer, provider } = h.radar()[5];
    const load = (x: number) => {
      const img = internals(layer).getImageryFromCache(x, 6, 4);
      internals(layer)._requestImagery(img);
      return { img, request: img.request!, call: h.client.last() };
    };

    const cancelled = load(4);
    expect(cancelled.img.state).toBe(ImageryState.TRANSITIONING);
    expect(cancelled.call.args).toMatchObject({ z: 4, x: 4, y: 6, palette: 'classic', snow: true });
    cancelled.call.reject(new TileCancelled());
    await flush();
    expect(cancelled.request.state).toBe(Cesium.RequestState.CANCELLED);
    expect(cancelled.img.state).toBe(ImageryState.UNLOADED); // asked again if it comes back into view
    expect(cancelled.img.request).toBeUndefined();

    // A real failure still fails (Cesium logs it: nobody listens for errors here).
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const failed = load(5);
    failed.call.reject(new Error('decode failed'));
    await flush();
    expect(failed.request.state).not.toBe(Cesium.RequestState.CANCELLED);
    expect(failed.img.state).toBe(ImageryState.FAILED);

    const delivered = load(6);
    delivered.call.resolve({ width: 512, height: 512 });
    await flush();
    expect(delivered.img.state).toBe(ImageryState.RECEIVED);

    // The provider on its own: the rejection passes through, marked cancelled.
    const request = new Cesium.Request();
    const promise = provider.requestImage(7, 6, 4, request)!;
    h.client.last().reject(new TileCancelled());
    await expect(promise).rejects.toBeInstanceOf(TileCancelled);
    expect(request.state).toBe(Cesium.RequestState.CANCELLED);
  });
});

describe('radar engine: timeline updates', () => {
  it('keeps the same frame time on screen when a new frame arrives and the oldest expires', () => {
    const h = start({ autoplay: false });
    h.view('111111');
    h.run(600);
    h.engine.step(-2);
    h.run(300);
    expect(h.head().index).toBe(3);
    const before = h.radar();

    h.engine.setTimeline(HOST, timeline([...TIMES.slice(1), T6]));
    h.frame();
    expect(h.head()).toMatchObject({ index: 2, position: 2 });
    expect(h.drawn().map((l) => l.time)).toEqual([TIMES[3]]);
    // Only the new frame's layer is new; the expired one is gone.
    const after = h.radar();
    expect(after.map((l) => l.time)).toEqual([...TIMES.slice(1), T6]);
    expect(same(after.slice(0, 5).map((l) => l.layer), before.slice(1).map((l) => l.layer))).toBe(true);
    expect(before[0].layer.isDestroyed()).toBe(true);
    expect(h.client.retain).toHaveBeenLastCalledWith(after.map((l) => l.key));
  });

  it('carries a blend in progress across the refresh', () => {
    const h = start();
    h.view('111111');
    h.runUntil(midStep(h, 2));
    const p = h.head().position;
    const times = h.drawn().map((l) => l.time);
    expect(times).toEqual([TIMES[2], TIMES[3]]);

    h.engine.setTimeline(HOST, timeline([...TIMES.slice(1), T6]));
    h.frame();
    expect(h.drawn().map((l) => l.time)).toEqual(times);
    expect(h.head().position).toBeCloseTo(p - 1 + 16 / DEFAULT_TIMING.frameMs, 6);
  });

  it('carries on from the frame it was blending into when the one on screen expires', () => {
    const h = start();
    h.view('111111');
    h.runUntil(() => same(h.drawn().map((l) => l.index), [0, 1]) && h.head().index === 0 && h.alphas()[1] > 0.1);
    h.engine.setTimeline(HOST, timeline([...TIMES.slice(1), T6]));
    h.frame();
    // Not a frame ahead (TIMES[1] blending into TIMES[2]).
    expect(h.drawn().map((l) => l.time)).toEqual([TIMES[1]]);
    expect(h.head()).toMatchObject({ index: 0, playing: true });
  });

  it('rests on the newest observed frame, and follows a forecast frame that becomes observed', () => {
    const h = mount({ autoplay: false });
    h.engine.setActive(true);
    // Two nowcast frames after the newest observation.
    h.engine.setTimeline(HOST, timeline([...TIMES, T6, T6 + 600], 6));
    h.view('11111111');
    h.run(600);
    expect(h.head()).toMatchObject({ index: 5, live: true });
    const nowcast = h.radar()[6].layer;
    // T6 is observed now: a new layer (new path), and "now" moves onto it once loaded.
    h.engine.setTimeline(HOST, timeline([...TIMES.slice(1), T6, T6 + 600, T6 + 1200], 6));
    expect(nowcast.isDestroyed()).toBe(true);
    h.frame();
    expect(h.head()).toMatchObject({ index: 4, live: true });
    h.view('11111111');
    h.run(SCAN + 700);
    expect(h.head()).toMatchObject({ index: 5, live: true });
    expect(h.drawn().map((l) => l.time)).toEqual([T6]);
  });

  it('ranks the frame on screen first for loading, then newest to oldest, and reports the visible tiles', () => {
    const h = start({ autoplay: false });
    h.view('111111');
    h.run(600);
    const keys = h.radar().map((l) => l.key);
    const order = () => {
      const ranks: Record<string, number> = h.client.setRanks.mock.lastCall![0];
      return Object.keys(ranks).sort((a, b) => ranks[a] - ranks[b]).map((k) => keys.indexOf(k));
    };
    expect(order()).toEqual([5, 4, 3, 2, 1, 0]);
    expect(h.client.setVisible).toHaveBeenLastCalledWith([`${AT[2]}/${AT[0]}/${AT[1]}`]);
    h.engine.step(-3);
    h.run(300);
    expect(order()).toEqual([2, 5, 4, 3, 1, 0]);
  });

  it('ignores a timeline with nothing new, even mid-rebuild', () => {
    const h = start({ autoplay: false });
    h.view('111111');
    h.run(600);
    const all = () => Array.from({ length: h.layers.length }, (_, i) => h.layers.get(i));
    const before = all();
    h.client.retain.mockClear();
    h.scene.requestRender.mockClear();
    h.engine.setTimeline(HOST, timeline(TIMES)); // a manifest poll: fresh objects, same frames
    expect(same(all(), before)).toBe(true);
    expect(h.client.retain).not.toHaveBeenCalled();
    expect(h.scene.requestRender).not.toHaveBeenCalled();

    h.engine.updateSettings({ palette: 'vivid' });
    const rebuilding = all();
    expect(rebuilding).toHaveLength(12);
    h.run(100);
    h.engine.setTimeline(HOST, timeline(TIMES));
    expect(same(all(), rebuilding)).toBe(true);
  });

  it('rebuilds every layer when the tile host changes', () => {
    const h = start({ autoplay: false });
    h.view('111111');
    h.run(600);
    const old = h.radar().map((l) => l.layer);
    h.engine.setTimeline('https://mirror.example', timeline(TIMES));
    const fresh = h.radar();
    expect(fresh).toHaveLength(6);
    expect(old.every((l) => l.isDestroyed())).toBe(true);
    fresh[5].provider.requestImage(...AT, new Cesium.Request());
    expect(h.client.last().args.url.startsWith('https://mirror.example/v2/radar/')).toBe(true);
    // The new layers stay hidden until they have loaded.
    h.run(SCAN);
    expect(h.alphas()).toEqual([0, 0, 0, 0, 0, 0]);
    h.view('111111');
    h.run(SCAN + 500);
    expect(h.alphas()[5]).toBeCloseTo(OPACITY, 2);
  });

  it('keeps the layers in time order just below the place labels', () => {
    const h = mount({ autoplay: false });
    const stub = () => new Cesium.UrlTemplateImageryProvider({ url: 'https://basemap.example/{z}/{x}/{y}.png' });
    const base = h.layers.addImageryProvider(stub());
    const labels = h.layers.addImageryProvider(stub());
    setLabelOverlay(h.viewer, labels);
    const all = [...TIMES, T6];
    const order = () =>
      Array.from({ length: h.layers.length }, (_, i) => {
        const layer = h.layers.get(i);
        if (layer === base) return 'base';
        if (layer === labels) return 'labels';
        return all.indexOf(h.radar().find((l) => l.layer === layer)!.time);
      });
    const show = (indexes: number[]) => h.engine.setTimeline(HOST, timeline(indexes.map((i) => all[i])));

    h.engine.setActive(true);
    show([3, 4, 5]);
    expect(order()).toEqual(['base', 3, 4, 5, 'labels']);
    show([0, 1, 2, 3, 4, 5]); // a longer window: older frames slot in underneath
    expect(order()).toEqual(['base', 0, 1, 2, 3, 4, 5, 'labels']);
    show([1, 2, 3, 4, 5, 6]); // a new frame on top, the oldest gone
    expect(order()).toEqual(['base', 1, 2, 3, 4, 5, 6, 'labels']);
    show([1, 2, 4, 5, 6]);
    show([1, 2, 3, 4, 5, 6]); // back into the middle
    expect(order()).toEqual(['base', 1, 2, 3, 4, 5, 6, 'labels']);

    // A rebuild stacks above the current layers, then takes their place.
    h.engine.updateSettings({ palette: 'vivid' });
    expect(order()).toEqual(['base', 1, 2, 3, 4, 5, 6, 1, 2, 3, 4, 5, 6, 'labels']);
    expect(h.radar().map((l) => l.palette)).toEqual([...Array(6).fill('classic'), ...Array(6).fill('vivid')]);
    h.view('111111');
    h.run(SCAN);
    expect(order()).toEqual(['base', 1, 2, 3, 4, 5, 6, 'labels']);
    expect(h.radar().every((l) => l.palette === 'vivid')).toBe(true);
    h.engine.destroy();
    expect(order()).toEqual(['base', 'labels']);
  });
});

describe('radar engine: palette rebuilds', () => {
  it('builds the new palette underneath and swaps once the loop has loaded in it, without a blink', () => {
    const h = start({ autoplay: false });
    h.view('111111');
    h.run(600);
    const old = h.radar().map((l) => l.layer);
    h.engine.updateSettings({ palette: 'vivid' });
    const fresh = h.radar().filter((l) => l.palette === 'vivid');
    expect(fresh).toHaveLength(6);
    expect(fresh.every((l) => l.layer.alpha === 0)).toBe(true);

    // The frame on screen loads first in the new stack; the rest of the loop isn't there yet.
    h.view((l) => l.palette === 'classic' || l.index === 5);
    h.run(1000);
    expect(h.radar()).toHaveLength(12);
    h.view('111111');
    for (let t = 0; t < SCAN; t += 16) {
      h.frame();
      const newest = h.radar().filter((l) => l.time === TIMES[5]);
      expect(Math.max(...newest.map((l) => l.layer.alpha))).toBeCloseTo(OPACITY, 2);
    }
    expect(same(h.radar().map((l) => l.layer), fresh.map((l) => l.layer))).toBe(true);
    expect(old.every((l) => l.isDestroyed())).toBe(true);
  });

  it('waits only for the frames the loop plays, and the one on screen', () => {
    const h = start({ autoplay: false });
    h.view('000111');
    h.run(600);
    h.engine.updateSettings({ palette: 'vivid' });
    h.view((l) => l.index >= 3);
    h.run(SCAN);
    expect(h.radar().map((l) => l.palette)).toEqual(Array(6).fill('vivid'));

    // Stepped back to a frame outside the loop: that one has to load too.
    h.engine.step(-4);
    h.run(300);
    h.engine.updateSettings({ palette: 'classic' });
    h.view((l) => l.index >= 3);
    h.run(1000);
    expect(h.radar()).toHaveLength(12);
    h.view((l) => l.index >= 3 || l.index === 1);
    h.run(SCAN);
    expect(h.radar().map((l) => l.palette)).toEqual(Array(6).fill('classic'));
  });

  it('swaps after 5 s even if the new stack never loads', () => {
    const h = start({ autoplay: false });
    h.view('111111');
    h.run(600);
    h.engine.updateSettings({ palette: 'vivid' });
    h.view((l) => l.palette === 'classic');
    h.run(4900);
    expect(h.radar()).toHaveLength(12);
    h.run(200);
    expect(h.radar().map((l) => l.palette)).toEqual(Array(6).fill('vivid'));
  });

  it('restarts the rebuild when the timeline changes under it', () => {
    const h = start({ autoplay: false });
    h.view('111111');
    h.run(600);
    h.engine.updateSettings({ palette: 'vivid' });
    const first = h.radar().filter((l) => l.palette === 'vivid');
    h.run(100);
    h.engine.setTimeline(HOST, timeline([...TIMES.slice(1), T6]));
    expect(first.every((l) => l.layer.isDestroyed())).toBe(true);
    // The current stack plus a fresh rebuild of all six frames.
    expect(h.radar()).toHaveLength(12);
    h.view(() => true);
    h.run(SCAN);
    const after = h.radar();
    expect(after.map((l) => l.time)).toEqual([...TIMES.slice(1), T6]);
    expect(after.every((l) => l.palette === 'vivid')).toBe(true);
  });

  it('rebuilds for palette, snow and refreshTiles, not for opacity or speed', () => {
    const h = start({ autoplay: false });
    h.view('111111');
    h.run(600);
    h.engine.updateSettings({ palette: 'classic', opacity: 0.5, speed: 2 });
    h.frame();
    expect(h.radar()).toHaveLength(6);
    expect(h.alphas()[5]).toBeCloseTo(0.5, 2);
    h.engine.updateSettings({ snow: false });
    expect(h.radar()).toHaveLength(12);
    h.view(() => true);
    h.run(SCAN);
    expect(h.radar()).toHaveLength(6);
    h.engine.refreshTiles();
    expect(h.radar()).toHaveLength(12);
  });
});

describe('radar engine: on / off', () => {
  it('fades out, then releases every layer', () => {
    const h = start({ autoplay: false });
    h.view('111111');
    h.run(600);
    h.engine.setActive(false);
    h.run(96);
    expect(h.alphas()[5]).toBeGreaterThan(0.2);
    expect(h.alphas()[5]).toBeLessThan(OPACITY - 0.2);
    h.run(250);
    expect(h.radar()).toHaveLength(0);
    expect(h.head()).toMatchObject({ total: 0, readyMask: '' });
  });

  it('switched back on, fades in once the frame on screen has loaded, or after 2.5 s regardless', () => {
    const h = start({ autoplay: false });
    h.view('111111');
    h.run(600);
    const reopen = () => {
      h.engine.setActive(false);
      h.run(400);
      expect(h.radar()).toHaveLength(0);
      h.engine.setActive(true);
      h.engine.setTimeline(HOST, timeline(TIMES)); // as RadarLayer does on reactivation
    };

    reopen();
    h.view('111111');
    h.run(SCAN + 480);
    expect(h.alphas()[5]).toBeCloseTo(OPACITY, 2);

    reopen();
    h.view('000000');
    h.run(2400);
    expect(Math.max(...h.alphas())).toBe(0);
    h.run(200);
    expect(h.alphas()[5]).toBeGreaterThan(0);
    h.run(500);
    expect(h.alphas()[5]).toBeCloseTo(OPACITY, 2);
  });

  it('keeps its layers if switched back on before the fade-out ends', () => {
    const h = start({ autoplay: false });
    h.view('111111');
    h.run(600);
    const layers = h.radar().map((l) => l.layer);
    h.engine.setActive(false);
    h.run(96);
    h.engine.setActive(true);
    h.run(500);
    expect(same(h.radar().map((l) => l.layer), layers)).toBe(true);
    expect(h.alphas()[5]).toBeCloseTo(OPACITY, 2);
  });

  it('answers hover probes for the frame on screen, and not while hidden', async () => {
    const h = start({ autoplay: false });
    expect(await h.engine.probe(-97, 35)).toBeNull();
    h.view('111111');
    h.run(600);
    expect(await h.engine.probe(-97, 35)).toEqual({ dbz: 42, snow: false });
    expect(h.client.probe).toHaveBeenCalledWith(h.radar()[5].key, -97, 35);
  });

  it('destroy() removes every layer, listener and handle', () => {
    vi.stubGlobal('window', {});
    const h = start();
    const w = window as unknown as Record<string, unknown>;
    expect(w.__radarEngine).toBe(h.engine);
    h.view('111111');
    h.run(600);
    const play = vi.spyOn(h.engine, 'play');

    h.engine.destroy();
    expect(h.layers.length).toBe(0);
    expect(w.__radarEngine).toBeUndefined();
    expect(h.scene.preUpdate.numberOfListeners).toBe(0);
    expect(h.camera.moveStart.numberOfListeners).toBe(0);
    expect(h.camera.moveEnd.numberOfListeners).toBe(0);
    expect(h.head()).toMatchObject({ total: 0, playing: false });
    radarControl.play();
    expect(play).not.toHaveBeenCalled();
    h.engine.setTimeline(HOST, timeline([...TIMES, T6]));
    expect(h.layers.length).toBe(0);
    h.engine.destroy(); // twice is harmless
  });

  it('leaves the controls with a newer engine when an older one goes', () => {
    vi.stubGlobal('window', {});
    const older = start();
    const newer = start();
    const play = vi.spyOn(newer.engine, 'play');
    older.engine.destroy();
    radarControl.play();
    expect(play).toHaveBeenCalledTimes(1);
    expect((window as unknown as Record<string, unknown>).__radarEngine).toBe(newer.engine);
  });
});

describe('radar engine: playhead', () => {
  it('moves the live pin only forward, onto a newer frame once it has loaded', () => {
    const h = start({ autoplay: false });
    h.view('111111');
    h.run(600);
    expect(h.head()).toMatchObject({ index: 5, live: true });

    // Somewhere the newest frame hasn't loaded yet: "now" doesn't step back.
    h.camera.moveStart.raiseEvent();
    h.run(300);
    h.view('111110');
    h.camera.moveEnd.raiseEvent();
    h.run(1000);
    expect(h.head()).toMatchObject({ readyMask: '111110', index: 5, position: 5, live: true });

    // A new frame is published: "now" moves onto it only once it has loaded.
    h.view('111111');
    h.engine.setTimeline(HOST, timeline([...TIMES, T6]));
    h.view('1111110');
    h.run(1000);
    expect(h.head()).toMatchObject({ index: 5, position: 5, live: true });
    h.view('1111111');
    h.run(SCAN + 300);
    expect(h.head().position).toBeGreaterThan(5);
    expect(h.head().position).toBeLessThan(6);
    expect(h.head().live).toBe(true);
    h.run(400);
    expect(h.head()).toMatchObject({ index: 6, position: 6, live: true });
    expect(h.alphas()[6]).toBeCloseTo(OPACITY, 2);
  });

  it('lets step and scrub show a frame that is still loading', () => {
    const h = start({ autoplay: false });
    h.view('000111');
    h.run(600);
    h.engine.step(-4);
    h.run(300);
    expect(h.head()).toMatchObject({ index: 1, position: 1, live: false });
    expect(h.drawn().map((l) => l.index)).toEqual([1]);
    expect(h.alphas()[1]).toBeCloseTo(OPACITY, 2);

    h.engine.scrub(0.5);
    h.frame();
    expect(h.head().position).toBe(0.5);
    expect(h.drawn().map((l) => l.index)).toEqual([0, 1]);
    h.engine.endScrub();
    h.run(300);
    expect(h.head()).toMatchObject({ position: 1, playing: false });
    h.engine.oldest();
    h.run(300);
    expect(h.head().index).toBe(0);
    h.engine.latest();
    h.run(300);
    expect(h.head()).toMatchObject({ index: 5, live: true });
  });

  it('crossfades within [0, opacity], never dipping coverage mid-blend', () => {
    const h = start();
    h.view('111111');
    const problems: string[] = [];
    let blends = 0;
    for (let t = 0; t < 12_000; t += 16) {
      h.frame();
      const a = h.alphas();
      if (a.some((x) => x < 0 || x > OPACITY + QUANTUM / 2)) problems.push(`out of range at ${t}: ${a}`);
      const on = a.map((x, i) => (x > DRAWN ? i : -1)).filter((i) => i >= 0);
      if (on.length > 2) problems.push(`more than two frames drawn at ${t}: ${a}`);
      if (on.length === 2) {
        blends++;
        const [lower, upper] = on;
        if (upper - lower !== 1 && !(lower === 0 && upper === 5)) problems.push(`not a neighbour or wrap blend: ${on}`);
        // The lower layer never drops below its linear share (opacity − upper).
        if (a[lower] < OPACITY - a[upper] - QUANTUM) problems.push(`coverage dips at ${t}: ${a}`);
      }
    }
    expect(problems).toEqual([]);
    expect(blends).toBeGreaterThan(200);
  });
});

// The engine and provider read a few private Cesium members; these fail
// loudly on a Cesium upgrade that moves them (the engine itself would quietly
// fall back to treating every frame as loaded).
describe('Cesium internals the radar relies on', () => {
  const stubProvider = () => new Cesium.UrlTemplateImageryProvider({ url: 'https://tiles.example/{z}/{x}/{y}.png' });
  const quadtreeTile = () =>
    new CesiumPrivate.QuadtreeTile({ tilingScheme: new Cesium.GeographicTilingScheme(), x: 1, y: 0, level: 1 });

  it('Globe keeps the quadtree render list and load queues on _surface', () => {
    const surface = surfaceOf(new Cesium.Globe());
    expect(Array.isArray(surface._tilesToRender)).toBe(true);
    expect(Array.isArray(surface._tileLoadQueueHigh)).toBe(true);
    expect(Array.isArray(surface._tileLoadQueueMedium)).toBe(true);
    expect(Array.isArray(surface._tileLoadQueueLow)).toBe(true);
  });

  it('quadtree tiles expose rectangle and data.imagery', () => {
    const qt = quadtreeTile();
    expect(qt.rectangle).toBeInstanceOf(Cesium.Rectangle);
    expect('data' in qt).toBe(true);
    expect(new CesiumPrivate.GlobeSurfaceTile().imagery).toEqual([]);
  });

  it('ImageryState has the values the engine hard-codes', () => {
    expect(ImageryState).toMatchObject({
      UNLOADED: 0,
      TRANSITIONING: 1,
      READY: 4,
      FAILED: 5,
      INVALID: 6,
      PLACEHOLDER: 7,
    });
  });

  it('ImageryLayer caches imagery under JSON.stringify([x, y, level]) until its last reference goes', () => {
    const layer = new Cesium.ImageryLayer(stubProvider());
    const cache = internals(layer)._imageryCache;
    expect(cache).toEqual({});
    const img = internals(layer).getImageryFromCache(3, 5, 4);
    expect(cache[JSON.stringify([3, 5, 4])]).toBe(img);
    expect(img).toMatchObject({ imageryLayer: layer, x: 3, y: 5, level: 4, state: ImageryState.UNLOADED });
    img.releaseReference();
    expect(JSON.stringify([3, 5, 4]) in cache).toBe(false);
  });

  it('TileImagery keeps imagery in loadingImagery (an ancestor standing in) until READY, then in readyImagery', () => {
    const layer = new Cesium.ImageryLayer(stubProvider());
    const img = internals(layer).getImageryFromCache(2, 1, 2);
    const ti = new CesiumPrivate.TileImagery(img, new Cesium.Cartesian4(0, 0, 1, 1), true);
    expect(ti.loadingImagery).toBe(img);
    expect(ti.readyImagery).toBeUndefined();
    img.state = ImageryState.TRANSITIONING; // requested
    img.parent!.state = ImageryState.READY;
    ti.processStateMachine(quadtreeTile(), {}, true);
    expect(ti.loadingImagery).toBe(img);
    expect(ti.readyImagery).toBe(img.parent);
    img.state = ImageryState.READY;
    expect(ti.processStateMachine(quadtreeTile(), {}, true)).toBe(true);
    expect(ti.readyImagery).toBe(img);
    expect(ti.loadingImagery).toBeUndefined();
  });

  it('ImageryLayer puts imagery back to UNLOADED when a request rejects after being marked CANCELLED', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const settle: Array<(cancel: boolean) => void> = [];
    let defer = false;
    const provider = stubProvider();
    provider.requestImage = (_x, _y, _level, request) => {
      if (defer) return undefined;
      return new Promise((_resolve, reject) =>
        settle.push((cancel) => {
          if (cancel) requestInternals(request!).state = Cesium.RequestState.CANCELLED;
          reject(new Error('no'));
        })
      );
    };
    const layer = new Cesium.ImageryLayer(provider);
    const load = (x: number) => {
      const img = internals(layer).getImageryFromCache(x, 0, 1);
      internals(layer)._requestImagery(img);
      return img;
    };

    const cancelled = load(0);
    expect(cancelled.request).toBeInstanceOf(Cesium.Request);
    expect(requestInternals(cancelled.request!).cancelled).toBe(false);
    settle[0](true);
    await flush();
    expect(cancelled.state).toBe(ImageryState.UNLOADED);

    const failed = load(1);
    settle[1](false);
    await flush();
    expect(failed.state).toBe(ImageryState.FAILED);

    defer = true; // requestImage returning undefined postpones the tile
    expect(load(2).state).toBe(ImageryState.UNLOADED);

    const request = requestInternals(new Cesium.Request());
    request.cancel();
    expect(request.cancelled).toBe(true);
  });

  it('the engine reads readiness off real Cesium tiles', () => {
    const h = start({ autoplay: false });
    const qt = quadtreeTile();
    const data = new CesiumPrivate.GlobeSurfaceTile();
    qt.data = data;
    const tis = h
      .radar()
      .map(
        (l) =>
          new CesiumPrivate.TileImagery(
            internals(l.layer).getImageryFromCache(3, 2, 2),
            new Cesium.Cartesian4(0, 0, 1, 1),
            true
          )
      );
    data.imagery.push(...tis);
    h.surface._tilesToRender = [qt];
    h.run(SCAN);
    expect(h.head().readyMask).toBe('000000');
    // What TileImagery.processStateMachine does once an imagery tile is READY.
    for (const ti of tis.slice(4)) {
      ti.loadingImagery!.state = ImageryState.READY;
      ti.readyImagery = ti.loadingImagery;
      ti.loadingImagery = undefined;
    }
    tis[3].loadingImagery!.state = ImageryState.FAILED;
    h.run(SCAN);
    expect(h.head().readyMask).toBe('000111');
  });
});
