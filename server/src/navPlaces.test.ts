import { describe, expect, it } from 'vitest';
import { GridIndex, haversineKm, nearestAirport, nearestPort } from './navPlaces';

describe('nearestAirport', () => {
  it('names the field a company jet uses', () => {
    // Centennial (KAPA), a few km off the field after takeoff.
    const n = nearestAirport(39.5701 + 0.03, -104.8493 + 0.02)!;
    expect(n.place).toMatchObject({ ident: 'KAPA', iata: 'APA', region: 'CO', country: 'US' });
    expect(n.distanceKm).toBeLessThan(5);
    expect(nearestAirport(35.9524, -112.147)!.place.ident).toBe('KGCN');
  });

  it('has nothing to say far from any airport', () => {
    expect(nearestAirport(30, -140)).toBeNull(); // mid-Pacific
  });
});

describe('nearestPort', () => {
  it('names a UN/LOCODE port', () => {
    const n = nearestPort(37.94, 23.63)!; // off Piraeus
    expect(n.place.name).toMatch(/Piraeus/);
    expect(n.place.country).toBe('GR');
  });

  it('prefers a Windstar port of call for an anchorage', () => {
    expect(nearestPort(-17.49, -149.82)!.place.name).toBe('Moorea (Cook’s Bay)');
    expect(nearestPort(-16.67, -151.4)!.place.name).toBe('Taha’a (Motu Mahana)');
  });

  it('fills a UN/LOCODE port without coordinates from GeoNames', () => {
    expect(nearestPort(31.596, 130.557, 5)!.place.name).toMatch(/Kagoshima/);
  });

  it('is null out at sea', () => {
    expect(nearestPort(30, -40)).toBeNull();
  });
});

describe('GridIndex', () => {
  it('finds neighbours across the antimeridian', () => {
    const idx = new GridIndex([{ lat: 51.5, lon: 179.95, id: 'east' }, { lat: 51.5, lon: -170, id: 'far' }]);
    const n = idx.nearest(51.5, -179.95, 20)!;
    expect(n.place.id).toBe('east');
    expect(n.distanceKm).toBeCloseTo(haversineKm(51.5, -179.95, 51.5, 179.95), 6);
  });

  it('returns everything in range, nearest first', () => {
    const idx = new GridIndex([{ lat: 0, lon: 0.2 }, { lat: 0, lon: 0.05 }, { lat: 0, lon: 3 }]);
    expect(idx.within(0, 0, 30).map((n) => n.place.lon)).toEqual([0.05, 0.2]);
  });
});
