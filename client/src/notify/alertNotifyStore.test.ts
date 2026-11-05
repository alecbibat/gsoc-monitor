import { beforeEach, describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { mergeNotifySettings, useAlertNotifyStore } from './alertNotifyStore';
import { NoticeCard } from './AlertNotifier';
import {
  ENDED_COLOR, FLIGHT_COLOR, SHIP_COLOR,
  type FlightNotice, type Notice, type NwsNotice, type QuakeNotice, type ShipNotice, type WarnNotice,
} from './notices';
import type { PinHit } from './pinAlertMatch';

const NOW = Date.parse('2026-11-04T18:00:00Z');
const HIT: PinHit = { pin: { key: 'g::A', name: 'Grand Canyon Village', groupName: 'Grand Canyon', lat: 36.06, lon: -112.14 }, distanceMi: 0 };

const flight: FlightNotice = {
  category: 'flight', key: 'flight:1', color: FLIGHT_COLOR, rank: 2,
  event: {
    id: '1', reg: 'N10AZ', group: 'company', kind: 'takeoff', lat: 39.58, lon: -104.84, t: NOW - 60_000,
    model: 'Dassault Falcon 900 B',
    airport: { ident: 'KAPA', iata: 'APA', name: 'Centennial Airport', municipality: 'Englewood', region: 'CO', country: 'US', distanceKm: 1.4 },
  },
};
const ship: ShipNotice = {
  category: 'ship', key: 'ship:1', color: SHIP_COLOR, rank: 1,
  event: {
    id: '1', mmsi: '309242000', name: 'Wind Surf', kind: 'departure',
    port: { name: 'Cádiz', country: 'ES', locode: 'ESCAD', distanceKm: 0.8 },
    lat: 36.4, lon: -6.3, t: NOW - 30 * 60_000, detectedAt: NOW - 60_000, destination: 'MALAGA',
  },
};
const quake: QuakeNotice = {
  category: 'quake', key: 'quake:us1', color: '#ffb84d', rank: 11, hits: [{ ...HIT, distanceMi: 23.4 }],
  quake: { id: 'us1', mag: 4.8, place: '20 km NE of Tusayan, Arizona', time: NOW - 300_000, lat: 36.1, lon: -111.9, depthKm: 10, url: '', felt: 12, tsunami: 0, status: 'reviewed' },
};
const warn = (key: string, aliases: string[] = []): WarnNotice => ({
  category: 'warn', key, aliases, color: '#ff3366', rank: 14, hits: [HIT], isUpdate: false, changes: [], newPins: [], endedAt: [],
  bbox: [-112.2, 36, -112.1, 36.1],
  alert: {
    id: key, capId: 'cap', event: 'Flash Flood Warning', sender: 'NWS Flagstaff AZ', weaClass: 'imminent-threat',
    category: 'met', severity: 'Extreme', urgency: 'Immediate', certainty: 'Likely', responseType: null, msgType: 'alert',
    referencedId: null, sent: new Date(NOW).toISOString(), expires: new Date(NOW + 3_600_000).toISOString(),
    weaText: 'Flash Flood Warning this area. Avoid flood areas.', weaLongText: null, headline: null, description: null,
    instruction: null, spanishText: null, areaDesc: null, counties: [], polygons: [], circles: [], nws: true,
  },
});

beforeEach(() => {
  useAlertNotifyStore.setState({
    enabled: true,
    categories: { nws: true, warn: true, quake: true, nps: true, flight: true, ship: true },
    queue: [],
    announced: new Set(),
    flashSeq: 0,
  });
});

describe('alert notify store', () => {
  it('queues each event once, even when two sources report it', () => {
    const s = useAlertNotifyStore.getState();
    s.push([warn('warn:a', ['nws:x'])]);
    // The same warning from the NWS feed, by its alias.
    s.push([{ ...warn('nws:x'), category: 'nws' } as unknown as Notice]);
    s.push([warn('warn:a', ['nws:x'])]);
    expect(useAlertNotifyStore.getState().queue.map((n) => n.key)).toEqual(['warn:a']);
    expect(useAlertNotifyStore.getState().flashSeq).toBe(1);
  });

  it('flashes the colour of the most urgent notice in a batch, and shows it first', () => {
    useAlertNotifyStore.getState().push([ship, warn('warn:b'), flight]);
    expect(useAlertNotifyStore.getState().flashColor).toBe('#ff3366');
    expect(useAlertNotifyStore.getState().queue.map((n) => n.key)).toEqual(['warn:b', 'flight:1', 'ship:1']);
  });

  it('puts the most urgent waiting notice next, without swapping the one on screen', () => {
    const s = useAlertNotifyStore.getState();
    s.push([flight]); // on screen
    s.push([ship, quake]);
    s.push([warn('warn:d')]);
    expect(useAlertNotifyStore.getState().queue.map((n) => n.key)).toEqual(['flight:1', 'warn:d', 'quake:us1', 'ship:1']);
  });

  it('drops kinds that are switched off, and clears them from the queue when switched off', () => {
    const s = useAlertNotifyStore.getState();
    s.setCategory('ship', false);
    s.push([ship, flight]);
    expect(useAlertNotifyStore.getState().queue.map((n) => n.key)).toEqual(['flight:1']);
    s.setCategory('flight', false);
    expect(useAlertNotifyStore.getState().queue).toEqual([]);
  });

  it('keeps a saved browser’s choices and turns on kinds it never saw', () => {
    const merged = mergeNotifySettings({ enabled: false, categories: { ship: false } }, useAlertNotifyStore.getState());
    expect(merged.enabled).toBe(false);
    expect(merged.categories).toEqual({ nws: true, warn: true, quake: true, nps: true, flight: true, ship: false });
  });
});

describe('NoticeCard', () => {
  const render = (notice: Notice) =>
    renderToStaticMarkup(
      createElement(NoticeCard, {
        notice, index: 0, total: 1, now: NOW,
        onShow: () => {}, onDismiss: () => {}, onDismissAll: () => {}, onTurnOff: () => {},
      })
    );

  it('names the airport a company jet took off from', () => {
    const html = render(flight);
    expect(html).toContain('Company aircraft departed');
    expect(html).toContain('N10AZ took off from Centennial Airport (APA)');
    expect(html).toContain('Dassault Falcon 900 B');
    expect(html).toContain('Englewood, CO');
    expect(html).toContain('Wheels up');
  });

  it('names the port a ship left and where it is bound', () => {
    const html = render(ship);
    expect(html).toContain('Wind Surf departed Cádiz, Spain');
    expect(html).toContain('Bound for MALAGA');
    expect(html).toContain('Reported');
  });

  it('shows a quake’s magnitude, place and the properties within 50 mi', () => {
    const html = render(quake);
    expect(html).toContain('M4.8 earthquake');
    expect(html).toContain('20 km NE of Tusayan, Arizona');
    expect(html).toContain('Within 50 mi');
    expect(html).toContain('23.4 mi away');
  });

  const PIN_B = { key: 'g::B', name: 'Phantom Ranch', groupName: 'Grand Canyon', lat: 36.1, lon: -112.09 };
  const nws = (extra: Partial<NwsNotice> = {}): NwsNotice => ({
    category: 'nws', key: 'nws:v2', aliases: ['nws:v2'], id: 'v2', color: '#00ff00', rank: 13,
    alert: {
      geometry: null,
      properties: {
        id: 'v2', event: 'Flood Warning', severity: 'Severe', urgency: 'Immediate', senderName: 'NWS Flagstaff AZ',
        sent: new Date(NOW).toISOString(), ends: new Date(NOW + 30 * 3_600_000).toISOString(), expires: new Date(NOW + 6 * 3_600_000).toISOString(),
      },
    },
    hits: [HIT], isUpdate: true, changes: [], newPins: [], endedAt: [], cancelled: null, bbox: [-112.2, 36, -112.1, 36.1],
    ...extra,
  });

  it('says what changed in an NWS alert: old value struck, new value, newly reached pins marked', () => {
    const html = render(
      nws({
        changes: [
          { label: 'Certainty', from: 'Likely', to: 'Observed', kind: 'text' },
          { label: 'Ends', from: new Date(NOW + 6 * 3_600_000).toISOString(), to: new Date(NOW + 30 * 3_600_000).toISOString(), kind: 'time' },
        ],
        hits: [HIT, { pin: PIN_B, distanceMi: 3.2 }],
        newPins: ['g::B'],
      })
    );
    expect(html).toContain('NWS alert changed near your locations');
    expect(html).toContain('What changed');
    expect(html).toMatch(/Certainty<\/dt><dd[^>]*><span[^>]*line-through[^>]*>Likely<\/span>.*Observed/);
    expect(html).toContain('>Ends<');
    expect(html).toContain('Now reaches');
    expect(html).toMatch(/Phantom Ranch[^]*?>New</);
    // The hazard's own end, not the message's expiry.
    expect(html).toContain('>Ends</span>');
    expect(html).not.toContain('>Expires</span>');
  });

  it('tells an NWS cancellation in the calm colour, with the pins it covered', () => {
    const html = render(nws({ color: ENDED_COLOR, cancelled: { sent: new Date(NOW).toISOString(), text: 'The Flood Warning has been cancelled and is no longer in effect.' }, endedAt: [HIT.pin] }));
    expect(html).toContain('NWS alert cancelled near your locations');
    expect(html).toContain('Flood Warning cancelled');
    expect(html).toContain('has been cancelled and is no longer in effect');
    expect(html).toContain('Was in effect within 15 mi');
    expect(html).toContain('✓');
  });

  it('lists the pins an NWS alert no longer covers', () => {
    const html = render(nws({ color: ENDED_COLOR, hits: [{ pin: PIN_B, distanceMi: 0 }], endedAt: [HIT.pin] }));
    expect(html).toContain('NWS alert no longer in effect at some of your locations');
    expect(html).toMatch(/No longer in effect at<\/dt><dd[^>]*>Grand Canyon Village/);
    expect(html).toContain('Still within 15 mi');
  });

  it('shows what a WEA said before its update', () => {
    const update: WarnNotice = {
      ...warn('warn:u'),
      isUpdate: true,
      changes: [{ label: 'Message', from: 'Shelter in place.', to: 'All clear.', kind: 'text' }],
    };
    const html = render(update);
    expect(html).toContain('Emergency alert updated near your locations');
    expect(html).toContain('Previously: “Shelter in place.”');
  });

  it('leads a WEA with the message sent to phones', () => {
    const html = render(warn('warn:c'));
    expect(html).toContain('Emergency alert sent to phones near your locations');
    expect(html).toContain('Flash Flood Warning this area');
    expect(html).toContain('Imminent threat');
    expect(html).toContain('Inside alert area');
  });
});
