import type { DrawLayer } from './crisisStore';
import type { LocationGroup } from '../layers/locations/locations';
import { isShipGroupId } from './incidentShips';

// Camera framing for the public share globe (CrisisShareGlobe). Pure — no
// Cesium — so the choices are unit-testable.

/** A lon/lat box in degrees. */
export interface DegRect {
  west: number;
  south: number;
  east: number;
  north: number;
}

// Smallest box a drawn extent opens in, per axis (~3 km of latitude): about
// what the share page's flat map shows at its max zoom (Leaflet 14) on a
// phone. Incident drawings are usually property-scale — a 300 m exclusion
// zone, a 500 m evacuation route — and a regional frame leaves them a speck
// hidden under their own label. Larger drawings get a 25% margin instead.
export const MIN_DRAWN_SPAN_DEG = 0.03;

// Regional floors for the OPENING view while the hurricanes feed is shown: a
// property-scale frame would leave the storm the incident is about out of view.
export const REGIONAL_SPAN_DEG = 4; // ~440 km
export const REGIONAL_PIN_HEIGHT_M = 400_000;

/** Padded box around the visible drawn layers, or null when nothing is drawn. */
export function drawnExtentRect(layers: readonly DrawLayer[], minSpanDeg = MIN_DRAWN_SPAN_DEG): DegRect | null {
  const pts = layers.filter((l) => l.visible).flatMap((l) => l.positions);
  if (pts.length === 0) return null;
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const p of pts) {
    w = Math.min(w, p.lon); e = Math.max(e, p.lon);
    s = Math.min(s, p.lat); n = Math.max(n, p.lat);
  }
  // Pad each side by 25% of the span, or enough to reach the minimum span.
  const pad = (span: number) => Math.max(span * 0.25, (minSpanDeg - span) / 2);
  const padLon = pad(e - w);
  const padLat = pad(n - s);
  return {
    west: Math.max(-180, w - padLon),
    south: Math.max(-90, s - padLat),
    east: Math.min(180, e + padLon),
    north: Math.min(90, n + padLat),
  };
}

/** Camera position over a set of property pins, high enough to fit their spread. */
export function pinsView(
  groups: readonly LocationGroup[],
  minHeightM = 80_000
): { lon: number; lat: number; height: number } | null {
  const locs = groups.flatMap((g) => g.locations);
  if (locs.length === 0) return null;
  const avgLat = locs.reduce((s, l) => s + l.lat, 0) / locs.length;
  const avgLon = locs.reduce((s, l) => s + l.lon, 0) / locs.length;
  // Height from the pins' spread: metres per degree ≈ 111 km, longitude scaled
  // by cos(lat). Clamped so a single-site group still gets a useful close-up.
  const latSpanM = (Math.max(...locs.map((l) => l.lat)) - Math.min(...locs.map((l) => l.lat))) * 111_000;
  const lonSpanM =
    (Math.max(...locs.map((l) => l.lon)) - Math.min(...locs.map((l) => l.lon))) *
    111_000 * Math.cos((avgLat * Math.PI) / 180);
  const height = Math.min(Math.max(2_500_000, minHeightM), Math.max(minHeightM, Math.hypot(latSpanM, lonSpanM) * 2.2));
  return { lon: avgLon, lat: avgLat, height };
}

export type OpeningFrame =
  | { kind: 'drawn'; rect: DegRect }
  | { kind: 'pins'; groups: LocationGroup[] };

/**
 * What the share globe opens framed on, or null when there is nothing to frame
 * YET (the caller keeps waiting: drawings or vessel positions can still land).
 *
 * The drawn incident area wins — it is the most specific thing the team
 * published. Otherwise the same order as "Zoom to Incident": the incident's
 * own property (or, when that property is the fleet, its vessels — waited for
 * until a position lands), then every prescribed pin, then any vessels.
 */
export function openingFrame(
  input: {
    drawLayers: readonly DrawLayer[];
    pinGroups: readonly LocationGroup[];
    primaryGroupId: string | null;
    shipGroup: LocationGroup | null;
  },
  minSpanDeg = MIN_DRAWN_SPAN_DEG
): OpeningFrame | null {
  const rect = drawnExtentRect(input.drawLayers, minSpanDeg);
  if (rect) return { kind: 'drawn', rect };
  if (isShipGroupId(input.primaryGroupId)) {
    return input.shipGroup ? { kind: 'pins', groups: [input.shipGroup] } : null;
  }
  const primary = input.pinGroups.filter((g) => g.id === input.primaryGroupId);
  if (primary.length > 0) return { kind: 'pins', groups: primary };
  if (input.pinGroups.length > 0) return { kind: 'pins', groups: [...input.pinGroups] };
  if (input.shipGroup) return { kind: 'pins', groups: [input.shipGroup] };
  return null;
}
