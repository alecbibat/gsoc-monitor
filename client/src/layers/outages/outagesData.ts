// California statewide power-outage incidents, from the Cal OES public ArcGIS
// view (California Office of Emergency Services). Each point is a reported
// outage with the utility, start + estimated-restoration times, cause, impacted
// customers, and planned/unplanned type — served CORS-enabled with no key, the
// same browser-side pattern as the fire/hurricane layers.
//
// Coverage note: this is CALIFORNIA ONLY. There is no free, sanctioned national
// per-outage feed (PowerOutage.us is paid + prohibits scraping; per-utility OMS
// feeds are fragmented), so this is the cleanest public source with real
// per-outage detail.

const SERVICE =
  'https://services.arcgis.com/BLN4oKB0N1YSgvY8/arcgis/rest/services/Power_Outages_(View)/FeatureServer/0/query';

const MAX_OUTAGES = 3000;

export interface Outage {
  id: string;
  utility: string;
  lat: number;
  lon: number;
  start: number | null; // epoch ms
  estimatedRestore: number | null; // epoch ms
  cause: string | null;
  customers: number | null;
  county: string | null;
  status: string | null; // e.g. "Active"
  type: string | null; // "Planned" | "Unplanned"
}

export interface OutagesResult {
  outages: Outage[];
  error: string | null;
}

// Marker/accent color by outage type: unplanned (a real, unexpected outage) is
// the one to notice → red; planned/scheduled → amber; unknown → grey.
export function outageColor(type: string | null): string {
  const t = (type ?? '').toLowerCase();
  // "Unplanned" and Cal OES's "Not Planned" are both real, unexpected outages —
  // check these before the bare "planned" substring (which they both contain).
  if (t.includes('unplanned') || t.includes('not planned')) return '#ff3b30';
  if (t.includes('planned')) return '#eab308';
  return '#9ca3af';
}

// Cal OES labels unexpected outages "Not Planned"; normalize to the clearer
// "Unplanned" for display.
function normType(raw: string | null): string | null {
  if (!raw) return null;
  const t = raw.toLowerCase();
  if (t.includes('unplanned') || t.includes('not planned')) return 'Unplanned';
  if (t.includes('planned')) return 'Planned';
  return raw;
}

function num(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}
function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}

interface OutageProps {
  UtilityCompany?: string;
  StartDate?: number | null;
  EstimatedRestoreDate?: number | null;
  Cause?: string | null;
  ImpactedCustomers?: number | null;
  County?: string | null;
  OutageStatus?: string | null;
  OutageType?: string | null;
  IncidentId?: string | null;
  GlobalID?: string | null;
}

function parseOutage(f: GeoJSON.Feature): Outage | null {
  if (f.geometry?.type !== 'Point') return null;
  const [lon, lat] = f.geometry.coordinates as [number, number];
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const p = (f.properties ?? {}) as OutageProps;
  return {
    id: str(p.IncidentId) ?? str(p.GlobalID) ?? `${lon.toFixed(4)},${lat.toFixed(4)}`,
    utility: str(p.UtilityCompany) ?? 'Unknown utility',
    lat,
    lon,
    start: num(p.StartDate),
    estimatedRestore: num(p.EstimatedRestoreDate),
    cause: str(p.Cause),
    customers: num(p.ImpactedCustomers),
    county: str(p.County),
    status: str(p.OutageStatus),
    type: normType(str(p.OutageType)),
  };
}

export async function fetchOutages(): Promise<OutagesResult> {
  const params = new URLSearchParams({
    where: "OutageStatus='Active'",
    outFields:
      'UtilityCompany,StartDate,EstimatedRestoreDate,Cause,ImpactedCustomers,County,OutageStatus,OutageType,IncidentId,GlobalID',
    orderByFields: 'ImpactedCustomers DESC',
    resultRecordCount: String(MAX_OUTAGES),
    outSR: '4326',
    f: 'geojson',
  });
  try {
    const r = await fetch(`${SERVICE}?${params.toString()}`, { signal: AbortSignal.timeout(25_000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = (await r.json()) as { features?: GeoJSON.Feature[]; error?: { message?: string } };
    if (j.error) throw new Error(j.error.message ?? 'ArcGIS error');
    const seen = new Set<string>();
    const outages: Outage[] = [];
    for (const f of j.features ?? []) {
      const o = parseOutage(f);
      if (!o || seen.has(o.id)) continue;
      seen.add(o.id);
      outages.push(o);
    }
    return { outages, error: null };
  } catch (err) {
    return { outages: [], error: err instanceof Error ? err.message : 'unreachable' };
  }
}
