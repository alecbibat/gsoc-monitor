// Coordinates typed or pasted into the search box, in the forms people copy
// them in: decimal pairs ("40.6892, -74.0445"), hemisphere letters
// ("40.6892 N, 74.0445 W"), degrees-minutes-seconds as Google Maps shows them
// (40°41'21.3"N 74°02'40.2"W), and map links (Google, Apple, OpenStreetMap,
// Yandex, geo: URIs). Pure, so the search box can answer instantly without a
// geocoder round trip. Anything that could as well be a postal code or a
// street address ("111 22", "7 11", "15 S 100 E") is left to the geocoder.

export interface LatLon {
  lat: number;
  lon: number;
}

const NUM = String.raw`-?\d+(?:\.\d+)?`;

function inRange(lat: number, lon: number): LatLon | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

// A comma between two numbers in a URL, however it was encoded: ",", "%2C",
// and the "+" / "%20" an encoded "lat, lon" space becomes.
const SEP = String.raw`(?:,|%2C)(?:\s|\+|%20)*`;

// Map links carry the point in the URL; the first pattern that matches wins,
// so the place itself comes before a view centre. Google: !3d…!4d… is the
// dropped place, a lat,lon path segment is the searched point (the last one,
// for a directions link: its destination), @lat,lon is only the view centre.
const URL_PATTERNS: RegExp[] = [
  new RegExp(String.raw`!3d(${NUM})!4d(${NUM})`),
  new RegExp(String.raw`/maps/(?:search|place|dir)/(?:[^?#@]*/)?(${NUM})${SEP}(${NUM})/?(?:[?#@]|$)`),
  new RegExp(String.raw`[?&]mlat=(${NUM})&mlon=(${NUM})`, 'i'),
  new RegExp(String.raw`[?&](?:q|query|ll|sll|center|coordinate|destination|daddr)=(?:loc:)?(${NUM})${SEP}(${NUM})`, 'i'),
  new RegExp(String.raw`^geo:(${NUM}),(${NUM})`, 'i'),
  new RegExp(String.raw`#map=\d+(?:\.\d+)?/(${NUM})/(${NUM})`),
  new RegExp(String.raw`@(${NUM}),(${NUM})`),
];

// Yandex writes its points longitude first (ll=37.6173,55.7558 is Moscow).
const YANDEX_RE = new RegExp(String.raw`^(?:https?://)?(?:www\.|maps\.)?yandex\.[a-z.]+/.*[?&](?:pt|ll)=(${NUM})${SEP}(${NUM})`, 'i');

function parseMapUrl(s: string): LatLon | null {
  if (!/^(?:https?:\/\/|www\.|maps\.|geo:)/i.test(s)) return null;
  const yandex = s.match(YANDEX_RE);
  if (yandex) return inRange(Number(yandex[2]), Number(yandex[1]));
  for (const re of URL_PATTERNS) {
    const m = s.match(re);
    if (m) return inRange(Number(m[1]), Number(m[2]));
  }
  return null;
}

/**
 * One coordinate's value from its number groups: decimal degrees, or degrees
 * with minutes (and seconds). Null for anything that isn't a well-formed angle.
 */
function angle(text: string): number | null {
  // A sign, if any, leads the component and appears once.
  if (!/^\s*[+-]?[^+-]*$/.test(text)) return null;
  const nums = text.match(/\d+(?:\.\d+)?/g);
  if (!nums || nums.length > 3) return null;
  // Only the last group may carry a fraction: 40.5°30' isn't an angle.
  if (nums.slice(0, -1).some((n) => n.includes('.'))) return null;
  const [d, m = 0, s = 0] = nums.map(Number);
  if (m >= 60 || s >= 60) return null;
  const v = d + m / 60 + s / 3600;
  return /^\s*-/.test(text) ? -v : v;
}

// A bare whole number — no fraction, degree mark or minutes — reads as well
// as a house number or postal code as it does an angle.
const BARE_INT_RE = /^\s*[+-]?\d+\s*$/;

/** Splits around hemisphere letters: "40 41 21 N 74 2 40 W", "N40.5 W74.1". */
function parseHemispheres(t: string): LatLon | null {
  const letters = t.match(/[NSEW]/g);
  if (!letters || letters.length !== 2) return null;
  const prefix = /^[NSEW]/.test(t);
  if (!prefix && !/[NSEW]$/.test(t)) return null;
  const parts = prefix
    ? t.match(/^([NSEW][^NSEW]+)([NSEW][^NSEW]+)$/)
    : t.match(/^([^NSEW]+[NSEW])([^NSEW]+[NSEW])$/);
  if (!parts) return null;
  let lat: number | null = null;
  let lon: number | null = null;
  const bodies = [parts[1], parts[2]].map((part) => part.replace(/[NSEW]/, '').replace(/^[\s,;]+|[\s,;]+$/g, ''));
  // "15 S 100 E" is a Utah street address, not a point in the Indian Ocean.
  if (bodies.every((b) => BARE_INT_RE.test(b))) return null;
  for (const [i, part] of [parts[1], parts[2]].entries()) {
    const letter = part.match(/[NSEW]/)![0];
    // The letter is the sign; "-40 N" contradicts itself.
    const body = bodies[i];
    if (/[+-]/.test(body)) return null;
    const v = angle(body);
    if (v === null) return null;
    if (letter === 'N' || letter === 'S') {
      if (lat !== null) return null;
      lat = letter === 'S' ? -v : v;
    } else {
      if (lon !== null) return null;
      lon = letter === 'W' ? -v : v;
    }
  }
  return lat === null || lon === null ? null : inRange(lat, lon);
}

/** Two signed angles, latitude first: split on a comma/semicolon, else on the gap between them. */
function parseSignedPair(t: string): LatLon | null {
  let parts: string[] | null = null;
  const bySep = t.split(/[,;]/);
  if (bySep.length === 2) {
    parts = bySep;
  } else if (bySep.length === 1) {
    // No separator: either two decimal numbers, or two marked angles
    // (40°41'21" -74°2'40") whose units show where one ends. Two whole
    // numbers ("111 22", "7 11") are a postal code or a name, not a point.
    const bare = t.trim().split(/\s+/);
    if (bare.length === 2 && bare.every((b) => /^[+-]?\d+(?:\.\d+°?|°)$/.test(b))) {
      parts = bare;
    } else {
      const marked = t.match(
        /^\s*([+-]?\d+(?:\.\d+)?°(?:\s*\d+(?:\.\d+)?'(?:\s*\d+(?:\.\d+)?")?)?)\s+([+-]?\d+(?:\.\d+)?°(?:\s*\d+(?:\.\d+)?'(?:\s*\d+(?:\.\d+)?")?)?)\s*$/
      );
      if (marked) parts = [marked[1], marked[2]];
    }
  }
  if (!parts) return null;
  const a = angle(parts[0]);
  const b = angle(parts[1]);
  if (a === null || b === null) return null;
  // Latitude first, Google's order. Only when the first value can't be a
  // latitude is the pair taken as longitude-first (GeoJSON's "-122.34, 47.61");
  // a longitude-first pair whose longitude is under 90° can't be told apart
  // and reads latitude-first.
  if (Math.abs(a) > 90 && Math.abs(b) <= 90) return inRange(b, a);
  return inRange(a, b);
}

export function parseCoordinates(input: string): LatLon | null {
  const s = input.trim();
  if (!s) return null;
  const fromUrl = parseMapUrl(s);
  if (fromUrl) return fromUrl;

  const t = s
    .toUpperCase()
    // Typographic minus signs and dashes (Word, PDFs, Wikipedia) are minus.
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .replace(/[′’‘´`]/g, "'")
    .replace(/[″”“]/g, '"')
    .replace(/''/g, '"')
    .replace(/[º˚]/g, '°')
    // One pair of enclosing brackets, as LatLng.toString() prints them.
    .replace(/^\(([^()]*)\)$|^\[([^[\]]*)\]$/, '$1$2')
    .trim();
  // Digits, signs, separators, unit marks and hemisphere letters only — so
  // "Route 66" or "I-95 N" go to the geocoder instead.
  if (!/^[\d\s.,;°'"+\-NSEW]+$/.test(t) || !/\d/.test(t)) return null;
  return /[NSEW]/.test(t) ? parseHemispheres(t) : parseSignedPair(t);
}

/** "40.68925, -74.04450" — five decimals is about a metre. */
export function formatLatLon({ lat, lon }: LatLon): string {
  return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
}
