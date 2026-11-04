import { describe, expect, it } from 'vitest';
import { ageLabel, stepTick, tickStyle } from './legendKeys';

describe('tickStyle', () => {
  it('pins the end labels flush with the bar and centres the rest on their point', () => {
    expect(tickStyle(0)).toEqual({ left: 0 });
    expect(tickStyle(1)).toEqual({ right: 0 });
    expect(tickStyle(0.25)).toEqual({ left: '25%', transform: 'translateX(-50%)' });
  });
});

describe('stepTick', () => {
  it('centres a label under its step, with the first and last steps flush', () => {
    expect(stepTick(0, 18, 'a')).toEqual({ at: 0, label: 'a' });
    expect(stepTick(17, 18, 'z')).toEqual({ at: 1, label: 'z' });
    expect(stepTick(3, 18, 'm').at).toBeCloseTo(3.5 / 18);
  });
});

describe('ageLabel', () => {
  it('writes minutes under an hour, hours from there', () => {
    expect(ageLabel(2)).toBe('2m');
    expect(ageLabel(30)).toBe('30m');
    expect(ageLabel(60)).toBe('1h');
    expect(ageLabel(90)).toBe('1.5h');
    expect(ageLabel(1440)).toBe('24h');
  });
});
