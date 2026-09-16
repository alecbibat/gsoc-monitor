// "What time is it in this zone?" — shared by the globe labels, the click
// panel and the unit tests so all three agree. Pure TypeScript: no Cesium, no
// React, no module-level Date.now() so the tests can pin the instant.
//
// Every zone polygon carries a tz database name (America/New_York,
// Etc/GMT+12 …), and the browser's own copy of the tz database — reached
// through Intl.DateTimeFormat — supplies the rules, so daylight-saving
// changes and offset reforms need no data update on our side.

export interface ZoneClock {
  /** Stable identity: the tz database name. */
  key: string;
  /** The zone the clock follows. */
  iana: string;
}

export interface ZoneReading {
  /** "14:04:22" — always 24-hour, always zero-padded. */
  hhmmss: string;
  /** "Wed" */
  weekday: string;
  /** The zone's calendar date relative to the viewer's own: -1, 0 or +1 days. */
  dayOffset: number;
  /** Effective offset at this instant, minutes east of UTC (DST included). */
  offsetMin: number;
  /** "UTC-4", "UTC+5:45", "UTC+0" */
  offsetLabel: string;
  /** Alphabetic abbreviation when one exists in English ("EDT", "BST", "AEST"), else null. */
  abbr: string | null;
  /** True while the zone is on daylight-saving (summer) time. */
  isDst: boolean;
}

const MIN_PER_HOUR = 60;
const MS_PER_MIN = 60_000;
const MS_PER_DAY = 86_400_000;

// ── IANA validity ────────────────────────────────────────────────────────────

const validityCache = new Map<string, boolean>();

/** True when this browser's `Intl` knows the zone. */
export function isValidTimeZone(name: string | null | undefined): name is string {
  if (!name) return false;
  const cached = validityCache.get(name);
  if (cached !== undefined) return cached;
  let ok = false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: name });
    ok = true;
  } catch {
    ok = false;
  }
  validityCache.set(name, ok);
  return ok;
}

/**
 * A clock for the zone, or null when this browser's tz database doesn't
 * have it (a zone created after the browser shipped, or a malformed name).
 */
export function resolveZoneClock(ianaName: string | null | undefined): ZoneClock | null {
  return isValidTimeZone(ianaName) ? { key: ianaName, iana: ianaName } : null;
}

// ── Formatting ───────────────────────────────────────────────────────────────

export function formatOffsetLabel(offsetMin: number): string {
  const sign = offsetMin < 0 ? '-' : '+';
  const abs = Math.abs(Math.round(offsetMin));
  const h = Math.floor(abs / MIN_PER_HOUR);
  const m = abs % MIN_PER_HOUR;
  return m === 0 ? `UTC${sign}${h}` : `UTC${sign}${h}:${String(m).padStart(2, '0')}`;
}

// One parts formatter per zone (constructing Intl.DateTimeFormat costs ~50µs
// and the labels read every zone every second). Pinned to en-US: the parts
// are parsed back into numbers, which a locale with non-Latin digits or a
// non-Gregorian calendar would break.
const partsFormatters = new Map<string, Intl.DateTimeFormat>();
function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let f = partsFormatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    partsFormatters.set(timeZone, f);
  }
  return f;
}

interface WallClock {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: string;
}

function wallClockIn(timeZone: string, at: Date): WallClock {
  const out: WallClock = { year: 0, month: 0, day: 0, hour: 0, minute: 0, second: 0, weekday: '' };
  for (const p of partsFormatter(timeZone).formatToParts(at)) {
    switch (p.type) {
      case 'year': out.year = parseInt(p.value, 10); break;
      case 'month': out.month = parseInt(p.value, 10); break;
      case 'day': out.day = parseInt(p.value, 10); break;
      case 'hour': out.hour = parseInt(p.value, 10) % 24; break; // "24" guard for old engines
      case 'minute': out.minute = parseInt(p.value, 10); break;
      case 'second': out.second = parseInt(p.value, 10); break;
      case 'weekday': out.weekday = p.value; break;
    }
  }
  return out;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** Effective offset (minutes east of UTC) of a zone at an instant. */
export function offsetMinutesAt(timeZone: string, nowMs: number): number {
  const wholeSecond = Math.floor(nowMs / 1000) * 1000;
  const w = wallClockIn(timeZone, new Date(wholeSecond));
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  return Math.round((asUtc - wholeSecond) / MS_PER_MIN);
}

// Standard (non-DST) offset per zone and calendar year: the lowest offset
// that is in force for at least three of the year's mid-month samples. DST
// only ever adds, so the low offset is standard time in either hemisphere;
// the three-sample floor keeps a brief dip — Morocco's month at UTC+0 during
// Ramadan — from being mistaken for the whole year's standard time.
const standardOffsetCache = new Map<string, number>();
const MIN_STANDARD_SAMPLES = 3;
function standardOffsetMin(timeZone: string, year: number): number {
  const key = `${timeZone}|${year}`;
  const cached = standardOffsetCache.get(key);
  if (cached !== undefined) return cached;
  const counts = new Map<number, number>();
  for (let month = 0; month < 12; month++) {
    const off = offsetMinutesAt(timeZone, Date.UTC(year, month, 15, 12));
    counts.set(off, (counts.get(off) ?? 0) + 1);
  }
  let std = Infinity;
  let fallback = Infinity;
  for (const [off, n] of counts) {
    if (off < fallback) fallback = off;
    if (n >= MIN_STANDARD_SAMPLES && off < std) std = off;
  }
  const result = std === Infinity ? fallback : std;
  standardOffsetCache.set(key, result);
  return result;
}

// ICU's long name settles the question outright where it has one ("Eastern
// Daylight Time", "Central European Summer Time", "Japan Standard Time");
// only zones it names numerically fall back to the offset heuristic.
function isDaylightTime(timeZone: string, nowMs: number, offsetMin: number, year: number): boolean {
  const long = zoneLongName(timeZone, nowMs, offsetMin);
  if (long) {
    if (/Daylight|Summer/i.test(long)) return true;
    if (/Standard/i.test(long)) return false;
  }
  return offsetMin > standardOffsetMin(timeZone, year);
}

// English-speaking locales carry short names for different metazones: en-US
// knows EDT/PDT but calls London "GMT+1", en-GB knows BST/CEST/GST, en-AU and
// en-NZ know AEST/NZST/CHAST, en-IN knows IST, en-CA knows NDT. Try each and
// keep the first purely alphabetic answer; numeric "GMT+2" style is dropped
// because the offset label already says that.
const ABBR_LOCALES = ['en-US', 'en-GB', 'en-AU', 'en-NZ', 'en-IN', 'en-CA'];
const abbrFormatters = new Map<string, Intl.DateTimeFormat[]>();
const abbrCache = new Map<string, string | null>();

export function zoneAbbreviation(timeZone: string, nowMs: number, offsetMin: number): string | null {
  const key = `${timeZone}|${offsetMin}`;
  const cached = abbrCache.get(key);
  if (cached !== undefined) return cached;

  let fmts = abbrFormatters.get(timeZone);
  if (!fmts) {
    fmts = [];
    for (const locale of ABBR_LOCALES) {
      try {
        fmts.push(new Intl.DateTimeFormat(locale, { timeZone, timeZoneName: 'short' }));
      } catch {
        // A locale the engine lacks — skip it rather than lose the clock.
      }
    }
    abbrFormatters.set(timeZone, fmts);
  }

  const at = new Date(nowMs);
  let abbr: string | null = null;
  for (const f of fmts) {
    const v = f.formatToParts(at).find((p) => p.type === 'timeZoneName')?.value ?? '';
    if (/^[A-Z]{2,5}$/.test(v) && v !== 'GMT' && v !== 'UTC') {
      abbr = v;
      break;
    }
  }
  abbrCache.set(key, abbr);
  return abbr;
}

// Whole days between the zone's calendar date and the viewer's own local date
// at the same instant: +1 when it is already tomorrow there.
function dayOffsetFrom(w: WallClock, nowMs: number): number {
  const local = new Date(nowMs);
  const localDay = Date.UTC(local.getFullYear(), local.getMonth(), local.getDate());
  const zoneDay = Date.UTC(w.year, w.month - 1, w.day);
  return Math.round((zoneDay - localDay) / MS_PER_DAY);
}

/** The zone's wall-clock reading at `nowMs` (epoch milliseconds). */
export function readZone(clock: ZoneClock, nowMs: number): ZoneReading {
  const w = wallClockIn(clock.iana, new Date(nowMs));
  const wholeSecond = Math.floor(nowMs / 1000) * 1000;
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  const offsetMin = Math.round((asUtc - wholeSecond) / MS_PER_MIN);
  return {
    hhmmss: `${pad2(w.hour)}:${pad2(w.minute)}:${pad2(w.second)}`,
    weekday: w.weekday,
    dayOffset: dayOffsetFrom(w, nowMs),
    offsetMin,
    offsetLabel: formatOffsetLabel(offsetMin),
    abbr: zoneAbbreviation(clock.iana, nowMs, offsetMin),
    isDst: isDaylightTime(clock.iana, nowMs, offsetMin, w.year),
  };
}

// Long English name for the panel ("Eastern Daylight Time", "Nepal Time");
// null when ICU only has a numeric "GMT+05:45" style name.
const longNameFormatters = new Map<string, Intl.DateTimeFormat>();
const longNameCache = new Map<string, string | null>();

export function zoneLongName(timeZone: string, nowMs: number, offsetMin: number): string | null {
  const key = `${timeZone}|${offsetMin}`;
  const cached = longNameCache.get(key);
  if (cached !== undefined) return cached;
  let f = longNameFormatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'long' });
    longNameFormatters.set(timeZone, f);
  }
  const v = f.formatToParts(new Date(nowMs)).find((p) => p.type === 'timeZoneName')?.value ?? '';
  // Keep any real name ("St. Pierre & Miquelon Daylight Time"); drop the
  // numeric "GMT+05:45" style ICU uses when it has none.
  const name = v && !/^(GMT|UTC)([+\-\u2212]\d.*)?$/.test(v) ? v : null;
  longNameCache.set(key, name);
  return name;
}

// ── Dates (panel only — not needed every second for every label) ─────────────

const dateFormatters = new Map<string, Intl.DateTimeFormat>();
function dateFormatter(timeZone: string): Intl.DateTimeFormat {
  let f = dateFormatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });
    dateFormatters.set(timeZone, f);
  }
  return f;
}

/** "Wednesday, September 16, 2026" in the zone. */
export function formatZoneDate(clock: ZoneClock, nowMs: number): string {
  return dateFormatter(clock.iana).format(new Date(nowMs));
}

// ── Map caption ──────────────────────────────────────────────────────────────

/**
 * Caption under the time: the offset in force and, where English has one,
 * the daylight-saving name — "UTC-4 · EDT" — with a fixed-width day marker
 * when that zone's date differs from the viewer's own ("UTC+14 · +1d") so a
 * glance shows the date line has been crossed. Every point of a zone polygon
 * shares these, so the caption is exact for the whole shape.
 */
export function captionFor(reading: ZoneReading): string {
  const parts: string[] = [reading.offsetLabel];
  if (reading.abbr) parts.push(reading.abbr);
  if (reading.dayOffset > 0) parts.push(`+${reading.dayOffset}d`);
  else if (reading.dayOffset < 0) parts.push(`${reading.dayOffset}d`);
  return parts.join(' · ');
}
