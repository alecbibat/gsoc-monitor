import * as Cesium from 'cesium';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LightningFieldResponse, LightningMarks, LightningStatusLite } from '../../types/lightning';
import { LIGHTNING_STAGES, STAGE_ENDS_S } from './lightningPalette';
import { qLat, qLon, tickOf } from './strikeKey';

// The engine end to end against a stand-in viewer (real Cesium billboards and
// math, no WebGL), a mocked /field and a fake socket: what's drawn, the live →
// field hand-over, the window filter, expiry, stale responses and teardown.

vi.mock('../../api/lightningApi', () => ({ fetchLightningField: vi.fn() }));
import { fetchLightningField } from '../../api/lightningApi';
import { startLightning } from './lightningEngine';
import { useLightningStatus } from './lightningStore';

const fetchMock = vi.mocked(fetchLightningField);
const T0 = 1_790_000_000_000;
const MIN = 60_000;
const HOUR = 60 * MIN;

class FakeSocket {
  static all: FakeSocket[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  closed = false;
  constructor(public url: string) {
    FakeSocket.all.push(this);
  }
  send() {}
  close() {
    this.closed = true;
  }
  strike(lat: number, lon: number, tMs = Date.now()) {
    this.onmessage?.({ data: JSON.stringify({ lat, lon, time: tMs * 1e6 }) });
  }
}

interface Pt {
  tMs: number;
  lat: number;
  lon: number;
}

function encode(pts: Pt[]): LightningMarks {
  const sorted = [...pts].sort((a, b) => a.tMs - b.tMs);
  const ticks = sorted.map((p) => tickOf(p.tMs));
  return {
    tick0: ticks[0] ?? 0,
    dt: ticks.map((t, i) => (i === 0 ? 0 : t - ticks[i - 1])),
    la: sorted.map((p) => qLat(p.lat)),
    lo: sorted.map((p) => qLon(p.lon)),
  };
}

function statusLite(now: number): LightningStatusLite {
  return {
    now,
    collector: { connected: true, downSince: null, lastStrikeAgeS: 0, ratePerMin: 6_000 },
    counts: { m60: 10, m360: 20, m720: 30, m1440: 40, exact: true },
    coverage: { windowMin: 1440, coveredMin: 1440, gaps: [], restoring: false, restoredBackToMs: null },
    fidelity: { legacyBeforeMs: null, evictedBeforeMs: null },
    restore: { state: 'done', progress: 1, backToMs: null },
  };
}

function response(field: Pt[], fresh: Pt[]): LightningFieldResponse {
  const now = Date.now();
  return {
    v: 1,
    now,
    stageEndsS: [...STAGE_ENDS_S],
    view: { bbox: null, budget: 16_000, cellDeg: 1, total: field.length, degraded: null },
    field: encode(field),
    fresh: encode(fresh),
    status: statusLite(now),
  };
}

// A viewer looking down on Oklahoma from 2,000 km.
function fakeViewer() {
  const primitives: Cesium.BillboardCollection[] = [];
  const carto = Cesium.Cartographic.fromDegrees(-97, 35, 2e6);
  let rect = Cesium.Rectangle.fromDegrees(-110, 25, -85, 45);
  const scene = {
    primitives: {
      add: (p: Cesium.BillboardCollection) => (primitives.push(p), p),
      remove: (p: Cesium.BillboardCollection) => {
        primitives.splice(primitives.indexOf(p), 1);
        p.destroy();
        return true;
      },
    },
    requestRender: vi.fn(),
    globe: { ellipsoid: Cesium.Ellipsoid.WGS84 },
    frameState: { mode: Cesium.SceneMode.SCENE3D },
  };
  const camera = {
    positionCartographic: carto,
    positionWC: Cesium.Cartographic.toCartesian(carto),
    computeViewRectangle: (_e: unknown, result?: Cesium.Rectangle) => Cesium.Rectangle.clone(rect, result),
    changed: new Cesium.Event(),
    moveEnd: new Cesium.Event(),
  };
  const viewer = {
    scene,
    camera,
    dataSources: { add: vi.fn(async (d: unknown) => d), remove: vi.fn(() => true) },
    isDestroyed: () => false,
  } as unknown as Cesium.Viewer;
  return {
    viewer,
    scene,
    camera,
    primitives,
    setRect: (w: number, s: number, e: number, n: number) => {
      rect = Cesium.Rectangle.fromDegrees(w, s, e, n);
    },
  };
}

const shown = (c: Cesium.BillboardCollection) => {
  let n = 0;
  for (let i = 0; i < c.length; i++) if (c.get(i).show) n++;
  return n;
};
// Stage sizes are all distinct, so a billboard's width names its stage.
const stageOf = (bb: Cesium.Billboard) => LIGHTNING_STAGES.findIndex((s) => s.sizePx === bb.width);
const shownStages = (c: Cesium.BillboardCollection) => {
  const out: number[] = [];
  for (let i = 0; i < c.length; i++) if (c.get(i).show) out.push(stageOf(c.get(i)));
  return out.sort();
};
const flush = () => vi.advanceTimersByTimeAsync(0);

describe('lightning engine', () => {
  beforeEach(() => {
    FakeSocket.all = [];
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    vi.stubGlobal('WebSocket', FakeSocket);
    vi.stubGlobal('document', { hidden: false, addEventListener: vi.fn(), removeEventListener: vi.fn() });
    vi.stubGlobal('requestAnimationFrame', (cb: () => void) => setTimeout(cb, 16));
    vi.stubGlobal('cancelAnimationFrame', (id: ReturnType<typeof setTimeout>) => clearTimeout(id));
    vi.spyOn(console, 'warn').mockImplementation(() => {}); // zustand persist has no localStorage here
    fetchMock.mockReset();
    useLightningStatus.getState().resetRuntime();
    useLightningStatus.getState().setWindow(1440);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  // Four sampled marks (one of them also in the fresh list) and two fresh strikes.
  const twin: Pt = { tMs: T0 - 60_000, lat: 35.5, lon: -97.5 };
  const FIELD: Pt[] = [
    { tMs: T0 - 20 * MIN, lat: 36, lon: -98 }, // stage 2
    { tMs: T0 - 5 * HOUR, lat: 34, lon: -96 }, // stage 5
    { tMs: T0 - 20 * HOUR, lat: 33, lon: -95 }, // stage 6
    twin,
  ];
  const FRESH: Pt[] = [{ tMs: T0 - 10_000, lat: 35.2, lon: -97.2 }, twin];

  // Each call builds its response then, so its `now` is current (a stale `now`
  // would drag the server clock).
  const serve = (field: Pt[], fresh: Pt[]) =>
    fetchMock.mockImplementation(() => Promise.resolve(response(field, fresh)));

  // The browser socket delivering (strikes too old to draw, so nothing extra
  // lands in the live pool) — keeps the engine off the server fallback.
  function keepSocketAlive() {
    FakeSocket.all[0].onopen?.();
    const id = setInterval(() => {
      FakeSocket.all[FakeSocket.all.length - 1].strike(0, 0, Date.now() - 5 * MIN);
    }, 5_000);
    return () => clearInterval(id);
  }

  async function startWithField(variant: 'app' | 'share' = 'app') {
    serve(FIELD, FRESH);
    const v = fakeViewer();
    const stop = startLightning(v.viewer, variant);
    await flush();
    const [fieldBbs, liveBbs] = v.primitives;
    return { ...v, stop, fieldBbs, liveBbs };
  }

  it('asks for the snapped view box with the variant budgets', async () => {
    const { stop } = await startWithField();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const arg = fetchMock.mock.calls[0][0];
    // 25° × 20° → a 10° unit, snapped outward.
    expect(arg.bbox).toEqual([-110, 20, -80, 50]);
    expect(arg.budget).toBe(16_000);
    expect(arg.fresh).toBe(4_000);
    stop();

    const share = await startWithField('share');
    const a2 = fetchMock.mock.calls[1][0];
    expect([a2.budget, a2.fresh]).toEqual([10_000, 2_500]);
    share.stop();
  });

  it('draws the field and the fresh strikes, hiding a field mark whose live twin is shown', async () => {
    const { fieldBbs, liveBbs, stop } = await startWithField();
    expect(fieldBbs.length).toBe(4);
    expect(shownStages(fieldBbs)).toEqual([2, 5, 6]);
    expect(liveBbs.length).toBe(2);
    expect(shownStages(liveBbs)).toEqual([0, 0]);
    const st = useLightningStatus.getState();
    expect(st.field.marks).toBe(4);
    expect(st.field.liveShown).toBe(2);
    expect(st.server?.counts.m1440).toBe(40);
    expect(st.field.error).toBeNull();
    stop();
  });

  it('hands a strike from its white live X to its field twin at 2 minutes', async () => {
    const { fieldBbs, liveBbs, stop } = await startWithField();
    await vi.advanceTimersByTimeAsync(59_000); // twin is now 119 s old
    expect(shown(liveBbs)).toBe(2);
    expect(shown(fieldBbs)).toBe(3);
    await vi.advanceTimersByTimeAsync(1_000); // 120 s: retire, hand over
    expect(shown(liveBbs)).toBe(1);
    expect(shownStages(fieldBbs)).toEqual([1, 2, 5, 6]);
    expect(useLightningStatus.getState().field.liveShown).toBe(1);
    stop();
  });

  it('filters by window client-side without refetching', async () => {
    const { fieldBbs, stop } = await startWithField();
    const calls = fetchMock.mock.calls.length;
    useLightningStatus.getState().setWindow(60);
    expect(shownStages(fieldBbs)).toEqual([2]);
    useLightningStatus.getState().setWindow(360);
    expect(shownStages(fieldBbs)).toEqual([2, 5]);
    useLightningStatus.getState().setWindow(1440);
    expect(shownStages(fieldBbs)).toEqual([2, 5, 6]);
    expect(fetchMock.mock.calls.length).toBe(calls);
    stop();
  });

  it('expires marks at 24 h and recycles their billboards', async () => {
    const { fieldBbs, stop } = await startWithField();
    serve([], []); // later polls: nothing new
    await vi.advanceTimersByTimeAsync(4 * HOUR + 1_000);
    // The server dropped everything in its next poll anyway; the pool keeps its billboards.
    expect(shown(fieldBbs)).toBe(0);
    expect(fieldBbs.length).toBe(4);
    expect(useLightningStatus.getState().field.marks).toBe(0);
    stop();
  });

  it('diffs a refresh: kept marks are untouched, new ones reuse freed billboards', async () => {
    const { fieldBbs, stop } = await startWithField();
    const quiet = keepSocketAlive();
    const kept = FIELD.slice(0, 2);
    const extra: Pt = { tMs: T0 - 40 * MIN, lat: 37, lon: -99 };
    serve([...kept, extra], []);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fieldBbs.length).toBe(4); // no add(): the freed billboards were reused
    expect(useLightningStatus.getState().field.marks).toBe(3);
    expect(shownStages(fieldBbs)).toEqual([2, 3, 5]);
    quiet();
    stop();
  });

  it('refetches at once for a new view box and ignores the superseded response', async () => {
    const v = fakeViewer();
    let resolveFirst!: (r: LightningFieldResponse) => void;
    fetchMock.mockImplementationOnce(() => new Promise((res) => (resolveFirst = res)));
    fetchMock.mockImplementationOnce(() =>
      Promise.resolve(response([{ tMs: T0 - 3 * HOUR, lat: 45.5, lon: 10.5 }], []))
    );
    const stop = startLightning(v.viewer, 'app');
    const [fieldBbs] = v.primitives;
    v.setRect(5, 40, 15, 50);
    v.camera.moveEnd.raiseEvent();
    await vi.advanceTimersByTimeAsync(750);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0].signal?.aborted).toBe(true);
    expect(fetchMock.mock.calls[1][0].bbox).toEqual([5, 40, 15, 50]);
    // The old box's response lands late: dropped.
    resolveFirst(response(FIELD, FRESH));
    await flush();
    expect(fieldBbs.length).toBe(1);
    expect(shownStages(fieldBbs)).toEqual([5]);
    stop();
  });

  it('follows a camera that never rests (no moveEnd) once its box holds for two ticks', async () => {
    const { setRect, camera, stop } = await startWithField();
    // A close-up that settled: moveEnd, the fast path.
    setRect(5, 40, 15, 50);
    camera.moveEnd.raiseEvent();
    await vi.advanceTimersByTimeAsync(750);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0].bbox).toEqual([5, 40, 15, 50]);
    // The fly-back: a different box on every tick, so nothing is fetched mid-flight.
    for (const [w, s, e, n] of [
      [-10, 20, 30, 60],
      [-60, 0, 0, 60],
    ]) {
      setRect(w, s, e, n);
      await vi.advanceTimersByTimeAsync(1_000);
    }
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // Then the whole-globe rotation: the camera keeps turning, so no moveEnd.
    setRect(-180, -90, 180, 90);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    // The hemisphere box around the camera's sub-point (35° N, 97° W).
    expect(fetchMock.mock.calls[2][0].bbox).toEqual([-180, -45, 180, 90]);
    // Held: nothing more until the poll.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    stop();
  });

  it('keeps the view box through a small pan (no refetch)', async () => {
    const { setRect, camera, stop } = await startWithField();
    setRect(-109.5, 25.5, -84.5, 45.5); // still inside the 5° snapped box
    camera.moveEnd.raiseEvent();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    stop();
  });

  it('draws socket strikes live, keyed so the fresh list dedupes them', async () => {
    serve([], []);
    const v = fakeViewer();
    const stop = startLightning(v.viewer, 'app');
    await flush();
    const [, liveBbs] = v.primitives;
    const ws = FakeSocket.all[0];
    const quiet = keepSocketAlive();
    expect(useLightningStatus.getState().connected).toBe(true);
    const t = Date.now() - 2_000;
    ws.strike(35, -97, t);
    ws.strike(-35, 83, t); // other side of the planet: drawn (hidden by the globe) but no render
    expect(liveBbs.length).toBe(2);
    // The server's fresh list carries the first one too: no second X.
    serve([], [{ tMs: t, lat: 35, lon: -97 }]);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(liveBbs.length).toBe(2);
    const st = useLightningStatus.getState();
    expect(st.ratePerMin).toBeGreaterThanOrEqual(2 + 5); // ours + the keep-alive frames so far
    expect(st.liveSource).toBe('browser');
    quiet();
    stop();
  });

  it('falls back to the server fresh list after 30 s without the socket, polling every 10 s', async () => {
    const { stop } = await startWithField();
    expect(useLightningStatus.getState().liveSource).toBe('offline'); // still connecting
    await vi.advanceTimersByTimeAsync(30_000);
    expect(useLightningStatus.getState().liveSource).toBe('server');
    const calls = fetchMock.mock.calls.length;
    await vi.advanceTimersByTimeAsync(20_000);
    expect(fetchMock.mock.calls.length - calls).toBeGreaterThanOrEqual(2);
    // The server failing too: offline, with a store error.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    fetchMock.mockRejectedValue(new Error('Request to /api/lightning/field failed: 503'));
    await vi.advanceTimersByTimeAsync(11_000); // the failing poll, then a tick
    const st = useLightningStatus.getState();
    expect(st.field.error).toMatch(/503/);
    expect(st.liveSource).toBe('offline');
    expect(st.error).not.toBeNull();
    stop();
  });

  it('tears everything down and resets the store', async () => {
    const { stop, primitives, fieldBbs, liveBbs } = await startWithField();
    const ws = FakeSocket.all[0];
    stop();
    expect(primitives).toHaveLength(0);
    expect(fieldBbs.isDestroyed()).toBe(true);
    expect(liveBbs.isDestroyed()).toBe(true);
    expect(ws.closed).toBe(true);
    const st = useLightningStatus.getState();
    expect(st.server).toBeNull();
    expect(st.field.marks).toBe(0);
    expect(st.windowMinutes).toBe(1440); // persisted setting survives
    const calls = fetchMock.mock.calls.length;
    await vi.advanceTimersByTimeAsync(5 * MIN);
    expect(fetchMock.mock.calls.length).toBe(calls);
    expect(FakeSocket.all).toHaveLength(1);
  });

  it('survives StrictMode mount → unmount → mount', async () => {
    serve(FIELD, FRESH);
    const v = fakeViewer();
    startLightning(v.viewer, 'app')();
    const stop = startLightning(v.viewer, 'app');
    await flush();
    expect(v.primitives).toHaveLength(2);
    expect(v.primitives[0].length).toBe(4);
    expect(useLightningStatus.getState().field.marks).toBe(4);
    stop();
    expect(v.primitives).toHaveLength(0);
  });
});
