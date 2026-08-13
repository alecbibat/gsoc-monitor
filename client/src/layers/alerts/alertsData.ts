// Shared NWS active-alerts data + geometry resolution. Used by both AlertsLayer
// (which draws the polygons) and the proximity widget (which point-tests
// properties against the same polygons), so the map and the watch list always
// agree on which alerts are active and where. Pure data — colours are returned
// as hex strings so this module stays free of any Cesium dependency.

// Fetched directly from the browser first: NWS sends CORS headers, and the
// direct path keeps the feed working even when our own server is having a bad
// day. No query params — exactly like the proven weather-leaflet reference
// (the /alerts/active endpoint can 400 on some param combinations).
//
// When the direct fetch fails — NWS edge instability (e.g. the 2026-08-12
// AWIPS outage), or a corporate/guest network filtering weather.gov while
// other alert sources still work — we fall back to our server's proxy, which
// reaches NWS from the dyno's network with a proper User-Agent.
export const ALERTS_API = 'https://api.weather.gov/alerts/active';
const ALERTS_PROXY = '/api/alerts/active';

// A hung national-feed download (multi-MB GeoJSON) should fail over to the
// proxy rather than stall the 60s poll loop indefinitely.
const ALERTS_TIMEOUT_MS = 20_000;

// Static US county polygons keyed by 5-digit FIPS (the dataset the proven
// weather-leaflet app uses). Most non-storm NWS alerts ship geometry: null and
// only reference county SAME codes, which we resolve against these polygons.
const COUNTY_GEOJSON =
  'https://raw.githubusercontent.com/plotly/datasets/master/geojson-counties-fips.json';

export interface RawAlert {
  id?: string;
  geometry: GeoJSON.Geometry | null;
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
    geocode?: { SAME?: string[]; UGC?: string[] };
  };
}

export const SEVERITY_RANK: Record<string, number> = {
  Extreme: 4,
  Severe: 3,
  Moderate: 2,
  Minor: 1,
  Unknown: 0,
};

/** Numeric severity rank with a safe default for unknown strings. */
export function severityRank(severity: string | undefined): number {
  return SEVERITY_RANK[severity ?? 'Unknown'] ?? 0;
}

// Severity is still used for draw-order (most severe drawn last/on top) and as the
// fallback colour when an event doesn't match a known hazard family.
function severityColorHex(severity: string): string {
  switch (severity) {
    case 'Extreme':
      return '#ff3b3b';
    case 'Severe':
      return '#ff8a3d';
    case 'Moderate':
      return '#ffe14d';
    case 'Minor':
      return '#52a9ff';
    default:
      return '#9aa5b1';
  }
}

// Colour by hazard TYPE (the NWS `event` string), not just severity, so the map
// reads semantically: floods are blue, thunderstorms yellow, fire orange, winter
// icy, and the genuinely life-threatening events (tornado, tsunami, flash flood,
// storm surge, hurricane, extreme wind) get bold, saturated, mutually-distinct
// colours so they jump off the map on any basemap. Checks run most-specific
// first; `severity` shades a few families (Warning vs Watch/Advisory).
export function alertColorHex(event: string, severity: string): string {
  const e = event.toLowerCase();
  const isWarning = e.includes('warning') || e.includes('emergency');
  const isWatch = e.includes('watch');

  // --- Life-threatening: bold, vivid, each a distinct hue ---
  if (e.includes('tornado')) return '#ff1f4f'; // crimson
  if (e.includes('tsunami')) return '#b026ff'; // electric purple
  if (e.includes('extreme wind')) return '#ff3d00'; // orange-red
  if (e.includes('flash flood')) return '#00c8ff'; // bright cyan
  if (e.includes('storm surge')) return '#6a5cff'; // violet-blue
  if (e.includes('hurricane') && !e.includes('wind')) return '#ff2d95'; // hot magenta
  if (e.includes('typhoon') || e.includes('tropical storm')) return '#ff2d95';

  // --- Flooding family: shades of blue (Warning darkest) ---
  if (e.includes('flood') || e.includes('seiche')) {
    return isWarning ? '#1769ff' : isWatch ? '#4d94ff' : '#86b6ff';
  }

  // --- Thunderstorms: yellow ---
  if (e.includes('thunderstorm')) return isWarning ? '#ffd60a' : '#ffe98a';

  // --- Fire / red-flag: orange ---
  if (e.includes('fire') || e.includes('red flag') || e.includes('smoke')) return '#ff8a1e';

  // --- Excessive heat: amber-red ---
  if (e.includes('heat') || (e.includes('hot') && isWarning)) return '#ff6024';

  // --- Winter / cold: icy lavender (desaturated to stay distinct from flood blue) ---
  if (/winter|snow|\bice\b|icy|blizzard|freez|frost|sleet|wind chill|cold|avalanche/.test(e)) {
    return e.includes('blizzard') || e.includes('ice storm') ? '#8fa8e0' : '#b9c4e8';
  }

  // --- Wind (non-tornado): khaki ---
  if (e.includes('wind') || e.includes('gale')) return '#caa54a';

  // --- Marine / coastal hazards: teal ---
  if (
    e.includes('marine') ||
    e.includes('small craft') ||
    e.includes('rip current') ||
    e.includes('surf')
  )
    return '#23c2b8';

  // --- Air quality / dust / ash / fog: muted brown-grey ---
  if (/air quality|dust|ashfall|\bfog\b/.test(e)) return '#9a8a7a';

  // --- Anything else: fall back to severity ---
  return severityColorHex(severity);
}

function extractRings(geometry: GeoJSON.Geometry | null | undefined): number[][][] {
  if (!geometry) return [];
  if (geometry.type === 'Polygon') {
    return [geometry.coordinates[0] as number[][]];
  }
  if (geometry.type === 'MultiPolygon') {
    return geometry.coordinates.map((poly) => poly[0] as number[][]);
  }
  return [];
}

// Load the county polygons once and index them by FIPS id. Memoised across the
// app's lifetime; a failed load is allowed to retry on the next refresh.
let countyPromise: Promise<Map<string, GeoJSON.Geometry>> | null = null;
export function loadCounties(): Promise<Map<string, GeoJSON.Geometry>> {
  if (!countyPromise) {
    countyPromise = fetch(COUNTY_GEOJSON)
      .then((r) => {
        if (!r.ok) throw new Error(`county geojson ${r.status}`);
        return r.json() as Promise<GeoJSON.FeatureCollection>;
      })
      .then((data) => {
        const map = new Map<string, GeoJSON.Geometry>();
        for (const f of data.features) {
          if (f.id != null && f.geometry) map.set(String(f.id), f.geometry);
        }
        return map;
      })
      .catch((err) => {
        countyPromise = null;
        throw err;
      });
  }
  return countyPromise;
}

export function alertRings(
  alert: RawAlert,
  counties: Map<string, GeoJSON.Geometry> | null
): number[][][] {
  // Prefer the alert's own precise polygon (storm-based warnings have one)...
  const own = extractRings(alert.geometry);
  if (own.length) return own;

  // ...otherwise fall back to the counties named by its SAME (county FIPS) codes.
  if (!counties) return [];
  const rings: number[][][] = [];
  for (const code of alert.properties.geocode?.SAME ?? []) {
    const fips = code.length === 6 ? code.slice(1) : code; // SAME -> 5-digit FIPS
    const geom = counties.get(fips);
    if (geom) for (const ring of extractRings(geom)) rings.push(ring);
  }
  return rings;
}

async function fetchAlertsFrom(url: string): Promise<RawAlert[]> {
  const r = await fetch(url, { signal: AbortSignal.timeout(ALERTS_TIMEOUT_MS) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const json = (await r.json()) as { features?: RawAlert[] };
  return json.features ?? [];
}

// After a direct-path failure, prefer the proxy for a while instead of
// re-burning the 20s timeout on every poll — a firewall that blackholes
// weather.gov never sends an RST, so each direct attempt only dies at the
// timeout. The direct path is retried after this window so the feed heals
// back to direct once the network or the NWS edge recovers.
const DIRECT_RETRY_MS = 10 * 60_000;
let directDownSince: number | null = null;

/**
 * Fetch all currently-active NWS alerts: directly from api.weather.gov, then
 * through the server proxy if the direct path fails (with the proxy preferred
 * for a while after a direct failure). Throws only when both paths fail, with
 * a message naming each path's failure.
 */
export async function fetchActiveAlerts(): Promise<RawAlert[]> {
  const preferProxy =
    directDownSince !== null && Date.now() - directDownSince < DIRECT_RETRY_MS;
  let directReason = 'skipped after recent failure';
  if (!preferProxy) {
    try {
      const alerts = await fetchAlertsFrom(ALERTS_API);
      directDownSince = null;
      return alerts;
    } catch (err) {
      directDownSince = Date.now();
      directReason = err instanceof Error ? err.message : 'unreachable';
    }
  }
  try {
    return await fetchAlertsFrom(ALERTS_PROXY);
  } catch (err) {
    const proxyReason = err instanceof Error ? err.message : 'unreachable';
    throw new Error(`direct: ${directReason} · proxy: ${proxyReason}`);
  }
}
