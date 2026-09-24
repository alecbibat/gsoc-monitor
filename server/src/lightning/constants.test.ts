import { describe, expect, it } from 'vitest';
// The client palette has no imports, so the server test can read the real thing.
import { STAGE_ENDS_S as CLIENT_STAGE_ENDS_S } from '../../../client/src/layers/lightning/lightningPalette';
import {
  BUDGETS,
  DEFAULT_BUDGET,
  DEFAULT_FRESH,
  FRESH_CAPS,
  LADDER_DEG,
  MAX_RECORDS_FLOOR,
  STAGE_ENDS_S,
  STRATA_ENDS_S,
  STRATA_SHARE,
  parseMaxRecords,
} from './constants';

describe('lightning constants', () => {
  it('stage ends are pinned and equal the client palette', () => {
    expect(STAGE_ENDS_S).toEqual([120, 600, 1800, 3600, 10800, 43200, 86400]);
    expect([...CLIENT_STAGE_ENDS_S]).toEqual([...STAGE_ENDS_S]);
  });

  it('strata follow the stages (white split at 60 s) and their shares sum to 1', () => {
    expect(STRATA_ENDS_S).toEqual([60, 600, 1800, 3600, 10800, 43200, 86400]);
    expect(STRATA_ENDS_S.slice(1)).toEqual(STAGE_ENDS_S.slice(1));
    expect(STRATA_SHARE).toHaveLength(STRATA_ENDS_S.length);
    expect(STRATA_SHARE.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
  });

  it('the lattice ladder doubles every level (parent = row>>1, col>>1)', () => {
    for (let i = 1; i < LADDER_DEG.length; i++) expect(LADDER_DEG[i]).toBeCloseTo(LADDER_DEG[i - 1] * 2, 12);
  });

  it('defaults are members of their allowed sets', () => {
    expect(BUDGETS).toContain(DEFAULT_BUDGET);
    expect(FRESH_CAPS).toContain(DEFAULT_FRESH);
  });

  it('LIGHTNING_MAX_STRIKES has a default and a floor', () => {
    expect(parseMaxRecords(undefined)).toBe(12_000_000);
    expect(parseMaxRecords('nope')).toBe(12_000_000);
    expect(parseMaxRecords('500000')).toBe(MAX_RECORDS_FLOOR);
    expect(parseMaxRecords('20000000')).toBe(20_000_000);
  });
});
