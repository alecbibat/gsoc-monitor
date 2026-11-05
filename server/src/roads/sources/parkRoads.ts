import { createHash } from 'crypto';
import { midpointOf } from '../area';
import { compactLines, linesFromGeometry } from '../geometry';
import { fetchJson } from '../http';
import type { RoadSource } from '../service';
import type { RoadClosure } from '../types';

// ── The parks' own road-status maps ──────────────────────────────────────────
// Yellowstone, Glacier and Death Valley each publish the data behind the live
// road map on their nps.gov pages — every road segment with its open/closed
// status, kept by park staff. These are the authoritative source for roads
// inside those parks (seasonal closures, construction, washouts), which the
// NPS Data API's road events don't cover. They are public but undocumented
// website services, so a change on NPS's side shows as this source being
// "unavailable" in the layer's status (the others carry on).

type GeoJsonFeature = { geometry?: { type?: string; coordinates?: unknown } | null; properties?: Record<string, unknown> | null };
export type GeoJsonCollection = { features?: GeoJsonFeature[] };

const TTL_MS = 10 * 60_000;
const str = (v: unknown) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'x';
const short = (s: string) => createHash('sha1').update(s).digest('hex').slice(0, 8);

function closure(base: Omit<RoadClosure, 'point' | 'source' | 'impact' | 'start' | 'end' | 'direction' | 'url'> & Partial<RoadClosure>): RoadClosure {
  return {
    impact: 'closed',
    start: null,
    end: null,
    direction: null,
    url: null,
    point: midpointOf(base.lines),
    source: base.id.split(':')[0],
    ...base,
  };
}

/**
 * Several features for one road (Glacier and Death Valley map a closed road
 * in pieces) become one closure with all their lines.
 */
function groupLines(
  features: readonly GeoJsonFeature[],
  keyOf: (p: Record<string, unknown>) => string | null
): Map<string, { props: Record<string, unknown>; lines: number[][][] }> {
  const groups = new Map<string, { props: Record<string, unknown>; lines: number[][][] }>();
  for (const f of features) {
    const props = f.properties ?? {};
    const key = keyOf(props);
    if (key === null) continue;
    const lines = compactLines(linesFromGeometry(f.geometry).lines);
    if (lines.length === 0) continue;
    const g = groups.get(key);
    if (g) g.lines.push(...lines);
    else groups.set(key, { props, lines });
  }
  return groups;
}

// ── Yellowstone ───────────────────────────────────────────────────────────────
// NPMap/Carto tables behind nps.gov/yell's road map: each Grand Loop and
// entrance-road segment with whether it is open to wheeled vehicles and to
// over-snow vehicles. (Staff-name columns are deliberately not selected.)
const YELL_SQL =
  'SELECT r.name, r.name_segment, r.the_geom, s.npmap_id, s.updated_at, ' +
  's.public_open_to_wheeled_vehicles, s.public_open_to_oversnow_vehicles ' +
  'FROM "nps-yell".roads r, "nps-yell".road_statuses s ' +
  'WHERE s.archived = false AND r.npmap_id = s.npmap_id AND s.public_open_to_wheeled_vehicles = false';
export const YELL_URL = `https://carto.nps.gov/user/nps-yell/api/v2/sql?format=geojson&q=${encodeURIComponent(YELL_SQL)}`;

export function normalizeYellowstoneRoads(fc: GeoJsonCollection): RoadClosure[] {
  const out: RoadClosure[] = [];
  for (const f of fc.features ?? []) {
    const p = f.properties ?? {};
    if (p.public_open_to_wheeled_vehicles !== false) continue;
    const lines = compactLines(linesFromGeometry(f.geometry).lines);
    if (lines.length === 0) continue;
    const name = str(p.name) || 'Park road';
    const segment = str(p.name_segment);
    const oversnow = p.public_open_to_oversnow_vehicles === true;
    out.push(
      closure({
        id: `yell:${str(p.npmap_id) || short(name + segment)}`,
        sourceLabel: 'Yellowstone road status (NPS)',
        parkCode: 'yell',
        title: segment ? `${name}: ${segment}` : name,
        roadNames: [name],
        description: oversnow
          ? 'Closed to wheeled vehicles. Open to over-snow vehicles (commercially guided snowcoaches and snowmobiles).'
          : 'Closed to all wheeled vehicles.',
        eventType: 'park road status',
        updated: str(p.updated_at) ? new Date(str(p.updated_at)).toISOString() : null,
        lines,
        url: 'https://www.nps.gov/yell/planyourvisit/parkroads.htm',
      })
    );
  }
  return out;
}

// ── Glacier ───────────────────────────────────────────────────────────────────
// The "glaclive" Carto account behind Glacier's road-status map: road pieces
// with status, the reason, and the usual seasonal window.
const GLAC_SQL =
  "SELECT the_geom, cartodb_id, rdname, reason, seasdesc, maintainer, status FROM glac_road_nds WHERE status = 'closed'";
export const GLAC_URL = `https://carto.nps.gov/user/glaclive/api/v2/sql?format=GeoJSON&q=${encodeURIComponent(GLAC_SQL)}`;

export function normalizeGlacierRoads(fc: GeoJsonCollection): RoadClosure[] {
  const groups = groupLines(fc.features ?? [], (p) =>
    str(p.status).toLowerCase() === 'closed' ? `${str(p.rdname)}\u0001${str(p.reason)}` : null
  );
  return [...groups.entries()].map(([key, { props: p, lines }]) => {
    const raw = str(p.rdname);
    const name = !raw || /^no name$/i.test(raw) ? 'Unnamed park road' : raw;
    const reason = str(p.reason);
    const season = str(p.seasdesc);
    const maintainer = str(p.maintainer);
    return closure({
      id: `glac:${slug(name)}:${short(key)}`,
      sourceLabel: 'Glacier road status (NPS)',
      parkCode: 'glac',
      title: `${name} closed`,
      roadNames: [name],
      description: [
        reason ? `${reason.replace(/\.$/, '')}.` : 'Closed.',
        season ? `Usual season: ${season.replace(/\.$/, '')}.` : '',
        maintainer && maintainer !== 'National Park Service' ? `Maintained by ${maintainer}.` : '',
      ]
        .filter(Boolean)
        .join(' '),
      eventType: reason ? reason.toLowerCase() : 'park road status',
      updated: null,
      lines,
    });
  });
}

// ── Death Valley ──────────────────────────────────────────────────────────────
// Death Valley's road-status layer (ArcGIS, NPS's own hosting): every park
// road with Open/Closed and a note from the park.
export const DEVA_URL =
  'https://services1.arcgis.com/fBc8EJBxQRMcHlei/arcgis/rest/services/DEVA_Trans_Road_Status_WebsiteView_ln/FeatureServer/0/query?' +
  new URLSearchParams({
    where: "RoadStatus = 'Closed'",
    outFields: 'RoadName,RoadStatus,Notes',
    outSR: '4326',
    f: 'geojson',
  }).toString();

export function normalizeDeathValleyRoads(fc: GeoJsonCollection & { error?: { message?: string } }): RoadClosure[] {
  if (fc.error) throw new Error(`ArcGIS: ${fc.error.message ?? 'error'}`);
  const groups = groupLines(fc.features ?? [], (p) =>
    str(p.RoadStatus).toLowerCase() === 'closed' ? `${str(p.RoadName)}\u0001${str(p.Notes)}` : null
  );
  return [...groups.entries()].map(([key, { props: p, lines }]) => {
    const name = str(p.RoadName) || 'Park road';
    const notes = str(p.Notes);
    return closure({
      id: `deva:${slug(name)}:${short(key)}`,
      sourceLabel: 'Death Valley road status (NPS)',
      parkCode: 'deva',
      title: `${name} closed`,
      roadNames: [name],
      description: notes || 'Closed.',
      eventType: 'park road status',
      updated: null,
      lines,
    });
  });
}

export const yellowstoneRoadSource: RoadSource = {
  key: 'yell',
  label: 'Yellowstone road status',
  ttlMs: () => TTL_MS,
  fetch: async () => normalizeYellowstoneRoads(await fetchJson<GeoJsonCollection>(YELL_URL)),
};

export const glacierRoadSource: RoadSource = {
  key: 'glac',
  label: 'Glacier road status',
  ttlMs: () => TTL_MS,
  fetch: async () => normalizeGlacierRoads(await fetchJson<GeoJsonCollection>(GLAC_URL)),
};

export const deathValleyRoadSource: RoadSource = {
  key: 'deva',
  label: 'Death Valley road status',
  ttlMs: () => TTL_MS,
  fetch: async () => normalizeDeathValleyRoads(await fetchJson<GeoJsonCollection>(DEVA_URL)),
};
