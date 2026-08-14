import { describe, expect, it } from 'vitest';
import { RISK_LEVELS, RISK_RINGS, bumpLevel, maxLevel } from './riskTypes';

describe('risk level algebra', () => {
  it('orders the five levels', () => {
    expect(RISK_LEVELS.low.rank).toBeLessThan(RISK_LEVELS.guarded.rank);
    expect(RISK_LEVELS.guarded.rank).toBeLessThan(RISK_LEVELS.elevated.rank);
    expect(RISK_LEVELS.elevated.rank).toBeLessThan(RISK_LEVELS.high.rank);
    expect(RISK_LEVELS.high.rank).toBeLessThan(RISK_LEVELS.critical.rank);
  });

  it('maxLevel picks the worse level regardless of order', () => {
    expect(maxLevel('low', 'high')).toBe('high');
    expect(maxLevel('high', 'low')).toBe('high');
    expect(maxLevel('elevated', 'elevated')).toBe('elevated');
  });

  it('bumpLevel escalates one step and saturates at critical', () => {
    expect(bumpLevel('low')).toBe('guarded');
    expect(bumpLevel('high')).toBe('critical');
    expect(bumpLevel('critical')).toBe('critical');
  });

  it('declares the fixed rings in ascending order', () => {
    const miles = RISK_RINGS.map((r) => r.miles);
    expect(miles).toEqual([...miles].sort((a, b) => a - b));
    expect(miles[miles.length - 1]).toBe(100);
  });
});
