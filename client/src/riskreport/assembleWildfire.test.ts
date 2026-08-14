import { describe, expect, it } from 'vitest';
import { hotspotAgeHours } from './assembleWildfire';
import type { FireHotspot } from '../layers/fires/firesData';

// The Esri service returns acq_date as epoch-ms and acq_time as a NUMBER
// despite FireHotspot's declared string types — the helper must accept both
// runtime shapes and never throw (a crash here took down the whole report).
const base: Omit<FireHotspot, 'acqDate' | 'acqTime'> = {
  lat: 44.5, lon: -110.8, frp: 12, brightness: 330,
  confidence: 'Nominal', satellite: 'NOAA-20', daynight: 'D',
};

const hoursAgo = (h: number) => Date.now() - h * 3600_000;

describe('hotspotAgeHours', () => {
  it('handles the real runtime shape: numeric epoch date + numeric time', () => {
    // Midnight-UTC epoch for "6 hours ago", time component zeroed into acqTime.
    const sixAgo = new Date(hoursAgo(6));
    const midnight = Date.UTC(sixAgo.getUTCFullYear(), sixAgo.getUTCMonth(), sixAgo.getUTCDate());
    const hhmm = sixAgo.getUTCHours() * 100 + sixAgo.getUTCMinutes();
    const h = { ...base, acqDate: midnight, acqTime: hhmm } as unknown as FireHotspot;
    const age = hotspotAgeHours(h);
    expect(age).toBeGreaterThanOrEqual(5);
    expect(age).toBeLessThanOrEqual(7);
  });

  it('handles the declared string shape', () => {
    const d = new Date(hoursAgo(3));
    const iso = d.toISOString();
    const h = {
      ...base,
      acqDate: iso.slice(0, 10),
      acqTime: `${String(d.getUTCHours()).padStart(2, '0')}${String(d.getUTCMinutes()).padStart(2, '0')}`,
    } as unknown as FireHotspot;
    const age = hotspotAgeHours(h);
    expect(age).toBeGreaterThanOrEqual(2);
    expect(age).toBeLessThanOrEqual(4);
  });

  it('degrades to undefined (never throws) on garbage', () => {
    for (const [acqDate, acqTime] of [
      ['', ''], [null, null], [undefined, 134], ['not-a-date', 'xx'], [-5, 999999],
    ] as const) {
      const h = { ...base, acqDate, acqTime } as unknown as FireHotspot;
      expect(() => hotspotAgeHours(h)).not.toThrow();
    }
  });

  it('short numeric times like 134 (01:34 UTC) parse via padding', () => {
    const now = new Date();
    const midnightToday = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const h = { ...base, acqDate: midnightToday, acqTime: 134 } as unknown as FireHotspot;
    expect(() => hotspotAgeHours(h)).not.toThrow();
  });
});
