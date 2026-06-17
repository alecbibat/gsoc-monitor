// Cross-references each tracked property against live hazard feeds (NASA FIRMS
// fires + NWS active alerts) and returns the properties that have something
// nearby, ranked worst-first. Reuses the exact same data modules the map layers
// draw from, so the watch list and the globe never disagree.

import { LOCATION_GROUPS, type Location, type LocationGroup } from '../../layers/locations/locations';
import { MILES_TO_M, haversineMeters, metersToMiles, pointInRings } from '../../lib/geo';
import { fetchHotspotsNearPins } from '../../layers/fires/firesData';
import {
  fetchActiveAlerts,
  loadCounties,
  alertRings,
  alertColorHex,
  severityRank,
} from '../../layers/alerts/alertsData';

export interface PropertyAlert {
  id: string;
  event: string;
  severity: string;
  colorHex: string;
  headline: string | null;
  areaDesc: string;
  expires: string;
}

export interface PropertyFire {
  lat: number;
  lon: number;
  frp: number | null;
  distanceMi: number;
}

export interface PropertyHazards {
  key: string; // stable id for React lists
  group: LocationGroup;
  location: Location;
  alerts: PropertyAlert[];
  fires: PropertyFire[]; // nearest-first
  nearestFireMi: number | null;
  worstSeverity: number; // max alert severity rank (0 when no alerts)
}

export interface ScanResult {
  properties: PropertyHazards[]; // only those with ≥1 hazard, ranked worst-first
  scannedCount: number; // total properties checked
  fireError: string | null;
  alertError: string | null;
  updated: number;
}

/**
 * Scan every property for fire hotspots within `radiusMi` and for NWS alerts
 * whose area contains the property. Fire and alert feeds fail independently:
 * one being down still returns the other's results.
 */
export async function scanProximity(radiusMi: number): Promise<ScanResult> {
  const radiusM = radiusMi * MILES_TO_M;

  const [fireRes, alerts, counties] = await Promise.all([
    fetchHotspotsNearPins(radiusM),
    fetchActiveAlerts().catch(() => null),
    loadCounties().catch(() => null),
  ]);

  const fires = fireRes.hotspots ?? [];
  const fireError = fireRes.hotspots === null ? (fireRes.error ?? 'unreachable') : null;
  const alertError = alerts === null ? 'NWS feed unreachable' : null;

  // Resolve each alert's polygon rings once, then point-test every property.
  const alertGeoms = (alerts ?? [])
    .map((alert) => ({ alert, rings: alertRings(alert, counties) }))
    .filter((a) => a.rings.length > 0);

  const properties: PropertyHazards[] = [];
  let scannedCount = 0;

  for (const group of LOCATION_GROUPS) {
    for (const location of group.locations) {
      scannedCount++;

      const nearFires: PropertyFire[] = [];
      for (const h of fires) {
        const d = haversineMeters(location.lat, location.lon, h.lat, h.lon);
        if (d <= radiusM) {
          nearFires.push({ lat: h.lat, lon: h.lon, frp: h.frp, distanceMi: metersToMiles(d) });
        }
      }
      nearFires.sort((a, b) => a.distanceMi - b.distanceMi);

      const propAlerts: PropertyAlert[] = [];
      for (const { alert, rings } of alertGeoms) {
        if (!pointInRings(location.lon, location.lat, rings)) continue;
        const p = alert.properties;
        propAlerts.push({
          id: p.id ?? alert.id ?? `${group.id}-${propAlerts.length}`,
          event: p.event ?? 'Alert',
          severity: p.severity ?? 'Unknown',
          colorHex: alertColorHex(p.event ?? '', p.severity ?? 'Unknown'),
          headline: p.headline ?? null,
          areaDesc: p.areaDesc ?? '',
          expires: p.expires ?? '',
        });
      }
      propAlerts.sort((a, b) => severityRank(b.severity) - severityRank(a.severity));

      if (nearFires.length === 0 && propAlerts.length === 0) continue;

      properties.push({
        key: `${group.id}::${location.name}`,
        group,
        location,
        alerts: propAlerts,
        fires: nearFires,
        nearestFireMi: nearFires.length ? nearFires[0].distanceMi : null,
        worstSeverity: propAlerts.reduce((m, a) => Math.max(m, severityRank(a.severity)), 0),
      });
    }
  }

  // Rank: most severe active alert first, then closest fire.
  properties.sort((a, b) => {
    if (b.worstSeverity !== a.worstSeverity) return b.worstSeverity - a.worstSeverity;
    return (a.nearestFireMi ?? Infinity) - (b.nearestFireMi ?? Infinity);
  });

  return { properties, scannedCount, fireError, alertError, updated: Date.now() };
}
