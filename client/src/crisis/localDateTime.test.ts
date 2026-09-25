import { describe, expect, it } from 'vitest';
import { fromLocalInput, nowForInput, toLocalInput } from './localDateTime';

describe('localDateTime', () => {
  it('keeps empty values empty both ways', () => {
    expect(fromLocalInput('')).toBe('');
    expect(toLocalInput('')).toBe('');
    expect(toLocalInput(undefined)).toBe('');
    expect(toLocalInput(null)).toBe('');
  });

  it('passes legacy zone-less values through unchanged', () => {
    expect(toLocalInput('2026-03-01T09:30')).toBe('2026-03-01T09:30');
    expect(toLocalInput('2026-03-01T09:30:15')).toBe('2026-03-01T09:30:15');
  });

  it('stores the input as a UTC instant of the local wall time', () => {
    const iso = fromLocalInput('2026-03-01T09:30');
    expect(iso).toMatch(/Z$/);
    // Same instant as the local wall time the operator typed.
    expect(new Date(iso).getTime()).toBe(new Date(2026, 2, 1, 9, 30).getTime());
  });

  it('round-trips input → stored → input', () => {
    for (const v of ['2026-03-01T09:30', '2026-12-31T23:59', '2026-07-04T00:00']) {
      expect(toLocalInput(fromLocalInput(v))).toBe(v);
    }
  });

  it('renders stored instants as local wall time', () => {
    const d = new Date(2026, 8, 25, 14, 5, 37);
    expect(toLocalInput(d.toISOString())).toBe('2026-09-25T14:05');
    // Offset-form instants too.
    expect(toLocalInput('2026-09-25T12:00:00+00:00')).toBe(toLocalInput('2026-09-25T12:00:00.000Z'));
  });

  it('never throws on garbage', () => {
    expect(fromLocalInput('not a date')).toBe('');
    expect(toLocalInput('garbageZ')).toBe('');
  });

  it('"now" truncates to the minute the input can show', () => {
    const iso = nowForInput(new Date(2026, 8, 25, 14, 5, 37, 250));
    expect(iso).toBe(new Date(2026, 8, 25, 14, 5).toISOString());
  });
});
