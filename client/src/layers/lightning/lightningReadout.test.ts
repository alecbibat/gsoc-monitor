import { describe, expect, it } from 'vitest';
import type { LightningStatusLite } from '../../types/lightning';
import { collectorLine, countForWindow, gapMinutes } from './lightningReadout';

function status(p: {
  restore?: Partial<LightningStatusLite['restore']>;
  collector?: Partial<LightningStatusLite['collector']>;
} = {}): LightningStatusLite {
  return {
    now: 0,
    collector: { connected: true, downSince: null, lastStrikeAgeS: 0, ratePerMin: 5_400, ...p.collector },
    counts: { m60: 1, m360: 2, m720: 3, m1440: 4, exact: true },
    coverage: { windowMin: 1440, coveredMin: 1440, gaps: [], restoring: false, restoredBackToMs: null },
    fidelity: { legacyBeforeMs: null, evictedBeforeMs: null },
    restore: { state: 'done', progress: 1, backToMs: null, ...p.restore },
  };
}

describe('lightning readout', () => {
  it('picks the count for the selected window', () => {
    const c = status().counts;
    expect(countForWindow(c, 60)).toBe(1);
    expect(countForWindow(c, 360)).toBe(2);
    expect(countForWindow(c, 720)).toBe(3);
    expect(countForWindow(c, 1440)).toBe(4);
  });

  it('sums gaps to whole minutes', () => {
    expect(gapMinutes(undefined)).toBe(0);
    expect(gapMinutes([])).toBe(0);
    expect(
      gapMinutes([
        { fromMs: 0, toMs: 180_000 },
        { fromMs: 1_000_000, toMs: 1_150_000 },
      ])
    ).toBe(6); // 3 + 2.5
  });

  it('puts a failing request first', () => {
    expect(collectorLine(status(), 'Request failed: 503')).toEqual({
      text: 'History unavailable — retrying',
      tone: 'danger',
    });
    expect(collectorLine(null, null)).toBeNull();
  });

  it('shows restore progress until the 24 h load is done', () => {
    expect(collectorLine(status({ restore: { state: 'loading', progress: 0.426 } }), null)?.text).toBe(
      'Loading 24 h history… 42%'
    );
    // Never "100%" while it is still loading.
    expect(collectorLine(status({ restore: { state: 'retrying', progress: 1 } }), null)?.text).toBe(
      'Loading 24 h history… 99%'
    );
  });

  it('reports a collector outage with its start time', () => {
    const line = collectorLine(
      status({ collector: { connected: false, downSince: 1_790_000_000_000 } }),
      null,
      () => '14:05'
    );
    expect(line).toEqual({ text: 'Server collector offline since 14:05', tone: 'warn' });
    expect(collectorLine(status({ collector: { connected: false } }), null)?.text).toBe(
      'Server collector offline'
    );
  });

  it('reports a healthy collector with the true global rate', () => {
    const line = collectorLine(status(), null);
    expect(line?.tone).toBe('ok');
    expect(line?.text).toMatch(/^Server collector live · 5.?400\/min$/);
  });
});
