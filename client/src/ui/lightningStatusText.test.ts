import { describe, expect, it } from 'vitest';
import { lightningStatusText, type LightningStatusInputs } from './lightningStatusText';

const healthy: LightningStatusInputs = {
  fieldError: null,
  serverConnected: true,
  serverDownSince: null,
  serverRatePerMin: 6100,
  restoring: false,
  restoreState: 'done',
  restoreProgress: 1,
  ratePerMin: 5900,
  liveSource: 'browser',
};

const text = (o: Partial<LightningStatusInputs>) => lightningStatusText({ ...healthy, ...o }, () => '14:05');

describe('lightningStatusText', () => {
  it('live on the browser socket', () => {
    expect(text({})).toBe(`${(5900).toLocaleString()} strikes/min · live`);
  });

  it('"live" means the browser socket is the live source, not merely open', () => {
    // A relay that accepts the socket but passes no frames: the engine has
    // switched to the server's fresh list, so the line must say so.
    expect(text({ liveSource: 'server', ratePerMin: 0 })).toBe(`${(6100).toLocaleString()} strikes/min · via server`);
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
    expect(text({ serverConnected: false, serverDownSince: null, restoring: true, restoreState: 'retrying' })).toBe(
      'Server collector offline'
    );
    // Silent (downSince set) while the socket still reads open.
    expect(text({ serverConnected: true, serverDownSince: Date.now() })).toBe('Server collector offline since 14:05');
    expect(text({ serverConnected: false, serverDownSince: null })).toBe('Server collector offline');
  });

  it('a restore retrying on the database says history is unavailable, not "loading 0%"', () => {
    expect(text({ restoring: true, restoreState: 'retrying', restoreProgress: 0 })).toBe(
      'History unavailable (database) — retrying'
    );
    // It outranks the live source, like the loading restore does.
    expect(text({ restoring: true, restoreState: 'retrying', liveSource: 'server' })).toBe(
      'History unavailable (database) — retrying'
    );
    // Back to loading on the next attempt.
    expect(text({ restoring: true, restoreState: 'loading', restoreProgress: 0 })).toBe('Loading 24 h history… 0%');
  });

  it('restore progress, floored and capped below 100', () => {
    expect(text({ restoring: true, restoreProgress: 0.426 })).toBe('Loading 24 h history… 42%');
    expect(text({ restoring: true, restoreProgress: 1 })).toBe('Loading 24 h history… 99%');
    expect(text({ restoring: true, restoreProgress: Number.NaN })).toBe('Loading 24 h history… 0%');
  });

  it('falls back to the server relay, then to connecting', () => {
    expect(text({ liveSource: 'server' })).toBe(`${(6100).toLocaleString()} strikes/min · via server`);
    expect(text({ liveSource: 'offline', serverConnected: null })).toBe('Connecting…');
  });

  it('shows the server rate while the browser socket is still connecting', () => {
    // First 30 s of a load: no socket strike yet, but the server collector is
    // up and its fresh list is already feeding the live Xs.
    expect(text({ liveSource: 'offline' })).toBe(`${(6100).toLocaleString()} strikes/min · via server`);
  });

  it('no server status yet is not "offline"', () => {
    expect(text({ serverConnected: null, liveSource: 'offline', restoreState: null })).toBe('Connecting…');
  });
});
