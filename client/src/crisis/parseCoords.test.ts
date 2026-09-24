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
