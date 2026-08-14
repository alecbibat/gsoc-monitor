import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchDirections } from './directionsClient';

// Exercises the radius/tier sweep against a stubbed Overpass. OSRM always
// fails here, so every leg falls back to a straight line and `distanceM` stays
// exactly what the sweep measured — which keeps the ordering assertions honest.

interface StubElement {
  lat: number;
  lon: number;
  tags: Record<string, string>;
}

const ORIGIN = { lat: 45.0, lon: -110.0 };

/** ~1 km per 0.009° of latitude at this latitude — close enough to place
 *  fixtures at a predictable distance. */
function north(km: number): number {
  return ORIGIN.lat + km * 0.009;
}

/**
 * @param byClause matched against the decoded Overpass query; the first entry
 *   whose key appears in the query supplies that call's elements.
 */
function stubOverpass(byClause: Array<[string, StubElement[]]>) {
  const calls: string[] = [];
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    if (typeof url === 'string' && url.includes('project-osrm')) {
      return { ok: false, status: 503, json: async () => ({}) } as unknown as Response;
    }
    const query = decodeURIComponent(String(init?.body ?? '')).replace(/^data=/, '');
    calls.push(query);
    const hit = byClause.find(([needle]) => query.includes(needle));
    return {
      ok: true,
      status: 200,
      json: async () => ({ elements: hit ? hit[1] : [] }),
    } as unknown as Response;
  });
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe('fetchDirections — hospital tiering', () => {
  it('prefers a distant general hospital over a nearby psychiatric one', async () => {
    stubOverpass([
      [
        '"amenity"="hospital"',
        [
          { lat: north(2), lon: ORIGIN.lon, tags: { amenity: 'hospital', 'healthcare:speciality': 'psychiatry', name: 'Cedar Behavioral' } },
          { lat: north(40), lon: ORIGIN.lon, tags: { amenity: 'hospital', name: 'Livingston HealthCare' } },
        ],
      ],
    ]);

    const { hospitals } = await fetchDirections(ORIGIN.lat, ORIGIN.lon);

    expect(hospitals[0].name).toBe('Livingston HealthCare');
    expect(hospitals[0].serviceLabel).toBe('Hospital');
    // The psychiatric hospital is still offered — as option B, saying what it is.
    expect(hospitals[1].name).toBe('Cedar Behavioral');
    expect(hospitals[1].serviceLabel).toContain('no emergency dept');
    expect(hospitals[1].distanceM).toBeLessThan(hospitals[0].distanceM);
  });

  it('never offers an acupuncture or chiropractic clinic as the hospital', async () => {
    stubOverpass([
      [
        '"amenity"="clinic"',
        [
          { lat: north(1), lon: ORIGIN.lon, tags: { amenity: 'clinic', 'healthcare:speciality': 'acupuncture', name: 'Still Point Acupuncture' } },
          { lat: north(2), lon: ORIGIN.lon, tags: { amenity: 'clinic', 'healthcare:speciality': 'chiropractic', name: 'Peak Chiropractic' } },
          { lat: north(3), lon: ORIGIN.lon, tags: { amenity: 'clinic', leisure: 'sports_centre', name: 'Gallatin Sports Center' } },
        ],
      ],
    ]);

    const { hospitals } = await fetchDirections(ORIGIN.lat, ORIGIN.lon);

    expect(hospitals).toHaveLength(0);
  });

  it('falls back to urgent care only when no hospital exists in range, and labels it', async () => {
    stubOverpass([
      // No match for the hospital clauses — that tier sweeps every radius dry.
      ['"emergency"="yes"', [{ lat: north(9), lon: ORIGIN.lon, tags: { amenity: 'clinic', emergency: 'yes', name: 'Big Sky Urgent Care' } }]],
    ]);

    const { hospitals } = await fetchDirections(ORIGIN.lat, ORIGIN.lon);

    expect(hospitals).toHaveLength(1);
    expect(hospitals[0].name).toBe('Big Sky Urgent Care');
    expect(hospitals[0].serviceLabel).toBe('Urgent care');
    expect(hospitals[0].tier).toBeGreaterThan(0);
  });

  it('stops at the hospital tier instead of querying for clinics', async () => {
    const calls = stubOverpass([
      ['"amenity"="hospital"', [{ lat: north(5), lon: ORIGIN.lon, tags: { amenity: 'hospital', emergency: 'yes', name: 'Bozeman Health' } }]],
    ]);

    const { hospitals } = await fetchDirections(ORIGIN.lat, ORIGIN.lon);

    expect(hospitals[0].serviceLabel).toBe('Hospital · emergency dept');
    expect(calls.some((q) => q.includes('"amenity"="clinic"'))).toBe(false);
    // And one hospital in the first ring settles it: no radius expansion, so
    // the strict filter costs a single Overpass round trip, not four.
    expect(calls.filter((q) => q.includes('"amenity"="hospital"'))).toHaveLength(1);
  });
});

describe('fetchDirections — lodging', () => {
  it('excludes the pin itself when the property is a hotel', async () => {
    stubOverpass([
      [
        '"tourism"',
        [
          // The pin's own building, mapped as a polygon whose centroid sits
          // ~220 m off the pin — the old flat 80 m guard let this through.
          { lat: north(0.22), lon: ORIGIN.lon, tags: { tourism: 'hotel', name: 'Many Glacier Hotel' } },
          { lat: north(6), lon: ORIGIN.lon, tags: { tourism: 'motel', name: 'Swiftcurrent Motor Inn' } },
        ],
      ],
    ]);

    const { hotels } = await fetchDirections(ORIGIN.lat, ORIGIN.lon, 'Many Glacier Hotel');

    expect(hotels.map((h) => h.name)).toEqual(['Swiftcurrent Motor Inn']);
    expect(hotels[0].serviceLabel).toBe('Motel');
  });
});

describe('fetchDirections — emergency services', () => {
  it('skips police offices and decommissioned fire stations', async () => {
    stubOverpass([
      [
        '"amenity"="police"',
        [
          { lat: north(1), lon: ORIGIN.lon, tags: { amenity: 'police', police: 'offices', name: 'County Admin' } },
          { lat: north(12), lon: ORIGIN.lon, tags: { amenity: 'police', operator: 'Park County Sheriff' } },
        ],
      ],
      [
        '"amenity"="fire_station"',
        [
          { lat: north(2), lon: ORIGIN.lon, tags: { amenity: 'fire_station', disused: 'yes', name: 'Old Station 2' } },
          { lat: north(8), lon: ORIGIN.lon, tags: { amenity: 'fire_station', 'fire_station:type': 'volunteer', name: 'Gardiner VFD' } },
        ],
      ],
    ]);

    const { police, fireStations } = await fetchDirections(ORIGIN.lat, ORIGIN.lon);

    expect(police).toHaveLength(1);
    expect(police[0].serviceLabel).toBe('Police · Park County Sheriff');
    expect(fireStations).toHaveLength(1);
    expect(fireStations[0].name).toBe('Gardiner VFD');
    expect(fireStations[0].serviceLabel).toBe('Fire station · volunteer');
  });
});
