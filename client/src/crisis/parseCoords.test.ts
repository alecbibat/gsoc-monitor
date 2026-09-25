import { describe, expect, it } from 'vitest';
import { parseCoords } from './parseCoords';

// Typographic marks written as escapes so an editor can't normalise them to
// ASCII (which is how the DMS patterns originally lost them).
const PRIME = '\u2032';         // ′ Wikipedia / GeoHack minutes
const DOUBLE_PRIME = '\u2033';  // ″ Wikipedia / GeoHack seconds
const RSQUO = '\u2019';         // ’ Word / Outlook smart apostrophe
const RDQUO = '\u201D';         // ” Word / Outlook smart double quote

function expectSf(input: string) {
  const r = parseCoords(input);
  expect(r.error).toBeNull();
  expect(r.points).toHaveLength(1);
  expect(r.points[0].lat).toBeCloseTo(37.7747, 4);
  expect(r.points[0].lon).toBeCloseTo(-122.4192, 4);
}

describe('parseCoords DMS', () => {
  it('parses ASCII-quoted DMS', () => {
    expectSf(`37°46'29"N, 122°25'09"W`);
  });

  it('parses prime / double-prime DMS', () => {
    expectSf(`37°46${PRIME}29${DOUBLE_PRIME}N, 122°25${PRIME}09${DOUBLE_PRIME}W`);
  });

  it('parses smart-quote DMS', () => {
    expectSf(`37°46${RSQUO}29${RDQUO}N, 122°25${RSQUO}09${RDQUO}W`);
  });

  it('parses degrees-minutes with a prime', () => {
    const r = parseCoords(`37° 46${PRIME} N, 122° 25${PRIME} W`);
    expect(r.error).toBeNull();
    expect(r.points[0].lat).toBeCloseTo(37 + 46 / 60, 6);
    expect(r.points[0].lon).toBeCloseTo(-(122 + 25 / 60), 6);
  });
});

describe('parseCoords single-space pairs', () => {
  it('parses a decimal pair separated by one space', () => {
    const r = parseCoords('37.80 -122.40');
    expect(r.error).toBeNull();
    expect(r.points).toEqual([{ lat: 37.8, lon: -122.4 }]);
  });

  it('parses cardinal-suffixed values separated by one space', () => {
    const r = parseCoords('37.7749N 122.4194W');
    expect(r.error).toBeNull();
    expect(r.points).toEqual([{ lat: 37.7749, lon: -122.4194 }]);
  });

  it('parses GeoHack-style DMS separated by one space', () => {
    expectSf(`37°46${PRIME}29${DOUBLE_PRIME}N 122°25${PRIME}09${DOUBLE_PRIME}W`);
  });

  it('parses a multi-line single-space outline', () => {
    const r = parseCoords('34.0522 -118.2437\n34.0531 -118.2301\n34.0412 -118.2285');
    expect(r.error).toBeNull();
    expect(r.points).toHaveLength(3);
    expect(r.points[2]).toEqual({ lat: 34.0412, lon: -118.2285 });
  });

  it('splits spaced values at the first value\'s cardinal letter', () => {
    expectSf(`37° 46${PRIME} 29${DOUBLE_PRIME} N 122° 25${PRIME} 09${DOUBLE_PRIME} W`);
    const r = parseCoords('37.7749° N 122.4194° W');
    expect(r.error).toBeNull();
    expect(r.points).toEqual([{ lat: 37.7749, lon: -122.4194 }]);
  });

  it('does not split a spaced DMS value with no cardinal to split at', () => {
    // Six tokens and no N/S/E/W: ambiguous, so reported rather than misread.
    const r = parseCoords(`37° 46' 29" 122° 25' 09"`);
    expect(r.points).toHaveLength(0);
    expect(r.error).toMatch(/37° 46'/);
  });

  it('ignores a stray trailing comma on a space-separated pair', () => {
    const r = parseCoords('37.80 -122.40,\n37.81  -122.41,\n-33.9 18.4,');
    expect(r.error).toBeNull();
    expect(r.points).toEqual([
      { lat: 37.8, lon: -122.4 },
      { lat: 37.81, lon: -122.41 },
      { lat: -33.9, lon: 18.4 },
    ]);
  });

  it('parses southern/eastern hemisphere pairs', () => {
    expect(parseCoords('-33.9 18.4').points).toEqual([{ lat: -33.9, lon: 18.4 }]);
    const r = parseCoords(`33°54${PRIME}S 18°25${PRIME}E`);
    expect(r.error).toBeNull();
    expect(r.points[0].lat).toBeCloseTo(-33.9, 6);
    expect(r.points[0].lon).toBeCloseTo(18 + 25 / 60, 6);
    expect(parseCoords('-33.9\t18.4').points).toEqual([{ lat: -33.9, lon: 18.4 }]);
  });
});

describe('parseCoords error reporting', () => {
  it('reports a lone value instead of skipping it silently', () => {
    const r = parseCoords('37.7749');
    expect(r.points).toHaveLength(0);
    expect(r.error).toMatch(/37\.7749/);
  });

  it('keeps the good points and reports the skipped lines', () => {
    const r = parseCoords('37.80, -122.40\n37.81\n37.82 -122.42\nlat lon');
    expect(r.points).toHaveLength(2);
    expect(r.error).toMatch(/^2 line\(s\) skipped/);
    expect(r.error).toMatch(/37\.81/);
  });

  it('still parses comma pairs and WKT', () => {
    expect(parseCoords('37.8, -122.4').points).toEqual([{ lat: 37.8, lon: -122.4 }]);
    const wkt = parseCoords('LINESTRING (-122.4 37.7, -122.3 37.8)');
    expect(wkt.error).toBeNull();
    expect(wkt.points).toEqual([{ lat: 37.7, lon: -122.4 }, { lat: 37.8, lon: -122.3 }]);
  });
});
