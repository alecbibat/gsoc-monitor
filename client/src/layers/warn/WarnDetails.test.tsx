import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { WarnDetails } from './WarnDetails';
import { WarnLegend } from './WarnLegend';
import type { WarnAlert } from '../../types';

const alert: Omit<WarnAlert, 'polygons' | 'circles'> = {
  id: 'b4329fed',
  capId: 'ASHERGROUP-1783437-post-1793720794',
  event: '911 Telephone Outage Emergency',
  sender: '201265,,Park County WY',
  weaClass: 'public-safety',
  category: 'infra',
  severity: 'Severe',
  urgency: 'Immediate',
  certainty: 'Observed',
  responseType: 'Monitor',
  msgType: 'alert',
  sent: '2026-11-03T15:46:35.925Z',
  expires: '2026-11-04T14:35:00Z',
  weaText: 'Park Co.OHS: 911 lines are down. Emergencies call 307-219-1891 Powell, 307-254-0226 Cody.',
  weaLongText: 'Park County Office of Homeland Security: 911 line is temporarily unavailable in Park County.',
  headline: null,
  description: null,
  instruction: null,
  spanishText: 'Las lineas 911 estan fuera de servicio.',
  areaDesc: 'In this area',
  counties: ['56029'],
  nws: false,
};

describe('WarnDetails', () => {
  it('leads with the message phones received, then who sent it and where', () => {
    const html = renderToStaticMarkup(<WarnDetails payload={alert} />);
    expect(html).toContain('Public safety');
    expect(html).toContain('Sent to phones');
    expect(html).toContain('911 lines are down');
    expect(html).toContain('temporarily unavailable in Park County');
    expect(html).toContain('201265,,Park County WY');
    expect(html).toContain('In this area');
    // County names arrive once the atlas loads; until then, the FIPS code.
    expect(html).toContain('56029');
    expect(html).toContain('En español');
    expect(html).toContain('warn.pbs.org');
    expect(html).not.toContain('NWS Alerts layer');
  });

  it('points NWS-issued alerts at the NWS layer, and marks updates', () => {
    const html = renderToStaticMarkup(
      <WarnDetails payload={{ ...alert, nws: true, weaClass: 'imminent-threat', msgType: 'update' }} />
    );
    expect(html).toContain('Imminent threat');
    expect(html).toContain('Update');
    expect(html).toContain('NWS Alerts layer');
  });
});

describe('WarnLegend', () => {
  it('keys every alert class and credits PBS', () => {
    const html = renderToStaticMarkup(<WarnLegend />);
    for (const label of ['National alert', 'Imminent threat', 'AMBER alert', 'Public safety']) {
      expect(html).toContain(label);
    }
    expect(html).toContain('broadcast by PBS');
  });
});
