import { Router } from 'express';
import { cache } from '../cache';
import { config } from '../config';

const router = Router();

interface PolygonGeom {
  type: 'Polygon';
  coordinates: number[][][];
}
interface MultiPolygonGeom {
  type: 'MultiPolygon';
  coordinates: number[][][][];
}
type AlertGeometry =
  | PolygonGeom
  | MultiPolygonGeom
  | { type: string; coordinates: unknown }
  | null;

interface RawAlertFeature {
  id?: string;
  geometry: AlertGeometry;
  properties: {
    id?: string;
    event?: string;
    headline?: string | null;
    description?: string;
    instruction?: string | null;
    severity?: string;
    certainty?: string;
    urgency?: string;
    senderName?: string;
    effective?: string;
    expires?: string;
    areaDesc?: string;
    geocode?: { UGC?: string[]; SAME?: string[] };
  };
}

function nwsHeaders() {
  return { 'User-Agent': config.nwsUserAgent, Accept: 'application/geo+json' };
}

// NWS caps each page of /alerts/active at 500 features. During active weather
// there are frequently more than that nationwide, so follow the pagination
// links to collect them all.
async function fetchAllActiveAlerts(): Promise<RawAlertFeature[]> {
  const features: RawAlertFeature[] = [];
  let url = 'https://api.weather.gov/alerts/active?limit=500';
  for (let page = 0; page < 8; page++) {
    const resp = await fetch(url, { headers: nwsHeaders() });
    if (!resp.ok) throw new Error(`NWS alerts error: ${resp.status}`);
    const json = (await resp.json()) as {
      features?: RawAlertFeature[];
      pagination?: { next?: string };
    };
    const batch = json.features ?? [];
    features.push(...batch);
    const next = json.pagination?.next;
    if (!next || batch.length === 0) break;
    url = next;
  }
  return features;
}

// Most NWS alerts (winter weather, heat, flood, red-flag, etc.) ship with
// geometry: null and only reference UGC forecast/county zones. We resolve those
// zones to real polygons via the zones API and cache each one for a long time
// (zone boundaries change very rarely), so the map can colour them in.
const ZONE_TTL = 30 * 24 * 60 * 60_000; // 30 days
const zoneInFlight = new Set<string>();

function zoneType(ugc: string): 'county' | 'forecast' {
  // UGC: SS + (Z = public forecast zone | C = county) + NNN
  return ugc.charAt(2) === 'C' ? 'county' : 'forecast';
}

async function fillZones(ugcs: string[]): Promise<void> {
  const todo = ugcs.filter(
    (u) => cache.get(`zone:${u}`) === undefined && !zoneInFlight.has(u)
  );
  if (todo.length === 0) return;

  const CONCURRENCY = 10;
  let idx = 0;
  const worker = async () => {
    while (idx < todo.length) {
      const ugc = todo[idx++];
      zoneInFlight.add(ugc);
      try {
        const resp = await fetch(
          `https://api.weather.gov/zones/${zoneType(ugc)}/${ugc}`,
          { headers: nwsHeaders() }
        );
        if (resp.ok) {
          const json = (await resp.json()) as { geometry?: AlertGeometry };
          cache.set(`zone:${ugc}`, json.geometry ?? null, ZONE_TTL);
        } else if (resp.status === 404) {
          // Known to have no geometry — cache null so we don't keep retrying.
          cache.set(`zone:${ugc}`, null, ZONE_TTL);
        }
        // Other errors: leave uncached so a later refresh retries.
      } catch {
        // Network hiccup — allow a retry on the next cycle.
      } finally {
        zoneInFlight.delete(ugc);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, todo.length) }, worker));
}

function pushPolys(geom: AlertGeometry, out: number[][][][]): void {
  if (!geom) return;
  if (geom.type === 'Polygon') {
    out.push((geom as PolygonGeom).coordinates);
  } else if (geom.type === 'MultiPolygon') {
    for (const poly of (geom as MultiPolygonGeom).coordinates) out.push(poly);
  }
}

const SEVERITY_RANK: Record<string, number> = {
  Extreme: 4,
  Severe: 3,
  Moderate: 2,
  Minor: 1,
  Unknown: 0,
};

router.get('/', async (_req, res) => {
  try {
    const alerts = await cache.getOrFetch('alerts:all', 60_000, fetchAllActiveAlerts);

    const uncached: string[] = [];
    const features = alerts.map((f) => {
      let geometry: AlertGeometry = f.geometry ?? null;

      if (!geometry) {
        const ugcs = f.properties.geocode?.UGC ?? [];
        const polys: number[][][][] = [];
        for (const ugc of ugcs) {
          const cached = cache.get<AlertGeometry>(`zone:${ugc}`);
          if (cached === undefined) uncached.push(ugc);
          else pushPolys(cached, polys);
        }
        if (polys.length === 1) {
          geometry = { type: 'Polygon', coordinates: polys[0] };
        } else if (polys.length > 1) {
          geometry = { type: 'MultiPolygon', coordinates: polys };
        }
      }

      const p = f.properties;
      return {
        type: 'Feature' as const,
        geometry,
        properties: {
          id: p.id ?? f.id ?? '',
          event: p.event ?? 'Alert',
          headline: p.headline ?? null,
          description: p.description ?? '',
          instruction: p.instruction ?? null,
          severity: p.severity ?? 'Unknown',
          certainty: p.certainty ?? 'Unknown',
          urgency: p.urgency ?? 'Unknown',
          senderName: p.senderName ?? '',
          effective: p.effective ?? '',
          expires: p.expires ?? '',
          areaDesc: p.areaDesc ?? '',
        },
      };
    });

    // Resolve any zones we haven't seen yet in the background; they'll appear on
    // the next 60s client refresh. Don't block the response on it.
    if (uncached.length > 0) void fillZones([...new Set(uncached)]);

    // Draw higher-severity polygons last so they sit on top of lower ones.
    features.sort(
      (a, b) =>
        (SEVERITY_RANK[a.properties.severity] ?? 0) -
        (SEVERITY_RANK[b.properties.severity] ?? 0)
    );

    res.json({ type: 'FeatureCollection', features });
  } catch (err) {
    res.status(502).json({ error: 'Failed to fetch NWS alerts', detail: String(err) });
  }
});

export default router;
