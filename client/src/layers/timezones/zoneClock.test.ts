import { describe, expect, it } from 'vitest';
import {
  captionFor,
  formatOffsetLabel,
  formatZoneDate,
  isValidTimeZone,
  nominalOffsetFromProps,
  offsetMinutesAt,
  parseSignedHours,
  parseUtcFormat,
  readZone,
  representativeZone,
  resolveZoneClock,
  shortPlaceName,
  zoneAbbreviation,
  zoneCityName,
  zoneLongName,
} from './zoneClock';

// A fixed instant so every expectation is deterministic: 2026-09-16 13:40:05.5Z
// (northern-hemisphere summer, southern-hemisphere winter).
const SUMMER = Date.UTC(2026, 8, 16, 13, 40, 5, 500);
// 2026-01-16 13:40:05Z — the other half of the year.
const WINTER = Date.UTC(2026, 0, 16, 13, 40, 5);

describe('isValidTimeZone', () => {
  it('accepts real zones and tz database links', () => {
    expect(isValidTimeZone('America/New_York')).toBe(true);
    expect(isValidTimeZone('Asia/Rangoon')).toBe(true); // link → Asia/Yangon
    expect(isValidTimeZone('Pacific/Enderbury')).toBe(true); // link → Pacific/Kanton
    expect(isValidTimeZone('Antarctica/South_Pole')).toBe(true);
  });

  it('rejects the malformed names Natural Earth ships', () => {
    expect(isValidTimeZone('Antarctica/')).toBe(false);
    expect(isValidTimeZone('Antarctica/Central')).toBe(false);
    expect(isValidTimeZone('Antarctica/Mirny')).toBe(false);
    expect(isValidTimeZone('')).toBe(false);
    expect(isValidTimeZone(null)).toBe(false);
    expect(isValidTimeZone(undefined)).toBe(false);
  });
});

describe('offset parsing', () => {
  it('reads utc_format strings including half and quarter hours', () => {
    expect(parseUtcFormat('UTC+05:45')).toBe(5.75);
    expect(parseUtcFormat('UTC-03:30')).toBe(-3.5);
    expect(parseUtcFormat('UTC+12:45')).toBe(12.75);
    expect(parseUtcFormat('UTC±00:00')).toBe(0);
    expect(parseUtcFormat('UTC+14:00')).toBe(14);
    expect(parseUtcFormat('nonsense')).toBeNull();
    expect(parseUtcFormat(5)).toBeNull();
  });

  it('reads signed hour strings and numbers', () => {
    expect(parseSignedHours('+1')).toBe(1);
    expect(parseSignedHours('-3.5')).toBe(-3.5);
    expect(parseSignedHours('0')).toBe(0);
    expect(parseSignedHours(5.75)).toBe(5.75);
    expect(parseSignedHours('-9,5')).toBe(-9.5);
    expect(parseSignedHours('UTC+1')).toBeNull();
    expect(parseSignedHours(NaN)).toBeNull();
  });
});

describe('nominalOffsetFromProps', () => {
  it('uses zone when the fields agree', () => {
    expect(nominalOffsetFromProps({ zone: -3.5, name: '-3.5', utc_format: 'UTC-03:30' })).toBe(-3.5);
    expect(nominalOffsetFromProps({ zone: 5.75, name: '+5.75', utc_format: 'UTC+05:45' })).toBe(5.75);
  });

  it('lets name + utc_format outvote a wrong zone (the Neumayer Station glitch)', () => {
    expect(nominalOffsetFromProps({ zone: 6, name: '+1', utc_format: 'UTC+01:00' })).toBe(1);
  });

  it('keeps zone when only one other field disagrees (the Kamchatka -180..-169 polygon)', () => {
    expect(nominalOffsetFromProps({ zone: 12, name: '+12', utc_format: 'UTC-12:00' })).toBe(12);
    expect(nominalOffsetFromProps({ zone: 6, name: '+1', utc_format: 'UTC+06:00' })).toBe(6);
    expect(nominalOffsetFromProps({ zone: 6, name: '+6', utc_format: 'UTC+01:00' })).toBe(6);
  });

  it('falls back to whatever is parseable', () => {
    expect(nominalOffsetFromProps({ utc_format: 'UTC+09:30' })).toBe(9.5);
    expect(nominalOffsetFromProps({ time_zone: 'UTC-11:00' })).toBe(-11);
    expect(nominalOffsetFromProps({})).toBeNull();
  });
});

describe('representativeZone', () => {
  it('passes a valid name through and drops malformed ones', () => {
    expect(representativeZone(-5, 'America/New_York', 'Colombia, Cuba')).toBe('America/New_York');
    expect(representativeZone(12, 'Antarctica/', 'Antarctica')).toBeNull();
    expect(representativeZone(-11, null, 'Arctic Ocean')).toBeNull();
  });

  it('replaces Omsk for the +7 band it no longer belongs to', () => {
    expect(representativeZone(7, 'Asia/Omsk', 'Russia (Novosibirsk Oblast), Mongolia (western part)')).toBe(
      'Asia/Novosibirsk'
    );
    // Only that band: an Omsk-named +6 band would keep Omsk.
    expect(representativeZone(6, 'Asia/Omsk', null)).toBe('Asia/Omsk');
  });

  it('gives the nameless Primorsky band a Vladivostok clock', () => {
    expect(representativeZone(11, null, 'Russia (Primorsky Krai)')).toBe('Asia/Vladivostok');
    expect(representativeZone(11, null, 'Antarctica')).toBeNull();
  });
});

describe('naming', () => {
  it('turns zone names into place names', () => {
    expect(zoneCityName('America/New_York')).toBe('New York');
    expect(zoneCityName('Antarctica/South_Pole')).toBe('South Pole');
    expect(zoneCityName('Antarctica/DumontDUrville')).toBe("Dumont d'Urville");
    expect(zoneCityName('America/St_Johns')).toBe("St. John's");
    expect(zoneCityName('Asia/Tokyo')).toBe('Tokyo');
  });

  it('shortens single-place bands and skips lists and long names', () => {
    expect(shortPlaceName('United States (Aleutian Islands)')).toBe('Aleutian Islands');
    expect(shortPlaceName('Tajikistan')).toBe('Tajikistan');
    expect(shortPlaceName('American Samoa, Niue')).toBeNull();
    expect(shortPlaceName('Arctic Ocean')).toBeNull();
    expect(shortPlaceName('Antarctica')).toBeNull();
    expect(shortPlaceName('French Southern and Antarctic Lands')).toBeNull();
    expect(shortPlaceName(null)).toBeNull();
    expect(shortPlaceName('')).toBeNull();
  });
});

describe('resolveZoneClock', () => {
  it('follows a valid IANA name', () => {
    const c = resolveZoneClock(-5, 'America/New_York');
    expect(c).toEqual({ key: 'America/New_York', iana: 'America/New_York', fixedOffsetMin: -300 });
  });

  it('falls back to a fixed offset for missing or malformed names', () => {
    expect(resolveZoneClock(-11, null)).toEqual({ key: 'fixed:-660', iana: null, fixedOffsetMin: -660 });
    expect(resolveZoneClock(12, 'Antarctica/')).toEqual({ key: 'fixed:720', iana: null, fixedOffsetMin: 720 });
    expect(resolveZoneClock(5.75, '')).toEqual({ key: 'fixed:345', iana: null, fixedOffsetMin: 345 });
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

  it('follows the tz database rather than the stale Natural Earth offsets', () => {
    expect(offsetMinutesAt('Europe/Moscow', SUMMER)).toBe(180); // NE still says +4
    expect(offsetMinutesAt('America/Caracas', SUMMER)).toBe(-240); // NE still says -4:30
  });
});

describe('readZone', () => {
  it('reads an IANA clock with DST, abbreviation and weekday', () => {
    const r = readZone(resolveZoneClock(-5, 'America/New_York'), SUMMER);
    expect(r.hhmmss).toBe('09:40:05');
    expect(r.weekday).toBe('Wed');
    expect(r.offsetMin).toBe(-240);
    expect(r.offsetLabel).toBe('UTC-4');
    expect(r.abbr).toBe('EDT');
    expect(r.isDst).toBe(true);
  });

  it('flags standard time as not DST', () => {
    const r = readZone(resolveZoneClock(-5, 'America/New_York'), WINTER);
    expect(r.hhmmss).toBe('08:40:05');
    expect(r.offsetLabel).toBe('UTC-5');
    expect(r.abbr).toBe('EST');
    expect(r.isDst).toBe(false);
  });

  it('crosses the date line correctly', () => {
    const r = readZone(resolveZoneClock(14, 'Pacific/Kiritimati'), SUMMER);
    expect(r.hhmmss).toBe('03:40:05');
    expect(r.weekday).toBe('Thu');
    expect(r.offsetLabel).toBe('UTC+14');
  });

  it('reports the day relative to the viewer\'s own calendar date', () => {
    // The viewer's date comes from the process time zone; derive the expectation
    // from the same source so the test holds in any TZ.
    const local = new Date(SUMMER);
    const localDay = Date.UTC(local.getFullYear(), local.getMonth(), local.getDate());
    const expectFor = (zoneDay: number) => Math.round((zoneDay - localDay) / 86_400_000);
    // Kiritimati is on the 17th at 03:40; UTC-11 is on the 16th at 02:40.
    expect(readZone(resolveZoneClock(14, 'Pacific/Kiritimati'), SUMMER).dayOffset).toBe(
      expectFor(Date.UTC(2026, 8, 17))
    );
    expect(readZone(resolveZoneClock(-11, null), SUMMER).dayOffset).toBe(expectFor(Date.UTC(2026, 8, 16)));
    // Same instant seen from two zones a day apart differ by exactly one day.
    expect(
      readZone(resolveZoneClock(14, 'Pacific/Kiritimati'), SUMMER).dayOffset -
        readZone(resolveZoneClock(-11, null), SUMMER).dayOffset
    ).toBe(1);
  });

  it('reads a fixed-offset clock, including fractional and negative offsets', () => {
    expect(readZone(resolveZoneClock(-11, null), SUMMER)).toEqual({
      hhmmss: '02:40:05',
      weekday: 'Wed',
      dayOffset: 0,
      offsetMin: -660,
      offsetLabel: 'UTC-11',
      abbr: null,
      isDst: false,
    });
    const nepal = readZone(resolveZoneClock(5.75, 'Antarctica/'), SUMMER);
    expect(nepal.hhmmss).toBe('19:25:05');
    expect(nepal.offsetLabel).toBe('UTC+5:45');
  });

  it('never prints a 24th hour', () => {
    // 04:00Z is exactly midnight in New York during DST.
    const r = readZone(resolveZoneClock(-5, 'America/New_York'), Date.UTC(2026, 8, 16, 4, 0, 0));
    expect(r.hhmmss).toBe('00:00:00');
    const f = readZone(resolveZoneClock(-4, null), Date.UTC(2026, 8, 16, 4, 0, 0));
    expect(f.hhmmss).toBe('00:00:00');
  });

  it('is unaffected by sub-second jitter', () => {
    const a = readZone(resolveZoneClock(0, 'Europe/London'), SUMMER);
    const b = readZone(resolveZoneClock(0, 'Europe/London'), SUMMER + 499);
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
  });

  it('drops a bare GMT/UTC because the offset label already says it', () => {
    expect(zoneAbbreviation('Europe/London', WINTER, 0)).toBeNull();
  });
});

describe('formatZoneDate', () => {
  it('formats the date in the zone', () => {
    expect(formatZoneDate(resolveZoneClock(14, 'Pacific/Kiritimati'), SUMMER)).toBe(
      'Thursday, September 17, 2026'
    );
    expect(formatZoneDate(resolveZoneClock(-11, null), SUMMER)).toBe('Wednesday, September 16, 2026');
  });
});

describe('captionFor', () => {
  const base = { hhmmss: '09:40:05', weekday: 'Wed', offsetMin: -240, offsetLabel: 'UTC-4', isDst: true };

  it('names the place and the offset on the viewer\'s own day, never the abbreviation', () => {
    expect(captionFor({ ...base, dayOffset: 0, abbr: 'EDT' }, 'New York')).toBe('New York · UTC-4');
    expect(captionFor({ ...base, dayOffset: 0, abbr: null }, null)).toBe('UTC-4');
    expect(captionFor({ ...base, dayOffset: 0, abbr: null })).toBe('UTC-4');
  });

  it('appends a fixed-width day marker when the zone is on a different day', () => {
    expect(captionFor({ ...base, dayOffset: 1, abbr: null, offsetLabel: 'UTC+14' }, 'Kiritimati')).toBe(
      'Kiritimati · UTC+14 · +1d'
    );
    expect(captionFor({ ...base, dayOffset: -1, abbr: null, offsetLabel: 'UTC-11' })).toBe('UTC-11 · -1d');
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
