import { describe, expect, it } from 'vitest';
import { parseAdsbdbAircraft, parsePlanespottersPhoto } from './aircraftInfo';

describe('parseAdsbdbAircraft', () => {
  it('extracts the registry fields from the response envelope', () => {
    const parsed = parseAdsbdbAircraft({
      response: {
        aircraft: {
          type: 'Citation Excel',
          icao_type: 'C56X',
          manufacturer: 'Cessna',
          mode_s: 'A1B2C3',
          registration: 'N154LA',
          registered_owner: 'Example Aviation LLC',
          url_photo: 'https://example.test/p.jpg',
        },
      },
    });
    expect(parsed).toEqual({
      manufacturer: 'Cessna',
      model: 'Citation Excel',
      icaoType: 'C56X',
      owner: 'Example Aviation LLC',
    });
  });

  it('returns null for the unknown-aircraft sentinel and malformed shapes', () => {
    expect(parseAdsbdbAircraft({ response: 'unknown aircraft' })).toBeNull();
    expect(parseAdsbdbAircraft({ response: { aircraft: {} } })).toBeNull();
    expect(parseAdsbdbAircraft(null)).toBeNull();
    expect(parseAdsbdbAircraft('nonsense')).toBeNull();
  });

  it('treats empty strings as missing fields', () => {
    const parsed = parseAdsbdbAircraft({
      response: { aircraft: { type: '  ', manufacturer: '', icao_type: 'PC12' } },
    });
    expect(parsed).toEqual({ manufacturer: null, model: null, icaoType: 'PC12', owner: null });
  });
});

describe('parsePlanespottersPhoto', () => {
  it('keeps the first photo, preferring the large thumbnail', () => {
    const photo = parsePlanespottersPhoto({
      photos: [
        {
          id: '123',
          thumbnail: { src: 'https://t.test/small.jpg', size: { width: 280, height: 210 } },
          thumbnail_large: { src: 'https://t.test/large.jpg', size: { width: 640, height: 480 } },
          link: 'https://www.planespotters.net/photo/123',
          photographer: 'A Spotter',
        },
        { id: '456' },
      ],
    });
    expect(photo).toEqual({
      src: 'https://t.test/large.jpg',
      link: 'https://www.planespotters.net/photo/123',
      photographer: 'A Spotter',
    });
  });

  it('falls back to the small thumbnail when no large one exists', () => {
    const photo = parsePlanespottersPhoto({
      photos: [
        {
          thumbnail: { src: 'https://t.test/small.jpg' },
          link: 'https://www.planespotters.net/photo/9',
          photographer: 'B Spotter',
        },
      ],
    });
    expect(photo?.src).toBe('https://t.test/small.jpg');
  });

  it('returns null for an empty list, a photo without a usable URL, or junk', () => {
    expect(parsePlanespottersPhoto({ photos: [] })).toBeNull();
    expect(parsePlanespottersPhoto({ photos: [{ photographer: 'C' }] })).toBeNull();
    expect(parsePlanespottersPhoto(null)).toBeNull();
    expect(parsePlanespottersPhoto({ error: 'rate limited' })).toBeNull();
  });
});
