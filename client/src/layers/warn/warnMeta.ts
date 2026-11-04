import type { WeaClass } from '../../types';

// Wireless Emergency Alert classes as the WEA system defines them, with the
// colour the PBS WARN layer draws each in. Shared by the layer, its legend and
// its detail panel. Store-free and static.
export const WEA_CLASSES: Record<WeaClass, { label: string; color: string; note: string }> = {
  'imminent-threat': {
    label: 'Imminent threat',
    color: '#ff3366',
    note: 'Extreme or severe threats to life: NWS warnings, USGS earthquake warnings, local evacuations',
  },
  'public-safety': {
    label: 'Public safety',
    color: '#c084fc',
    note: 'Local agencies: road closures, police activity, boil-water and 911 outages',
  },
  amber: {
    label: 'AMBER alert',
    color: '#ffbf00',
    note: 'Child abduction',
  },
  presidential: {
    label: 'National alert',
    color: '#f8fafc',
    note: 'Issued by the President or FEMA',
  },
};

/** Legend / menu order: most urgent first. */
export const WEA_CLASS_ORDER: WeaClass[] = ['presidential', 'imminent-threat', 'amber', 'public-safety'];

export const WARN_ATTRIBUTION = 'Wireless Emergency Alerts broadcast by PBS';
export const WARN_SITE = 'https://warn.pbs.org/';

/** PBS's backend checks in every few seconds; past this its feed is stale (their map's own rule). */
export const WARN_HEARTBEAT_STALE_MS = 2 * 60_000;

// State and territory FIPS → USPS code, for naming the counties a WEA was sent to.
export const STATE_ABBR: Record<string, string> = {
  '01': 'AL', '02': 'AK', '04': 'AZ', '05': 'AR', '06': 'CA', '08': 'CO', '09': 'CT', '10': 'DE',
  '11': 'DC', '12': 'FL', '13': 'GA', '15': 'HI', '16': 'ID', '17': 'IL', '18': 'IN', '19': 'IA',
  '20': 'KS', '21': 'KY', '22': 'LA', '23': 'ME', '24': 'MD', '25': 'MA', '26': 'MI', '27': 'MN',
  '28': 'MS', '29': 'MO', '30': 'MT', '31': 'NE', '32': 'NV', '33': 'NH', '34': 'NJ', '35': 'NM',
  '36': 'NY', '37': 'NC', '38': 'ND', '39': 'OH', '40': 'OK', '41': 'OR', '42': 'PA', '44': 'RI',
  '45': 'SC', '46': 'SD', '47': 'TN', '48': 'TX', '49': 'UT', '50': 'VT', '51': 'VA', '53': 'WA',
  '54': 'WV', '55': 'WI', '56': 'WY', '60': 'AS', '66': 'GU', '69': 'MP', '72': 'PR', '78': 'VI',
};
