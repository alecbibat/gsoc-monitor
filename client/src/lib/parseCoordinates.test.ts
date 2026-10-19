import { describe, expect, it } from 'vitest';
import { formatLatLon, parseCoordinates } from './parseCoordinates';

const near = (lat: number, lon: number) => ({
  lat: expect.closeTo(lat, 4) as unknown as number,
  lon: expect.closeTo(lon, 4) as unknown as number,
});

describe('parseCoordinates', () => {
  it('reads decimal pairs with a comma, semicolon or space', () => {
    expect(parseCoordinates('40.6892, -74.0445')).toEqual({ lat: 40.6892, lon: -74.0445 });
    expect(parseCoordinates('40.6892;-74.0445')).toEqual({ lat: 40.6892, lon: -74.0445 });
    expect(parseCoordinates('  40.6892   -74.0445 ')).toEqual({ lat: 40.6892, lon: -74.0445 });
    expect(parseCoordinates('40.6892°, -74.0445°')).toEqual({ lat: 40.6892, lon: -74.0445 });
    expect(parseCoordinates('+40, +74')).toEqual({ lat: 40, lon: 74 });
  });

  it('accepts longitude-first only when latitude-first is impossible', () => {
    expect(parseCoordinates('-122.3425, 47.6097')).toEqual({ lat: 47.6097, lon: -122.3425 });
    expect(parseCoordinates('47.6097, -122.3425')).toEqual({ lat: 47.6097, lon: -122.3425 });
    // Ambiguous: both readings are valid, so it's latitude-first.
    expect(parseCoordinates('-74.04, 40.69')).toEqual({ lat: -74.04, lon: 40.69 });
  });

  it('normalizes typographic minus signs, ring degree marks and enclosing brackets', () => {
    expect(parseCoordinates('40.6892, \u221274.0445')).toEqual({ lat: 40.6892, lon: -74.0445 });
    expect(parseCoordinates('40.6892, \u201374.0445')).toEqual({ lat: 40.6892, lon: -74.0445 });
    expect(parseCoordinates(`40˚41'21.3"N 74˚02'40.2"W`)).toEqual(near(40.68925, -74.0445));
    expect(parseCoordinates('(40.6892, -74.0445)')).toEqual({ lat: 40.6892, lon: -74.0445 });
    expect(parseCoordinates('[40.6892, -74.0445]')).toEqual({ lat: 40.6892, lon: -74.0445 });
  });

  it('reads hemisphere letters as prefixes or suffixes, either order', () => {
    expect(parseCoordinates('40.6892 N, 74.0445 W')).toEqual({ lat: 40.6892, lon: -74.0445 });
    expect(parseCoordinates('40.6892N 74.0445W')).toEqual({ lat: 40.6892, lon: -74.0445 });
    expect(parseCoordinates('n33.87 e151.21')).toEqual({ lat: 33.87, lon: 151.21 });
    expect(parseCoordinates('S 33.87, E 151.21')).toEqual({ lat: -33.87, lon: 151.21 });
    expect(parseCoordinates('151.21 E, 33.87 S')).toEqual({ lat: -33.87, lon: 151.21 });
  });

  it('reads degrees-minutes-seconds the way Google Maps writes them', () => {
    expect(parseCoordinates(`40°41'21.3"N 74°02'40.2"W`)).toEqual(near(40.689250, -74.044500));
    expect(parseCoordinates(`40° 41′ 21.3″ N, 74° 2′ 40.2″ W`)).toEqual(near(40.689250, -74.044500));
    expect(parseCoordinates('40 41 21.3 N 74 2 40.2 W')).toEqual(near(40.689250, -74.044500));
    expect(parseCoordinates(`40°41.355'N 74°2.67'W`)).toEqual(near(40.68925, -74.0445));
    expect(parseCoordinates(`40°41'21.3" -74°02'40.2"`)).toEqual(near(40.689250, -74.044500));
  });

  it('pulls the point out of Google Maps and OpenStreetMap links', () => {
    expect(
      parseCoordinates(
        'https://www.google.com/maps/place/Statue+of+Liberty/@40.6892494,-74.0470753,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d40.6892494!4d-74.0445004'
      )
    ).toEqual({ lat: 40.6892494, lon: -74.0445004 });
    expect(parseCoordinates('https://www.google.com/maps/@47.6097,-122.3425,15z')).toEqual({ lat: 47.6097, lon: -122.3425 });
    expect(parseCoordinates('https://maps.google.com/?q=47.6097,-122.3425')).toEqual({ lat: 47.6097, lon: -122.3425 });
    expect(parseCoordinates('https://www.openstreetmap.org/#map=15/47.6097/-122.3425')).toEqual({ lat: 47.6097, lon: -122.3425 });
    expect(parseCoordinates('https://www.openstreetmap.org/?mlat=47.6097&mlon=-122.3425#map=15/47.6/-122.3')).toEqual({
      lat: 47.6097,
      lon: -122.3425,
    });
  });

  it('reads the searched point from path-style and directions links, not the view centre', () => {
    const point = { lat: 40.6892, lon: -74.0445 };
    expect(parseCoordinates('https://www.google.com/maps/search/40.6892,-74.0445')).toEqual(point);
    expect(parseCoordinates('https://www.google.com/maps/place/40.6892,-74.0445')).toEqual(point);
    expect(parseCoordinates('https://www.google.com/maps/search/40.6892,+-74.0445/@40.7,-74.1,12z')).toEqual(point);
    expect(parseCoordinates('https://www.google.com/maps/dir/40.758,-73.9855/40.6892,-74.0445/@40.72,-74.02,13z')).toEqual(point);
  });

  it('accepts encoded separators, Apple coordinate=, geo: URIs and loc: queries', () => {
    const point = { lat: 40.6892, lon: -74.0445 };
    expect(parseCoordinates('https://maps.google.com/?q=40.6892%2C+-74.0445')).toEqual(point);
    expect(parseCoordinates('https://www.google.com/maps/search/?api=1&query=40.6892%2C%20-74.0445')).toEqual(point);
    expect(parseCoordinates('https://maps.google.com/?q=40.6892,+-74.0445')).toEqual(point);
    expect(parseCoordinates('https://maps.google.com/?q=loc:40.6892,-74.0445')).toEqual(point);
    expect(parseCoordinates('https://maps.apple.com/place?coordinate=40.6892,-74.0445&name=Statue')).toEqual(point);
    expect(parseCoordinates('https://maps.apple.com/place?address=Liberty+Island&coordinate=40.6892%2C-74.0445')).toEqual(point);
    expect(parseCoordinates('geo:40.6892,-74.0445')).toEqual(point);
  });

  it('reads Yandex links longitude-first', () => {
    expect(parseCoordinates('https://yandex.ru/maps/?ll=37.617300%2C55.755800&z=16')).toEqual({ lat: 55.7558, lon: 37.6173 });
    expect(parseCoordinates('https://yandex.com/maps/213/moscow/?pt=37.6173,55.7558&z=12')).toEqual({ lat: 55.7558, lon: 37.6173 });
  });

  it('leaves place names, addresses, postal codes and road numbers to the geocoder', () => {
    for (const q of [
      'Pittsburgh',
      '1600 Pennsylvania Ave',
      'Route 66',
      'I-95 N',
      '15213',
      'NEWS',
      'https://maps.app.goo.gl/abc',
      // Space-separated postal codes and numeric names: Stockholm, Athens,
      // Prague, New Delhi, 7-Eleven.
      '111 22',
      '105 57',
      '110 00',
      '110 001',
      '7 11',
      // Utah / Idaho grid addresses.
      '15 S 100 E',
      '80 N 100 W',
      'N7 E15',
    ]) {
      expect(parseCoordinates(q), q).toBeNull();
    }
  });

  it('rejects out-of-range and malformed angles', () => {
    for (const q of [
      '95, 91',
      '0, 181',
      '100, 200',
      '40.5 30, -74',
      `40°61'N 74°W`,
      '40 N 74 N',
      '-40 N, 74 W',
      '1, 2, 3',
      '4-0, 74',
      '',
    ]) {
      expect(parseCoordinates(q), q).toBeNull();
    }
  });
});

describe('formatLatLon', () => {
  it('prints five decimals', () => {
    expect(formatLatLon({ lat: 40.6892494, lon: -74.0445004 })).toBe('40.68925, -74.04450');
  });
});
