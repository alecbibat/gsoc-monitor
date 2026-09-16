// "What time is it in this zone?" — shared by the globe labels, the click
// panel and the unit tests so all three agree. Pure TypeScript: no Cesium, no
// React, no module-level Date.now() so the tests can pin the instant.
//
// Natural Earth's time-zone polygons are offset *bands* (one polygon per UTC
// offset per region), each tagged with a representative IANA zone name
// (`tz_name1st`) for the most notable place inside it. Where that name is a
// real tz database entry we follow it, which gives daylight-saving-aware time
// and survives the dataset's stale offsets (it still has Moscow at +4, a
// decade after Russia moved to +3). Where it is missing or malformed (the
// Arctic Ocean slivers, most Antarctic wedges, "Antarctica/" with nothing
// after the slash) we fall back to the band's fixed nominal offset.

export interface ZoneClock {
  /** Stable identity: the IANA name, or `fixed:<minutes>` for offset-only zones. */
  key: string;
  /** IANA zone the clock follows (DST-aware), or null when only an offset is known. */
  iana: string | null;
  /** Nominal band offset in minutes east of UTC; the whole story for fixed clocks. */
  fixedOffsetMin: number;
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

// ── IANA validity ────────────────────────────────────────────────────────────

const validityCache = new Map<string, boolean>();

/** True when `Intl` accepts the name as a time zone (so `Antarctica/` → false). */
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

// ── Nominal offset from the Natural Earth properties ─────────────────────────

/** "UTC+05:45" / "UTC-03:30" / "UTC±00:00" → hours east of UTC. */
export function parseUtcFormat(raw: unknown): number | null {
  if (typeof raw !== 'string') return null;
  const m = raw.trim().match(/^UTC\s*([+\-±−])\s*(\d{1,2})(?::(\d{2}))?$/i);
  if (!m) return null;
  const sign = m[1] === '-' || m[1] === '−' ? -1 : 1;
  const hours = parseInt(m[2], 10) + (m[3] ? parseInt(m[3], 10) / MIN_PER_HOUR : 0);
  return sign * hours;
}

/** "+1" / "-3.5" / "0" / 5.75 → hours east of UTC. */
export function parseSignedHours(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== 'string') return null;
  const m = raw.trim().match(/^([+\-−]?)(\d{1,2}(?:[.,]\d+)?)$/);
  if (!m) return null;
  const v = parseFloat(m[2].replace(',', '.'));
  return m[1] === '-' || m[1] === '−' ? -v : v;
}

/**
 * Nominal band offset in hours from a Natural Earth feature's properties.
 *
 * `zone` is the canonical numeric field, but the dataset has at least one
 * feature (Neumayer Station) where `zone` says +6 while `name` and
 * `utc_format` both say +1 — so when the two textual fields agree with each
 * other and disagree with `zone`, they win.
 */
export function nominalOffsetFromProps(props: Record<string, unknown>): number | null {
  const zone = parseSignedHours(props['zone'] ?? props['Zone'] ?? props['ZONE']);
  const name = parseSignedHours(props['name'] ?? props['NAME']);
  const fmt =
    parseUtcFormat(props['utc_format'] ?? props['UTC_FORMAT']) ??
    parseUtcFormat(props['time_zone'] ?? props['TIME_ZONE']);

  const votes = [zone, name, fmt].filter((v): v is number => v !== null);
  if (votes.length === 0) return null;
  if (zone === null) return votes[0];
  if (name !== null && fmt !== null && name === fmt && zone !== name) return name;
  return zone;
}

// ── Representative zone fixes ────────────────────────────────────────────────
//
// Natural Earth's `tz_name1st` is the zone of the most notable place in the
// band as of ~2012. Where a place has since left the band, following it would
// put the wrong clock on everything that stayed. Keep this list tiny and
// evidence-based: each entry names the band (nominal offset + the field that
// identifies it) and the zone that still matches what the band covers.
interface RepresentativeFix {
  nominalHours: number;
  /** Match on the band's tz_name1st … */
  iana?: string;
  /** … or, for bands without one, on its `places` text. */
  places?: string;
  use: string;
  why: string;
}
const REPRESENTATIVE_FIXES: RepresentativeFix[] = [
  {
    nominalHours: 7,
    iana: 'Asia/Omsk',
    use: 'Asia/Novosibirsk',
    why: 'Omsk moved to UTC+6 in 2016; the band is Novosibirsk Oblast and western Mongolia, both still UTC+7.',
  },
  {
    nominalHours: 11,
    places: 'Russia (Primorsky Krai)',
    use: 'Asia/Vladivostok',
    why: 'The band has no zone name; Primorsky Krai has been UTC+10 (Vladivostok) since 2014, not the nominal +11.',
  },
];

/**
 * The IANA zone a band's clock should follow, after the fixes above; null
 * when the band has no usable zone and must run on its fixed offset.
 */
export function representativeZone(
  nominalHours: number,
  ianaName: string | null | undefined,
  places: string | null | undefined
): string | null {
  for (const fix of REPRESENTATIVE_FIXES) {
    if (fix.nominalHours !== nominalHours) continue;
    if (fix.iana !== undefined && fix.iana === ianaName) return fix.use;
    if (fix.places !== undefined && fix.places === places?.trim()) return fix.use;
  }
  return isValidTimeZone(ianaName) ? ianaName : null;
}

// ── Naming the clock ─────────────────────────────────────────────────────────

// Segments whose underscore-to-space spelling still reads wrong.
const CITY_SPELLINGS: Record<string, string> = {
  DumontDUrville: "Dumont d'Urville",
  St_Johns: "St. John's",
  Sao_Paulo: 'São Paulo',
};

/** "America/New_York" → "New York"; "Antarctica/South_Pole" → "South Pole". */
export function zoneCityName(iana: string): string {
  const seg = iana.slice(iana.lastIndexOf('/') + 1);
  return CITY_SPELLINGS[seg] ?? seg.replace(/_/g, ' ');
}

const MAX_PLACE_LABEL = 20;
// Ocean and ice bands: naming them adds width, not information.
const GENERIC_PLACES = new Set(['Arctic Ocean', 'Southern Ocean', 'Pacific Ocean', 'Antarctica', 'Siberia']);

/**
 * A short place name for a band that has no zone of its own, from Natural
 * Earth's `places` text: "United States (Aleutian Islands)" → "Aleutian
 * Islands", "Tajikistan" → "Tajikistan". Lists of several places, and long
 * names, give null (the caption then shows the offset alone).
 */
export function shortPlaceName(places: string | null | undefined): string | null {
  if (!places) return null;
  const s = places.trim();
  if (!s || s.includes(',')) return null;
  const paren = /\(([^)]+)\)/.exec(s);
  const name = (paren ? paren[1] : s).trim();
  if (!name || name.length > MAX_PLACE_LABEL || GENERIC_PLACES.has(name)) return null;
  return name;
}

// ── Clock resolution ─────────────────────────────────────────────────────────

export function resolveZoneClock(nominalOffsetHours: number, ianaName?: string | null): ZoneClock {
  const fixedOffsetMin = Math.round(nominalOffsetHours * MIN_PER_HOUR);
  const iana = isValidTimeZone(ianaName) ? ianaName : null;
  return {
    key: iana ?? `fixed:${fixedOffsetMin}`,
    iana,
    fixedOffsetMin,
  };
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
// and the labels read every zone every second).
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

/** Effective offset (minutes east of UTC) of an IANA zone at an instant. */
export function offsetMinutesAt(timeZone: string, nowMs: number): number {
  const wholeSecond = Math.floor(nowMs / 1000) * 1000;
  const w = wallClockIn(timeZone, new Date(wholeSecond));
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  return Math.round((asUtc - wholeSecond) / MS_PER_MIN);
}

// Standard (non-DST) offset per zone and calendar year: the smaller of the
// offsets in force on 1 January and 1 July. DST only ever adds, so whichever
// half-year is lower is standard time in either hemisphere.
const standardOffsetCache = new Map<string, number>();
function standardOffsetMin(timeZone: string, year: number): number {
  const key = `${timeZone}|${year}`;
  const cached = standardOffsetCache.get(key);
  if (cached !== undefined) return cached;
  const jan = offsetMinutesAt(timeZone, Date.UTC(year, 0, 1, 12));
  const jul = offsetMinutesAt(timeZone, Date.UTC(year, 6, 1, 12));
  const std = Math.min(jan, jul);
  standardOffsetCache.set(key, std);
  return std;
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

const MS_PER_DAY = 86_400_000;

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
  if (clock.iana) {
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
      isDst: offsetMin > standardOffsetMin(clock.iana, w.year),
    };
  }

  const w = wallClockIn('UTC', new Date(nowMs + clock.fixedOffsetMin * MS_PER_MIN));
  return {
    hhmmss: `${pad2(w.hour)}:${pad2(w.minute)}:${pad2(w.second)}`,
    weekday: w.weekday,
    dayOffset: dayOffsetFrom(w, nowMs),
    offsetMin: clock.fixedOffsetMin,
    offsetLabel: formatOffsetLabel(clock.fixedOffsetMin),
    abbr: null,
    isDst: false,
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
  const name = /^[A-Za-z][A-Za-z .'-]+$/.test(v) ? v : null;
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
  if (clock.iana) return dateFormatter(clock.iana).format(new Date(nowMs));
  return dateFormatter('UTC').format(new Date(nowMs + clock.fixedOffsetMin * MS_PER_MIN));
}

// ── Map caption ──────────────────────────────────────────────────────────────

/**
 * Caption under the time: whose clock it is and its offset — "New York ·
 * UTC-4", or just "UTC-11" for a band with no named place — with a fixed-width
 * day marker when that zone's date differs from the viewer's own ("Kiritimati
 * · UTC+14 · +1d") so a glance shows the date line has been crossed. The DST
 * abbreviation deliberately stays off the map: it belongs to the
 * representative place, not to every spot in the band.
 */
export function captionFor(reading: ZoneReading, place: string | null = null): string {
  const parts: string[] = [];
  if (place) parts.push(place);
  parts.push(reading.offsetLabel);
  if (reading.dayOffset > 0) parts.push(`+${reading.dayOffset}d`);
  else if (reading.dayOffset < 0) parts.push(`${reading.dayOffset}d`);
  return parts.join(' · ');
}
