import { describe, expect, it } from 'vitest';
import type { LightningStatusLite } from '../../types/lightning';
import { collectorLine, countForWindow, countIsExact, evictionLine, gapMinutes } from './lightningReadout';

const NOW = 1_790_000_000_000;
const HOUR = 3_600_000;

function status(p: {
  restore?: Partial<LightningStatusLite['restore']>;
  collector?: Partial<LightningStatusLite['collector']>;
  fidelity?: Partial<LightningStatusLite['fidelity']>;
  exact?: boolean;
} = {}): LightningStatusLite {
  return {
    now: NOW,
    collector: { connected: true, downSince: null, lastStrikeAgeS: 0, ratePerMin: 5_400, ...p.collector },
    counts: { m60: 1, m360: 2, m720: 3, m1440: 4, exact: p.exact ?? true },
    coverage: { windowMin: 1440, coveredMin: 1440, gaps: [], restoring: false, restoredBackToMs: null },
    fidelity: { legacyBeforeMs: null, evictedBeforeMs: null, ...p.fidelity },
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
    expect(collectorLine(status({ restore: { state: 'loading', progress: 0.426 } }), null)).toEqual({
      text: 'Loading 24 h history… 42%',
      tone: 'muted',
    });
    // Never "100%" while it is still loading.
    expect(collectorLine(status({ restore: { state: 'pending', progress: 1 } }), null)?.text).toBe(
      'Loading 24 h history… 99%'
    );
  });

  it('says a restore that keeps failing is unavailable, not loading', () => {
    // The server sits in 'retrying' for as long as Postgres is down.
    expect(collectorLine(status({ restore: { state: 'retrying', progress: 0 } }), null)).toEqual({
      text: 'History unavailable (database) — retrying',
      tone: 'warn',
    });
  });

  it('ranks a collector outage above the restore, and a failing request above both', () => {
    const down = { connected: false, downSince: 1_790_000_000_000 };
    for (const state of ['pending', 'loading', 'retrying'] as const) {
      const s = status({ collector: down, restore: { state, progress: 0.5 } });
      expect(collectorLine(s, null, () => '14:05')).toEqual({
        text: 'Server collector offline since 14:05',
        tone: 'warn',
      });
      expect(collectorLine(s, 'Request failed: 503')?.tone).toBe('danger');
    }
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

  it('marks a window approximate only when the 1-in-6 history reaches into it', () => {
    // No legacy history in the 24 h window: every window is exact.
    for (const w of [60, 360, 720, 1440] as const) expect(countIsExact(status(), w)).toBe(true);
    // Legacy history ending 18.6 h ago: the 24 h window holds some, the rest don't.
    const s = status({ exact: false, fidelity: { legacyBeforeMs: NOW - 18.6 * HOUR } });
    expect(countIsExact(s, 60)).toBe(true);
    expect(countIsExact(s, 360)).toBe(true);
    expect(countIsExact(s, 720)).toBe(true);
    expect(countIsExact(s, 1440)).toBe(false);
    // Ending 3 h ago: only the 1 h window is clear of it.
    const s3 = status({ exact: false, fidelity: { legacyBeforeMs: NOW - 3 * HOUR } });
    expect(([60, 360, 720, 1440] as const).map((w) => countIsExact(s3, w))).toEqual([true, false, false, false]);
    // Still restoring it (its end not published yet): only the 24 h flag is known.
    const restoring = status({ exact: false, restore: { state: 'loading', progress: 0.9 } });
    for (const w of [60, 360, 720, 1440] as const) expect(countIsExact(restoring, w)).toBe(false);
  });

  it('warns when positions inside the window were evicted from server memory', () => {
    const fmt = () => '09:30';
    const s = status({ fidelity: { evictedBeforeMs: NOW - 10 * HOUR } });
    // Outside the 1 h and 6 h windows: nothing is missing there.
    expect(evictionLine(s, 60, fmt)).toBeNull();
    expect(evictionLine(s, 360, fmt)).toBeNull();
    for (const w of [720, 1440] as const) {
      expect(evictionLine(s, w, fmt)).toEqual({
        text: 'Positions before 09:30 not held (server memory) — older marks are missing; counts are exact',
        tone: 'warn',
      });
    }
    expect(evictionLine(status(), 1440, fmt)).toBeNull();
    expect(evictionLine(null, 1440, fmt)).toBeNull();
    // With the "≈" showing on the count, don't call it exact.
    const legacy = status({
      exact: false,
      fidelity: { evictedBeforeMs: NOW - 10 * HOUR, legacyBeforeMs: NOW - 20 * HOUR },
    });
    expect(evictionLine(legacy, 1440, fmt)?.text).toMatch(/older marks are missing; counts still include them$/);
    expect(evictionLine(legacy, 720, fmt)?.text).toMatch(/counts are exact$/);
  });
});
