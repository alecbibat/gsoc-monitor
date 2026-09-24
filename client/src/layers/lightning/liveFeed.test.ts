import { describe, expect, it } from 'vitest';
import { RateWindow, SOCKET_FALLBACK_MS, decideLiveSource, relayBackoffMs } from './liveFeed';

describe('relay backoff', () => {
  it('doubles from 3 s and caps at 60 s', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 50].map(relayBackoffMs)).toEqual([
      3_000, 6_000, 12_000, 24_000, 48_000, 60_000, 60_000, 60_000,
    ]);
    expect(relayBackoffMs(-1)).toBe(3_000);
  });
});

describe('rate window', () => {
  it('counts strikes over the trailing minute', () => {
    const r = new RateWindow();
    const t0 = 1_790_000_000_000;
    for (let i = 0; i < 120; i++) r.add(t0 + i * 500); // 2/s for 60 s
    expect(r.perMinute(t0 + 59_900)).toBe(120);
    // 30 s later only the second half is still inside the minute.
    expect(r.perMinute(t0 + 89_900)).toBe(60);
    expect(r.perMinute(t0 + 200_000)).toBe(0);
  });

  it('reuses a bucket a minute later instead of adding to it', () => {
    const r = new RateWindow();
    r.add(0);
    r.add(60_000);
    expect(r.perMinute(60_000)).toBe(1);
    r.clear();
    expect(r.perMinute(60_000)).toBe(0);
  });
});

describe('live source', () => {
  const started = 1_000_000;

  it('is the browser while the socket delivers', () => {
    const d = decideLiveSource({
      nowMs: started + 120_000,
      startedMs: started,
      socketLastStrikeMs: started + 119_000,
      serverLive: true,
    });
    expect(d).toEqual({ source: 'browser', fastPoll: false });
  });

  it('stays on the browser through a short silence, then falls back to the server', () => {
    const last = started + 5_000;
    const at = (dt: number, serverLive = true) =>
      decideLiveSource({ nowMs: last + dt, startedMs: started, socketLastStrikeMs: last, serverLive });
    expect(at(SOCKET_FALLBACK_MS - 1).source).toBe('browser');
    expect(at(SOCKET_FALLBACK_MS)).toEqual({ source: 'server', fastPoll: true });
    expect(at(SOCKET_FALLBACK_MS, false)).toEqual({ source: 'offline', fastPoll: true });
  });

  it('does not claim the server during the first 30 s of a load', () => {
    const at = (dt: number, serverLive: boolean) =>
      decideLiveSource({ nowMs: started + dt, startedMs: started, socketLastStrikeMs: null, serverLive });
    expect(at(2_000, true)).toEqual({ source: 'offline', fastPoll: false });
    expect(at(SOCKET_FALLBACK_MS, true)).toEqual({ source: 'server', fastPoll: true });
    expect(at(SOCKET_FALLBACK_MS, false)).toEqual({ source: 'offline', fastPoll: true });
  });
});
