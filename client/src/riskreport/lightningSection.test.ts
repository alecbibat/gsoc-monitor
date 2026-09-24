import { describe, expect, it } from 'vitest';
import type { LightningHistoryResponse } from '../types';
import type { LightningNearResponse } from '../types/lightning';
import {
  appendBlufDrivers,
  buildLightningSection,
  coverageCaption,
  fmtSpan,
  legacyLightningSection,
  lightningCountPrefix,
  type LightningSectionResult,
} from './lightningSection';
import type { RiskTarget } from './riskTypes';

// 2026-09-24 18:00:00 UTC — the server's clock in every fixture.
const NOW = Date.UTC(2026, 8, 24, 18, 0, 0);
const MIN = 60_000;
const HOUR = 3_600_000;
const utc = (h: number, m = 0) => Date.UTC(2026, 8, 24, h, m, 0);

type Overrides = {
  [K in keyof LightningNearResponse]?: LightningNearResponse[K] extends object | null
    ? Partial<NonNullable<LightningNearResponse[K]>> | null
    : LightningNearResponse[K];
};

/** A healthy, fully covered, quiet /near answer; override the parts under test. */
function near(o: Overrides = {}): LightningNearResponse {
  return {
    v: 1,
    now: NOW,
    lat: 40,
    lon: -105,
    radiusMi: 130,
    hours: 24,
    counts: { le5: 0, le25: 0, le100: 0, inRadius: 0, exact: true, ...(o.counts ?? {}) },
    nearest: o.nearest === undefined ? null : (o.nearest as LightningNearResponse['nearest']),
    points: { lat: [], lon: [], t: [], sampled: false, ...(o.points ?? {}) },
    fidelity: { legacyBeforeMs: null, evictedBeforeMs: null, ...(o.fidelity ?? {}) },
    coverage: {
      windowMin: 1440,
      coveredMin: 1440,
      gaps: [],
      restoring: false,
      restoredBackToMs: null,
      ...(o.coverage ?? {}),
    },
    collector: { connected: true, downSince: null, lastStrikeAgeS: 1, ratePerMin: 5400, ...(o.collector ?? {}) },
  };
}

const build = (o: Overrides = {}, nowMs = NOW) => buildLightningSection(near(o), nowMs);

/** Every caveat reaches the section AND the bottom line — the level stays Low. */
function expectCaveat(r: LightningSectionResult, re: RegExp) {
  expect(r.section.level).toBe('low');
  expect(r.section.drivers.some((d) => re.test(d))).toBe(true);
  expect(r.blufDrivers.some((d) => re.test(d))).toBe(true);
  expect(r.lightning.notes?.some((d) => re.test(d))).toBe(true);
}

describe('buildLightningSection — counts', () => {
  it('uses the server counts as-is, even with no map points at all', () => {
    const r = build({ counts: { le5: 0, le25: 42, le100: 1234, inRadius: 2000, exact: true } });
    expect(r.lightning.strikes25mi).toBe(42);
    expect(r.lightning.strikes100mi).toBe(1234);
    expect(r.lightning.countsExact).toBe(true);
    expect(r.mapStrikes).toEqual([]);
    expect(r.section.countLabel).toBe(`${(42).toLocaleString()} ≤25 mi`);
    expect(r.section.drivers).toContain(`${(1234).toLocaleString()} strikes within 100 mi in the past 24 h`);
  });

  it('frames zero as "None ≤25 mi" and omits the 100 mi driver', () => {
    const r = build();
    expect(r.section.countLabel).toBe('None ≤25 mi');
    expect(r.section.drivers).toEqual([]);
    expect(r.blufDrivers).toEqual([]);
    expect(r.mapNote).toBeNull();
  });

  it('singular strike wording', () => {
    const r = build({ counts: { le100: 1, inRadius: 1 } });
    expect(r.section.drivers).toContain('1 strike within 100 mi in the past 24 h');
  });

  it('prefixes ≈ on labels and drivers when the counts are not exact', () => {
    const r = build({ counts: { le25: 12, le100: 60, inRadius: 90, exact: false } });
    expect(r.section.countLabel).toBe('≈12 ≤25 mi');
    expect(r.section.drivers).toContain('≈60 strikes within 100 mi in the past 24 h');
    expect(r.lightning.countsExact).toBe(false);
    expect(lightningCountPrefix(r.lightning)).toBe('≈');
    expect(lightningCountPrefix(build().lightning)).toBe('');
  });

  it('keeps coverageMin = coveredMin for older readers', () => {
    const r = build({ coverage: { coveredMin: 1300, gaps: [{ fromMs: utc(3), toMs: utc(3) + 140 * MIN }] } });
    expect(r.lightning.coverageMin).toBe(1300);
    expect(r.lightning.coverage).toEqual({
      windowMin: 1440,
      coveredMin: 1300,
      gaps: [{ fromMs: utc(3), toMs: utc(3) + 140 * MIN }],
    });
  });
});

describe('buildLightningSection — level', () => {
  it('a strike ≤5 mi is elevated: a direct ignition source', () => {
    const r = build({ nearest: { mi: 3.4, ageS: 7200, lat: 40, lon: -105 }, counts: { le5: 1, le25: 1, le100: 1, inRadius: 1 } });
    expect(r.section.level).toBe('elevated');
    expect(r.section.drivers[0]).toBe('Strike 3 mi from the property 2 h ago — direct ignition source');
    expect(r.lightning.nearestMi).toBe(3.4);
    expect(r.lightning.nearestAgeS).toBe(7200);
  });

  it('under a mile reads "<1", recent ages read in minutes', () => {
    const r = build({ nearest: { mi: 0.4, ageS: 600, lat: 40, lon: -105 } });
    expect(r.section.drivers[0]).toBe('Strike <1 mi from the property 10 min ago — direct ignition source');
    const r2 = build({ nearest: { mi: 5, ageS: 20, lat: 40, lon: -105 } });
    expect(r2.section.level).toBe('elevated');
    expect(r2.section.drivers[0]).toContain('<1 min ago');
  });

  it('≤25 mi is guarded', () => {
    const r = build({ nearest: { mi: 18.6, ageS: 5400, lat: 40, lon: -105 } });
    expect(r.section.level).toBe('guarded');
    expect(r.section.drivers[0]).toBe('Nearest strike 19 mi away, 2 h ago');
  });

  it('beyond 25 mi, or nothing at all, is low', () => {
    expect(build({ nearest: { mi: 25.1, ageS: 60, lat: 40, lon: -105 } }).section.level).toBe('low');
    expect(build().section.level).toBe('low');
  });
});

describe('buildLightningSection — caveats reach the bottom line even at Low', () => {
  it('collector blind ≥10 min: total and the largest gap, in UTC', () => {
    const r = build({
      coverage: {
        coveredMin: 1440 - 75,
        gaps: [
          { fromMs: utc(2, 10), toMs: utc(2, 25) }, // 15 min
          { fromMs: utc(9, 0), toMs: utc(10, 0) }, // 60 min
        ],
      },
    });
    expectCaveat(r, /^⚠ Lightning collector blind for 1h15m of the past 24 h \(largest 09:00–10:00 UTC\) — strikes in those periods are missing$/);
  });

  it('gaps under 10 min in total stay out', () => {
    const r = build({ coverage: { coveredMin: 1432, gaps: [{ fromMs: utc(4), toMs: utc(4, 8) }] } });
    expect(r.blufDrivers).toEqual([]);
    expect(r.section.drivers).toEqual([]);
  });

  it('only the part of a gap inside the window counts', () => {
    // 40 min straddling the window start → 5 min inside.
    const r = build({ coverage: { gaps: [{ fromMs: NOW - 24 * HOUR - 35 * MIN, toMs: NOW - 24 * HOUR + 5 * MIN }] } });
    expect(r.blufDrivers).toEqual([]);
  });

  it('history still restoring', () => {
    const r = build({ coverage: { restoring: true, restoredBackToMs: utc(6, 30), coveredMin: 690 } });
    expectCaveat(r, /^⚠ Lightning history still loading on the server \(back to 06:30 UTC\) — counts may be low$/);
    // The not-yet-restored span is unknown, not blind time.
    expect(r.blufDrivers).toHaveLength(1);
    const r2 = build({ coverage: { restoring: true, restoredBackToMs: null, coveredMin: 0 } });
    expectCaveat(r2, /^⚠ Lightning history still loading on the server — counts may be low$/);
  });

  it('collector disconnected', () => {
    const r = build({ collector: { connected: false, downSince: NOW - 7 * MIN, lastStrikeAgeS: null } });
    expectCaveat(r, /^⚠ Lightning collector offline for 7 min — the most recent strikes are missing$/);
  });

  it('collector connected but silent > 120 s counts as offline', () => {
    const r = build({ collector: { connected: true, lastStrikeAgeS: 3 * 3600 + 5 * 60 } });
    expectCaveat(r, /^⚠ Lightning collector offline for 3h05m — the most recent strikes are missing$/);
    expect(build({ collector: { lastStrikeAgeS: 119 } }).blufDrivers).toEqual([]);
  });

  it('offline with no timing known still says so', () => {
    const r = build({ collector: { connected: false, downSince: null, lastStrikeAgeS: null } });
    expectCaveat(r, /^⚠ Lightning collector offline — the most recent strikes are missing$/);
  });

  it('socket open but no strike since boot (downSince set) is offline', () => {
    const r = build({ collector: { connected: true, downSince: NOW - 8 * MIN, lastStrikeAgeS: null, ratePerMin: 0 } });
    expectCaveat(r, /^⚠ Lightning collector offline for 8 min — the most recent strikes are missing$/);
  });

  it('fidelity marks older than the window are ignored', () => {
    const r = build({ fidelity: { evictedBeforeMs: NOW - 25 * HOUR, legacyBeforeMs: NOW - 24 * HOUR } });
    expect(r.blufDrivers).toEqual([]);
    expect(r.section.drivers).toEqual([]);
    expect(r.mapNote).toBeNull();
  });
});

describe('buildLightningSection — positions evicted by the memory cap', () => {
  const EVICTED =
    /^⚠ Strike positions before 01:15 UTC were dropped \(server memory cap\) — counts, the nearest strike and the map cover only 01:15–now; a nearby strike before then would be missed$/;
  const fidelity = { evictedBeforeMs: utc(1, 15) };

  it('says the counts and nearest strike cover only the rest of the window — never that they are exact', () => {
    // The server marks the counts inexact once eviction reaches the window.
    const r = build({ fidelity, counts: { exact: false } });
    expectCaveat(r, EVICTED);
    expect(r.section.drivers.some((d) => /exact/.test(d))).toBe(false);
    expect(r.mapNote).toContain('no positions before 01:15 UTC');
  });

  it('zero reads "None ≤25 mi since HH:MM", not a clean none', () => {
    const r = build({ fidelity, counts: { exact: false } });
    expect(r.section.countLabel).toBe('None ≤25 mi since 01:15');
    expect(r.lightning.countsFromMs).toBe(utc(1, 15));
  });

  it('non-zero counts are lower bounds ("≥"), in the label, the drivers and the map note', () => {
    const t0 = NOW / 1000;
    const r = build({
      fidelity,
      counts: { le25: 12, le100: 60, inRadius: 90, exact: false },
      points: { lat: [40, 41], lon: [-105, -104], t: [t0 - 100, t0 - 50], sampled: true },
    });
    expect(r.section.countLabel).toBe('≥12 ≤25 mi');
    expect(r.section.drivers).toContain('≥60 strikes within 100 mi in the past 24 h');
    expect(r.mapNote).toContain('(2 of ≥90 strikes)');
    expect(lightningCountPrefix(r.lightning)).toBe('≥');
  });

  it('reaches the bottom line even when a strike ≤5 mi is already there', () => {
    const r = build({
      fidelity,
      nearest: { mi: 2, ageS: 60, lat: 40, lon: -105 },
      counts: { le5: 1, le25: 1, le100: 1, inRadius: 1, exact: false },
    });
    expect(r.section.level).toBe('elevated');
    expect(r.blufDrivers.some((d) => EVICTED.test(d))).toBe(true);
  });

  it('with pre-upgrade history too, the lower bound wins and both caveats are there', () => {
    const r = build({
      fidelity: { evictedBeforeMs: utc(1, 15), legacyBeforeMs: utc(11) },
      counts: { le25: 12, le100: 60, exact: false },
    });
    expect(r.section.countLabel).toBe('≥12 ≤25 mi');
    expect(r.section.drivers).toContain('≥60 strikes within 100 mi in the past 24 h');
    expect(r.blufDrivers.some((d) => EVICTED.test(d))).toBe(true);
    expect(r.blufDrivers.some((d) => d.includes('pre-upgrade history sampled 1-in-6'))).toBe(true);
  });

  it('eviction older than the window changes nothing', () => {
    const r = build({ fidelity: { evictedBeforeMs: NOW - 25 * HOUR }, counts: { le25: 3 } });
    expect(r.section.countLabel).toBe('3 ≤25 mi');
    expect(r.lightning.countsFromMs).toBeUndefined();
  });
});

describe('buildLightningSection — legacy 1-in-6 history', () => {
  const LEGACY = /^Strikes before 11:00 UTC come from pre-upgrade history sampled 1-in-6 — counts there are estimates and a single nearby strike can be missed$/;
  const fidelity = { legacyBeforeMs: utc(11) };

  it('always in the section; in the bottom line when nothing is within 5 mi', () => {
    const r = build({ fidelity, counts: { exact: false } });
    expectCaveat(r, LEGACY);
    expect(r.mapNote).toContain('strikes before 11:00 UTC are a 1-in-6 sample');
    const far = build({ fidelity, nearest: { mi: 12, ageS: 60, lat: 40, lon: -105 } });
    expect(far.section.drivers.some((d) => LEGACY.test(d))).toBe(true);
    expect(far.blufDrivers.some((d) => LEGACY.test(d))).toBe(true);
  });

  it('left out of the bottom line when a strike ≤5 mi already carries it', () => {
    const r = build({ fidelity, nearest: { mi: 4, ageS: 60, lat: 40, lon: -105 } });
    expect(r.section.drivers.some((d) => LEGACY.test(d))).toBe(true);
    expect(r.blufDrivers.some((d) => LEGACY.test(d))).toBe(false);
  });
});

describe('buildLightningSection — map', () => {
  it('returns strikes oldest → newest, dropping malformed entries', () => {
    const t0 = NOW / 1000;
    const r = build({
      points: { lat: [41, 40, 42, Number.NaN], lon: [-104, -105, -106, -100], t: [t0 - 10, t0 - 3000, t0 - 5, t0 - 1], sampled: false },
    });
    expect(r.mapStrikes.map((s) => s.t)).toEqual([t0 - 3000, t0 - 10, t0 - 5]);
    expect(r.mapStrikes[0]).toEqual({ lat: 40, lon: -105, t: t0 - 3000 });
  });

  it("moves strike times onto the client clock (server skew removed)", () => {
    const t0 = NOW / 1000;
    // Received when the client clock read 90 s ahead of the server's response
    // time: ages must still come out as the server's.
    const r = build({ points: { lat: [40], lon: [-105], t: [t0 - 30], sampled: false } }, NOW + 90_000);
    expect(r.mapStrikes[0].t).toBe(t0 - 30 + 90);
  });

  it('notes point sampling with N of M', () => {
    const t0 = NOW / 1000;
    const r = build({
      counts: { le25: 900, le100: 9000, inRadius: 15000, exact: true },
      points: { lat: [40, 41], lon: [-105, -104], t: [t0 - 100, t0 - 50], sampled: true },
    });
    expect(r.mapNote).toBe(`showing the newest strike per area (2 of ${(15000).toLocaleString()} strikes)`);
    expect(r.lightning.mapNote).toBe(r.mapNote);
    // The numbers never come from the sample.
    expect(r.lightning.strikes100mi).toBe(9000);
  });
});

describe('helpers', () => {
  it('fmtSpan', () => {
    expect(fmtSpan(0)).toBe('0 min');
    expect(fmtSpan(59.4)).toBe('59 min');
    expect(fmtSpan(60)).toBe('1h00m');
    expect(fmtSpan(125)).toBe('2h05m');
  });

  it('coverageCaption lists any gap, and nothing without one', () => {
    expect(coverageCaption(undefined)).toBeNull();
    expect(coverageCaption({ windowMin: 1440, coveredMin: 1440, gaps: [] })).toBeNull();
    expect(
      coverageCaption({
        windowMin: 1440,
        coveredMin: 1436,
        gaps: [{ fromMs: utc(1), toMs: utc(1, 4) }],
      })
    ).toBe('collector blind 4 min in 1 gap — no strikes recorded then');
    expect(
      coverageCaption({
        windowMin: 1440,
        coveredMin: 1360,
        gaps: [
          { fromMs: utc(1), toMs: utc(1, 20) },
          { fromMs: utc(5), toMs: utc(6) },
        ],
      })
    ).toBe('collector blind 1h20m in 2 gaps — no strikes recorded then');
  });

  it('appendBlufDrivers adds only what the bottom line lacks, in order', () => {
    const overall = ['Nearest strike 19 mi away, 2 h ago', '⚠ A'];
    expect(appendBlufDrivers(overall, ['⚠ A', '⚠ B'])).toEqual(['Nearest strike 19 mi away, 2 h ago', '⚠ A', '⚠ B']);
  });
});

describe('legacyLightningSection (fallback for a server without /near)', () => {
  const target: RiskTarget = { key: 'k', name: 'Lodge', lat: 40, lon: -105 };
  const nowS = NOW / 1000;
  const resp = (o: Partial<LightningHistoryResponse> = {}): LightningHistoryResponse => ({
    // 0.03° ≈ 2 mi north; 0.3° ≈ 21 mi; 1.2° ≈ 83 mi; 3° ≈ 207 mi (outside 130).
    lat: [40.03, 40.3, 41.2, 43],
    lon: [-105, -105, -105, -105],
    t: [nowS - 60, nowS - 7200, nowS - 600, nowS - 30],
    windowMin: 1440,
    totalInWindow: 4,
    returned: 4,
    thinned: false,
    coverageMin: 1440,
    connected: true,
    updated: nowS,
    ...o,
  });

  const SAMPLE =
    '⚠ Lightning history from this older server is a 1-in-6 sample — counts are estimates (×6) and a single nearby strike can be missed';

  it('counts client-side, keeps the old levels, and never presents the 1-in-6 sample as a census', () => {
    const r = legacyLightningSection(resp(), target, NOW);
    expect(r.section.level).toBe('elevated');
    expect(r.section.drivers[0]).toBe('Strike 2 mi from the property in the past 24 h — direct ignition source');
    // That server kept 1 strike in 6: counts are scaled ×6 and marked estimates.
    expect(r.lightning.strikes25mi).toBe(12);
    expect(r.lightning.strikes100mi).toBe(18);
    expect(r.lightning.countsExact).toBe(false);
    expect(r.section.countLabel).toBe('≈12 ≤25 mi');
    expect(r.section.drivers).toContain('≈18 strikes within 100 mi in the past 24 h');
    expect(r.section.drivers).toContain(SAMPLE);
    expect(r.blufDrivers).toEqual([SAMPLE]);
    expect(r.mapNote).toBe('strikes are a 1-in-6 sample');
    // 130 mi cut, oldest → newest.
    expect(r.mapStrikes.map((s) => s.t)).toEqual([nowS - 7200, nowS - 600, nowS - 60]);
  });

  it('nothing sampled nearby is "None sampled", with the caveat in the bottom line at Low', () => {
    const r = legacyLightningSection(resp({ lat: [43], lon: [-105], t: [nowS - 30] }), target, NOW);
    expect(r.section.level).toBe('low');
    expect(r.section.countLabel).toBe('None sampled ≤25 mi');
    expect(r.blufDrivers).toEqual([SAMPLE]);
  });

  it('scales a stride-sampled response on top of the ×6 and says so', () => {
    const r = legacyLightningSection(resp({ thinned: true, returned: 4, totalInWindow: 40 }), target, NOW);
    expect(r.lightning.strikes100mi).toBe(180);
    expect(r.section.countLabel).toBe('≈120 ≤25 mi');
    expect(r.section.drivers.some((d) => d.startsWith('⚠ Strike data was sampled'))).toBe(true);
    expect(r.blufDrivers.some((d) => d.startsWith('⚠ Strike data was sampled'))).toBe(true);
    expect(r.mapNote).toContain('thinned again to 4 of 40');
  });

  it('flags partial history, in the bottom line too', () => {
    const r = legacyLightningSection(resp({ coverageMin: 600 }), target, NOW);
    const partial = '⚠ Only 10.0 h of strike history collected — counts undercount the full day';
    expect(r.section.drivers).toContain(partial);
    expect(r.blufDrivers).toContain(partial);
  });
});
