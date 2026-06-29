import { Router } from 'express';
import { cache } from '../cache';
import { config } from '../config';

const router = Router();

// NWCG / National Predictive Services 7-Day Significant Fire Potential outlook
// (fsapps.nwcg.gov). One ArcGIS MapServer layer per day (0..6 = Day 1..7), each
// a set of ~234 Predictive Service Area (PSA) polygons tagged with a fuel
// dryness code and a significant-fire-potential type (CRITICAL / IGNITION).
const BASE = 'https://fsapps.nwcg.gov/psp/arcgis/rest/services/npsg/outlooks_forecast/MapServer';
// Native PSA geometry is ~45 MB/day; this Douglas-Peucker tolerance (degrees,
// ~2 km) brings it to ~270 KB while staying crisp at national scale.
const SIMPLIFY_DEG = 0.02;
const TTL_MS = 2 * 60 * 60 * 1000; // outlook is issued ~daily (sometimes updated)
const DAYS = 7;

interface DayCode {
  dryness: number | null;
  type: string | null; // 'CRITICAL' | 'IGNITION' | null
}
interface FireOutlookPsa {
  code: string; // PSA nat_code, e.g. "NC03B"
  gacc: string; // Geographic Area Coordination Center
  rings: number[][][]; // outer ring(s), [lon,lat] pairs (MultiPolygon → several)
  days: (DayCode | null)[]; // length 7, one per outlook day (null if absent that day)
}
export interface FireOutlookResponse {
  updated: number;
  dates: (string | null)[]; // 7 ISO dates (YYYY-MM-DD)
  psas: FireOutlookPsa[];
}

interface ArcFeatureProps {
  nat_code?: string;
  gacc?: string;
  drynesscode?: number | null;
  type?: string | null;
  timestampdate?: number | null;
}

const round = (n: number) => Math.round(n * 1e4) / 1e4;

// Outer rings only (holes dropped — negligible for a translucent fill overlay).
function ringsOf(geom: GeoJSON.Geometry | null | undefined): number[][][] {
  if (!geom) return [];
  if (geom.type === 'Polygon') {
    return [(geom.coordinates[0] as number[][]).map(([x, y]) => [round(x), round(y)])];
  }
  if (geom.type === 'MultiPolygon') {
    return (geom.coordinates as number[][][][]).map((poly) =>
      (poly[0] as number[][]).map(([x, y]) => [round(x), round(y)])
    );
  }
  return [];
}

function isoDate(ms: number | null | undefined): string | null {
  if (!ms) return null;
  return new Date(ms).toISOString().slice(0, 10);
}

interface DayItem {
  props: ArcFeatureProps;
  geometry: GeoJSON.Geometry | null;
}

// One day's query. Geometry only for Day 1 (PSA boundaries are shared across
// days and Day 1 is the superset); attributes-only for the rest. Two gotchas
// this handles: (1) the gov server throttles concurrent geometry queries, so we
// go sequentially; (2) `f=geojson` *requires* geometry — attribute-only queries
// must use `f=json` (Esri JSON, where props live under `.attributes`).
async function fetchDay(day: number, withGeometry: boolean): Promise<{ items: DayItem[]; date: string | null }> {
  // gacc is only requested on Day 1 (it's a per-PSA constant we reuse): the
  // per-day layers renamed that field to `gacc_name`, so asking for `gacc` on
  // them 400s. The shared fields (nat_code/drynesscode/type) are consistent.
  const fields = withGeometry
    ? 'nat_code,gacc,drynesscode,type,timestampdate'
    : 'nat_code,drynesscode,type,timestampdate';
  const url =
    `${BASE}/${day}/query?where=1%3D1&outFields=${fields}` +
    `&returnGeometry=${withGeometry}` +
    // outSR/maxAllowableOffset are only valid when returning geometry; including
    // outSR on an attribute-only query makes this server 400 ("Failed to execute").
    (withGeometry ? `&outSR=4326&maxAllowableOffset=${SIMPLIFY_DEG}&f=geojson` : `&f=json`);
  const res = await fetch(url, {
    headers: { 'User-Agent': config.nwsUserAgent, Accept: 'application/json' },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`NWCG outlooks HTTP ${res.status} (day ${day + 1})`);
  const json = (await res.json()) as {
    features?: Array<{ properties?: ArcFeatureProps; attributes?: ArcFeatureProps; geometry?: GeoJSON.Geometry }>;
    error?: { message?: string };
  };
  if (json.error) throw new Error(`NWCG outlooks error (day ${day + 1}): ${json.error.message ?? 'unknown'}`);
  const items: DayItem[] = (json.features ?? []).map((f) => ({
    props: f.properties ?? f.attributes ?? {},
    geometry: f.geometry ?? null,
  }));
  return { items, date: isoDate(items[0]?.props?.timestampdate) };
}

async function fetchOutlook(): Promise<FireOutlookResponse> {
  const byCode = new Map<string, FireOutlookPsa>();
  const dates: (string | null)[] = Array(DAYS).fill(null);

  for (let day = 0; day < DAYS; day++) {
    const { items, date } = await fetchDay(day, day === 0);
    dates[day] = date;
    for (const it of items) {
      const code = it.props.nat_code;
      if (!code) continue;
      let psa = byCode.get(code);
      if (!psa) {
        psa = { code, gacc: it.props.gacc ?? '', rings: ringsOf(it.geometry), days: Array(DAYS).fill(null) };
        byCode.set(code, psa);
      } else if (psa.rings.length === 0) {
        psa.rings = ringsOf(it.geometry);
      }
      psa.days[day] = {
        dryness: typeof it.props.drynesscode === 'number' ? it.props.drynesscode : null,
        type: it.props.type ?? null,
      };
    }
  }

  // Keep only PSAs we have geometry for (everything renderable).
  const psas = [...byCode.values()].filter((p) => p.rings.length > 0);
  if (psas.length === 0) throw new Error('NWCG outlooks returned no usable polygons');

  return { updated: Date.now(), dates, psas };
}

router.get('/', async (_req, res) => {
  try {
    const data = await cache.getOrFetch<FireOutlookResponse>('fire-outlook', TTL_MS, fetchOutlook, {
      staleOnError: true,
    });
    res.json(data);
  } catch (err) {
    console.error('Fire outlook route error', err);
    res.status(502).json({ error: 'Fire potential outlook unavailable' });
  }
});

export default router;
