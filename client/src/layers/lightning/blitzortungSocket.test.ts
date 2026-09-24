import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SOCKET_WATCHDOG_MS, startBlitzortungSocket } from './blitzortungSocket';
import type { LiveStrike } from './strikeKey';

// A stand-in for the browser WebSocket: records instances, lets the test
// open/message/close them.
class FakeSocket {
  static all: FakeSocket[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  sent: string[] = [];
  closed = false;
  constructor(public url: string) {
    FakeSocket.all.push(this);
  }
  send(s: string) {
    this.sent.push(s);
  }
  close() {
    this.closed = true;
  }
  // Test helpers
  open() {
    this.onopen?.();
  }
  strike(lat: number, lon: number) {
    this.onmessage?.({ data: JSON.stringify({ lat, lon, time: Date.now() * 1e6 }) });
  }
  drop() {
    this.onclose?.();
  }
}

const last = () => FakeSocket.all[FakeSocket.all.length - 1];

describe('blitzortung socket', () => {
  beforeEach(() => {
    FakeSocket.all = [];
    vi.useFakeTimers();
    vi.setSystemTime(1_790_000_000_000);
    vi.stubGlobal('WebSocket', FakeSocket);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function start() {
    const strikes: LiveStrike[] = [];
    const connected: boolean[] = [];
    const stop = startBlitzortungSocket({
      now: () => Date.now(),
      onStrike: (s) => strikes.push(s),
      onConnected: (c) => connected.push(c),
    });
    return { strikes, connected, stop };
  }

  it('subscribes on open and delivers parsed strikes with their keys', () => {
    const { strikes, connected, stop } = start();
    expect(FakeSocket.all).toHaveLength(1);
    last().open();
    expect(last().sent).toEqual(['{"a":111}']);
    expect(connected).toEqual([true]);
    last().strike(35, -97);
    last().onmessage?.({ data: 'not a frame' });
    expect(strikes).toHaveLength(1);
    expect(strikes[0].networkTime).toBe(true);
    expect(strikes[0].key).toMatch(/^\d+:\d+:\d+$/);
    stop();
  });

  it('rotates relays with backoff 3 s → 6 s → 12 s … 60 s', () => {
    const { stop } = start();
    const urls = [last().url];
    const delays: number[] = [];
    for (let i = 0; i < 7; i++) {
      last().drop();
      const before = FakeSocket.all.length;
      let waited = 0;
      while (FakeSocket.all.length === before) {
        vi.advanceTimersByTime(1_000);
        waited += 1_000;
      }
      delays.push(waited);
      urls.push(last().url);
    }
    expect(delays).toEqual([3_000, 6_000, 12_000, 24_000, 48_000, 60_000, 60_000]);
    expect(new Set(urls).size).toBe(3);
    expect(urls[0]).not.toBe(urls[1]);
    stop();
  });

  it('resets the backoff once a strike arrives', () => {
    const { stop } = start();
    last().drop();
    vi.advanceTimersByTime(3_000);
    last().drop();
    vi.advanceTimersByTime(6_000);
    last().open();
    last().strike(1, 2);
    const before = FakeSocket.all.length;
    last().drop();
    vi.advanceTimersByTime(3_000);
    expect(FakeSocket.all.length).toBe(before + 1);
    stop();
  });

  it('closes a socket that has gone silent for 60 s and moves on', () => {
    const { connected, stop } = start();
    const first = last();
    first.open();
    first.strike(1, 2);
    vi.advanceTimersByTime(SOCKET_WATCHDOG_MS - 5_000);
    expect(first.closed).toBe(false);
    vi.advanceTimersByTime(10_000);
    expect(first.closed).toBe(true);
    expect(first.onclose).toBeNull(); // detached: a late close event can't double-reconnect
    expect(connected[connected.length - 1]).toBe(false);
    vi.advanceTimersByTime(3_000);
    expect(last()).not.toBe(first);
    stop();
  });

  it('also gives up on a connection stuck connecting', () => {
    const { stop } = start();
    const first = last();
    vi.advanceTimersByTime(SOCKET_WATCHDOG_MS + 5_000);
    expect(first.closed).toBe(true);
    stop();
  });

  it('stop() closes quietly and never reconnects', () => {
    const { stop } = start();
    const ws = last();
    ws.open();
    stop();
    expect(ws.closed).toBe(true);
    expect(ws.onclose).toBeNull();
    vi.advanceTimersByTime(10 * 60_000);
    expect(FakeSocket.all).toHaveLength(1);
  });
});
