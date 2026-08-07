import type { PropertyHazards } from '../widgets/proximity/proximityScan';
import { severityRank } from '../layers/alerts/alertsData';
import { quakeColor } from '../widgets/proximity/format';
import { LOCATION_GROUPS, type LocationGroup } from '../layers/locations/locations';

// Per-group Property Watch rollups shared by the pins screensaver's two
// hazard readouts: the instrument cluster in the clock card and the overview
// sitrep drawn on the globe. Both must agree at all times, so they consume
// this one summary of the proximity scan.

export interface AlertChip {
  event: string;
  colorHex: string;
  count: number; // affected locations in the group under this event
  rank: number;
}

export interface GroupSummary {
  group: LocationGroup;
  affectedCount: number;
  alerts: AlertChip[]; // worst-first
  fireCount: number;
  quakeCount: number;
  maxQuakeMag: number;
}

// Fold the worst-first affected list into per-group summaries (insertion order
// keeps groups worst-first too). Fires dedupe by coordinate and quakes by id,
// since one hotspot or quake can sit within range of several sister sites.
export function summarize(affected: PropertyHazards[]): GroupSummary[] {
  const order: GroupSummary[] = [];
  const byId = new Map<
    string,
    {
      summary: GroupSummary;
      alertMap: Map<string, AlertChip>;
      fireKeys: Set<string>;
      quakeIds: Set<string>;
    }
  >();

  for (const p of affected) {
    let entry = byId.get(p.group.id);
    if (!entry) {
      entry = {
        summary: {
          group: p.group,
          affectedCount: 0,
          alerts: [],
          fireCount: 0,
          quakeCount: 0,
          maxQuakeMag: 0,
        },
        alertMap: new Map(),
        fireKeys: new Set(),
        quakeIds: new Set(),
      };
      byId.set(p.group.id, entry);
      order.push(entry.summary);
    }
    entry.summary.affectedCount++;
    entry.summary.maxQuakeMag = Math.max(entry.summary.maxQuakeMag, p.maxQuakeMag ?? 0);

    const seenEvents = new Set<string>();
    for (const a of p.alerts) {
      const chip = entry.alertMap.get(a.event);
      if (!chip) {
        entry.alertMap.set(a.event, {
          event: a.event,
          colorHex: a.colorHex,
          count: 1,
          rank: severityRank(a.severity),
        });
      } else if (!seenEvents.has(a.event)) {
        chip.count++;
      }
      seenEvents.add(a.event);
    }
    for (const f of p.fires) entry.fireKeys.add(`${f.lat},${f.lon}`);
    for (const q of p.quakes) entry.quakeIds.add(q.id);
  }

  for (const e of byId.values()) {
    e.summary.alerts = [...e.alertMap.values()].sort((a, b) => b.rank - a.rank);
    e.summary.fireCount = e.fireKeys.size;
    e.summary.quakeCount = e.quakeIds.size;
  }
  return order;
}

// The one color a group's hazards roll up to: worst alert wins, then fire
// amber, then the magnitude-scaled quake color.
export function groupHazardColor(g: GroupSummary): string {
  if (g.alerts.length > 0) return g.alerts[0].colorHex;
  if (g.fireCount > 0) return '#ffb84d';
  return quakeColor(g.maxQuakeMag);
}

export function isExtreme(g: GroupSummary): boolean {
  return (g.alerts[0]?.rank ?? 0) >= 4;
}

export function groupCentroid(group: LocationGroup): { lat: number; lon: number } {
  let lat = 0;
  let lon = 0;
  for (const loc of group.locations) {
    lat += loc.lat;
    lon += loc.lon;
  }
  return { lat: lat / group.locations.length, lon: lon / group.locations.length };
}

// Canonical west→east ordering for the 13-segment severity meter, so a
// segment's position always means the same group and operators can learn it.
export const WATCH_GROUP_ORDER: LocationGroup[] = [...LOCATION_GROUPS].sort(
  (a, b) => groupCentroid(a).lon - groupCentroid(b).lon
);
