// Cross-references each tracked property against live hazard feeds (NASA FIRMS
// fires, NWS active alerts, and USGS earthquakes) and returns the properties
// that have something nearby, ranked worst-first. Reuses the exact same data
// the map layers draw from, so the watch list and the globe never disagree.

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
import { api } from '../../api/client';
import type { EarthquakeFeature } from '../../types';

// Fixed seismic query for the scan: M2.5+ over the past week. Independent of the
// earthquakes layer's own magnitude/period filter so the watch list stays a
// stable "recent shaking near my sites" signal (captures Yellowstone-style
// swarms without the global noise of the M1+ feeds).
const QUAKE_MAGNITUDE = '2.5';
const QUAKE_PERIOD = 'week';

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

interface QuakeRecord {
  id: string;
  mag: number;
  place: string;
  lat: number;
  lon: number;
  depthKm: number | null;
  time: number; // epoch ms
  url: string;
}

export interface PropertyQuake extends QuakeRecord {
  distanceMi: number;
}

export interface PropertyHazards {
  key: string; // stable id for React lists
  group: LocationGroup;
  location: Location;
  alerts: PropertyAlert[];
  fires: PropertyFire[]; // nearest-first
  quakes: PropertyQuake[]; // nearest-first
  nearestFireMi: number | null;
  nearestQuakeMi: number | null;
  maxQuakeMag: number | null;
  worstSeverity: number; // max alert severity rank (0 when no alerts)
}

export interface ScanResult {
  properties: PropertyHazards[]; // only those with ≥1 hazard, ranked worst-first
  scannedCount: number; // total properties checked
  fireError: string | null;
  alertError: string | null;
  quakeError: string | null;
  updated: number;
}

function parseQuakes(fc: GeoJSON.FeatureCollection | null): QuakeRecord[] {
  if (!fc) return [];
  const features = (fc.features ?? []) as unknown as EarthquakeFeature[];
  const quakes: QuakeRecord[] = [];
  for (const f of features) {
    const coords = f.geometry?.coordinates;
    const mag = f.properties?.mag;
    if (!coords || typeof coords[0] !== 'number' || typeof coords[1] !== 'number') continue;
    if (typeof mag !== 'number') continue;
    quakes.push({
      id: f.id,
      mag,
      place: f.properties.place ?? '',
      lon: coords[0],
      lat: coords[1],
      depthKm: typeof coords[2] === 'number' ? coords[2] : null,
      time: f.properties.time ?? 0,
      url: f.properties.url ?? '',
    });
  }
  return quakes;
}

/**
 * Scan every property for fire hotspots within `radiusMi`, NWS alerts whose
 * area contains the property, and recent earthquakes within `radiusMi`. The
 * three feeds fail independently: any one being down still returns the others.
 */
export async function scanProximity(radiusMi: number): Promise<ScanResult> {
  const radiusM = radiusMi * MILES_TO_M;

  const [fireRes, alerts, counties, quakesFc] = await Promise.all([
    fetchHotspotsNearPins(radiusM),
    fetchActiveAlerts().catch(() => null),
    loadCounties().catch(() => null),
    api.earthquakes(QUAKE_MAGNITUDE, QUAKE_PERIOD).catch(() => null),
  ]);

  const fires = fireRes.hotspots ?? [];
  const fireError = fireRes.hotspots === null ? (fireRes.error ?? 'unreachable') : null;
  const alertError = alerts === null ? 'NWS feed unreachable' : null;
  const quakeError = quakesFc === null ? 'USGS feed unreachable' : null;
  const quakes = parseQuakes(quakesFc);

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

      const nearQuakes: PropertyQuake[] = [];
      for (const q of quakes) {
        const d = haversineMeters(location.lat, location.lon, q.lat, q.lon);
        if (d <= radiusM) nearQuakes.push({ ...q, distanceMi: metersToMiles(d) });
      }
      nearQuakes.sort((a, b) => a.distanceMi - b.distanceMi);

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

      if (nearFires.length === 0 && nearQuakes.length === 0 && propAlerts.length === 0) continue;

      properties.push({
        key: `${group.id}::${location.name}`,
        group,
        location,
        alerts: propAlerts,
        fires: nearFires,
        quakes: nearQuakes,
        nearestFireMi: nearFires.length ? nearFires[0].distanceMi : null,
        nearestQuakeMi: nearQuakes.length ? nearQuakes[0].distanceMi : null,
        maxQuakeMag: nearQuakes.length ? nearQuakes.reduce((m, q) => Math.max(m, q.mag), 0) : null,
        worstSeverity: propAlerts.reduce((m, a) => Math.max(m, severityRank(a.severity)), 0),
      });
    }
  }

  // Rank: most severe active alert first, then the property with the closest
  // physical hazard (fire or quake).
  properties.sort((a, b) => {
    if (b.worstSeverity !== a.worstSeverity) return b.worstSeverity - a.worstSeverity;
    const an = Math.min(a.nearestFireMi ?? Infinity, a.nearestQuakeMi ?? Infinity);
    const bn = Math.min(b.nearestFireMi ?? Infinity, b.nearestQuakeMi ?? Infinity);
    return an - bn;
  });

  return { properties, scannedCount, fireError, alertError, quakeError, updated: Date.now() };
}
