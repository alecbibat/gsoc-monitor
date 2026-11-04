import { describe, expect, it } from 'vitest';
import { normalizeWarnAlert, normalizeWarnPage } from './warn';

// Trimmed from live PBS WARN records (2026-11).
const NOW = Date.parse('2026-11-04T14:18:30Z');

const roadClosure = {
  id: 63400,
  cap_identifier: 'LADOT-2adbb26c-6946-48ac-a3a8-58932c909016',
  cmac_message_number: 'b4334831',
  msg_type: 'alert',
  status: 'Actual',
  sent: '2026-11-04T00:01:54.717000+00:00',
  expires: '2026-11-05T00:01:52+00:00',
  event: 'Local Area Emergency',
  sender: 'LADOTD,Baton Rouge,LA',
  category: 'transport',
  severity: 'Severe',
  urgency: 'Immediate',
  certainty: 'Observed',
  response_type: null,
  cmac_special_handling: 'Public Safety',
  is_cancelled: false,
  is_out_of_date: false,
  texts: [
    { type: 'cap_headline', language: 'English', value: 'LADOTD:LA-174 CLOSED near Bob Wilson Road. Expect delays..' },
    { type: 'cmac_short_text', language: 'English', value: 'LADOTD:LA-174 CLOSED near Bob Wilson Road. Expect delays..' },
    { type: 'cmac_long_text', language: 'English', value: 'LADOTD: LA-174 is closed near Bob Wilson Road due to a natural gas leak.' },
    { type: 'cmac_long_text', language: 'Spanish', value: 'LADOTD: LA-174 está cerrada.' },
  ],
  areas: [
    { type: 'state', value: '22' },
    { type: 'cmas_geocode', value: '22069' },
    { type: 'cmas_geocode', value: '22031' },
    { type: 'polygon', value: [[31.8772061, -93.3833225], [31.8761311, -93.3869381], [31.87, -93.38], [31.8772061, -93.3833225]] },
    { type: 'area_description', value: 'AffectedArea' },
  ],
};

// County-only: the county outline rides on the geocode entry.
const outage911 = {
  ...roadClosure,
  id: 63373,
  cap_identifier: 'ASHERGROUP-1783437-post-1793720794',
  cmac_message_number: 'b4329fed',
  event: '911 Telephone Outage Emergency',
  sender: '201265,,Park County WY',
  category: 'infra',
  expires: '2026-11-04T14:35:00+00:00',
  texts: [{ type: 'cmac_short_text', language: 'English', value: 'Park Co.OHS: 911 lines are down.' }],
  areas: [
    { type: 'state', value: '56' },
    { type: 'cmas_geocode', value: '56029', polygons: [[[43.843, -109.857], [43.848, -109.855], [43.849, -109.851], [43.843, -109.857]]] },
    { type: 'area_description', value: 'In this area' },
  ],
};

const nwsFlashFlood = {
  ...roadClosure,
  id: 63401,
  cap_identifier: 'urn:oid:2.49.0.1.840.0.eb180187417b37a83e33a70d9ab94cf1d74915de.001.1.IPAWS',
  cmac_message_number: 'b4334900',
  event: 'Flash Flood Warning',
  sender: 'NWS Jackson MS',
  category: 'met',
  severity: 'Extreme',
  cmac_special_handling: null,
  areas: [{ type: 'circle', value: { center: { latitude: 33.2461, longitude: -87.6222 }, radius: 1.901 } }],
};

describe('normalizeWarnAlert', () => {
  it('flattens a polygon alert, swapping PBS’s [lat, lon] to [lon, lat]', () => {
    const a = normalizeWarnAlert(roadClosure, NOW)!;
    expect(a).toMatchObject({
      id: 'b4334831',
      event: 'Local Area Emergency',
      sender: 'LADOTD,Baton Rouge,LA',
      weaClass: 'public-safety',
      msgType: 'alert',
      weaText: 'LADOTD:LA-174 CLOSED near Bob Wilson Road. Expect delays..',
      weaLongText: expect.stringContaining('natural gas leak'),
      spanishText: 'LADOTD: LA-174 está cerrada.',
      counties: ['22069', '22031'],
      // The placeholder area description is dropped.
      areaDesc: null,
      nws: false,
      referencedId: null,
    });
    expect(a.polygons).toHaveLength(1);
    expect(a.polygons[0][0]).toEqual([-93.3833225, 31.8772061]);
  });

  it('draws a county-only alert from the outline attached to its county code', () => {
    const a = normalizeWarnAlert(outage911, NOW)!;
    expect(a.counties).toEqual(['56029']);
    expect(a.polygons[0][0]).toEqual([-109.857, 43.843]);
    expect(a.areaDesc).toBe('In this area');
  });

  it('keeps circles, and marks NWS-issued alerts and imminent threats', () => {
    const a = normalizeWarnAlert(nwsFlashFlood, NOW)!;
    expect(a.circles).toEqual([{ lon: -87.6222, lat: 33.2461, radiusKm: 1.901 }]);
    expect(a.weaClass).toBe('imminent-threat');
    expect(a.nws).toBe(true);
  });

  it('links an update to the version it replaces', () => {
    const upd = normalizeWarnAlert({ ...roadClosure, msg_type: 'update', cmac_message_number: 'b4335000', cmac_referenced_message_number: 'b4334831' }, NOW)!;
    expect(upd).toMatchObject({ id: 'b4335000', msgType: 'update', referencedId: 'b4334831' });
  });

  it('classes AMBER alerts', () => {
    expect(normalizeWarnAlert({ ...roadClosure, cmac_special_handling: 'Child Abduction' }, NOW)!.weaClass).toBe('amber');
  });

  it('drops what is not a live WEA', () => {
    expect(normalizeWarnAlert({ ...roadClosure, msg_type: 'cancel' }, NOW)).toBeNull();
    expect(normalizeWarnAlert({ ...roadClosure, is_cancelled: true }, NOW)).toBeNull();
    expect(normalizeWarnAlert({ ...roadClosure, is_out_of_date: true }, NOW)).toBeNull();
    expect(normalizeWarnAlert({ ...roadClosure, status: 'Exercise' }, NOW)).toBeNull();
    expect(normalizeWarnAlert({ ...roadClosure, category: 'test', cmac_special_handling: 'State Local WEA Test' }, NOW)).toBeNull();
    expect(normalizeWarnAlert({ ...roadClosure, expires: '2026-11-04T14:00:00+00:00' }, NOW)).toBeNull();
    expect(normalizeWarnAlert({ ...roadClosure, areas: [{ type: 'state', value: '22' }] }, NOW)).toBeNull();
    expect(normalizeWarnAlert(null, NOW)).toBeNull();
  });

  it('skips malformed points and rings too short to draw', () => {
    const a = normalizeWarnAlert({
      ...roadClosure,
      areas: [
        { type: 'polygon', value: [[31.8, -93.3], ['x', -93.4], [91, -93.5], [31.7, -93.2], [31.9, -93.1]] },
        { type: 'polygon', value: [[31.8, -93.3], [31.7, -93.2]] },
        { type: 'circle', value: { center: { latitude: 33, longitude: -87 }, radius: -1 } },
      ],
    }, NOW)!;
    expect(a.polygons).toEqual([[[-93.3, 31.8], [-93.2, 31.7], [-93.1, 31.9]]]);
    expect(a.circles).toEqual([]);
  });
});

describe('normalizeWarnPage', () => {
  it('reads the page count and heartbeat, and dedupes by id', () => {
    const page = normalizeWarnPage({
      alerts: [roadClosure, outage911, roadClosure, { ...roadClosure, msg_type: 'cancel', cmac_message_number: 'x' }],
      pages: { page: 1, pages: 2, per_page: 50, total: 60 },
      last_heartbeat: 'Wed, 04 Nov 2026 14:18:23 GMT',
    }, NOW);
    expect(page.alerts.map((a) => a.id)).toEqual(['b4334831', 'b4329fed']);
    expect(page.pages).toBe(2);
    expect(page.heartbeat).toBe('2026-11-04T14:18:23.000Z');
  });

  it('rejects a body without an alerts list', () => {
    expect(() => normalizeWarnPage({ error: 'not found' })).toThrow(/alerts/);
  });
});
