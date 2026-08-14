import { describe, expect, it } from 'vitest';
import { dueState, localIsoDate } from './PropertyAssets';

describe('dueState', () => {
  const today = '2026-08-14';

  it('is quiet with no due date', () => {
    expect(dueState(null, today)).toBeNull();
  });

  it('flags overdue strictly after the due date', () => {
    expect(dueState('2026-08-13', today)?.label).toBe('overdue');
    // Due TODAY is not overdue — it is due in 0 days.
    expect(dueState('2026-08-14', today)?.label).toBe('due in 0d');
  });

  it('warns inside the 30-day window and stays quiet beyond', () => {
    expect(dueState('2026-09-13', today)?.label).toBe('due in 30d');
    expect(dueState('2026-09-14', today)?.label).toBe('due 2026-09-14');
  });

  it('day math is exact across the string boundary (UTC-midnight parses)', () => {
    expect(dueState('2026-08-15', today)?.label).toBe('due in 1d');
  });
});

describe('localIsoDate', () => {
  it('formats the LOCAL calendar date, zero-padded', () => {
    // 5 Jan 2026 23:30 local — toISOString would report the next/prev UTC day
    // in offset zones; localIsoDate must stay on the local day.
    const d = new Date(2026, 0, 5, 23, 30);
    expect(localIsoDate(d)).toBe('2026-01-05');
  });
});
