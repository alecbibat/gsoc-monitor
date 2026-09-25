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

  it('keeps the year 4 digits while the operator is still typing it', () => {
    // Year-field keystrokes emit "0002-…", "0020-…", "0202-…" before "2026-…".
    for (const v of ['0002-03-01T09:30', '0020-03-01T09:30', '0202-03-01T09:30']) {
      expect(toLocalInput(fromLocalInput(v))).toBe(v);
    }
  });

  it('never throws on garbage', () => {
    expect(fromLocalInput('not a date')).toBe('');
    expect(toLocalInput('garbageZ')).toBe('');
  });

  it('"now" truncates to the minute the input can show', () => {
    const iso = nowForInput(new Date(2026, 8, 25, 14, 5, 37, 250));
    expect(iso).toBe(new Date(2026, 8, 25, 14, 5).toISOString());
  });

  it('"now" keeps the instant in the hour a DST fall-back repeats', () => {
    const tz = process.env.TZ;
    process.env.TZ = 'America/New_York';
    try {
      // 01:30 EDT and 01:30 EST: the same wall time, an hour apart.
      expect(nowForInput(new Date('2026-11-01T05:30:20Z'))).toBe('2026-11-01T05:30:00.000Z');
      expect(nowForInput(new Date('2026-11-01T06:30:20Z'))).toBe('2026-11-01T06:30:00.000Z');
    } finally {
      if (tz === undefined) delete process.env.TZ; else process.env.TZ = tz;
    }
  });
});
