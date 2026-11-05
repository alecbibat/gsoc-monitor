import { feature as topoFeature, mesh as topoMesh } from 'topojson-client';
import type { GeometryCollection, GeometryObject, Topology } from 'topojson-specification';
import countiesTopoUrl from 'us-atlas/counties-10m.json?url';

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

// Static US county polygons keyed by 5-digit FIPS: the Census-derived us-atlas
// TopoJSON, bundled with the app so no third-party host sits in the path. Most
// non-storm NWS alerts ship geometry: null and only reference county SAME
// codes, which we resolve against these polygons. Being a topology, neighbouring
// counties share their border arcs exactly, which is what lets an alert's
// counties merge into one outer outline (alertOutline) — the per-county GeoJSON
// used before had independently simplified borders that never lined up.
// A stalled same-origin download still shouldn't hold up every alerts redraw,
// proximity scan and risk report that awaits it: bound the wait for headers.
const COUNTY_HEADERS_TIMEOUT_MS = 20_000;
// FIPS codes the Census retired that an older NWS county table might still
// send, mapped to their successors (renames and a city–county merger).
const RETIRED_FIPS: Record<string, string> = {
  '02270': '02158', // Wade Hampton → Kusilvak Census Area, AK (2015)
  '46113': '46102', // Shannon → Oglala Lakota County, SD (2015)
  '51515': '51019', // Bedford city → Bedford County, VA (2013)
};

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
    sent?: string;
    effective?: string;
    /** When the hazard begins; for one under way, NWS restates it as each version's issue time. */
    onset?: string | null;
    /** When the hazard ends (null: not given). Unlike `expires` — when this message lapses — it holds across re-issues. */
    ends?: string | null;
    expires?: string;
    areaDesc?: string;
    /** CAP status: "Actual", or "Exercise" / "System" / "Test" / "Draft". */
    status?: string;
    /** CAP msgType: "Alert" (new), "Update", "Cancel", "Ack", "Error". */
    messageType?: string;
    /** Earlier messages this one updates or cancels; `identifier` matches their `properties.id`. */
    references?: { identifier?: string; sent?: string }[];
    geocode?: { SAME?: string[]; UGC?: string[] };
    /**
     * CAP parameters as NWS sends them — string arrays keyed by name, e.g.
     * flashFloodDamageThreat: ['CATASTROPHIC'] (a Flash Flood Emergency) or
     * flashFloodDetection: ['OBSERVED']. Shape is upstream-controlled: read
     * defensively.
     */
    parameters?: Record<string, unknown>;
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

/** The county topology plus the per-county polygons built from it. */
export interface CountyAtlas {
  /** County polygons by 5-digit FIPS. */
  geometries: Map<string, GeoJSON.Geometry>;
  topology: Topology;
  /** Each county's topology object (its arcs), by FIPS — for merged outlines. */
  objects: Map<string, GeometryObject>;
}

export function countyAtlasFromTopology(topology: Topology): CountyAtlas {
  const collection = topology.objects.counties as GeometryCollection;
  const geometries = new Map<string, GeoJSON.Geometry>();
  const objects = new Map<string, GeometryObject>();
  for (const obj of collection.geometries) {
    if (obj.id == null) continue;
    const fips = String(obj.id);
    objects.set(fips, obj);
    const geom = (topoFeature(topology, obj) as GeoJSON.Feature).geometry;
    if (geom) geometries.set(fips, geom);
  }
  return { geometries, topology, objects };
}

// Load the county topology once and index it by FIPS id. Memoised across the
// app's lifetime; a failed load is allowed to retry on the next refresh.
let atlasPromise: Promise<CountyAtlas> | null = null;
export function loadCountyAtlas(): Promise<CountyAtlas> {
  if (!atlasPromise) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), COUNTY_HEADERS_TIMEOUT_MS);
    atlasPromise = fetch(countiesTopoUrl, { signal: ctrl.signal })
      .then((r) => {
        clearTimeout(timer); // headers arrived — never abort the body download
        if (!r.ok) throw new Error(`county topology ${r.status}`);
        return r.json() as Promise<Topology>;
      })
      .then(countyAtlasFromTopology)
      .catch((err) => {
        clearTimeout(timer);
        atlasPromise = null;
        throw err;
      });
  }
  return atlasPromise;
}

/** County polygons by 5-digit FIPS (see loadCountyAtlas). */
export function loadCounties(): Promise<Map<string, GeoJSON.Geometry>> {
  return loadCountyAtlas().then((atlas) => atlas.geometries);
}

/** The 5-digit county FIPS codes an alert names through its SAME codes, deduped. */
export function alertCountyFips(alert: RawAlert): string[] {
  const out = new Set<string>();
  for (const code of alert.properties.geocode?.SAME ?? []) {
    const fips = code.length === 6 ? code.slice(1) : code; // SAME -> 5-digit FIPS
    out.add(RETIRED_FIPS[fips] ?? fips);
  }
  return [...out];
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
  for (const fips of alertCountyFips(alert)) {
    const geom = counties.get(fips);
    if (geom) for (const ring of extractRings(geom)) rings.push(ring);
  }
  return rings;
}

// Merged county outlines, keyed by the sorted FIPS list: many alerts share a
// county set, and the 60 s redraw re-asks for every alert each time.
const outlineCache = new Map<string, number[][][]>();
const OUTLINE_CACHE_MAX = 2_000;

/**
 * An alert's border as lines of [lon, lat]: its own polygon's rings, or for a
 * county-based alert the outer outline of its counties merged — the borders
 * between two of its own counties cancel out, so a 40-county warning gets one
 * clean perimeter instead of a mesh of county lines. Empty when the alert has
 * neither geometry nor a county the atlas knows.
 */
export function alertOutline(alert: RawAlert, atlas: CountyAtlas | null): number[][][] {
  const own = extractRings(alert.geometry);
  if (own.length) return own;
  if (!atlas) return [];
  const fips = alertCountyFips(alert).filter((f) => atlas.objects.has(f)).sort();
  if (fips.length === 0) return [];
  const key = fips.join(',');
  const hit = outlineCache.get(key);
  if (hit) return hit;
  // mesh() over just these counties with "a === b" keeps the arcs only one of
  // them uses: the perimeter (and any holes), never a shared inner border.
  const lines = topoMesh(
    atlas.topology,
    { type: 'GeometryCollection', geometries: fips.map((f) => atlas.objects.get(f)!) },
    (a, b) => a === b
  ).coordinates;
  if (outlineCache.size >= OUTLINE_CACHE_MAX) outlineCache.clear();
  outlineCache.set(key, lines);
  return lines;
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
 * Active alerts whose areas contain one point, resolved by NWS itself
 * (forecast zones, county zones and storm polygons) — the flood report's site
 * test. The national feed can only place a geometry-less alert by painting
 * every county in its SAME list, which puts a coastal Storm Surge Warning on
 * inland towns of the same county and can't place territory alerts at all.
 * Direct first, then the server proxy, like fetchActiveAlerts.
 */
export async function fetchAlertsAtPoint(lat: number, lon: number): Promise<RawAlert[]> {
  // NWS rejects more than 4 decimals.
  const point = `${lat.toFixed(4)},${lon.toFixed(4)}`;
  try {
    return await fetchAlertsFrom(`${ALERTS_API}?point=${point}`);
  } catch (err) {
    const directReason = err instanceof Error ? err.message : 'unreachable';
    try {
      return await fetchAlertsFrom(`${ALERTS_PROXY}?point=${point}`);
    } catch (err2) {
      const proxyReason = err2 instanceof Error ? err2.message : 'unreachable';
      throw new Error(`direct: ${directReason} · proxy: ${proxyReason}`);
    }
  }
}

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

// The map layer and the pin notifier each poll the national feed every minute;
// one multi-MB download serves both when their polls land within this window.
const SHARED_MAX_AGE_MS = 30_000;
let shared: { at: number; promise: Promise<RawAlert[]> } | null = null;

/**
 * fetchActiveAlerts, shared: a call within SHARED_MAX_AGE_MS of the last one
 * gets the same (possibly still in-flight) result. A failure is forgotten at
 * once, so the next caller retries instead of re-reading the error.
 */
export function fetchActiveAlertsShared(now = Date.now()): Promise<RawAlert[]> {
  if (shared && now - shared.at < SHARED_MAX_AGE_MS) return shared.promise;
  const promise = fetchActiveAlerts();
  const entry = { at: now, promise };
  shared = entry;
  promise.catch(() => {
    if (shared === entry) shared = null;
  });
  return promise;
}
