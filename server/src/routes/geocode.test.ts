import type { AddressInfo } from 'net';
import type { Server } from 'http';
import express from 'express';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { TtlCache } from '../cache';
import geocodeRouter, {
  type Candidate,
  type FetchJson,
  cleanQuery,
  coverage,
  createGeocoder,
  unexplained,
  normalizeNominatim,
  normalizePhoton,
  parseBias,
  rankByCoverage,
  sanitizeBbox,
  termsFor,
  tokenize,
} from './geocode';

// ── Fixtures (trimmed real payloads) ──────────────────────────────────────────

type PhotonProps = Record<string, unknown>;
const photonFeature = (lon: number, lat: number, props: PhotonProps) => ({
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [lon, lat] },
  properties: props,
});
const photonCollection = (...features: unknown[]) => ({ type: 'FeatureCollection', features });

const PITTSBURGH = photonFeature(-79.9900861, 40.4416941, {
  osm_type: 'R', osm_id: 188553, osm_key: 'boundary', osm_value: 'administrative', type: 'city',
  name: 'Pittsburgh', county: 'Allegheny County', state: 'Pennsylvania', country: 'United States',
  countrycode: 'US', extent: [-80.0955, 40.5012, -79.8657, 40.3615],
});
const PITTSBURG_KS = photonFeature(-94.7046, 37.4109, {
  osm_type: 'R', osm_id: 130034, osm_key: 'boundary', osm_value: 'administrative', type: 'city',
  name: 'Pittsburg', county: 'Crawford County', state: 'Kansas', country: 'United States',
  countrycode: 'US', extent: [-94.7457, 37.4515, -94.6618, 37.3716],
});
const SPRINGFIELD_MO = photonFeature(-93.2923, 37.2153, {
  osm_type: 'R', osm_id: 1, osm_key: 'place', osm_value: 'city', type: 'city',
  name: 'Springfield', state: 'Missouri', country: 'United States', countrycode: 'US',
});
const SPRINGFIELD_IL = photonFeature(-89.6501, 39.7817, {
  osm_type: 'R', osm_id: 2, osm_key: 'place', osm_value: 'city', type: 'city',
  name: 'Springfield', state: 'Illinois', country: 'United States', countrycode: 'US',
});
const STARBUCKS = photonFeature(-122.3425, 47.6097, {
  osm_type: 'N', osm_id: 1234, osm_key: 'amenity', osm_value: 'cafe', type: 'house',
  name: 'Starbucks', housenumber: '1912', street: 'Pike Place', postcode: '98101',
  city: 'Seattle', state: 'Washington', country: 'United States', countrycode: 'US',
});
const USA = photonFeature(-100.4459, 39.7837, {
  osm_type: 'R', osm_id: 148838, osm_key: 'place', osm_value: 'country', type: 'country',
  name: 'United States', country: 'United States', countrycode: 'US', extent: [-180, 71.6, 180, -14.8],
});
const GERMANY = photonFeature(10.4234, 51.0834, {
  osm_type: 'R', osm_id: 51477, osm_key: 'place', osm_value: 'country', type: 'country',
  name: 'Germany', country: 'Germany', countrycode: 'DE', extent: [5.8663, 55.0991, 15.0419, 47.2701],
});
const HOUSE = photonFeature(-77.0365, 38.8977, {
  osm_type: 'W', osm_id: 99, osm_key: 'building', osm_value: 'yes', type: 'house',
  housenumber: '1600', street: 'Pennsylvania Avenue Northwest', city: 'Washington',
  state: 'District of Columbia', country: 'United States', countrycode: 'US',
});

const NOMINATIM_PITTSBURGH = {
  osm_type: 'relation', osm_id: 188553, lat: '40.4416941', lon: '-79.9900861',
  category: 'boundary', type: 'administrative', addresstype: 'city', name: 'Pittsburgh',
  display_name: 'Pittsburgh, Allegheny County, Pennsylvania, United States',
  boundingbox: ['40.3614960', '40.5012010', '-80.0955000', '-79.8657000'],
  address: { city: 'Pittsburgh', county: 'Allegheny County', state: 'Pennsylvania', country: 'United States', country_code: 'us' },
};
const NOMINATIM_WHITE_HOUSE = {
  osm_type: 'way', osm_id: 238241022, lat: '38.8976997', lon: '-77.0365532',
  category: 'office', type: 'government', addresstype: 'office', name: 'White House',
  display_name: 'White House, 1600, Pennsylvania Avenue Northwest, Washington, District of Columbia, 20500, United States',
  boundingbox: ['38.8974908', '38.8979110', '-77.0368537', '-77.0362519'],
  address: {
    office: 'White House', house_number: '1600', road: 'Pennsylvania Avenue Northwest',
    city: 'Washington', state: 'District of Columbia', postcode: '20500', country: 'United States', country_code: 'us',
  },
};
const NOMINATIM_FRANCE = {
  osm_type: 'relation', osm_id: 2202162, lat: '46.603354', lon: '1.8883335',
  category: 'boundary', type: 'administrative', addresstype: 'country', name: 'France',
  display_name: 'France', boundingbox: ['-50.2187169', '51.3055721', '-178.3873749', '172.3057152'],
  address: { country: 'France', country_code: 'fr' },
};

// ── Pure helpers ──────────────────────────────────────────────────────────────

describe('cleanQuery', () => {
  it('collapses whitespace and drops "near me" phrasing the camera bias already covers', () => {
    expect(cleanQuery('  starbucks   near me ')).toBe('starbucks');
    expect(cleanQuery('pizza nearby')).toBe('pizza');
    expect(cleanQuery('nearest hospital')).toBe('hospital');
    expect(cleanQuery('the closest gas station')).toBe('gas station');
  });

  it('keeps names that merely contain "near", and never empties the query', () => {
    expect(cleanQuery('Near North Side')).toBe('Near North Side');
    expect(cleanQuery('near me')).toBe('near me');
  });
});

describe('tokenize', () => {
  it('lowercases, folds accents and splits on punctuation', () => {
    expect(tokenize('Québec City, QC')).toEqual(['quebec', 'city', 'qc']);
    expect(tokenize("Macy's — 34th St.")).toEqual(['macy', 's', '34th', 'st']);
  });
});

describe('coverage', () => {
  const pgh = termsFor(['Pittsburgh', 'Allegheny County', 'Pennsylvania', 'United States'], 'US', 'Pennsylvania');

  it('counts words matched exactly, as a prefix, or by US state / country code', () => {
    expect(coverage('pittsburgh pa', pgh)).toBe(1);
    expect(coverage('pitts', pgh)).toBe(1);
    expect(coverage('pittsburgh usa', pgh)).toBe(1);
    expect(coverage('pittsburgh ohio', pgh)).toBe(0.5);
  });

  it('forgives a typo in longer words, but not in short ones or numbers', () => {
    expect(coverage('pittsbugh', pgh)).toBe(1);
    expect(coverage('pitsbur', pgh)).toBe(1); // typo AND half-typed
    expect(coverage('pz', pgh)).toBe(0);
    const house = termsFor(['1600', 'Pennsylvania Avenue Northwest'], 'US');
    expect(coverage('1601 pennsylvania', house)).toBe(0.5);
  });

  it('knows the street and direction abbreviations people type', () => {
    const house = termsFor(['1600', 'Pennsylvania Avenue Northwest', 'Washington'], 'US', 'District of Columbia');
    expect(coverage('1600 pennsylvania ave nw washington dc', house)).toBe(1);
  });

  it('ignores stopwords, but reads a trailing "in" / "on" as Indiana / Ontario', () => {
    expect(coverage('the university of pittsburgh', termsFor(['University of Pittsburgh'], 'US'))).toBe(1);
    expect(coverage('pizza in pittsburgh', termsFor(['Pizza', 'Pittsburgh'], 'US', 'Pennsylvania'))).toBe(1);
    expect(coverage('gary in', termsFor(['Gary', 'Indiana'], 'US', 'Indiana'))).toBe(1);
    expect(coverage('gary in', termsFor(['Gary', 'West Virginia'], 'US', 'West Virginia'))).toBe(0.5);
    expect(coverage('kingston on', termsFor(['Kingston', 'Ontario'], 'CA', 'Ontario'))).toBe(1);
  });

  it('matches one- and two-letter words only exactly, so a region code is not any prefix', () => {
    const parisFr = termsFor(['Paris', 'Ile-de-France', 'France'], 'FR', 'Ile-de-France');
    expect(coverage('paris il', parisFr)).toBe(0.5); // "il" doesn't stand for Île-de-France
    expect(coverage('paris il', termsFor(['Paris', 'Illinois'], 'US', 'Illinois'))).toBe(1);
    expect(coverage('aurora co', termsFor(['Aurora', 'Kane County', 'Illinois'], 'US', 'Illinois'))).toBe(0.5);
    expect(coverage('aurora co', termsFor(['Aurora', 'Arapahoe County', 'Colorado'], 'US', 'Colorado'))).toBe(1);
    expect(coverage('salem ma', termsFor(['Salem', 'Marion County', 'Oregon'], 'US', 'Oregon'))).toBe(0.5);
  });

  it('lists the words a result leaves unexplained', () => {
    expect(unexplained('pennsylvania ave washington dc', termsFor(['Pennsylvania Avenue', 'Washington', 'Pennsylvania'], 'US', 'Pennsylvania'))).toEqual(['dc']);
  });
});

describe('rankByCoverage', () => {
  const c = (id: string, terms: string[]): Candidate => ({
    place: {
      id, name: id, context: '', category: null, lat: 0, lon: 0, bbox: null, kind: 'city', fullMatch: false, source: 'photon',
    },
    terms,
    regionTerms: [],
  });

  it('lifts a full match over a partial one and keeps provider order among equals', () => {
    const ranked = rankByCoverage('springfield il', [
      c('mo', termsFor(['Springfield', 'Missouri'], 'US', 'Missouri')),
      c('ma', termsFor(['Springfield', 'Massachusetts'], 'US', 'Massachusetts')),
      c('il', termsFor(['Springfield', 'Illinois'], 'US', 'Illinois')),
    ]);
    expect(ranked.map((r) => r.place.id)).toEqual(['il', 'mo', 'ma']);
    expect(ranked.map((r) => r.place.fullMatch)).toEqual([true, false, false]);
  });
});

describe('sanitizeBbox', () => {
  it('keeps a box that frames its point', () => {
    expect(sanitizeBbox(40.44, -79.99, [-80.1, 40.36, -79.87, 40.5])).toEqual([-80.1, 40.36, -79.87, 40.5]);
  });

  it('drops boxes that would frame the wrong thing', () => {
    expect(sanitizeBbox(39.8, -100.4, [-180, -14.8, 180, 71.6])).toBeNull(); // wraps the planet
    expect(sanitizeBbox(10, 10, [20, 20, 30, 30])).toBeNull(); // point outside
    expect(sanitizeBbox(10, 10, [10, 10, 10, 10])).toBeNull(); // degenerate
    expect(sanitizeBbox(10, 10, [12, 0, 8, 20])).toBeNull(); // west > east
    expect(sanitizeBbox(10, 10, [NaN, 0, 20, 20])).toBeNull();
    expect(sanitizeBbox(10, 10, null)).toBeNull();
  });

  it('drops a big box whose place sits off in a corner (outlying islands), but not an off-centre one on one axis', () => {
    // Tokyo Metropolis, Ogasawara and Okinotorishima included.
    expect(sanitizeBbox(35.68, 139.76, [135.85, 20.21, 154.21, 35.9])).toBeNull();
    // Florida: the point is east of centre, but mid-way north–south.
    expect(sanitizeBbox(27.75, -81.46, [-87.6, 24.4, -80.0, 31.0])).toEqual([-87.6, 24.4, -80.0, 31.0]);
    // Small boxes are never second-guessed.
    expect(sanitizeBbox(40.5, -80.09, [-80.1, 40.36, -79.87, 40.5])).toEqual([-80.1, 40.36, -79.87, 40.5]);
  });
});

describe('parseBias', () => {
  it('snaps the focus to a grid that tightens with zoom', () => {
    expect(parseBias('40.4417', '-79.9901', '14')).toEqual({ lat: 40.44, lon: -79.99, zoom: 14 });
    expect(parseBias('40.4417', '-79.9901', '10')).toEqual({ lat: 40.4, lon: -80, zoom: 10 });
    expect(parseBias('40.4417', '-79.9901', '6')).toEqual({ lat: 40, lon: -80, zoom: 6 });
    expect(parseBias('40.4417', '-79.9901', '25')).toEqual({ lat: 40.44, lon: -79.99, zoom: 18 });
  });

  it('is null when the globe is zoomed out or the params are unusable', () => {
    expect(parseBias('40', '-80', '4')).toBeNull();
    expect(parseBias(undefined, undefined, undefined)).toBeNull();
    expect(parseBias('', '', '10')).toBeNull();
    expect(parseBias(['1', '2'], '-80', '10')).toBeNull();
    expect(parseBias('91', '0', '10')).toBeNull();
    expect(parseBias('0', '181', '10')).toBeNull();
    expect(parseBias('abc', '0', '10')).toBeNull();
  });
});

describe('normalizePhoton', () => {
  it('builds a city with its context and extent re-ordered to [w, s, e, n]', () => {
    const [{ place, terms }] = normalizePhoton(photonCollection(PITTSBURGH));
    expect(place).toEqual({
      id: 'photon:R188553',
      name: 'Pittsburgh',
      context: 'Pennsylvania, United States',
      category: null,
      lat: 40.4416941,
      lon: -79.9900861,
      bbox: [-80.0955, 40.3615, -79.8657, 40.5012],
      kind: 'city',
      fullMatch: false,
      source: 'photon',
    });
    expect(terms).toEqual(expect.arrayContaining(['pittsburgh', 'allegheny', 'pennsylvania', 'pa', 'us', 'usa']));
  });

  it('makes a named amenity a POI with its address as context and a category', () => {
    const [{ place }] = normalizePhoton(photonCollection(STARBUCKS));
    expect(place).toMatchObject({
      name: 'Starbucks',
      context: '1912 Pike Place, Seattle, Washington, United States',
      category: 'Cafe',
      kind: 'poi',
      bbox: null,
    });
  });

  it('names an unnamed building by its address', () => {
    const [{ place }] = normalizePhoton(photonCollection(HOUSE));
    expect(place).toMatchObject({
      name: '1600 Pennsylvania Avenue Northwest',
      context: 'Washington, District of Columbia, United States',
      kind: 'address',
    });
  });

  it("frames a country's home territory instead of an extent that wraps the planet", () => {
    const [us, de] = normalizePhoton(photonCollection(USA, GERMANY));
    expect(us.place.kind).toBe('country');
    expect(us.place.context).toBe('');
    expect(us.place.bbox).toEqual([-125.0, 24.4, -66.9, 49.5]);
    expect(de.place.bbox).toEqual([5.8663, 47.2701, 15.0419, 55.0991]);
  });

  it("frames Tokyo's mainland wards, not its Pacific islands", () => {
    const tokyo = photonFeature(139.7594549, 35.6828387, {
      osm_type: 'R', osm_id: 1543125, osm_key: 'boundary', osm_value: 'administrative', type: 'state',
      name: 'Tokyo', country: 'Japan', countrycode: 'JP', extent: [135.85, 35.9, 154.21, 20.21],
    });
    const [{ place }] = normalizePhoton(photonCollection(tokyo));
    expect(place.kind).toBe('state');
    expect(place.bbox).toEqual([138.9, 35.45, 139.95, 35.9]);
  });

  it('skips malformed features and tolerates a non-collection body', () => {
    expect(normalizePhoton(photonCollection({ properties: { name: 'x' } }, { geometry: { coordinates: [1, 2] } }))).toEqual([]);
    expect(normalizePhoton(null)).toEqual([]);
    expect(normalizePhoton({ message: 'error' })).toEqual([]);
  });
});

describe('normalizeNominatim', () => {
  it('maps a city, re-ordering the bounding box to [w, s, e, n]', () => {
    const [{ place }] = normalizeNominatim([NOMINATIM_PITTSBURGH]);
    expect(place).toMatchObject({
      id: 'nominatim:R188553',
      name: 'Pittsburgh',
      context: 'Pennsylvania, United States',
      kind: 'city',
      bbox: [-80.0955, 40.361496, -79.8657, 40.501201],
      source: 'nominatim',
    });
  });

  it('maps a landmark as a POI with its street address', () => {
    const [{ place, terms }] = normalizeNominatim([NOMINATIM_WHITE_HOUSE]);
    expect(place).toMatchObject({
      name: 'White House',
      context: '1600 Pennsylvania Avenue Northwest, Washington, District of Columbia, United States',
      category: 'Government',
      kind: 'poi',
    });
    expect(terms).toEqual(expect.arrayContaining(['1600', '20500', 'nw', 'dc']));
  });

  it("swaps an overseas-spanning country extent for the home territory", () => {
    const [{ place }] = normalizeNominatim([NOMINATIM_FRANCE]);
    expect(place.kind).toBe('country');
    expect(place.bbox).toEqual([-5.2, 41.3, 9.6, 51.1]);
  });

  it('tolerates junk', () => {
    expect(normalizeNominatim({ error: 'x' })).toEqual([]);
    expect(normalizeNominatim([{ lat: 'x', lon: '1' }, null])).toEqual([]);
  });
});

// ── The pipeline ──────────────────────────────────────────────────────────────

function fakeUpstreams(handlers: { photon?: () => unknown; nominatim?: () => unknown }) {
  const calls: string[] = [];
  const fetchJson: FetchJson = async (url) => {
    calls.push(url);
    const host = new URL(url).hostname;
    const h = host.includes('photon') ? handlers.photon : handlers.nominatim;
    if (!h) throw new Error(`unexpected ${host}`);
    return h();
  };
  const geocode = createGeocoder({ fetchJson, cache: new TtlCache(), nominatimTurn: async () => true });
  return {
    calls,
    geocode,
    search: async (...args: Parameters<typeof geocode>) => (await geocode(...args)).results,
  };
}

describe('createGeocoder', () => {
  it('answers from Photon alone when its best result covers the whole query', async () => {
    const { calls, search } = fakeUpstreams({ photon: () => photonCollection(PITTSBURGH, PITTSBURG_KS) });
    const results = await search('pittsburgh', 'search', null);
    expect(results.map((r) => r.id)).toEqual(['photon:R188553', 'photon:R130034']);
    expect(results[0].fullMatch).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('https://photon.komoot.io/api/?q=pittsburgh&limit=8&lang=en');
  });

  it('re-ranks Photon by query coverage ("springfield il")', async () => {
    const { search } = fakeUpstreams({ photon: () => photonCollection(SPRINGFIELD_MO, SPRINGFIELD_IL) });
    const [top] = await search('springfield il', 'search', null);
    expect(top.id).toBe('photon:R2');
  });

  it('passes the camera bias to both providers', async () => {
    const { calls, search } = fakeUpstreams({
      photon: () => photonCollection(),
      nominatim: () => [NOMINATIM_PITTSBURGH],
    });
    await search('pittsburgh', 'search', { lat: 40.4, lon: -80, zoom: 10 });
    const photon = new URL(calls[0]);
    expect(photon.searchParams.get('lat')).toBe('40.4');
    expect(photon.searchParams.get('lon')).toBe('-80');
    expect(photon.searchParams.get('zoom')).toBe('10');
    const nominatim = new URL(calls[1]);
    expect(nominatim.hostname).toBe('nominatim.openstreetmap.org');
    expect(nominatim.searchParams.get('addressdetails')).toBe('1');
    const [w, n, e, s] = nominatim.searchParams.get('viewbox')!.split(',').map(Number);
    expect(w).toBeLessThan(-80);
    expect(e).toBeGreaterThan(-80);
    expect(n).toBeGreaterThan(40.4);
    expect(s).toBeLessThan(40.4);
  });

  it('falls back to Nominatim when Photon is down or finds nothing', async () => {
    const down = fakeUpstreams({
      photon: () => {
        throw new Error('photon 503');
      },
      nominatim: () => [NOMINATIM_PITTSBURGH],
    });
    expect((await down.search('pittsburgh', 'search', null))[0].source).toBe('nominatim');

    const empty = fakeUpstreams({ photon: () => photonCollection(), nominatim: () => [NOMINATIM_PITTSBURGH] });
    expect((await empty.search('pittsburgh', 'search', null))[0].source).toBe('nominatim');
  });

  it("lets Nominatim lead only when it explains more of the query, and dedupes the same OSM object", async () => {
    const { search } = fakeUpstreams({
      photon: () => photonCollection(PITTSBURG_KS, PITTSBURGH),
      nominatim: () => [NOMINATIM_PITTSBURGH],
    });
    // "pittsburgh ohio": nothing covers "ohio" — Photon's order stands, and
    // Nominatim's Pittsburgh is the same relation as Photon's, so it appears once.
    const results = await search('pittsburgh ohio', 'search', null);
    expect(results.map((r) => r.id)).toEqual(['photon:R130034', 'photon:R188553']);
  });

  it('prefers Nominatim when it covers the whole query and Photon does not', async () => {
    const { search } = fakeUpstreams({
      photon: () => photonCollection(HOUSE),
      nominatim: () => [NOMINATIM_WHITE_HOUSE],
    });
    const [top] = await search('white house 1600 pennsylvania', 'search', null);
    expect(top.id).toBe('nominatim:W238241022');
  });

  it("won't trade a nearby partial match for a far-off full one when the camera is on an area", async () => {
    const tokyo = {
      osm_type: 'node', osm_id: 7, lat: '35.68', lon: '139.76', category: 'amenity', type: 'cafe',
      addresstype: 'amenity', name: 'Starbucks Coffee', display_name: 'Starbucks Coffee, Chiyoda, Tokyo, Japan',
      address: { country_code: 'jp' },
    };
    const { search } = fakeUpstreams({ photon: () => photonCollection(STARBUCKS), nominatim: () => [tokyo] });
    const nearSeattle = await search('starbucks coffee', 'search', { lat: 47.6, lon: -122.3, zoom: 12 });
    expect(nearSeattle[0].name).toBe('Starbucks');
    expect(nearSeattle[0].context).toContain('Seattle');
    // With no view to be near, the fuller match wins.
    const unbiased = await search('starbucks coffee', 'search', null);
    expect(unbiased[0].name).toBe('Starbucks Coffee');
  });

  it('never asks Nominatim for suggestions', async () => {
    const { calls, search } = fakeUpstreams({ photon: () => photonCollection(SPRINGFIELD_MO) });
    await search('springfield xyz', 'suggest', null);
    expect(calls.every((u) => u.includes('photon'))).toBe(true);
  });

  it('shares the Photon fetch between suggestions and the Enter search, and caches per bias', async () => {
    const { calls, search } = fakeUpstreams({ photon: () => photonCollection(PITTSBURGH) });
    await search('pittsburgh', 'suggest', null);
    await search('Pittsburgh', 'search', null);
    expect(calls).toHaveLength(1);
    await search('pittsburgh', 'search', { lat: 40, lon: -80, zoom: 8 });
    expect(calls).toHaveLength(2);
  });

  it('does not let one ranking leak into the cached copy another request ranks', async () => {
    const { search } = fakeUpstreams({ photon: () => photonCollection(SPRINGFIELD_MO, SPRINGFIELD_IL) });
    const a = await search('springfield il', 'suggest', null);
    const b = await search('springfield', 'suggest', null);
    expect(a.map((r) => r.id)).toEqual(['photon:R2', 'photon:R1']);
    expect(b.map((r) => r.id)).toEqual(['photon:R1', 'photon:R2']);
    expect(a[1].fullMatch).toBe(false);
    expect(b[0].fullMatch).toBe(true);
  });

  it("follows a far-off fuller match when its extra words say where (… washington dc)", async () => {
    const paStreet = photonFeature(-80.2462, 40.1739, {
      osm_type: 'W', osm_id: 5, osm_key: 'highway', osm_value: 'residential', type: 'street',
      name: 'Pennsylvania Avenue', city: 'Washington', state: 'Pennsylvania', country: 'United States', countrycode: 'US',
    });
    const dcAve = {
      osm_type: 'way', osm_id: 6, lat: '38.8964', lon: '-77.0262', category: 'highway', type: 'primary',
      addresstype: 'road', name: 'Pennsylvania Avenue Northwest',
      display_name: 'Pennsylvania Avenue Northwest, Washington, District of Columbia, 20004, United States',
      address: { road: 'Pennsylvania Avenue Northwest', city: 'Washington', state: 'District of Columbia', country: 'United States', country_code: 'us' },
    };
    const { search } = fakeUpstreams({ photon: () => photonCollection(paStreet), nominatim: () => [dcAve] });
    const [top] = await search('pennsylvania ave washington dc', 'search', { lat: 40.44, lon: -79.99, zoom: 13 });
    expect(top.id).toBe('nominatim:W6');
  });

  it('reports a degraded answer when a provider failed but the other had something', async () => {
    const { geocode } = fakeUpstreams({
      photon: () => photonCollection(PITTSBURG_KS),
      nominatim: () => {
        throw new Error('nominatim timeout');
      },
    });
    const out = await geocode('pittsburgh ohio', 'search', null);
    expect(out.degraded).toBe(true);
    expect(out.results[0].id).toBe('photon:R130034');
  });

  it("treats Photon down + Nominatim empty as an outage, not 'no such place'", async () => {
    const { search } = fakeUpstreams({
      photon: () => {
        throw new Error('photon 429');
      },
      nominatim: () => [],
    });
    await expect(search('pitsburgh', 'search', null)).rejects.toThrow('photon 429');
  });

  it('answers an honest empty list when both providers worked and found nothing', async () => {
    const { geocode } = fakeUpstreams({ photon: () => photonCollection(), nominatim: () => [] });
    expect(await geocode('zzzzqqqq', 'search', null)).toEqual({ results: [], degraded: false });
  });

  it('answers from Photon alone (degraded) when no Nominatim turn comes soon enough', async () => {
    const calls: string[] = [];
    const geocode = createGeocoder({
      fetchJson: async (url) => {
        calls.push(new URL(url).hostname);
        return photonCollection(PITTSBURG_KS);
      },
      cache: new TtlCache(),
      nominatimTurn: async () => false,
    });
    const out = await geocode('pittsburgh ohio', 'search', null);
    expect(calls).toEqual(['photon.komoot.io']);
    expect(out).toMatchObject({ degraded: true, results: [{ id: 'photon:R130034' }] });
  });

  it('throws only when both providers fail', async () => {
    const { search } = fakeUpstreams({
      photon: () => {
        throw new Error('photon down');
      },
      nominatim: () => {
        throw new Error('nominatim down');
      },
    });
    await expect(search('x y z', 'search', null)).rejects.toThrow('photon down');
  });
});

// ── The route ─────────────────────────────────────────────────────────────────

describe('GET /api/geocode', () => {
  let server: Server;
  let base = '';
  const realFetch = globalThis.fetch;
  let upstream: (url: URL) => Response = () => new Response('[]');
  const seen: Array<{ url: string; ua: string | null }> = [];

  beforeAll(async () => {
    const app = express();
    app.use('/api/geocode', geocodeRouter);
    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => resolve());
    });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/geocode`;
  });
  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  beforeEach(() => {
    seen.length = 0;
    vi.stubGlobal('fetch', async (input: string | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.hostname === '127.0.0.1') return realFetch(input, init);
      seen.push({ url: String(input), ua: new Headers(init?.headers).get('user-agent') });
      return upstream(url);
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('rejects a missing or oversized query without calling upstream', async () => {
    expect((await realFetch(`${base}`)).status).toBe(400);
    expect((await realFetch(`${base}?q=%20%20`)).status).toBe(400);
    expect((await realFetch(`${base}?q=${'a'.repeat(201)}`)).status).toBe(400);
    expect(seen).toHaveLength(0);
  });

  it('returns normalized results, identified upstream, browser-cacheable', async () => {
    upstream = () => Response.json(photonCollection(GERMANY));
    const res = await realFetch(`${base}?q=germany-route-test&mode=suggest&lat=50&lon=10&zoom=6`);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('private, max-age=600');
    const body = await res.json();
    expect(body.results[0]).toMatchObject({ name: 'Germany', kind: 'country', fullMatch: false });
    expect(seen).toHaveLength(1);
    expect(seen[0].ua).toBeTruthy();
    expect(new URL(seen[0].url).searchParams.get('zoom')).toBe('6');
  });

  it("doesn't let the browser cache a degraded answer", async () => {
    upstream = (url) =>
      url.hostname === 'photon.komoot.io'
        ? Response.json(photonCollection(PITTSBURG_KS))
        : new Response('busy', { status: 503 });
    const res = await realFetch(`${base}?q=route-test-degraded`);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect((await res.json()).results).toHaveLength(1);
  });

  it('answers 502 when every provider fails', async () => {
    upstream = () => new Response('nope', { status: 503 });
    const res = await realFetch(`${base}?q=route-test-both-down`);
    expect(res.status).toBe(502);
    expect(seen.map((s) => new URL(s.url).hostname)).toEqual(['photon.komoot.io', 'nominatim.openstreetmap.org']);
  });
});
