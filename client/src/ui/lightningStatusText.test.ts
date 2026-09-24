import { describe, expect, it } from 'vitest';
import { lightningStatusText, type LightningStatusInputs } from './lightningStatusText';

const healthy: LightningStatusInputs = {
  fieldError: null,
  serverConnected: true,
  serverDownSince: null,
  serverRatePerMin: 6100,
  restoring: false,
  restoreProgress: 1,
  connected: true,
  ratePerMin: 5900,
  liveSource: 'browser',
};

const text = (o: Partial<LightningStatusInputs>) => lightningStatusText({ ...healthy, ...o }, () => '14:05');

describe('lightningStatusText', () => {
  it('live on the browser socket', () => {
    expect(text({})).toBe(`${(5900).toLocaleString()} strikes/min · live`);
  });

  it('a failing history fetch outranks everything', () => {
    expect(text({ fieldError: 'HTTP 503', serverConnected: false, restoring: true })).toBe(
      'History unavailable — retrying'
    );
  });

  it('server collector offline outranks the restore and the live socket', () => {
    expect(text({ serverConnected: false, serverDownSince: Date.now(), restoring: true })).toBe(
      'Server collector offline since 14:05'
    );
    // Silent (downSince set) while the socket still reads open.
    expect(text({ serverConnected: true, serverDownSince: Date.now() })).toBe('Server collector offline since 14:05');
    expect(text({ serverConnected: false, serverDownSince: null })).toBe('Server collector offline');
  });

  it('restore progress, floored and capped below 100', () => {
    expect(text({ restoring: true, restoreProgress: 0.426 })).toBe('Loading 24 h history… 42%');
    expect(text({ restoring: true, restoreProgress: 1 })).toBe('Loading 24 h history… 99%');
    expect(text({ restoring: true, restoreProgress: Number.NaN })).toBe('Loading 24 h history… 0%');
  });

  it('falls back to the server relay, then to connecting', () => {
    expect(text({ connected: false, liveSource: 'server' })).toBe(`${(6100).toLocaleString()} strikes/min · via server`);
    expect(text({ connected: false, liveSource: 'offline', serverConnected: null })).toBe('Connecting…');
  });

  it('shows the server rate while the browser socket is still connecting', () => {
    // First 30 s of a load: no socket strike yet, but the server collector is
    // up and its fresh list is already feeding the live Xs.
    expect(text({ connected: false, liveSource: 'offline' })).toBe(`${(6100).toLocaleString()} strikes/min · via server`);
  });

  it('no server status yet is not "offline"', () => {
    expect(text({ serverConnected: null, connected: false, liveSource: 'offline' })).toBe('Connecting…');
  });
});
