// Pure pieces of the vector place-label layer (placeLabels.ts): reading the
// bundled dataset, the typography tier and placement priority of each place,
// the Web-Mercator zoom a ground resolution corresponds to, and a screen-space
// collision grid. Kept free of Cesium so they unit-test without WebGL.

export type PlaceKind = 'c' | 's' | 'p' | 'w'; // country, state/province, populated place, water
export type LabelTier = 'country' | 'state' | 'water' | 'city1' | 'city2' | 'city3';

export interface PlaceRow {
  kind: PlaceKind;
  name: string;
  lon: number;
  lat: number;
  // Web-map zoom (256px Web Mercator tiles) at which the label first appears —
  // Natural Earth's curated min_zoom / min_label.
  minZoom: number;
  pop: number;
  flags: number;
  abbr: string;
}

export const FLAG_NATIONAL_CAPITAL = 1;
export const FLAG_ADMIN1_CAPITAL = 2;

const KINDS = new Set<string>(['c', 's', 'p', 'w']);

// Numbers only — Number(null) would quietly read a missing coordinate as 0.
const num = (v: unknown): number =>
  typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;

// The dataset is `{ v, fields, rows }` with one array per place, in the column
// order `fields` names (see scripts/build-place-labels.mjs). Malformed rows are
// skipped rather than failing the whole layer.
export function parsePlaceRows(json: unknown): PlaceRow[] {
  const doc = json as { fields?: unknown; rows?: unknown };
  if (!doc || !Array.isArray(doc.fields) || !Array.isArray(doc.rows)) {
    throw new Error('place labels: unexpected dataset format');
  }
  const fields = doc.fields as string[];
  const col = (f: string) => fields.indexOf(f);
  const iKind = col('kind');
  const iName = col('name');
  const iLon = col('lon');
  const iLat = col('lat');
  const iMin = col('minZoom');
  const iPop = col('pop');
  const iFlags = col('flags');
  const iAbbr = col('abbr');
  if ([iKind, iName, iLon, iLat, iMin].some((i) => i < 0)) {
    throw new Error('place labels: dataset is missing required fields');
  }
  const out: PlaceRow[] = [];
  for (const r of doc.rows as unknown[]) {
    if (!Array.isArray(r)) continue;
    const kind = r[iKind];
    const name = typeof r[iName] === 'string' ? (r[iName] as string).trim() : '';
    const lon = num(r[iLon]);
    const lat = num(r[iLat]);
    const minZoom = num(r[iMin]);
    if (typeof kind !== 'string' || !KINDS.has(kind) || !name) continue;
    if (!Number.isFinite(lon) || !Number.isFinite(lat) || !Number.isFinite(minZoom)) continue;
    out.push({
      kind: kind as PlaceKind,
      name,
      lon,
      lat,
      minZoom,
      pop: iPop >= 0 ? Number(r[iPop]) || 0 : 0,
      flags: iFlags >= 0 ? Number(r[iFlags]) || 0 : 0,
      abbr: iAbbr >= 0 && typeof r[iAbbr] === 'string' ? (r[iAbbr] as string) : '',
    });
  }
  return out;
}

export function tierOf(row: PlaceRow): LabelTier {
  switch (row.kind) {
    case 'c':
      return 'country';
    case 's':
      return 'state';
    case 'w':
      return 'water';
    default:
      if (row.flags & FLAG_NATIONAL_CAPITAL || row.pop >= 2_000_000) return 'city1';
      if (row.flags & FLAG_ADMIN1_CAPITAL || row.pop >= 250_000) return 'city2';
      return 'city3';
  }
}

// Countries and states are set in spaced capitals, the cartographic convention
// that separates area names from point names. Cesium labels have no
// letter-spacing, so the tracking is a hair space (U+200A) between letters —
// whitespace glyphs take up their measured width but draw nothing.
const HAIR_SPACE = ' ';
export function displayText(row: PlaceRow, tier: LabelTier): string {
  if (tier === 'country' || tier === 'state') {
    return Array.from(row.name.toUpperCase()).join(HAIR_SPACE);
  }
  return row.name;
}

// Placement order — lower goes first and wins collisions. Starts from the
// zoom the place earns a label at, so the curated ranking carries through;
// countries lead (they only show while zoomed out), capitals and bigger cities
// edge ahead of their peers, and states and water names give way to cities.
export function priorityOf(row: PlaceRow): number {
  let p = row.minZoom;
  if (row.kind === 'c') p -= 1.5;
  else if (row.kind === 's') p += 0.4;
  else if (row.kind === 'w') p += 0.8;
  else {
    if (row.flags & FLAG_NATIONAL_CAPITAL) p -= 0.6;
    else if (row.flags & FLAG_ADMIN1_CAPITAL) p -= 0.25;
    if (row.pop > 0) p -= 0.5 * Math.min(1, Math.log10(row.pop) / 8);
  }
  return p;
}

// Past this zoom a kind is no longer useful context: a country name over a
// city-scale view, a state name over a neighbourhood.
export const MAX_ZOOM: Record<PlaceKind, number> = { c: 7.5, s: 10.5, w: 11, p: Infinity };

// Ground metres per pixel at zoom 0 on the equator for 256px Web Mercator tiles.
export const M_PER_PX_Z0 = 156_543.03392;

// The Web-Mercator zoom whose ground resolution at this latitude matches
// `metersPerPixel`, so Natural Earth's web-map zoom thresholds carry over to
// the globe's perspective view.
export function equivalentZoom(metersPerPixel: number, cosLat: number): number {
  return Math.log2((M_PER_PX_Z0 * Math.max(0.05, cosLat)) / Math.max(1e-6, metersPerPixel));
}

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

// Uniform-grid spatial hash of accepted label boxes: a candidate only checks
// the boxes in the cells it overlaps.
export class CollisionGrid {
  private cells = new Map<number, Box[]>();
  constructor(private readonly cell = 64) {}

  clear(): void {
    this.cells.clear();
  }

  fits(b: Box): boolean {
    const c = this.cell;
    for (let cx = Math.floor(b.x0 / c); cx <= Math.floor(b.x1 / c); cx++) {
      for (let cy = Math.floor(b.y0 / c); cy <= Math.floor(b.y1 / c); cy++) {
        const list = this.cells.get(cx * 100_003 + cy);
        if (!list) continue;
        for (const o of list) {
          if (b.x0 < o.x1 && b.x1 > o.x0 && b.y0 < o.y1 && b.y1 > o.y0) return false;
        }
      }
    }
    return true;
  }

  insert(b: Box): void {
    const c = this.cell;
    for (let cx = Math.floor(b.x0 / c); cx <= Math.floor(b.x1 / c); cx++) {
      for (let cy = Math.floor(b.y0 / c); cy <= Math.floor(b.y1 / c); cy++) {
        const key = cx * 100_003 + cy;
        const list = this.cells.get(key);
        if (list) list.push(b);
        else this.cells.set(key, [b]);
      }
    }
  }
}
