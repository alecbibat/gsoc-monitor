import { describe, expect, it } from 'vitest';
import { lcsKind, normalizeCaltransLcs, type LcsRecord } from './caltrans';
import { normalizeDeathValleyRoads, normalizeGlacierRoads, normalizeYellowstoneRoads } from './parkRoads';

const NOW = Date.parse('2026-11-05T15:00:00Z');
const line = (lon: number, lat: number) => [[lon, lat], [lon + 0.01, lat + 0.005], [lon + 0.02, lat + 0.01]];

// Shapes trimmed from the live park road-status services (2026-11-05).
describe('Yellowstone road status', () => {
  const seg = (name_segment: string, wheeled: boolean, oversnow: boolean) => ({
    geometry: { type: 'MultiLineString', coordinates: [line(-110.83, 44.45)] },
    properties: {
      name: 'Grand Loop Rd',
      name_segment,
      npmap_id: `id-${name_segment}`,
      updated_at: '2026-11-01T13:44:40Z',
      public_open_to_wheeled_vehicles: wheeled,
      public_open_to_oversnow_vehicles: oversnow,
    },
  });

  it('turns each segment closed to wheeled vehicles into a closure', () => {
    const out = normalizeYellowstoneRoads({
      features: [seg('Madison Junction to Old Faithful', false, false), seg('North Entrance to Mammoth', true, false)],
    });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      id: 'yell:id-Madison Junction to Old Faithful',
      source: 'yell',
      parkCode: 'yell',
      title: 'Grand Loop Rd: Madison Junction to Old Faithful',
      roadNames: ['Grand Loop Rd'],
      impact: 'closed',
      description: 'Closed to all wheeled vehicles.',
      updated: '2026-11-01T13:44:40.000Z',
      url: 'https://www.nps.gov/yell/planyourvisit/parkroads.htm',
    });
    expect(out[0].lines).toHaveLength(1);
    expect(out[0].point).not.toBeNull();
  });

  it('says when a closed road is open to snowcoaches and snowmobiles', () => {
    const [c] = normalizeYellowstoneRoads({ features: [seg('Madison Junction to Old Faithful', false, true)] });
    expect(c.description).toMatch(/open to over-snow vehicles/i);
  });
});

describe('Glacier road status', () => {
  const piece = (rdname: string, reason: string, extra: Record<string, unknown> = {}) => ({
    geometry: { type: 'LineString', coordinates: line(-113.9, 48.6) },
    properties: { rdname, reason, status: 'closed', seasdesc: null, maintainer: 'National Park Service', ...extra },
  });

  it('merges the pieces of one closed road and keeps the reason and usual season', () => {
    const out = normalizeGlacierRoads({
      features: [
        piece('Going-to-the-Sun Road', 'Winter Weather'),
        piece('Going-to-the-Sun Road', 'Winter Weather'),
        piece('Two Medicine Road', 'Closed for construction', { seasdesc: 'Closed Jan 1 - Mar 25' }),
        piece('Camas Road', 'Open', { status: 'open' }),
      ],
    });
    expect(out.map((c) => c.title)).toEqual(['Going-to-the-Sun Road closed', 'Two Medicine Road closed']);
    expect(out[0].lines).toHaveLength(2);
    expect(out[0]).toMatchObject({ parkCode: 'glac', impact: 'closed', description: 'Winter Weather.' });
    expect(out[1].description).toBe('Closed for construction. Usual season: Closed Jan 1 - Mar 25.');
  });

  it('names unnamed roads and notes a non-NPS maintainer', () => {
    const [c] = normalizeGlacierRoads({ features: [piece('No Name', 'Seasonal Closure ', { maintainer: 'Flathead County' })] });
    expect(c.title).toBe('Unnamed park road closed');
    expect(c.description).toBe('Seasonal Closure. Maintained by Flathead County.');
  });
});

describe('Death Valley road status', () => {
  const road = (RoadName: string, Notes: string | null, RoadStatus = 'Closed') => ({
    geometry: { type: 'LineString', coordinates: line(-117.4, 36.9) },
    properties: { RoadName, RoadStatus, Notes },
  });

  it('merges the segments of a closed road and leads with the park note', () => {
    const out = normalizeDeathValleyRoads({
      features: [
        road('Scottys Castle Road', 'Due to flood recovery work. No access permitted.'),
        road('Scottys Castle Road', 'Due to flood recovery work. No access permitted.'),
        road('SR 190', null, 'Open'),
        road('Titus Canyon Road', null),
      ],
    });
    expect(out.map((c) => [c.title, c.description, c.lines.length])).toEqual([
      ['Scottys Castle Road closed', 'Due to flood recovery work. No access permitted.', 2],
      ['Titus Canyon Road closed', 'Closed.', 1],
    ]);
    expect(out.every((c) => c.parkCode === 'deva' && c.source === 'deva')).toBe(true);
  });

  it('surfaces an ArcGIS error body as a failure, not as "nothing closed"', () => {
    expect(() => normalizeDeathValleyRoads({ error: { message: 'Invalid query' } })).toThrow(/Invalid query/);
  });
});

describe('Caltrans lane closures', () => {
  const rec = (over: {
    facility?: string;
    type?: string;
    c1097?: string;
    c1098?: string;
    c1022?: string;
    begin?: [number, number];
    end?: [number, number];
    endEpoch?: string;
    indefinite?: string;
  }): LcsRecord => ({
    lcs: {
      index: `C-${over.type ?? 'Full'}-${over.facility ?? 'Conventional Hwy'}-${over.begin?.join(',') ?? ''}`,
      location: {
        travelFlowDirection: 'East / West',
        begin: {
          beginRoute: 'SR-190',
          beginLocationName: 'Towne Pass',
          beginLongitude: String((over.begin ?? [-117.3, 36.38])[0]),
          beginLatitude: String((over.begin ?? [-117.3, 36.38])[1]),
        },
        end: {
          endLocationName: 'Emigrant Canyon Road',
          endLongitude: String((over.end ?? [-117.29, 36.385])[0]),
          endLatitude: String((over.end ?? [-117.29, 36.385])[1]),
        },
      },
      closure: {
        closureTimestamp: {
          closureStartEpoch: String(NOW / 1000 - 3600),
          closureEndEpoch: over.endEpoch ?? String(NOW / 1000 + 7200),
          isClosureEndIndefinite: over.indefinite ?? 'false',
        },
        facility: over.facility ?? 'Conventional Hwy',
        typeOfClosure: over.type ?? 'Full',
        typeOfWork: 'Emergency Work',
        estimatedDelay: 'Not Reported',
        lanesClosed: '1',
        code1097: { isCode1097: over.c1097 ?? 'true' },
        code1098: { isCode1098: over.c1098 ?? 'false' },
        code1022: { isCode1022: over.c1022 ?? 'false' },
      },
    },
  });

  it('classifies by facility and type', () => {
    expect(lcsKind('Conventional Hwy', 'Full')).toEqual({ impact: 'closed', what: 'closed' });
    expect(lcsKind('Mainline', 'Lane')).toEqual({ impact: 'restricted', what: 'lane closure' });
    expect(lcsKind('Off Ramp', 'Full')).toEqual({ impact: 'restricted', what: 'off ramp closed' });
    expect(lcsKind('Rest Area', 'Full')).toBeNull();
    expect(lcsKind('Conventional Hwy', 'Traffic Break')).toBeNull();
  });

  it('keeps closures in place near a park, with a short line between their ends', () => {
    const [c] = normalizeCaltransLcs({ data: [rec({})] }, NOW);
    expect(c).toMatchObject({
      source: 'caltrans',
      parkCode: 'deva',
      title: 'SR-190 closed',
      roadNames: ['SR-190'],
      impact: 'closed',
      description: 'Towne Pass to Emigrant Canyon Road. Emergency Work.',
      direction: 'East / West',
      point: [-117.3, 36.38],
      url: 'https://roads.dot.ca.gov/roadscell.php?roadnumber=190',
    });
    expect(c.lines).toEqual([[[-117.3, 36.38], [-117.29, 36.385]]]);
  });

  it('skips closures not set up yet, picked up, cancelled, over, or far from a park', () => {
    const data = [
      rec({ c1097: 'false' }),
      rec({ c1098: 'true' }),
      rec({ c1022: 'true' }),
      rec({ endEpoch: String(NOW / 1000 - 60) }),
      rec({ begin: [-121.5, 38.5], end: [-121.49, 38.5] }), // Sacramento
    ];
    expect(normalizeCaltransLcs({ data }, NOW)).toEqual([]);
  });

  it('draws no straight line across long stretches, and reads an open-ended closure', () => {
    const [c] = normalizeCaltransLcs({ data: [rec({ end: [-117.0, 36.5], indefinite: 'true' })] }, NOW);
    expect(c.lines).toEqual([]);
    expect(c.end).toBeNull();
  });
});
