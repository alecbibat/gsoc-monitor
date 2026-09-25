import { describe, expect, it } from 'vitest';
import { tickerHealth } from './LightningTicker';

// The ticker polls /status every 15 s and aborts a poll the next one
// supersedes, so a server that never answers never "fails". Its last answer
// must stop vouching for the present after two polls' worth of silence.

const T0 = Date.UTC(2026, 8, 24, 18, 0, 0);
const S = 1000;
const healthy = { connected: true, downSince: null, lastStrikeAgeS: 1, ratePerMin: 6000 };

const health = (o: Partial<Parameters<typeof tickerHealth>[0]>) =>
  tickerHealth({ collector: healthy, failed: false, lastOkAt: T0, mountedAt: T0 - 60 * S, nowMs: T0, ...o });

describe('tickerHealth', () => {
  it('a fresh, healthy answer is LIVE', () => {
    expect(health({})).toEqual({ unreachable: false, live: true, offline: false });
    expect(health({ nowMs: T0 + 30 * S })).toEqual({ unreachable: false, live: true, offline: false });
  });

  it('no successful poll for more than two poll intervals is unreachable: no LIVE, no "offline"', () => {
    expect(health({ nowMs: T0 + 30 * S + 1 })).toEqual({ unreachable: true, live: false, offline: false });
    const down = { ...healthy, connected: false, downSince: T0 - 5 * 60 * S };
    expect(health({ collector: down, nowMs: T0 + 10 * 60 * S })).toEqual({
      unreachable: true,
      live: false,
      offline: false,
    });
  });

  it('a failed poll is unreachable however recent the last answer', () => {
    expect(health({ failed: true })).toEqual({ unreachable: true, live: false, offline: false });
  });

  it('with no answer ever, staleness counts from mount', () => {
    expect(health({ collector: null, lastOkAt: null, mountedAt: T0, nowMs: T0 + 10 * S }).unreachable).toBe(false);
    expect(health({ collector: null, lastOkAt: null, mountedAt: T0, nowMs: T0 + 31 * S }).unreachable).toBe(true);
  });

  it('a reachable server with a down collector is offline, not LIVE', () => {
    expect(health({ collector: { ...healthy, connected: false, downSince: T0 - 60 * S } })).toEqual({
      unreachable: false,
      live: false,
      offline: true,
    });
    // Socket open but nothing heard since boot.
    expect(health({ collector: { ...healthy, downSince: T0 - 60 * S, lastStrikeAgeS: null } }).offline).toBe(true);
    // Last strike a minute old: not LIVE.
    expect(health({ collector: { ...healthy, lastStrikeAgeS: 60 } }).live).toBe(false);
  });
});
