import { describe, it, expect, vi, afterEach } from 'vitest';
import { clearDirectionsCache, fetchDirections, fetchDriveRoute } from './directionsClient';

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

afterEach(() => {
  vi.unstubAllGlobals();
  // Every test shares ORIGIN, so remembered Overpass answers would leak across.
  clearDirectionsCache();
});

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

describe('fetchDirections — re-opens and superseded panels', () => {
  const HOSPITAL: Array<[string, StubElement[]]> = [
    ['"amenity"="hospital"', [{ lat: north(5), lon: ORIGIN.lon, tags: { amenity: 'hospital', emergency: 'yes', name: 'Bozeman Health' } }]],
  ];

  it('reuses successful Overpass answers when the same pin is opened again', async () => {
    const calls = stubOverpass(HOSPITAL);

    const first = await fetchDirections(ORIGIN.lat, ORIGIN.lon);
    const made = calls.length;
    const again = await fetchDirections(ORIGIN.lat, ORIGIN.lon);

    expect(made).toBeGreaterThan(0);
    expect(calls).toHaveLength(made);
    expect(again).toEqual(first);
  });

  it('never remembers a failed call, so the next open retries it', async () => {
    vi.stubGlobal('fetch', async () => ({ ok: false, status: 429, json: async () => ({}) }) as unknown as Response);
    expect((await fetchDirections(ORIGIN.lat, ORIGIN.lon)).hospitals).toHaveLength(0);

    stubOverpass(HOSPITAL);
    const { hospitals } = await fetchDirections(ORIGIN.lat, ORIGIN.lon);

    expect(hospitals[0].name).toBe('Bozeman Health');
  });

  it('never remembers an Overpass runtime-error answer', async () => {
    vi.stubGlobal('fetch', async (url: string) => {
      if (url.includes('project-osrm')) return { ok: false, status: 503, json: async () => ({}) } as unknown as Response;
      return {
        ok: true,
        status: 200,
        json: async () => ({ elements: [], remark: 'runtime error: Query timed out in "query" at line 1 after 21 seconds.' }),
      } as unknown as Response;
    });
    expect((await fetchDirections(ORIGIN.lat, ORIGIN.lon)).hospitals).toHaveLength(0);

    stubOverpass(HOSPITAL);
    const { hospitals } = await fetchDirections(ORIGIN.lat, ORIGIN.lon);

    expect(hospitals[0].name).toBe('Bozeman Health');
  });

  it('stops issuing requests once the caller aborts', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
      calls.push(url);
      // Hangs until aborted, like a slow Overpass instance.
      return new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
      });
    });
    const ac = new AbortController();

    const pending = fetchDirections(ORIGIN.lat, ORIGIN.lon, undefined, ac.signal);
    const inFlight = calls.length; // each category's first radius
    ac.abort();
    const res = await pending;

    expect(inFlight).toBeGreaterThan(0);
    expect(calls).toHaveLength(inFlight); // no wider radius, tier or OSRM call
    expect([...res.hospitals, ...res.hotels, ...res.police, ...res.fireStations]).toHaveLength(0);
  });
});

describe('fetchDriveRoute', () => {
  it('skips the unused overview geometry but still reports the road route', async () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      urls.push(url);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          code: 'Ok',
          routes: [{ distance: 1234, duration: 99, legs: [{ steps: [{ distance: 1234, name: 'Main St', maneuver: { type: 'depart' } }] }] }],
        }),
      } as unknown as Response;
    });

    const r = await fetchDriveRoute(ORIGIN.lat, ORIGIN.lon, north(1), ORIGIN.lon);

    expect(urls[0]).toContain('overview=false');
    expect(r.routed).toBe(true);
    expect(r.distanceM).toBe(1234);
    expect(r.durationS).toBe(99);
    expect(r.steps).toEqual([{ instruction: 'Head out on Main St', distanceM: 1234 }]);
  });
});
