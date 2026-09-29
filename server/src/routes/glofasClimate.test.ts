import { beforeEach, describe, expect, it, vi } from 'vitest';

// The Postgres snapshot store is mocked: tests drive what a read returns and
// record what gets saved.
const db = vi.hoisted(() => ({
  rows: [] as Array<{ data: unknown }>,
  readError: null as Error | null,
  saved: [] as Array<{ key: string; data: unknown }>,
}));
vi.mock('../db', () => ({
  pool: {
    query: async (sql: string, params: unknown[]) => {
      if (sql.startsWith('SELECT')) {
        if (db.readError) throw db.readError;
        return { rows: db.rows };
      }
      db.saved.push({ key: String(params[0]), data: JSON.parse(String(params[1])) });
      return { rows: [] };
    },
  },
}));

const {
  annualMaxima, climatologyWindow, gumbelReturnPeriods, resolveReturnPeriods, CLIMATE_YEARS,
} = await import('./glofasClimate');

/** A daily series with one peak per year: year i peaks at peaks[i]. */
function series(firstYear: number, peaks: number[], daysPerYear = 365) {
  const time: string[] = [];
  const q: Array<number | null> = [];
  peaks.forEach((peak, i) => {
    const y = firstYear + i;
    for (let d = 0; d < daysPerYear; d++) {
      time.push(new Date(Date.UTC(y, 0, 1 + d)).toISOString().slice(0, 10));
      q.push(d === 100 ? peak : 20);
    }
  });
  return { time, q };
}

const PEAKS = Array.from({ length: 20 }, (_, i) => 100 + 10 * i); // 100…290

beforeEach(() => {
  db.rows = [];
  db.readError = null;
  db.saved = [];
});

describe('climatologyWindow', () => {
  it('spans the last 20 complete calendar years', () => {
    expect(CLIMATE_YEARS).toBe(20);
    expect(climatologyWindow(new Date('2026-09-29T12:00:00Z'))).toEqual({ start: '2006-01-01', end: '2025-12-31' });
    expect(climatologyWindow(new Date('2027-01-01T00:00:00Z'))).toEqual({ start: '2007-01-01', end: '2026-12-31' });
  });
});

describe('annualMaxima', () => {
  it('takes each year\'s peak and skips short years and non-finite values', () => {
    const { time, q } = series(2000, [50, 80]);
    time.push('2002-01-01', '2002-01-02');
    q.push(999, null); // a 2-day "year" must not count
    q[5] = Number.NaN;
    expect(annualMaxima(time, q)).toEqual([{ year: 2000, max: 50 }, { year: 2001, max: 80 }]);
  });
});

describe('gumbelReturnPeriods', () => {
  it('fits the annual maxima by the method of moments', () => {
    const { time, q } = series(2006, PEAKS);
    // Reference values computed independently (mean 195, sd 59.16).
    expect(gumbelReturnPeriods(time, q)).toEqual({
      rp2: 185, rp5: 238, rp20: 305, years: 20, fromYear: 2006, toYear: 2025,
    });
  });

  it('orders the periods and never returns a negative flow', () => {
    const { time, q } = series(2006, [0, 0, 0, 0, 0, 0, 0, 0, 0, 500]);
    const rp = gumbelReturnPeriods(time, q)!;
    expect(rp.rp2).toBeGreaterThanOrEqual(0);
    expect(rp.rp2).toBeLessThanOrEqual(rp.rp5);
    expect(rp.rp5).toBeLessThanOrEqual(rp.rp20);
  });

  it('a flat record puts every period at the mean', () => {
    const { time, q } = series(2006, Array(12).fill(40));
    expect(gumbelReturnPeriods(time, q)).toMatchObject({ rp2: 40, rp5: 40, rp20: 40 });
  });

  it('is null below 10 usable years', () => {
    const { time, q } = series(2016, PEAKS.slice(0, 9));
    expect(gumbelReturnPeriods(time, q)).toBeNull();
  });
});

describe('resolveReturnPeriods', () => {
  const NOW = new Date('2026-09-29T12:00:00Z');
  const WINDOW = { start: '2006-01-01', end: '2025-12-31' };

  it("uses this year's stored fit without pulling", async () => {
    const rp = { rp2: 1, rp5: 2, rp20: 3, years: 20, fromYear: 2006, toYear: 2025 };
    db.rows = [{ data: { window: WINDOW, rp, savedAt: 1 } }];
    const pull = vi.fn();
    await expect(resolveReturnPeriods(45, -120, pull, NOW)).resolves.toEqual(rp);
    expect(pull).not.toHaveBeenCalled();
  });

  it('a stored "record too short" is honoured too — no re-pull', async () => {
    db.rows = [{ data: { window: WINDOW, rp: null, savedAt: 1 } }];
    const pull = vi.fn();
    await expect(resolveReturnPeriods(45, -120, pull, NOW)).resolves.toBeNull();
    expect(pull).not.toHaveBeenCalled();
  });

  it("re-pulls a previous year's fit, then stores the new one under the cell key", async () => {
    db.rows = [{ data: { window: { start: '2005-01-01', end: '2024-12-31' }, rp: null, savedAt: 1 } }];
    const pull = vi.fn(async () => series(2006, PEAKS));
    const rp = await resolveReturnPeriods(45, -120, pull, NOW);
    expect(pull).toHaveBeenCalledWith(WINDOW);
    expect(rp?.rp20).toBe(305);
    expect(db.saved).toHaveLength(1);
    expect(db.saved[0].key).toBe('glofas-rp:v1:45,-120');
    expect(db.saved[0].data).toMatchObject({ window: WINDOW, rp: { rp20: 305 } });
  });

  it('ignores a malformed stored row', async () => {
    db.rows = [{ data: { window: WINDOW, rp: { rp2: 'x' }, savedAt: 1 } }];
    const pull = vi.fn(async () => series(2006, PEAKS));
    await expect(resolveReturnPeriods(45, -120, pull, NOW)).resolves.toMatchObject({ rp2: 185 });
    expect(pull).toHaveBeenCalledOnce();
  });

  it('a database outage still answers from a pull', async () => {
    db.readError = new Error('connection refused');
    const pull = vi.fn(async () => series(2006, PEAKS));
    await expect(resolveReturnPeriods(45, -120, pull, NOW)).resolves.toMatchObject({ rp5: 238 });
  });

  it('propagates a pull failure and stores nothing', async () => {
    const pull = vi.fn(async () => {
      throw new Error('HTTP 429');
    });
    await expect(resolveReturnPeriods(45, -120, pull, NOW)).rejects.toThrow('HTTP 429');
    expect(db.saved).toEqual([]);
  });
});
