import type { RoadClosure, RoadImpact } from '../../types';

// How the road-closures layer draws each kind of event, shared by the layer,
// its legend and its detail panel. Store-free and static. A full closure is a
// solid red line under a round "no entry" sign; a restriction (lanes closed,
// one-way traffic) is a dashed amber line under a diamond warning sign — shape
// as well as colour, so they read apart for colour-blind viewers too.

export interface RoadImpactMeta {
  label: string;
  short: string;
  color: string;
  note: string;
}

export const ROAD_IMPACT: Record<RoadImpact, RoadImpactMeta> = {
  closed: { label: 'Road closed', short: 'Closed', color: '#ef4444', note: 'All lanes closed to traffic' },
  restricted: {
    label: 'Restricted',
    short: 'Restricted',
    color: '#f59e0b',
    note: 'Lanes closed, one-way traffic or other restrictions; the road is passable',
  },
};

export const ROAD_IMPACT_ORDER: RoadImpact[] = ['closed', 'restricted'];

export const ROADS_ATTRIBUTION = 'NPS road events and state DOT 511 feeds';

const iconCache = new Map<RoadImpact, string>();

/** The marker for a closure: a round no-entry sign, or a diamond warning sign for a restriction. */
export function roadIcon(impact: RoadImpact): string {
  const hit = iconCache.get(impact);
  if (hit) return hit;
  const color = ROAD_IMPACT[impact].color;
  const svg =
    impact === 'closed'
      ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">` +
        `<circle cx="12" cy="12" r="10.5" fill="${color}" stroke="#0a0c10" stroke-width="1.8"/>` +
        `<rect x="5.5" y="10" width="13" height="4" rx="1" fill="#fff"/></svg>`
      : `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">` +
        `<path d="M12 1.6 22.4 12 12 22.4 1.6 12Z" fill="${color}" stroke="#0a0c10" stroke-width="1.6" stroke-linejoin="round"/>` +
        `<rect x="10.9" y="6.6" width="2.2" height="7.4" rx="1" fill="#0a0c10"/>` +
        `<circle cx="12" cy="16.9" r="1.3" fill="#0a0c10"/></svg>`;
  const url = `data:image/svg+xml,${encodeURIComponent(svg)}`;
  iconCache.set(impact, url);
  return url;
}

export interface ParkRoadSummary {
  parkCode: string;
  closed: number;
  restricted: number;
}

/** Closures counted per park area, parks with the most closed roads first. */
export function summarizeByPark(closures: readonly RoadClosure[]): ParkRoadSummary[] {
  const by = new Map<string, ParkRoadSummary>();
  for (const c of closures) {
    const s = by.get(c.parkCode) ?? { parkCode: c.parkCode, closed: 0, restricted: 0 };
    s[c.impact] += 1;
    by.set(c.parkCode, s);
  }
  return [...by.values()].sort((a, b) => b.closed - a.closed || b.restricted - a.restricted);
}

/** "17 closed", "4 restricted", "28 closed · 7 restricted". */
export function summaryText(s: ParkRoadSummary): string {
  const parts = [s.closed ? `${s.closed} closed` : '', s.restricted ? `${s.restricted} restricted` : ''].filter(Boolean);
  return parts.join(' · ');
}
