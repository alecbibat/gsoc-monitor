import { describe, expect, it } from 'vitest';
import {
  CollisionGrid,
  FLAG_ADMIN1_CAPITAL,
  FLAG_NATIONAL_CAPITAL,
  displayText,
  equivalentZoom,
  M_PER_PX_Z0,
  parsePlaceRows,
  priorityOf,
  tierOf,
  type PlaceRow,
} from './placeLabelModel';

const row = (over: Partial<PlaceRow>): PlaceRow => ({
  kind: 'p',
  name: 'Somewhere',
  lon: 0,
  lat: 0,
  minZoom: 5,
  pop: 0,
  flags: 0,
  abbr: '',
  ...over,
});

describe('parsePlaceRows', () => {
  it('reads rows by the column order the dataset declares', () => {
    const rows = parsePlaceRows({
      v: 1,
      fields: ['kind', 'name', 'lon', 'lat', 'minZoom', 'pop', 'flags', 'abbr'],
      rows: [
        ['s', 'Colorado', -105.5, 39, 3.5, 0, 0, 'CO'],
        ['p', 'Denver', -104.985, 39.739, 4.6, 2827000, 2, ''],
      ],
    });
    expect(rows).toEqual([
      { kind: 's', name: 'Colorado', lon: -105.5, lat: 39, minZoom: 3.5, pop: 0, flags: 0, abbr: 'CO' },
      { kind: 'p', name: 'Denver', lon: -104.985, lat: 39.739, minZoom: 4.6, pop: 2827000, flags: 2, abbr: '' },
    ]);
  });

  it('skips malformed rows instead of failing the layer', () => {
    const rows = parsePlaceRows({
      fields: ['name', 'kind', 'lat', 'lon', 'minZoom'],
      rows: [['Ok', 'p', 1, 2, 3], ['', 'p', 1, 2, 3], ['Bad kind', 'x', 1, 2, 3], ['No lon', 'p', 1, null, 3], 'junk'],
    });
    expect(rows.map((r) => r.name)).toEqual(['Ok']);
    expect(rows[0]).toMatchObject({ lat: 1, lon: 2, pop: 0, flags: 0, abbr: '' });
  });

  it('rejects a document that is not a place dataset', () => {
    expect(() => parsePlaceRows({ rows: [] })).toThrow();
    expect(() => parsePlaceRows({ fields: ['name'], rows: [] })).toThrow();
  });
});

describe('typography', () => {
  it('tiers cities by status and size', () => {
    expect(tierOf(row({ flags: FLAG_NATIONAL_CAPITAL, pop: 50_000 }))).toBe('city1');
    expect(tierOf(row({ pop: 8_000_000 }))).toBe('city1');
    expect(tierOf(row({ flags: FLAG_ADMIN1_CAPITAL, pop: 30_000 }))).toBe('city2');
    expect(tierOf(row({ pop: 400_000 }))).toBe('city2');
    expect(tierOf(row({ pop: 20_000 }))).toBe('city3');
    expect(tierOf(row({ kind: 's' }))).toBe('state');
    expect(tierOf(row({ kind: 'c' }))).toBe('country');
    expect(tierOf(row({ kind: 'w' }))).toBe('water');
  });

  it('sets area names in tracked capitals and leaves point names alone', () => {
    expect(displayText(row({ kind: 's', name: 'Utah' }), 'state')).toBe('U T A H');
    expect(displayText(row({ name: 'Salt Lake City' }), 'city2')).toBe('Salt Lake City');
    expect(displayText(row({ kind: 'w', name: 'Gulf of Mexico' }), 'water')).toBe('Gulf of Mexico');
  });
});

describe('priorityOf', () => {
  it('puts a country ahead of the cities inside it, and capitals ahead of peers', () => {
    const country = priorityOf(row({ kind: 'c', minZoom: 1.7 }));
    const capital = priorityOf(row({ minZoom: 4, flags: FLAG_NATIONAL_CAPITAL, pop: 700_000 }));
    const peer = priorityOf(row({ minZoom: 4, pop: 700_000 }));
    expect(country).toBeLessThan(capital);
    expect(capital).toBeLessThan(peer);
  });

  it('lets a city outrank a state that appears at the same zoom', () => {
    expect(priorityOf(row({ minZoom: 4, pop: 600_000 }))).toBeLessThan(priorityOf(row({ kind: 's', minZoom: 4 })));
  });
});

describe('equivalentZoom', () => {
  it('matches Web Mercator resolution at the equator', () => {
    expect(equivalentZoom(M_PER_PX_Z0, 1)).toBeCloseTo(0, 6);
    expect(equivalentZoom(M_PER_PX_Z0 / 1024, 1)).toBeCloseTo(10, 6);
  });

  it('accounts for Mercator stretch away from the equator', () => {
    // At 60° a Mercator tile covers half the ground, so the same ground
    // resolution is one zoom level lower.
    expect(equivalentZoom(M_PER_PX_Z0 / 1024, 0.5)).toBeCloseTo(9, 6);
  });
});

describe('CollisionGrid', () => {
  it('rejects overlapping boxes, including across cell borders', () => {
    const g = new CollisionGrid(64);
    g.insert({ x0: 50, y0: 50, x1: 140, y1: 70 });
    expect(g.fits({ x0: 130, y0: 60, x1: 200, y1: 80 })).toBe(false);
    expect(g.fits({ x0: 141, y0: 50, x1: 200, y1: 70 })).toBe(true);
    expect(g.fits({ x0: 50, y0: 71, x1: 140, y1: 90 })).toBe(true);
    g.clear();
    expect(g.fits({ x0: 130, y0: 60, x1: 200, y1: 80 })).toBe(true);
  });
});
