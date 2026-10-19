import { Router } from 'express';
import { TtlCache } from '../cache';
import { config } from '../config';
import { nominatimTurn } from '../nominatimGate';

// Place search behind the top-bar search box.
//
// Photon (komoot's OpenStreetMap geocoder) answers first: it tolerates typos
// and half-typed words, indexes businesses and landmarks as well as places,
// and can prefer results near the camera — what a Google-style box needs, and
// what Nominatim's strict word matching doesn't do. Nominatim is the fallback
// when Photon is down or finds nothing, and the second opinion when Photon's
// best answer leaves part of the query unexplained (Nominatim is stronger on
// full street addresses and "City ST" forms). Nominatim's usage policy forbids
// search-as-you-type, so suggestions never reach it.
//
// Both providers are normalized to one Place shape, re-ranked by how much of
// the query each result accounts for, and given a camera-ready bounding box
// (or none, when the provider's box would frame the wrong thing).

export type PlaceKind =
  | 'country'
  | 'state'
  | 'county'
  | 'city'
  | 'locality'
  | 'street'
  | 'address'
  | 'poi'
  | 'other';

export interface Place {
  id: string;
  /** Primary label: "Pittsburgh", "Starbucks", "1600 Pennsylvania Avenue NW". */
  name: string;
  /** Where it is, most specific first: "Pennsylvania, United States". */
  context: string;
  /** What it is, for businesses and landmarks: "Cafe", "Airport". */
  category: string | null;
  lat: number;
  lon: number;
  /** [west, south, east, north] to frame, or null to frame the point by kind. */
  bbox: [number, number, number, number] | null;
  kind: PlaceKind;
  /** Every word of the query is accounted for by this result. */
  fullMatch: boolean;
  source: 'photon' | 'nominatim';
}

export type SearchMode = 'suggest' | 'search';

/** The camera's focus, so "Main St" or "starbucks" means the one in view. */
export interface Bias {
  lat: number;
  lon: number;
  zoom: number;
}

// A result plus the words it can account for (its names, address, region
// codes and their abbreviations) — the input to query-coverage ranking — and
// the subset that only says where it is (city, county, state, country).
export interface Candidate {
  place: Place;
  terms: string[];
  regionTerms: string[];
}

export type FetchJson = (url: string, timeoutMs: number) => Promise<unknown>;

const SUGGEST_LIMIT = 6;
const SEARCH_LIMIT = 6;
// Both modes ask Photon for the same count, so the Enter-press search for a
// query reuses the cached suggestions fetch instead of making a second one.
const PHOTON_LIMIT = 8;
const PHOTON_TIMEOUT_MS = 5_000;
const NOMINATIM_TIMEOUT_MS = 8_000;
// Longest a search will queue for a Nominatim turn (shared with the intel
// ingest) before answering from Photon alone.
const NOMINATIM_MAX_WAIT_MS = 2_500;
const RESULT_TTL_MS = 24 * 60 * 60_000;

// ── Query text ────────────────────────────────────────────────────────────────

// "near me" asks for the closest one — which the camera bias already does —
// and as literal words it only stops Photon matching anything.
const NEAR_ME_RE = /\b(?:near\s+me|near\s*by|around\s+me|close\s+to\s+me)\b/gi;
const LEADING_NEAREST_RE = /^(?:the\s+)?(?:nearest|closest)\s+/i;

export function cleanQuery(raw: string): string {
  const collapsed = raw.replace(/\s+/g, ' ').trim();
  const stripped = collapsed.replace(NEAR_ME_RE, ' ').replace(LEADING_NEAREST_RE, '').replace(/\s+/g, ' ').trim();
  return stripped || collapsed;
}

/** Lowercased, accent-folded word tokens. */
export function tokenize(s: string): string[] {
  return s
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

// Words a place's label never needs to account for — except "in" and "on"
// as the last word, where they're Indiana and Ontario ("gary in").
const STOPWORDS = new Set(['the', 'of', 'in', 'at', 'on', 'and', 'a', 'an', 'to']);
const TRAILING_CODES = new Set(['in', 'on']);

// Label word → the abbreviations people type for it. "pennsylvania ave nw"
// should fully match "Pennsylvania Avenue Northwest".
const ABBREVIATIONS: Record<string, string[]> = {
  north: ['n'], south: ['s'], east: ['e'], west: ['w'],
  northeast: ['ne'], northwest: ['nw'], southeast: ['se'], southwest: ['sw'],
  street: ['st'], saint: ['st'], avenue: ['ave', 'av'], road: ['rd'], boulevard: ['blvd'],
  drive: ['dr'], highway: ['hwy'], mount: ['mt'], mountain: ['mtn'], fort: ['ft'],
  point: ['pt'], lane: ['ln'], court: ['ct'], place: ['pl'], parkway: ['pkwy'],
  square: ['sq'], terrace: ['ter'], circle: ['cir'], expressway: ['expy'],
  freeway: ['fwy'], turnpike: ['tpke'], route: ['rte'], center: ['ctr'], centre: ['ctr'],
  university: ['univ'], international: ['intl'], township: ['twp'],
};

const COUNTRY_ALIASES: Record<string, string[]> = {
  US: ['usa', 'america'],
  GB: ['uk', 'britain'],
  AE: ['uae'],
};

// US states and territories, and Canadian provinces, by the English name both
// providers return — so "Springfield IL" and "Kingston ON" match on the code.
const REGION_CODES: Record<string, Record<string, string>> = {
  US: {
    alabama: 'al', alaska: 'ak', arizona: 'az', arkansas: 'ar', california: 'ca',
    colorado: 'co', connecticut: 'ct', delaware: 'de', florida: 'fl', georgia: 'ga',
    hawaii: 'hi', idaho: 'id', illinois: 'il', indiana: 'in', iowa: 'ia', kansas: 'ks',
    kentucky: 'ky', louisiana: 'la', maine: 'me', maryland: 'md', massachusetts: 'ma',
    michigan: 'mi', minnesota: 'mn', mississippi: 'ms', missouri: 'mo', montana: 'mt',
    nebraska: 'ne', nevada: 'nv', 'new hampshire': 'nh', 'new jersey': 'nj',
    'new mexico': 'nm', 'new york': 'ny', 'north carolina': 'nc', 'north dakota': 'nd',
    ohio: 'oh', oklahoma: 'ok', oregon: 'or', pennsylvania: 'pa', 'rhode island': 'ri',
    'south carolina': 'sc', 'south dakota': 'sd', tennessee: 'tn', texas: 'tx', utah: 'ut',
    vermont: 'vt', virginia: 'va', washington: 'wa', 'west virginia': 'wv',
    wisconsin: 'wi', wyoming: 'wy', 'district of columbia': 'dc', 'puerto rico': 'pr',
    guam: 'gu', 'united states virgin islands': 'vi', 'american samoa': 'as',
    'northern mariana islands': 'mp',
  },
  CA: {
    alberta: 'ab', 'british columbia': 'bc', manitoba: 'mb', 'new brunswick': 'nb',
    'newfoundland and labrador': 'nl', 'nova scotia': 'ns', ontario: 'on',
    'prince edward island': 'pe', quebec: 'qc', saskatchewan: 'sk',
    'northwest territories': 'nt', nunavut: 'nu', yukon: 'yt',
  },
};

function regionCode(countryCode: string, state: string | undefined): string | undefined {
  if (!state) return undefined;
  return REGION_CODES[countryCode]?.[tokenize(state).join(' ')];
}

/** The searchable words for a result: its own words plus the abbreviations and codes people type for them. */
export function termsFor(parts: Array<string | undefined | null>, countryCode: string, state?: string): string[] {
  const terms = new Set<string>();
  for (const part of parts) {
    if (!part) continue;
    for (const t of tokenize(part)) {
      terms.add(t);
      for (const abbr of ABBREVIATIONS[t] ?? []) terms.add(abbr);
    }
  }
  if (countryCode) {
    terms.add(countryCode.toLowerCase());
    for (const alias of COUNTRY_ALIASES[countryCode] ?? []) terms.add(alias);
  }
  const code = regionCode(countryCode, state);
  if (code) terms.add(code);
  return [...terms];
}

// Edit distance capped at `max` (returns max + 1 once it's exceeded).
function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      rowMin = Math.min(rowMin, cur[j]);
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

// A query word matches a term it equals or begins (the last word is usually
// half-typed), or — at four letters and up — one it misspells: within one edit
// of the term or of the term's same-length prefix (two edits at eight+).
// Numbers (house numbers, ZIP codes) and one- or two-letter words must match
// exactly: those are codes ("il", "nw"), and as prefixes they'd match
// anything — "il" begins "Île-de-France".
function wordMatches(word: string, terms: string[]): boolean {
  if (word.length <= 2) return terms.includes(word);
  const numeric = /^\d+$/.test(word);
  const maxEdits = word.length >= 8 ? 2 : word.length >= 4 ? 1 : 0;
  for (const term of terms) {
    if (term === word) return true;
    if (numeric) continue;
    if (term.startsWith(word)) return true;
    if (maxEdits === 0) continue;
    if (editDistance(word, term, maxEdits) <= maxEdits) return true;
    for (const len of [word.length - 1, word.length, word.length + 1]) {
      if (len < term.length && len >= 3 && editDistance(word, term.slice(0, len), maxEdits) <= maxEdits) {
        return true;
      }
    }
  }
  return false;
}

function queryWords(query: string): string[] {
  const words = tokenize(query);
  return words.filter((w, i) => !STOPWORDS.has(w) || (i === words.length - 1 && TRAILING_CODES.has(w)));
}

/** Fraction (0–1) of the query's words this result accounts for. */
export function coverage(query: string, terms: string[]): number {
  const words = queryWords(query);
  if (words.length === 0) return 1;
  let hit = 0;
  for (const w of words) if (wordMatches(w, terms)) hit++;
  return hit / words.length;
}

/** The query's words this result doesn't account for. */
export function unexplained(query: string, terms: string[]): string[] {
  return queryWords(query).filter((w) => !wordMatches(w, terms));
}

/**
 * Stable re-rank by coverage: the provider's own order (prominence, nearness)
 * stands among results that explain the query equally well, but one that
 * leaves words unexplained — Springfield, MO for "springfield il" — drops
 * below one that doesn't. Stamps each place's fullMatch.
 */
export function rankByCoverage(query: string, candidates: Candidate[]): Candidate[] {
  return candidates
    .map((c, i) => {
      const cov = coverage(query, c.terms);
      c.place.fullMatch = cov === 1;
      return { c, cov, i };
    })
    .sort((a, b) => b.cov - a.cov || a.i - b.i)
    .map((x) => x.c);
}

// ── Bounding boxes ───────────────────────────────────────────────────────────

// OSM's extent for these countries spans overseas territories (or wraps the
// antimeridian), so framing it shows an ocean or the whole planet. Google
// frames the home territory; so do we. [west, south, east, north].
const COUNTRY_VIEWPORTS: Record<string, [number, number, number, number]> = {
  US: [-125.0, 24.4, -66.9, 49.5],
  FR: [-5.2, 41.3, 9.6, 51.1],
  RU: [19.6, 41.2, 180.0, 81.9],
  NZ: [166.4, -47.4, 178.6, -34.3],
  NO: [4.5, 57.9, 31.2, 71.2],
  NL: [3.3, 50.7, 7.3, 53.6],
  PT: [-9.6, 36.9, -6.1, 42.2],
  ES: [-9.4, 35.9, 4.4, 43.8],
  DK: [8.0, 54.5, 15.3, 57.8],
  CL: [-75.8, -56.0, -66.4, -17.4],
  EC: [-81.1, -5.1, -75.1, 1.7],
  AU: [112.9, -43.7, 153.7, -10.6],
  GB: [-8.7, 49.8, 1.8, 60.9],
  ZA: [16.3, -34.9, 32.9, -22.1],
  JP: [129.3, 30.9, 146.0, 45.6],
};

// Same problem one level down: the Aleutians cross the antimeridian, Hawaii's
// extent runs 2,000 km up the uninhabited Northwestern islands, and Tokyo's
// takes in the Ogasawara islands 1,000 km out in the Pacific.
const REGION_VIEWPORTS: Record<string, [number, number, number, number]> = {
  'US:alaska': [-170.0, 51.2, -129.9, 71.5],
  'US:hawaii': [-160.3, 18.9, -154.8, 22.3],
  'JP:tokyo': [138.9, 35.45, 139.95, 35.9],
};

/**
 * A provider's box, if it frames the place: finite, correctly ordered, not
 * wrapping half the planet, and containing the place's own point (a box that
 * doesn't is describing something else). Null means "frame the point".
 */
export function sanitizeBbox(
  lat: number,
  lon: number,
  bbox: [number, number, number, number] | null
): [number, number, number, number] | null {
  if (!bbox || !bbox.every(Number.isFinite)) return null;
  const [w, s, e, n] = bbox;
  if (s < -90 || n > 90 || w < -180 || e > 180) return null;
  if (n < s || e < w) return null;
  if (e - w > 180) return null;
  if (n - s < 1e-6 && e - w < 1e-6) return null;
  const padLat = Math.max(0.01, (n - s) * 0.1);
  const padLon = Math.max(0.01, (e - w) * 0.1);
  if (lat < s - padLat || lat > n + padLat || lon < w - padLon || lon > e + padLon) return null;
  // A big box with the place off in a corner — off-centre on both axes — is
  // stretched by outlying islands; centring on it frames open ocean.
  if (n - s > 3 || e - w > 3) {
    const fx = (lon - w) / (e - w);
    const fy = (lat - s) / (n - s);
    const offCentre = (f: number) => !(f >= 0.25 && f <= 0.75);
    if (offCentre(fx) && offCentre(fy)) return null;
  }
  return [w, s, e, n];
}

function viewportFor(
  kind: PlaceKind,
  countryCode: string,
  name: string,
  lat: number,
  lon: number,
  bbox: [number, number, number, number] | null
): [number, number, number, number] | null {
  if (kind === 'country' && COUNTRY_VIEWPORTS[countryCode]) return COUNTRY_VIEWPORTS[countryCode];
  if (kind === 'state' || kind === 'city') {
    const v = REGION_VIEWPORTS[`${countryCode}:${tokenize(name).join(' ')}`];
    if (v) return v;
  }
  return sanitizeBbox(lat, lon, bbox);
}

// ── Kinds and labels ─────────────────────────────────────────────────────────

// OSM keys whose named features are businesses, facilities or landmarks.
const POI_KEYS = new Set([
  'amenity', 'shop', 'tourism', 'leisure', 'office', 'craft', 'healthcare', 'aeroway',
  'railway', 'historic', 'building', 'man_made', 'emergency', 'public_transport',
  'military', 'club', 'sport', 'power', 'industrial', 'aerialway',
]);

function placeValueKind(value: string | undefined): PlaceKind | null {
  switch (value) {
    case 'country':
      return 'country';
    case 'state':
    case 'province':
    case 'region':
      return 'state';
    case 'county':
    case 'state_district':
      return 'county';
    case 'city':
    case 'town':
    case 'village':
    case 'municipality':
    case 'hamlet':
      return 'city';
    case 'suburb':
    case 'neighbourhood':
    case 'quarter':
    case 'borough':
    case 'city_district':
    case 'district':
    case 'locality':
    case 'city_block':
    case 'isolated_dwelling':
      return 'locality';
    default:
      return null;
  }
}

function osmKind(key: string | undefined, value: string | undefined, named: boolean, hasHouseNumber: boolean): PlaceKind {
  if (key === 'place') return placeValueKind(value) ?? (hasHouseNumber ? 'address' : 'other');
  if (key === 'highway' && !hasHouseNumber) return 'street';
  if (key && POI_KEYS.has(key) && named) return 'poi';
  if (hasHouseNumber) return 'address';
  return 'other';
}

/** "fast_food" → "Fast food"; null for OSM's placeholder values. */
export function humanize(value: string | undefined): string | null {
  if (!value || value === 'yes' || value === 'no' || value === 'administrative') return null;
  const s = value.replace(/_/g, ' ').trim();
  return s ? s[0].toUpperCase() + s.slice(1) : null;
}

/** Comma-join, skipping blanks, the place's own name, and repeats. */
function joinContext(name: string, parts: Array<string | undefined | null>): string {
  const seen = new Set([name.trim().toLowerCase()]);
  const out: string[] = [];
  for (const p of parts) {
    const t = p?.trim();
    if (!t || seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
    out.push(t);
  }
  return out.join(', ');
}

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

// Kinds whose own name is a "where" (a city, a state), not a "what".
const REGION_KINDS = new Set<PlaceKind>(['country', 'state', 'county', 'city', 'locality']);

// ── Photon ───────────────────────────────────────────────────────────────────

interface PhotonProps {
  osm_type?: string;
  osm_id?: number;
  osm_key?: string;
  osm_value?: string;
  type?: string;
  name?: string;
  housenumber?: string;
  street?: string;
  postcode?: string;
  locality?: string;
  district?: string;
  city?: string;
  county?: string;
  state?: string;
  country?: string;
  countrycode?: string;
  // [minLon, maxLat, maxLon, minLat]
  extent?: number[];
}

interface PhotonFeature {
  geometry?: { coordinates?: number[] };
  properties?: PhotonProps;
}

function photonKind(p: PhotonProps, named: boolean): PlaceKind {
  const hasHouseNumber = Boolean(p.housenumber);
  switch (p.type) {
    case 'country':
    case 'state':
    case 'county':
    case 'city':
    case 'street':
      return p.type;
    case 'district':
    case 'locality':
      return 'locality';
    case 'house':
    case 'other': {
      const k = osmKind(p.osm_key, p.osm_value, named, hasHouseNumber);
      return k === 'street' ? 'other' : k;
    }
    default:
      return osmKind(p.osm_key, p.osm_value, named, hasHouseNumber);
  }
}

export function normalizePhoton(data: unknown): Candidate[] {
  const features = (data as { features?: PhotonFeature[] } | null)?.features;
  if (!Array.isArray(features)) return [];
  const out: Candidate[] = [];
  for (const f of features) {
    const p = f?.properties;
    const [lon, lat] = f?.geometry?.coordinates ?? [];
    if (!p || !finite(lat) || !finite(lon)) continue;
    const streetLine = [p.housenumber, p.street].filter(Boolean).join(' ');
    const name = p.name?.trim() || streetLine || p.city || p.state || p.country || '';
    if (!name) continue;
    const kind = photonKind(p, Boolean(p.name?.trim()));
    const cc = (p.countrycode ?? '').toUpperCase();
    const ext = p.extent;
    const raw: [number, number, number, number] | null =
      Array.isArray(ext) && ext.length === 4 ? [ext[0], ext[3], ext[2], ext[1]] : null;
    const town = p.city ?? p.locality ?? p.district;
    const context = joinContext(name, [
      kind === 'poi' || kind === 'address' || kind === 'other' ? streetLine : null,
      kind === 'city' ? null : town,
      kind === 'country' ? null : p.state,
      kind === 'country' ? null : p.country,
    ]);
    out.push({
      place: {
        id: `photon:${p.osm_type ?? ''}${p.osm_id ?? `${lat},${lon}`}`,
        name,
        context,
        category: kind === 'poi' || kind === 'other' ? humanize(p.osm_value) : null,
        lat,
        lon,
        bbox: viewportFor(kind, cc, name, lat, lon, raw),
        kind,
        fullMatch: false,
        source: 'photon',
      },
      terms: termsFor(
        [p.name, p.housenumber, p.street, p.postcode, p.locality, p.district, p.city, p.county, p.state, p.country, humanize(p.osm_value)],
        cc,
        kind === 'state' ? p.name : p.state
      ),
      regionTerms: termsFor(
        [REGION_KINDS.has(kind) ? p.name : null, p.locality, p.district, p.city, p.county, p.state, p.country],
        cc,
        kind === 'state' ? p.name : p.state
      ),
    });
  }
  return out;
}

// ── Nominatim ────────────────────────────────────────────────────────────────

interface NominatimItem {
  osm_type?: string;
  osm_id?: number;
  lat?: string;
  lon?: string;
  category?: string;
  type?: string;
  addresstype?: string;
  name?: string;
  display_name?: string;
  // [minLat, maxLat, minLon, maxLon] as strings
  boundingbox?: string[];
  address?: Record<string, string>;
}

function nominatimKind(item: NominatimItem, named: boolean, hasHouseNumber: boolean): PlaceKind {
  const at = item.addresstype;
  const byAddressType = placeValueKind(at);
  if (byAddressType) return byAddressType;
  if (at === 'road') return 'street';
  if (item.category === 'boundary' && item.type === 'administrative') return 'other';
  return osmKind(item.category, item.type, named, hasHouseNumber);
}

export function normalizeNominatim(data: unknown): Candidate[] {
  if (!Array.isArray(data)) return [];
  const out: Candidate[] = [];
  for (const item of data as NominatimItem[]) {
    const lat = Number(item?.lat);
    const lon = Number(item?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const a = item.address ?? {};
    const streetLine = [a.house_number, a.road].filter(Boolean).join(' ');
    const displayHead = item.display_name?.split(',')[0]?.trim();
    const ownName = item.name?.trim();
    const kind = nominatimKind(item, Boolean(ownName), Boolean(a.house_number));
    const name = (kind === 'address' && !ownName ? streetLine : ownName) || displayHead || streetLine;
    if (!name) continue;
    const cc = (a.country_code ?? '').toUpperCase();
    const bb = item.boundingbox?.map(Number);
    const raw: [number, number, number, number] | null =
      bb && bb.length === 4 ? [bb[2], bb[0], bb[3], bb[1]] : null;
    const town = a.city ?? a.town ?? a.village ?? a.hamlet ?? a.municipality ?? a.suburb;
    const context = joinContext(name, [
      kind === 'poi' || kind === 'address' || kind === 'other' ? streetLine : null,
      kind === 'city' ? null : town,
      kind === 'country' ? null : a.state,
      kind === 'country' ? null : a.country,
    ]);
    const osmLetter = item.osm_type ? item.osm_type[0].toUpperCase() : '';
    out.push({
      place: {
        id: `nominatim:${osmLetter}${item.osm_id ?? `${lat},${lon}`}`,
        name,
        context,
        category: kind === 'poi' || kind === 'other' ? humanize(item.type) : null,
        lat,
        lon,
        bbox: viewportFor(kind, cc, name, lat, lon, raw),
        kind,
        fullMatch: false,
        source: 'nominatim',
      },
      terms: termsFor([item.display_name, ownName, humanize(item.type), a.postcode], cc, kind === 'state' ? name : a.state),
      regionTerms: termsFor(
        [REGION_KINDS.has(kind) ? name : null, a.city, a.town, a.village, a.hamlet, a.municipality, a.suburb, a.county, a.state, a.country],
        cc,
        kind === 'state' ? name : a.state
      ),
    });
  }
  return out;
}

// ── Bias ─────────────────────────────────────────────────────────────────────

/**
 * The camera focus from ?lat&lon&zoom, snapped to a grid that tightens as the
 * view zooms in — enough precision to mean "near here", coarse enough that
 * one cached answer serves everyone looking at the same area. Null at
 * zoom ≤ 4 (a hemisphere in view has no "near here"; Photon ignores it too).
 */
export function parseBias(lat: unknown, lon: unknown, zoom: unknown): Bias | null {
  // Strings only: a repeated param arrives as an array, and Number('') is 0.
  const num = (v: unknown) => (typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN);
  const la = num(lat);
  const lo = num(lon);
  const z = Math.round(num(zoom));
  if (!Number.isFinite(la) || !Number.isFinite(lo) || !Number.isFinite(z)) return null;
  if (Math.abs(la) > 90 || Math.abs(lo) > 180) return null;
  const clampedZoom = Math.min(18, Math.max(0, z));
  if (clampedZoom <= 4) return null;
  const step = clampedZoom >= 13 ? 0.01 : clampedZoom >= 9 ? 0.1 : 1;
  const snap = (v: number) => Number((Math.round(v / step) * step).toFixed(2));
  return { lat: snap(la), lon: snap(lo), zoom: clampedZoom };
}

/** Rough half-width of the view, in km, at a slippy-map zoom level. */
function viewRadiusKm(zoom: number): number {
  return 78_000 / 2 ** zoom;
}

function distanceKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const rad = Math.PI / 180;
  const dLat = (bLat - aLat) * rad;
  const dLon = (bLon - aLon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

// ── Upstreams ────────────────────────────────────────────────────────────────

function photonUrl(q: string, bias: Bias | null): string {
  const params = new URLSearchParams({ q, limit: String(PHOTON_LIMIT), lang: 'en' });
  if (bias) {
    params.set('lat', String(bias.lat));
    params.set('lon', String(bias.lon));
    params.set('zoom', String(bias.zoom));
  }
  return `https://photon.komoot.io/api/?${params}`;
}

function nominatimUrl(q: string, bias: Bias | null): string {
  const params = new URLSearchParams({
    format: 'jsonv2',
    limit: String(SEARCH_LIMIT),
    addressdetails: '1',
    'accept-language': 'en',
    q,
  });
  if (bias) {
    // A preference, not a filter (bounded stays 0): matches in view rank first.
    const r = viewRadiusKm(bias.zoom);
    const dLat = Math.min(80, r / 111);
    const dLon = Math.min(170, r / (111 * Math.max(0.1, Math.cos((bias.lat * Math.PI) / 180))));
    const clampLon = (v: number) => Math.max(-180, Math.min(180, v));
    const clampLat = (v: number) => Math.max(-90, Math.min(90, v));
    params.set(
      'viewbox',
      [clampLon(bias.lon - dLon), clampLat(bias.lat + dLat), clampLon(bias.lon + dLon), clampLat(bias.lat - dLat)]
        .map((v) => v.toFixed(3))
        .join(',')
    );
  }
  return `https://nominatim.openstreetmap.org/search?${params}`;
}

async function defaultFetchJson(url: string, timeoutMs: number): Promise<unknown> {
  const upstream = await fetch(url, {
    // Both providers' usage policies require an identifying User-Agent.
    headers: { 'User-Agent': config.nwsUserAgent },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!upstream.ok) throw new Error(`${new URL(url).hostname} error: ${upstream.status}`);
  return upstream.json();
}

const biasKey = (bias: Bias | null) => (bias ? `${bias.lat},${bias.lon},${bias.zoom}` : '-');

export interface SearchResult {
  results: Place[];
  /** A provider failed: the answer may be missing what it would have found. */
  degraded: boolean;
}

export interface GeocodeDeps {
  fetchJson?: FetchJson;
  cache?: TtlCache;
  /** Waits for a Nominatim turn; false = no turn soon enough. */
  nominatimTurn?: (maxWaitMs: number) => Promise<boolean>;
}

/** The search pipeline, with its upstream fetch and cache injectable for tests. */
export function createGeocoder(deps: GeocodeDeps = {}) {
  const fetchJson = deps.fetchJson ?? defaultFetchJson;
  const takeNominatimTurn = deps.nominatimTurn ?? nominatimTurn;
  // Its own bounded cache: every keystroke-prefix × view-cell is a key, and
  // that churn mustn't evict the data layers' entries from the shared cache.
  const cache = deps.cache ?? new TtlCache({ maxEntries: 1_000, maxLastGood: 200 });

  const photon = (q: string, bias: Bias | null) =>
    cache.getOrFetch(
      `photon|${q.toLowerCase()}|${biasKey(bias)}`,
      RESULT_TTL_MS,
      async () => normalizePhoton(await fetchJson(photonUrl(q, bias), PHOTON_TIMEOUT_MS)),
      { staleOnError: true }
    );

  const nominatim = (q: string, bias: Bias | null) =>
    cache.getOrFetch(
      `nominatim|${q.toLowerCase()}|${biasKey(bias)}`,
      RESULT_TTL_MS,
      async () => {
        if (!(await takeNominatimTurn(NOMINATIM_MAX_WAIT_MS))) throw new Error('nominatim busy: rate limit');
        return normalizeNominatim(await fetchJson(nominatimUrl(q, bias), NOMINATIM_TIMEOUT_MS));
      },
      { staleOnError: true }
    );

  // Cached arrays are shared between requests: rank copies, never the originals.
  const copy = (cs: Candidate[]) => cs.map((c) => ({ ...c, place: { ...c.place } }));

  return async function search(rawQuery: string, mode: SearchMode, bias: Bias | null): Promise<SearchResult> {
    const q = cleanQuery(rawQuery);

    if (mode === 'suggest') {
      const ranked = rankByCoverage(q, copy(await photon(q, bias)));
      return { results: ranked.slice(0, SUGGEST_LIMIT).map((c) => c.place), degraded: false };
    }

    let fromPhoton: Candidate[] = [];
    let photonError: unknown = null;
    try {
      fromPhoton = rankByCoverage(q, copy(await photon(q, bias)));
    } catch (err) {
      photonError = err;
    }
    const best = fromPhoton[0];
    if (best?.place.fullMatch) {
      return { results: fromPhoton.slice(0, SEARCH_LIMIT).map((c) => c.place), degraded: false };
    }

    let fromNominatim: Candidate[] = [];
    let nominatimError: unknown = null;
    try {
      fromNominatim = rankByCoverage(q, copy(await nominatim(q, bias)));
    } catch (err) {
      nominatimError = err;
    }
    // Nothing to show and a provider failed: that's an outage, not "no such
    // place" — Photon might well have found it.
    if (!best && fromNominatim.length === 0 && (photonError || nominatimError)) {
      throw photonError ?? nominatimError;
    }

    const seen = new Set<string>();
    const merged: Place[] = [];
    const push = (cs: Candidate[]) => {
      for (const c of cs) {
        // The same OSM object from both providers: keep the first.
        const osmKey = c.place.id.slice(c.place.id.indexOf(':') + 1);
        if (seen.has(osmKey)) continue;
        seen.add(osmKey);
        merged.push(c.place);
      }
    };

    // Nominatim's answer leads only if it explains more of the query. When
    // the camera is on an area, the words it explains must also say where
    // ("… washington dc": its city or region), or it mustn't be a far-off
    // match standing in for a nearby one ("starbucks coffee": the Starbucks
    // down the street, not one named exactly that in Tokyo).
    const nomBest = fromNominatim[0];
    const nearView = (p: Place) =>
      !bias || distanceKm(bias.lat, bias.lon, p.lat, p.lon) <= 4 * viewRadiusKm(bias.zoom);
    const nominatimLeads =
      nomBest !== undefined &&
      (!best ||
        (coverage(q, nomBest.terms) > coverage(q, best.terms) &&
          (unexplained(q, best.terms).some((w) => wordMatches(w, nomBest.regionTerms)) ||
            nearView(nomBest.place) ||
            !nearView(best.place))));

    if (nominatimLeads) {
      push(fromNominatim);
      push(fromPhoton);
    } else {
      push(fromPhoton);
      push(fromNominatim);
    }
    return { results: merged.slice(0, SEARCH_LIMIT), degraded: Boolean(photonError || nominatimError) };
  };
}

export function createGeocodeRouter(deps: GeocodeDeps = {}) {
  const search = createGeocoder(deps);
  const router = Router();

  router.get('/', async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (!q || q.length > 200) {
      res.status(400).json({ error: 'q is required (max 200 chars)' });
      return;
    }
    const mode: SearchMode = req.query.mode === 'suggest' ? 'suggest' : 'search';
    const bias = parseBias(req.query.lat, req.query.lon, req.query.zoom);

    try {
      const { results, degraded } = await search(q, mode, bias);
      // Places don't move: let the browser reuse an answer when the same text
      // is typed again (backspace, retype) without asking the server — unless
      // a provider was failing, so a retry once it's back gets a full answer.
      res.setHeader('Cache-Control', degraded ? 'no-store' : 'private, max-age=600');
      res.json({ results });
    } catch (err) {
      res.status(502).json({ error: 'Failed to geocode', detail: String(err) });
    }
  });

  return router;
}

export default createGeocodeRouter();
