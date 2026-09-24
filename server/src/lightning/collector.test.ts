import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Collector, RELAYS, syntheticRateFromEnv } from './collector';
import { tickOf } from './quant';
import { FakeWs } from './testkit';

const T0 = Date.UTC(2026, 8, 24, 12, 0, 0);

function setup() {
  const sockets: FakeWs[] = [];
  const strikes: [number, number, number][] = [];
  const c = new Collector({
    onStrike: (tick, latQ, lonQ) => strikes.push([tick, latQ, lonQ]),
    wsFactory: (url) => {
      const ws = new FakeWs(url);
      sockets.push(ws);
      return ws;
    },
    now: () => Date.now(),
    random: () => 0, // no jitter
    log: () => {},
  });
  return { c, sockets, strikes, last: () => sockets[sockets.length - 1] };
}

/** Let queued microtasks (FakeWs emits 'close' in one) run. */
const flush = () => Promise.resolve();

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});
afterEach(() => {
  vi.useRealTimers();
});

describe('Collector', () => {
  it('connects immediately and subscribes on open', () => {
    const { c, sockets, last } = setup();
    c.start();
    expect(sockets).toHaveLength(1);
    expect(last().url).toBe(RELAYS[0]);
    expect(c.status().connected).toBe(false);
    expect(c.status().downSince).toBe(T0);
    last().open();
    expect(last().sent).toEqual([JSON.stringify({ a: 111 })]);
    expect(c.status()).toMatchObject({ connected: true, connectedSince: T0, relay: RELAYS[0] });
    c.stop();
  });

  it('backs off 1, 2, 4 … 60 s while relays fail, rotating relays', async () => {
    const { c, sockets, last } = setup();
    c.start();
    const delays: number[] = [];
    for (let k = 0; k < 8; k++) {
      last().emit('error', new Error('refused'));
      await flush(); // → close → scheduleReconnect
      const before = sockets.length;
      let waited = 0;
      while (sockets.length === before) {
        vi.advanceTimersByTime(500);
        waited += 500;
      }
      delays.push(waited);
    }
    expect(delays).toEqual([1_000, 2_000, 4_000, 8_000, 16_000, 32_000, 60_000, 60_000]);
    expect(sockets.slice(0, 4).map((s) => s.url)).toEqual([RELAYS[0], RELAYS[1], RELAYS[2], RELAYS[0]]);
    expect(c.status().reconnects24h).toBe(8);
    c.stop();
  });

  it('resets the backoff on the first strike after a successful open', async () => {
    const { c, sockets, last, strikes } = setup();
    c.start();
    for (let k = 0; k < 3; k++) {
      last().terminate();
      await flush();
      vi.advanceTimersByTime(60_000);
    }
    last().open();
    last().strike(35, -97);
    expect(strikes).toHaveLength(1);
    expect(c.status().downSince).toBeNull();
    const before = sockets.length;
    last().terminate();
    await flush();
    expect(c.status().downSince).toBe(Date.now());
    vi.advanceTimersByTime(999);
    expect(sockets).toHaveLength(before);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(before + 1);
    c.stop();
  });

  it('the watchdog replaces an open socket that has been silent for 60 s', async () => {
    const { c, sockets, last } = setup();
    c.start();
    last().open();
    last().strike(1, 2);
    const heardAt = Date.now();
    vi.advanceTimersByTime(45_000);
    expect(last().terminated).toBe(false);
    vi.advanceTimersByTime(15_000); // silent 60 s at the next check
    expect(sockets[0].terminated).toBe(true);
    await flush();
    expect(c.status()).toMatchObject({ connected: false, downSince: heardAt });
    vi.advanceTimersByTime(1_000);
    expect(sockets).toHaveLength(2);
    expect(last().url).toBe(RELAYS[1]);
    c.stop();
  });

  describe('an outage on relays that accept the socket but send nothing keeps its first downSince', () => {
    /** For `ms`, open every new socket as it appears and never deliver a strike. */
    async function silentRelays(last: () => FakeWs, ms: number): Promise<void> {
      const opened = new Set<FakeWs>();
      const end = Date.now() + ms;
      while (Date.now() < end) {
        const ws = last();
        if (!opened.has(ws)) {
          opened.add(ws);
          ws.open();
        }
        vi.advanceTimersByTime(5_000);
        await flush();
      }
    }
    /** Wait for the next live socket, open it and deliver one strike on it. */
    async function strikeOnNextSocket(last: () => FakeWs): Promise<void> {
      while (last().terminated) {
        vi.advanceTimersByTime(1_000);
        await flush();
      }
      last().open();
      last().strike(36, -97);
    }

    it('after a strike: the watchdog cycles for 3 h, downSince stays at the last strike', async () => {
      const { c, sockets, last } = setup();
      c.start();
      last().open();
      last().strike(35, -97);
      const heardAt = Date.now();
      await silentRelays(last, 3 * 3_600_000);
      expect(sockets.length).toBeGreaterThan(20); // many watchdog/backoff cycles
      expect(c.status()).toMatchObject({ downSince: heardAt, lastStrikeAt: heardAt });
      // The first strike ends the outage and records it as a blind interval.
      await strikeOnNextSocket(last);
      expect(c.status().downSince).toBeNull();
      expect(c.status().blind).toEqual([{ fromMs: heardAt, toMs: Date.now() }]);
      c.stop();
    });

    it('after a close: silent reconnects for 1 h keep downSince at the close', async () => {
      const { c, last } = setup();
      c.start();
      last().open();
      last().strike(35, -97);
      vi.advanceTimersByTime(10_000);
      const closedAt = Date.now();
      last().terminate(); // the relay drops us
      await flush();
      await silentRelays(last, 3_600_000);
      expect(c.status().downSince).toBe(closedAt);
      c.stop();
    });

    it('from boot: 2 h of silent relays keep downSince at boot, and the boot hole is not the collector’s to record', async () => {
      const { c, last } = setup();
      c.start();
      await silentRelays(last, 2 * 3_600_000);
      expect(c.status()).toMatchObject({ downSince: T0, lastStrikeAt: null });
      await strikeOnNextSocket(last);
      expect(c.status()).toMatchObject({ downSince: null, blind: [] });
      c.stop();
    });
  });

  it('keeps at most 64 ended blind intervals, none older than 25 h', async () => {
    const { c, last } = setup();
    c.start();
    last().open();
    last().strike(0, 0);
    for (let k = 0; k < 70; k++) {
      last().terminate();
      await flush();
      vi.advanceTimersByTime(2_000); // backoff 1 s (reset by each strike) + jitter 0
      last().open();
      last().strike(k, 1);
    }
    const blind = c.status().blind;
    expect(blind).toHaveLength(64);
    expect(blind.every((b) => b.toMs - b.fromMs === 2_000)).toBe(true); // close → strike on the next socket
    vi.advanceTimersByTime(25 * 3_600_000);
    expect(c.status().blind.length).toBeLessThan(64);
    vi.advanceTimersByTime(200_000);
    expect(c.status().blind).toEqual([]);
    c.stop();
  });

  it('stop() closes the socket and never reconnects', async () => {
    const { c, sockets, last } = setup();
    c.start();
    last().open();
    c.stop();
    expect(last().terminated).toBe(true);
    await flush();
    vi.advanceTimersByTime(10 * 60_000);
    expect(sockets).toHaveLength(1);
    expect(c.status().connected).toBe(false);
    c.start(); // no-op after stop
    expect(sockets).toHaveLength(1);
  });

  it('parses frames: network time, rejects, exact repeats and the rate', () => {
    const { c, last, strikes } = setup();
    c.start();
    last().open();
    const ns = (T0 - 2_000) * 1e6;
    last().strike(35, -97, ns);
    last().strike(35, -97, ns); // a relay repeating itself
    last().strike(36, -97); // no time → receive time
    last().emit('message', Buffer.from('garbage'));
    last().emit('message', Buffer.from(JSON.stringify({ lat: 95, lon: 0 })));
    expect(strikes).toHaveLength(2);
    expect(strikes[0][0]).toBe(tickOf(T0 - 2_000));
    expect(strikes[1][0]).toBe(tickOf(T0));
    expect(c.status()).toMatchObject({ rejected: 2, dupes: 1, received: 2, networkTimePct: 50, ratePerMin: 2 });
    vi.advanceTimersByTime(61_000);
    expect(c.status().ratePerMin).toBe(0);
    expect(c.status().lastStrikeAt).toBe(T0);
    c.stop();
  });
});

describe('synthetic feed', () => {
  it('is honoured only outside production', () => {
    expect(syntheticRateFromEnv({ LIGHTNING_SYNTHETIC_RATE: '50' })).toBe(50);
    expect(syntheticRateFromEnv({ LIGHTNING_SYNTHETIC_RATE: '50', NODE_ENV: 'production' })).toBeNull();
    expect(syntheticRateFromEnv({})).toBeNull();
    expect(syntheticRateFromEnv({ LIGHTNING_SYNTHETIC_RATE: 'x' })).toBeNull();
  });

  it('generates strikes at the requested rate through the normal path, without a socket', () => {
    const strikes: number[] = [];
    let sockets = 0;
    const c = new Collector({
      onStrike: (tick) => strikes.push(tick),
      wsFactory: () => {
        sockets++;
        return new FakeWs('x');
      },
      now: () => Date.now(),
      log: () => {},
      syntheticRate: 100,
    });
    c.start();
    vi.advanceTimersByTime(10_000);
    expect(sockets).toBe(0);
    expect(strikes.length).toBeGreaterThan(950);
    expect(strikes.length).toBeLessThan(1_050);
    const nowTick = tickOf(Date.now());
    expect(strikes.every((t) => t <= nowTick - 100 && t >= nowTick - 1_500)).toBe(true); // 1–4 s old when made
    expect(c.status()).toMatchObject({ connected: true, relay: 'synthetic', synthetic: true });
    c.stop();
  });
});
