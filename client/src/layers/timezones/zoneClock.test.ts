import { describe, expect, it } from 'vitest';
import {
  captionFor,
  formatOffsetLabel,
  formatZoneDate,
  isValidTimeZone,
  offsetMinutesAt,
  readZone,
  resolveZoneClock,
  zoneAbbreviation,
  zoneLongName,
} from './zoneClock';

// A fixed instant so every expectation is deterministic: 2026-09-16 13:40:05.5Z
// (northern-hemisphere summer, southern-hemisphere winter).
const SUMMER = Date.UTC(2026, 8, 16, 13, 40, 5, 500);
// 2026-01-16 13:40:05Z — the other half of the year.
const WINTER = Date.UTC(2026, 0, 16, 13, 40, 5);

const clock = (iana: string) => {
  const c = resolveZoneClock(iana);
  if (!c) throw new Error(`expected ${iana} to resolve`);
  return c;
};

describe('isValidTimeZone', () => {
  it('accepts real zones, tz database links and the Etc ocean zones', () => {
    expect(isValidTimeZone('America/New_York')).toBe(true);
    expect(isValidTimeZone('Asia/Rangoon')).toBe(true); // link → Asia/Yangon
    expect(isValidTimeZone('Antarctica/South_Pole')).toBe(true);
    expect(isValidTimeZone('Etc/GMT+12')).toBe(true);
  });

  it('rejects malformed or empty names', () => {
    expect(isValidTimeZone('Antarctica/')).toBe(false);
    expect(isValidTimeZone('Not/A_Zone')).toBe(false);
    expect(isValidTimeZone('')).toBe(false);
    expect(isValidTimeZone(null)).toBe(false);
    expect(isValidTimeZone(undefined)).toBe(false);
  });
});

describe('resolveZoneClock', () => {
  it('keys the clock by the zone name', () => {
    expect(resolveZoneClock('America/New_York')).toEqual({ key: 'America/New_York', iana: 'America/New_York' });
  });

  it('returns null for zones this engine cannot resolve', () => {
    expect(resolveZoneClock('Antarctica/')).toBeNull();
    expect(resolveZoneClock('')).toBeNull();
    expect(resolveZoneClock(undefined)).toBeNull();
  });
});

describe('formatOffsetLabel', () => {
  it('formats whole, half and quarter hours with a sign', () => {
    expect(formatOffsetLabel(0)).toBe('UTC+0');
    expect(formatOffsetLabel(-240)).toBe('UTC-4');
    expect(formatOffsetLabel(345)).toBe('UTC+5:45');
    expect(formatOffsetLabel(-210)).toBe('UTC-3:30');
    expect(formatOffsetLabel(840)).toBe('UTC+14');
    expect(formatOffsetLabel(765)).toBe('UTC+12:45');
  });
});

describe('offsetMinutesAt', () => {
  it('tracks daylight saving in both hemispheres', () => {
    expect(offsetMinutesAt('America/New_York', SUMMER)).toBe(-240);
    expect(offsetMinutesAt('America/New_York', WINTER)).toBe(-300);
    expect(offsetMinutesAt('Australia/Sydney', SUMMER)).toBe(600);
    expect(offsetMinutesAt('Australia/Sydney', WINTER)).toBe(660);
  });

  it('handles fractional and far-east offsets', () => {
    expect(offsetMinutesAt('Asia/Kathmandu', SUMMER)).toBe(345);
    expect(offsetMinutesAt('Pacific/Chatham', WINTER)).toBe(825); // +13:45 in NZ summer
    expect(offsetMinutesAt('Pacific/Kiritimati', SUMMER)).toBe(840);
    expect(offsetMinutesAt('America/St_Johns', SUMMER)).toBe(-150);
  });

  it('reads the Etc ocean zones with their inverted sign convention', () => {
    expect(offsetMinutesAt('Etc/GMT+12', SUMMER)).toBe(-720);
  });

  it('is exact at a DST transition instant', () => {
    // US DST ends 2026-11-01 at 06:00Z (02:00 EDT → 01:00 EST).
    expect(offsetMinutesAt('America/New_York', Date.UTC(2026, 10, 1, 5, 59, 59))).toBe(-240);
    expect(offsetMinutesAt('America/New_York', Date.UTC(2026, 10, 1, 6, 0, 0))).toBe(-300);
  });
});

describe('readZone', () => {
  it('reads a clock with DST, abbreviation and weekday', () => {
    const r = readZone(clock('America/New_York'), SUMMER);
    expect(r.hhmmss).toBe('09:40:05');
    expect(r.weekday).toBe('Wed');
    expect(r.offsetMin).toBe(-240);
    expect(r.offsetLabel).toBe('UTC-4');
    expect(r.abbr).toBe('EDT');
    expect(r.isDst).toBe(true);
  });

  it('flags standard time as not DST', () => {
    const r = readZone(clock('America/New_York'), WINTER);
    expect(r.hhmmss).toBe('08:40:05');
    expect(r.offsetLabel).toBe('UTC-5');
    expect(r.abbr).toBe('EST');
    expect(r.isDst).toBe(false);
  });

  it('never flags a zone without DST', () => {
    expect(readZone(clock('America/Phoenix'), SUMMER).isDst).toBe(false);
    expect(readZone(clock('Asia/Tokyo'), SUMMER).isDst).toBe(false);
  });

  it('crosses the date line correctly', () => {
    const r = readZone(clock('Pacific/Kiritimati'), SUMMER);
    expect(r.hhmmss).toBe('03:40:05');
    expect(r.weekday).toBe('Thu');
    expect(r.offsetLabel).toBe('UTC+14');
    const w = readZone(clock('Etc/GMT+12'), SUMMER);
    expect(w.hhmmss).toBe('01:40:05');
    expect(w.offsetLabel).toBe('UTC-12');
  });

  it('reports the day relative to the viewer\'s own calendar date', () => {
    // The viewer's date comes from the process time zone; derive the expectation
    // from the same source so the test holds in any TZ.
    const local = new Date(SUMMER);
    const localDay = Date.UTC(local.getFullYear(), local.getMonth(), local.getDate());
    const expectFor = (zoneDay: number) => Math.round((zoneDay - localDay) / 86_400_000);
    expect(readZone(clock('Pacific/Kiritimati'), SUMMER).dayOffset).toBe(expectFor(Date.UTC(2026, 8, 17)));
    expect(readZone(clock('Etc/GMT+12'), SUMMER).dayOffset).toBe(expectFor(Date.UTC(2026, 8, 16)));
    expect(
      readZone(clock('Pacific/Kiritimati'), SUMMER).dayOffset - readZone(clock('Etc/GMT+12'), SUMMER).dayOffset
    ).toBe(1);
  });

  it('never prints a 24th hour', () => {
    // 04:00Z is exactly midnight in New York during DST.
    const r = readZone(clock('America/New_York'), Date.UTC(2026, 8, 16, 4, 0, 0));
    expect(r.hhmmss).toBe('00:00:00');
  });

  it('is unaffected by sub-second jitter', () => {
    const a = readZone(clock('Europe/London'), SUMMER);
    const b = readZone(clock('Europe/London'), SUMMER + 499);
    expect(a).toEqual(b);
  });
});

describe('zoneAbbreviation', () => {
  it('finds English abbreviations from whichever locale knows them', () => {
    expect(zoneAbbreviation('Europe/London', SUMMER, 60)).toBe('BST');
    expect(zoneAbbreviation('Europe/Paris', SUMMER, 120)).toBe('CEST');
    expect(zoneAbbreviation('Australia/Sydney', SUMMER, 600)).toBe('AEST');
    expect(zoneAbbreviation('Pacific/Auckland', SUMMER, 720)).toBe('NZST');
    expect(zoneAbbreviation('Asia/Kolkata', SUMMER, 330)).toBe('IST');
    expect(zoneAbbreviation('America/Los_Angeles', SUMMER, -420)).toBe('PDT');
  });

  it('returns null rather than a numeric GMT+n style name', () => {
    expect(zoneAbbreviation('Asia/Kathmandu', SUMMER, 345)).toBeNull();
    expect(zoneAbbreviation('Asia/Tokyo', SUMMER, 540)).toBeNull();
    expect(zoneAbbreviation('Etc/GMT+12', SUMMER, -720)).toBeNull();
  });

  it('drops a bare GMT/UTC because the offset label already says it', () => {
    expect(zoneAbbreviation('Europe/London', WINTER, 0)).toBeNull();
  });
});

describe('formatZoneDate', () => {
  it('formats the date in the zone', () => {
    expect(formatZoneDate(clock('Pacific/Kiritimati'), SUMMER)).toBe('Thursday, September 17, 2026');
    expect(formatZoneDate(clock('Etc/GMT+12'), SUMMER)).toBe('Wednesday, September 16, 2026');
  });
});

describe('zoneLongName', () => {
  it('gives the long English name where ICU has one', () => {
    expect(zoneLongName('America/New_York', SUMMER, -240)).toBe('Eastern Daylight Time');
    expect(zoneLongName('America/New_York', WINTER, -300)).toBe('Eastern Standard Time');
    expect(zoneLongName('Asia/Kathmandu', SUMMER, 345)).toBe('Nepal Time');
  });

  it('returns null rather than a numeric name', () => {
    expect(zoneLongName('Etc/GMT-14', SUMMER, 840)).toBeNull();
  });
});

describe('captionFor', () => {
  const base = { hhmmss: '09:40:05', weekday: 'Wed', offsetMin: -240, offsetLabel: 'UTC-4', isDst: true };

  it('shows the offset and the abbreviation when there is one', () => {
    expect(captionFor({ ...base, dayOffset: 0, abbr: 'EDT' })).toBe('UTC-4 · EDT');
    expect(captionFor({ ...base, dayOffset: 0, abbr: null })).toBe('UTC-4');
  });

  it('appends a fixed-width day marker when the zone is on a different day', () => {
    expect(captionFor({ ...base, dayOffset: 1, abbr: null, offsetLabel: 'UTC+14' })).toBe('UTC+14 · +1d');
    expect(captionFor({ ...base, dayOffset: -1, abbr: null, offsetLabel: 'UTC-12' })).toBe('UTC-12 · -1d');
    expect(captionFor({ ...base, dayOffset: 1, abbr: 'NZDT', offsetLabel: 'UTC+13' })).toBe('UTC+13 · NZDT · +1d');
  });
});
