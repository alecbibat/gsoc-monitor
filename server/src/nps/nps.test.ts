import { describe, expect, it } from 'vitest';
import { alertCategory, normalizeNpsAlert, normalizeNpsAlerts, type RawNpsAlert } from './alerts';
import { normalizeNewsRelease, normalizeNewsReleases, releasePark, type RawNpsNewsRelease } from './news';
import { absUrl, parseNpsDate, plainText } from './text';
import { npsUrl } from './api';
import { NPS_PARK_CODES } from './parks';

// Trimmed from live /alerts records for the followed parks (2026-11-05).
const gtsr: RawNpsAlert = {
  id: 'a1b2c3d4-0000-4000-8000-000000000001',
  url: 'https://www.nps.gov/glac/planyourvisit/directions.htm',
  title: 'Going-to-the-Sun Road Seasonal Closure',
  parkCode: 'glac',
  description:
    'Going-to-the-Sun Road is closed for the season at Avalanche Creek on the west side of the park. On the east side, the closure is located at Jackson Glacier Overlook.',
  category: 'Park Closure',
  relatedRoadEvents: [],
  lastIndexedDate: '2026-11-02 00:00:00.0',
};

const gardnerBridge: RawNpsAlert = {
  id: 'a1b2c3d4-0000-4000-8000-000000000002',
  url: 'https://www.nps.gov/yell/planyourvisit/parkroads.htm',
  title: 'Traffic Delays - Gardner River High Bridge',
  parkCode: 'yell',
  description: 'Expect a single lane of traffic with up to 15-minute delays, 24 hours a day.',
  category: 'Information',
  relatedRoadEvents: [
    {
      title: 'Traffic Delays - Gardner River High Bridge',
      id: '57EFE369-9186-400A-8F18-0E966993B8A3',
      type: 'roadevent',
      url: 'https://www.nps.gov/yell/planyourvisit/conditions.htm',
    },
  ],
  lastIndexedDate: '2026-10-29 00:00:00.0',
};

const innerCanyonWater: RawNpsAlert = {
  id: 'a1b2c3d4-0000-4000-8000-000000000003',
  url: '',
  title: 'INNER CANYON WATER SHUTOFFS',
  parkCode: 'grca',
  description: 'Beginning Sep. 6, no potable water will be available in the inner canyon.',
  category: 'Danger',
  relatedRoadEvents: [],
  lastIndexedDate: '2026-09-11 00:00:00.0',
};

const gasPumps: RawNpsAlert = {
  id: 'a1b2c3d4-0000-4000-8000-000000000004',
  url: '',
  title: 'Gas Pumps at Panamint Springs Resort are Closed at Night',
  parkCode: 'deva',
  description: 'Gasoline is available at Panamint Springs Resort from 7am-9:30pm, daily.',
  category: 'Information',
  relatedRoadEvents: [],
  lastIndexedDate: '2025-01-27 12:37:06.0',
};

const lodging: RawNpsAlert = {
  id: 'a1b2c3d4-0000-4000-8000-000000000005',
  url: 'https://www.nps.gov/grca/learn/news/overnight-lodging.htm',
  title: 'Overnight Lodging Suspended and Parkwide Stage 4 Water Restrictions',
  parkCode: 'grca',
  description: 'Grand Canyon National Park has implemented Stage 4 water restrictions on the South Rim.',
  category: 'Caution',
  relatedRoadEvents: [],
  lastIndexedDate: '2026-09-30 00:00:00.0',
};

describe('parseNpsDate', () => {
  it('reads a midnight stamp as a bare calendar date at 12:00 UTC', () => {
    expect(parseNpsDate('2026-11-04 00:00:00.0')).toEqual({
      day: '2026-11-04',
      ms: Date.UTC(2026, 10, 4, 12),
      dateOnly: true,
    });
    expect(parseNpsDate('2026-11-04')).toMatchObject({ day: '2026-11-04', dateOnly: true });
  });

  it('keeps a clock time', () => {
    expect(parseNpsDate('2025-01-27 12:37:06.0')).toEqual({
      day: '2025-01-27',
      ms: Date.UTC(2025, 0, 27, 12, 37, 6),
      dateOnly: false,
    });
  });

  it('honours an explicit zone', () => {
    expect(parseNpsDate('2026-11-04T00:00:00Z')?.ms).toBe(Date.UTC(2026, 10, 4));
    expect(parseNpsDate('2026-11-04T08:30:00-0700')?.ms).toBe(Date.UTC(2026, 10, 4, 15, 30));
  });

  it('rejects blanks and junk', () => {
    expect(parseNpsDate('')).toBeNull();
    expect(parseNpsDate(undefined)).toBeNull();
    expect(parseNpsDate('soon')).toBeNull();
  });
});

describe('plainText', () => {
  it('strips tags and entities, keeping paragraph breaks', () => {
    expect(plainText('<p>Road&nbsp;closed at <a href="/x">Mile&nbsp;8</a>.</p><p>Use &amp; caution&#8212;ice.</p>')).toBe(
      'Road closed at Mile 8.\n\nUse & caution—ice.'
    );
    expect(plainText('Line one<br/>line   two')).toBe('Line one line two');
    expect(plainText(null)).toBe('');
  });
});

describe('absUrl', () => {
  it('makes NPS links absolute and https', () => {
    expect(absUrl('/yell/planyourvisit/conditions.htm')).toBe('https://www.nps.gov/yell/planyourvisit/conditions.htm');
    expect(absUrl('http://www.nps.gov/glac/index.htm')).toBe('https://www.nps.gov/glac/index.htm');
    expect(absUrl('  ')).toBeNull();
    expect(absUrl('javascript:alert(1)')).toBeNull();
  });
});

describe('normalizeNpsAlert', () => {
  it('maps NPS categories', () => {
    expect(alertCategory('Danger')).toBe('danger');
    expect(alertCategory('Park Closure')).toBe('closure');
    expect(alertCategory('Caution')).toBe('caution');
    expect(alertCategory('Information')).toBe('info');
    expect(alertCategory(undefined)).toBe('info');
  });

  it('flattens a record for a followed park', () => {
    expect(normalizeNpsAlert(gtsr)).toEqual({
      id: gtsr.id,
      parkCode: 'glac',
      park: 'Glacier',
      parkFullName: 'Glacier National Park',
      category: 'closure',
      categoryLabel: 'Park Closure',
      title: 'Going-to-the-Sun Road Seasonal Closure',
      description: gtsr.description,
      url: 'https://www.nps.gov/glac/planyourvisit/directions.htm',
      conditionsUrl: 'https://www.nps.gov/glac/planyourvisit/conditions.htm',
      postedDay: '2026-11-02',
      postedAt: Date.UTC(2026, 10, 2, 12),
      roadEvents: [],
    });
  });

  it('keeps related road events and falls back to no link when NPS gave none', () => {
    expect(normalizeNpsAlert(gardnerBridge)?.roadEvents).toEqual([
      {
        id: '57EFE369-9186-400A-8F18-0E966993B8A3',
        title: 'Traffic Delays - Gardner River High Bridge',
        url: 'https://www.nps.gov/yell/planyourvisit/conditions.htm',
      },
    ]);
    expect(normalizeNpsAlert(innerCanyonWater)?.url).toBeNull();
  });

  it('drops parks we do not follow and records without an id', () => {
    expect(normalizeNpsAlert({ ...gtsr, parkCode: 'zion' })).toBeNull();
    expect(normalizeNpsAlert({ ...gtsr, id: '' })).toBeNull();
  });

  it('orders the list most serious first, then newest, without duplicates', () => {
    const list = normalizeNpsAlerts([gasPumps, gardnerBridge, gtsr, lodging, innerCanyonWater, gtsr]);
    expect(list.map((a) => a.title)).toEqual([
      'INNER CANYON WATER SHUTOFFS',
      'Going-to-the-Sun Road Seasonal Closure',
      'Overnight Lodging Suspended and Parkwide Stage 4 Water Restrictions',
      'Traffic Delays - Gardner River High Bridge',
      'Gas Pumps at Panamint Springs Resort are Closed at Night',
    ]);
  });
});

// Shaped like /newsreleases records (see the NPS API's swagger.json).
const release: RawNpsNewsRelease = {
  id: 'B2E5A9E1-1DD8-B71B-0BB2-000000000001',
  url: 'https://www.nps.gov/romo/learn/news/trail-ridge-road-closes-for-the-season.htm',
  title: 'Trail Ridge Road Closes for the Season',
  abstract: 'Trail Ridge Road is closed for the season at Many Parks Curve and the Colorado River Trailhead.',
  parkCode: '',
  relatedParks: [{ parkCode: 'romo' }],
  releaseDate: '2026-10-28 00:00:00.0',
  image: { url: '/common/uploads/news/trail-ridge.jpg', altText: 'Snow on Trail Ridge Road', credit: 'NPS Photo' },
};

describe('normalizeNewsRelease', () => {
  it('finds the park in relatedParks when the top-level code is blank', () => {
    expect(releasePark(release)?.code).toBe('romo');
    expect(releasePark({ ...release, parkCode: 'yell' })?.code).toBe('yell');
    expect(releasePark({ ...release, relatedParks: [{ parkCode: 'zion' }] })).toBeUndefined();
  });

  it('flattens a release', () => {
    expect(normalizeNewsRelease(release)).toEqual({
      id: release.id,
      parkCode: 'romo',
      park: 'Rocky Mountain',
      parkFullName: 'Rocky Mountain National Park',
      title: 'Trail Ridge Road Closes for the Season',
      abstract: release.abstract,
      url: release.url,
      image: {
        url: 'https://www.nps.gov/common/uploads/news/trail-ridge.jpg',
        alt: 'Snow on Trail Ridge Road',
        credit: 'NPS Photo',
      },
      releasedDay: '2026-10-28',
      releasedAt: Date.UTC(2026, 9, 28, 12),
    });
  });

  it('sorts newest first and drops untitled or unfollowed releases', () => {
    const older = { ...release, id: 'old', title: 'Older', releaseDate: '2026-09-01 00:00:00.0' };
    const list = normalizeNewsReleases([older, release, { ...release, id: 'x', title: '' }, { ...release, id: 'y', relatedParks: [] }]);
    expect(list.map((n) => n.id)).toEqual([release.id, 'old']);
  });
});

describe('npsUrl', () => {
  it('keeps the park list comma-separated (an encoded %2C list reads as its first park only)', () => {
    const url = npsUrl('/alerts', { parkCode: NPS_PARK_CODES, limit: 100 });
    expect(url).toBe('https://developer.nps.gov/api/v1/alerts?parkCode=glac,yell,grca,deva,romo,moru&limit=100');
  });

  it('still encodes everything else', () => {
    expect(npsUrl('/newsreleases', { q: 'road & trail', sort: '-releaseDate' })).toBe(
      'https://developer.nps.gov/api/v1/newsreleases?q=road+%26+trail&sort=-releaseDate'
    );
  });
});
