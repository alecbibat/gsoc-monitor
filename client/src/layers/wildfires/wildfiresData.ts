// NIFC / WFIGS interagency wildfire incidents — the official "named fire +
// response" data (acres, containment, personnel, incident-management type,
// complexity, cause), current season. Served as CORS-enabled ArcGIS GeoJSON with
// no key, the same browser-side approach the hurricane + FIRMS layers use.
//
// This complements the FIRMS layer rather than replacing it: FIRMS is anonymous
// near-real-time satellite hotspots; this is named, human-managed incidents with
// the response picture attached.

const LOC =
  'https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Incident_Locations_Current/FeatureServer/0/query';
const PERIM =
  'https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Interagency_Perimeters_Current/FeatureServer/0/query';

const MAX_FIRES = 800;
const MAX_PERIMS = 500;
const MIN_ACRES = 5; // ignore trivial incidents
const PERIM_MIN_ACRES = 100; // only draw perimeters big enough to matter

export interface NamedFire {
  id: string;
  name: string;
  lat: number;
  lon: number;
  acres: number | null;
  contained: number | null; // percent 0–100
  personnel: number | null; // total assigned personnel (response)
  complexity: string | null; // e.g. "Type 1 Incident"
  managementOrg: string | null; // e.g. incident-management team
  cause: string | null;
  discovered: number | null; // epoch ms
  updated: number | null;    // epoch ms — WFIGS record last modified (staleness signal)
  state: string | null; // "CA"
}

export interface FirePerimeter {
  rings: number[][][]; // [ring][point] = [lon, lat]
}

export interface WildfiresResult {
  fires: NamedFire[];
  perimeters: FirePerimeter[];
  error: string | null;
}

// Containment ramp: hot red when barely contained, cooling to amber as it rises,
// grey once fully contained. Shared by the layer markers and the details panel.
export function containmentColor(pct: number | null): string {
  if (pct == null || pct < 30) return '#ff3b30';
  if (pct < 70) return '#ff8c1a';
  if (pct < 100) return '#ffd23f';
  return '#9ca3af';
}

function num(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}
function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}

interface LocProps {
  IncidentName?: string;
  IncidentSize?: number | null;
  PercentContained?: number | null;
  TotalIncidentPersonnel?: number | null;
  IncidentComplexityLevel?: string | null;
  IncidentManagementOrganization?: string | null;
  FireCause?: string | null;
  FireDiscoveryDateTime?: number | null;
  ModifiedOnDateTime_dt?: number | null;
  POOState?: string | null;
  IrwinID?: string | null;
}

function parseFire(f: GeoJSON.Feature): NamedFire | null {
  if (f.geometry?.type !== 'Point') return null;
  const [lon, lat] = f.geometry.coordinates as [number, number];
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const p = (f.properties ?? {}) as LocProps;
  const name = str(p.IncidentName);
  if (!name) return null;
  return {
    id: str(p.IrwinID) ?? `${name}:${lon.toFixed(3)},${lat.toFixed(3)}`,
    name,
    lat,
    lon,
    acres: num(p.IncidentSize),
    contained: num(p.PercentContained),
    personnel: num(p.TotalIncidentPersonnel),
    complexity: str(p.IncidentComplexityLevel),
    managementOrg: str(p.IncidentManagementOrganization),
    cause: str(p.FireCause),
    discovered: num(p.FireDiscoveryDateTime),
    updated: num(p.ModifiedOnDateTime_dt),
    state: str(p.POOState)?.replace(/^US-/, '') ?? null,
  };
}

async function queryGeoJson(url: string, params: Record<string, string>): Promise<GeoJSON.Feature[]> {
  const qs = new URLSearchParams(params).toString();
  const r = await fetch(`${url}?${qs}`, { signal: AbortSignal.timeout(25_000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const j = (await r.json()) as { features?: GeoJSON.Feature[]; error?: { message?: string } };
  if (j.error) throw new Error(j.error.message ?? 'ArcGIS error');
  return j.features ?? [];
}

// Active named wildfires (not fully contained, ≥ MIN_ACRES), biggest first.
const FIRE_FIELDS =
  'IncidentName,IncidentSize,PercentContained,TotalIncidentPersonnel,IncidentComplexityLevel,IncidentManagementOrganization,FireCause,FireDiscoveryDateTime,POOState,IrwinID';

async function fetchFires(): Promise<NamedFire[]> {
  const query = (outFields: string) =>
    queryGeoJson(LOC, {
      where: `IncidentTypeCategory='WF' AND IncidentSize>=${MIN_ACRES} AND (PercentContained<100 OR PercentContained IS NULL)`,
      outFields,
      orderByFields: 'IncidentSize DESC',
      resultRecordCount: String(MAX_FIRES),
      outSR: '4326',
      f: 'geojson',
    });
  let feats: GeoJSON.Feature[];
  try {
    // ModifiedOnDateTime_dt gives the record's last-update time (staleness
    // context in the risk report). An unknown outField fails the whole ArcGIS
    // query, so if the service ever renames it, retry without it rather than
    // blacking out the layer.
    feats = await query(`${FIRE_FIELDS},ModifiedOnDateTime_dt`);
  } catch {
    feats = await query(FIRE_FIELDS);
  }
  const seen = new Set<string>();
  const fires: NamedFire[] = [];
  for (const f of feats) {
    const nf = parseFire(f);
    if (!nf || seen.has(nf.id)) continue;
    seen.add(nf.id);
    fires.push(nf);
  }
  return fires;
}

function ringsOf(geom: GeoJSON.Geometry | null | undefined): number[][][] {
  if (!geom) return [];
  if (geom.type === 'Polygon') return [geom.coordinates[0] as number[][]];
  if (geom.type === 'MultiPolygon') return (geom.coordinates as number[][][][]).map((poly) => poly[0] as number[][]);
  return [];
}

// Fire-perimeter polygons for the sizable fires, simplified server-side to keep
// the payload light.
async function fetchPerimeters(): Promise<FirePerimeter[]> {
  const feats = await queryGeoJson(PERIM, {
    where: `attr_IncidentSize>=${PERIM_MIN_ACRES}`,
    outFields: 'poly_IncidentName',
    orderByFields: 'attr_IncidentSize DESC',
    resultRecordCount: String(MAX_PERIMS),
    outSR: '4326',
    maxAllowableOffset: '0.008', // ~800 m Douglas–Peucker simplification
    f: 'geojson',
  });
  const perims: FirePerimeter[] = [];
  for (const f of feats) {
    const rings = ringsOf(f.geometry).filter((r) => r.length >= 3);
    if (rings.length) perims.push({ rings });
  }
  return perims;
}

export async function fetchWildfires(): Promise<WildfiresResult> {
  // The incident points are the core payload (named + response); perimeters are
  // supplementary, so a perimeter failure must never block the markers.
  const [firesRes, perimRes] = await Promise.allSettled([fetchFires(), fetchPerimeters()]);
  if (firesRes.status === 'rejected') {
    return {
      fires: [],
      perimeters: [],
      error: firesRes.reason instanceof Error ? firesRes.reason.message : 'unreachable',
    };
  }
  return {
    fires: firesRes.value,
    perimeters: perimRes.status === 'fulfilled' ? perimRes.value : [],
    error: null,
  };
}
