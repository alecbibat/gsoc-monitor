import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RadarFrame } from '../../types';
import { DEFAULT_RADAR_PREFS, radarStatusText, STALE_AFTER_SEC, useRadarStore } from './radarStore';
import { formatClock } from './radarTimeline';

// Node has no Web Storage, and persist looks for it when the store module
// loads: give it an in-memory one first.
const storage = vi.hoisted(() => {
  const mem = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k),
  });
  return mem;
});

const frames = (times: number[]): RadarFrame[] => times.map((time) => ({ time, path: `/v2/radar/${time}` }));

const prefs = () => {
  const { windowMinutes, opacity, palette, speed, snow } = useRadarStore.getState();
  return { windowMinutes, opacity, palette, speed, snow };
};

async function rehydrate(state: unknown, version = 1) {
  storage.set('gsoc-radar', JSON.stringify({ state, version }));
  await useRadarStore.persist.rehydrate();
  return prefs();
}

beforeEach(() => {
  useRadarStore.setState({
    host: '',
    past: [],
    nowcast: [],
    generated: null,
    manifestAt: 0,
    loading: true,
    error: null,
    coolingDownMs: 0,
    tilesFailing: false,
    ...DEFAULT_RADAR_PREFS,
  });
  storage.clear();
});
afterEach(() => vi.restoreAllMocks());
afterAll(() => vi.unstubAllGlobals());

describe('radar preferences', () => {
  it('persists only the preferences', () => {
    useRadarStore.getState().setManifest({ host: 'h', generated: 1, past: frames([1]), nowcast: [] });
    useRadarStore.getState().setPalette('vivid');
    expect(JSON.parse(storage.get('gsoc-radar')!)).toEqual({
      state: { ...DEFAULT_RADAR_PREFS, palette: 'vivid' },
      version: 1,
    });
  });

  it('restores valid stored preferences', async () => {
    expect(await rehydrate({ windowMinutes: 60, opacity: 0.5, palette: 'rainviewer', speed: 2, snow: false })).toEqual({
      windowMinutes: 60,
      opacity: 0.5,
      palette: 'rainviewer',
      speed: 2,
      snow: false,
    });
  });

  it('falls back to the defaults for anything it does not recognise', async () => {
    const junk = [
      { windowMinutes: 45, opacity: 'high', palette: 'neon', speed: 3, snow: 'yes' },
      { windowMinutes: '60', speed: '1', opacity: null, snow: 1 },
      null,
    ];
    // Every preference starts away from its default, so "kept the current
    // value" can't pass for "fell back to the default".
    const moved = { windowMinutes: 30, opacity: 0.5, palette: 'vivid', speed: 2, snow: false };
    for (const stored of junk) {
      await rehydrate(moved);
      expect(await rehydrate(stored)).toEqual(DEFAULT_RADAR_PREFS);
    }
    // An entry from another schema version has no migration: defaults, not a crash.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await rehydrate(moved);
    expect(await rehydrate({ windowMinutes: 60 }, 0)).toEqual(DEFAULT_RADAR_PREFS);
  });

  it('clamps opacity to 0.2–1', async () => {
    expect((await rehydrate({ opacity: 5 })).opacity).toBe(1);
    expect((await rehydrate({ opacity: 0.05 })).opacity).toBe(0.2);
    expect((await rehydrate({ opacity: -1 })).opacity).toBe(0.2);
    useRadarStore.getState().setOpacity(0);
    expect(useRadarStore.getState().opacity).toBe(0.2);
    useRadarStore.getState().setOpacity(1.5);
    expect(useRadarStore.getState().opacity).toBe(1);
    useRadarStore.getState().setOpacity(Number.NaN);
    expect(useRadarStore.getState().opacity).toBe(DEFAULT_RADAR_PREFS.opacity);
  });
});

describe('setManifest', () => {
  it('keeps the frame arrays for an unchanged manifest but records that it arrived', () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1000);
    const { setManifest, setError } = useRadarStore.getState();
    setError('offline');
    setManifest({ host: 'h', generated: 100, past: frames([1, 2]), nowcast: frames([3]) });
    const first = useRadarStore.getState();
    expect(first).toMatchObject({ host: 'h', generated: 100, manifestAt: 1000, loading: false, error: null });

    now.mockReturnValue(2000);
    setError('offline');
    setManifest({ host: 'h', generated: 200, past: frames([1, 2]), nowcast: frames([3]) });
    const same = useRadarStore.getState();
    expect(same.past).toBe(first.past);
    expect(same.nowcast).toBe(first.nowcast);
    expect(same).toMatchObject({ generated: 200, manifestAt: 2000, loading: false, error: null });

    setManifest({ host: 'h', generated: 300, past: frames([1, 2, 4]), nowcast: [] });
    expect(useRadarStore.getState().past).toEqual(frames([1, 2, 4]));
    expect(useRadarStore.getState().nowcast).toEqual([]);
    setManifest({ host: 'h2', generated: 300, past: frames([1, 2, 4]), nowcast: [] });
    expect(useRadarStore.getState().host).toBe('h2');
  });
});

describe('radarStatusText', () => {
  const nowSec = 1_760_000_000;
  const base = { loading: false, error: null, past: [], nowcast: [], coolingDownMs: 0, tilesFailing: false };
  const past = frames([nowSec - 1200, nowSec - 600, nowSec - 60]);
  const tail = `3 frames · latest ${formatClock(nowSec - 60)}`;

  it('says what it is waiting for before any frames arrive', () => {
    expect(radarStatusText({ ...base, loading: true }, nowSec)).toBe('Loading RainViewer frames…');
    expect(radarStatusText({ ...base, error: 'HTTP 502' }, nowSec)).toBe('Radar feed unavailable · retrying');
  });

  it('reports trouble in order: feed error, failing tiles, delayed feed, rate limit', () => {
    const all = { ...base, past, error: 'HTTP 502', tilesFailing: true, coolingDownMs: 14_001 };
    expect(radarStatusText(all, nowSec)).toBe(`Radar feed stale · ${tail}`);
    expect(radarStatusText({ ...all, error: null }, nowSec)).toBe(`Radar tiles not loading · retrying · ${tail}`);
    const old = frames([nowSec - STALE_AFTER_SEC - 1]);
    expect(radarStatusText({ ...all, error: null, tilesFailing: false, past: old }, nowSec)).toBe(
      `Radar feed delayed · 1 frames · latest ${formatClock(nowSec - STALE_AFTER_SEC - 1)}`
    );
    expect(radarStatusText({ ...all, error: null, tilesFailing: false }, nowSec)).toBe(
      'RainViewer rate limit · resuming in 15 s'
    );
  });

  it('describes a healthy feed, with any forecast frames', () => {
    expect(radarStatusText({ ...base, past }, nowSec)).toBe(`RainViewer composite · ${tail}`);
    expect(radarStatusText({ ...base, past, nowcast: frames([nowSec + 600, nowSec + 1200]) }, nowSec)).toBe(
      `RainViewer composite · ${tail} · 2 forecast`
    );
    // Exactly 30 minutes old is not yet delayed.
    const edge = frames([nowSec - STALE_AFTER_SEC]);
    expect(radarStatusText({ ...base, past: edge }, nowSec)).toMatch(/^RainViewer composite/);
    vi.spyOn(Date, 'now').mockReturnValue((nowSec + STALE_AFTER_SEC) * 1000); // the default clock
    expect(radarStatusText({ ...base, past: edge })).toMatch(/^Radar feed delayed/);
  });
});
