// What a drawn incident layer measures.
//
// A line on an incident map is never just a line — it is "how far is the
// evacuation route", "how wide is the exclusion zone", "where exactly is the
// staging point". The geometry to answer that is already in the layer, so
// every surface that lists layers (the editor, the share link, the printed
// report, the map popups) shows the same figures from this one place.
import {
  formatArea, formatBearing, formatDistance, formatLatLon, formatNauticalMiles,
  initialBearing, perimeterM, polygonAreaM2, totalDistanceM,
} from '../measure/measureMath';
import type { DrawLayerPoint, DrawGeometry } from './crisisStore';

export interface LayerMeasure {
  /** What was measured — 'none' when the shape is too incomplete to say. */
  kind: 'length' | 'area' | 'position' | 'none';
  /** The headline figure: "12.3 km · 7.6 mi", "4.2 km² · 1.6 mi²", a position. */
  primary: string;
  /** Supporting figures: nautical miles, bearing, perimeter, vertex count. */
  detail: string;
  /** primary + detail on one line, for compact rows. */
  summary: string;
  lengthM?: number;
  areaM2?: number;
}

const NONE: LayerMeasure = { kind: 'none', primary: '', detail: '', summary: '' };

const join = (parts: Array<string | false | undefined>): string =>
  parts.filter((p): p is string => !!p).join(' · ');

/**
 * Measure a drawn layer from its own geometry.
 *
 * Areas report area and perimeter; lines and arrows report path length, with a
 * bearing when the shape is a straight two-point run (a three-legged route has
 * no single heading, and inventing one would be worse than saying nothing).
 * Points report their position. Anything with too few vertices to measure
 * returns kind 'none' rather than a zero.
 */
export function measureLayer(layer: {
  geometry: DrawGeometry;
  directional?: boolean;
  positions: DrawLayerPoint[];
}): LayerMeasure {
  const pts = layer.positions ?? [];
  const n = pts.length;

  if (layer.geometry === 'point' || (layer.geometry !== 'line' && n === 1)) {
    if (n === 0) return NONE;
    const p = pts[0];
    const position = formatLatLon(p.lat, p.lon);
    return {
      kind: 'position',
      primary: position,
      detail: n > 1 ? `${n} markers` : '',
      summary: join([position, n > 1 && `${n} markers`]),
    };
  }

  if (layer.geometry === 'polygon' && n >= 3) {
    const areaM2 = polygonAreaM2(pts);
    const perim = perimeterM(pts);
    const primary = formatArea(areaM2);
    const detail = join([`perimeter ${formatDistance(perim)}`, `${n} pts`]);
    return { kind: 'area', primary, detail, summary: join([primary, detail]), areaM2, lengthM: perim };
  }

  if (n >= 2) {
    // Includes a 2-point polygon: not an area yet, but the distance between
    // the two vertices is real and worth showing.
    const lengthM = totalDistanceM(pts);
    const primary = formatDistance(lengthM);
    const straight = n === 2;
    const detail = join([
      formatNauticalMiles(lengthM),
      straight ? `bearing ${formatBearing(initialBearing(pts[0], pts[1]))}` : `${n} pts`,
    ]);
    return { kind: 'length', primary, detail, summary: join([primary, detail]), lengthM };
  }

  return NONE;
}
