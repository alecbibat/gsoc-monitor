import { Router } from 'express';

const router = Router();

// Multi-state power-outage aggregator. Three adapter families, all public,
// no-key endpoints fetched server-side (several are non-CORS or multi-step, so
// the browser can't do this itself):
//
//  1. ArcGIS point feeds — state EM / utility-published FeatureServers with
//     per-outage detail (Cal OES CA, SRP AZ, SSVEC AZ, Minnesota Power MN/WI,
//     Riverside PU CA).
//  2. KUBRA Storm Center — the hosted outage-map platform behind many large
//     utilities (Oncor, Georgia Power, JEA, Colorado Springs Utilities, Cobb
//     EMC, LG&E/KU, Evergy, Versant, Appalachian Power). One generic adapter:
//     currentState → summary → quadkey-tile descent to individual outages.
//  3. NISC co-op outage maps (outagemap-data.cloud.coop) — one adapter, one
//     config entry per co-op tenant (Sawnee GA, SLEMCO LA, Price Electric WI,
//     Cloverland MI).
//
// Everything is normalized into one Outage shape and served in a single JSON.
// The whole result is rebuilt in the background (wind-route pattern) so the
// route always answers instantly, and a single flaky source never breaks the
// rest (every source is independently caught).
//
// Deliberately EXCLUDED after live testing: PNM (NM) — stale records with
// unparseable free-text dates would show phantom outages; LA GOHSEP — an
// accumulating log without utility names. Correctness over raw coverage.

const REFRESH_MS = 4 * 60_000; // background rebuild cadence
const FETCH_TIMEOUT_MS = 15_000;
const UA = 'gsoc-monitor outage aggregator';

export interface Outage {
  id: string;
  utility: string;
  state: string | null; // "CA" — best-effort label from the source config
  lat: number;
  lon: number;
  start: number | null; // epoch ms
  estimatedRestore: number | null; // epoch ms
  cause: string | null;
  customers: number | null;
  county: string | null; // county / area / cross-street context when available
  status: string | null;
  type: 'Planned' | 'Unplanned' | null;
  aggregated: number | null; // >1 when this point is a cluster of N outages
}

interface SourceStatus {
  name: string;
  state: string;
  ok: boolean;
  count: number;
}

export interface OutagesResponse {
  outages: Outage[];
  sources: SourceStatus[];
  updated: number;
  error?: string;
}

// ---------------------------------------------------------------------------
// shared helpers

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} (${url.slice(0, 80)})`);
  return (await res.json()) as T;
}

function num(v: unknown): number | null {
  if (v == null || v === '') return null; // Number(null) is 0 — don't invent zeros
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}
function str(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return s === '' || s.toLowerCase() === 'null' ? null : s;
}
// Accept epoch ms, epoch s, or an ISO-8601 string.
function toEpochMs(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) {
    if (v > 1e12) return v;
    if (v > 1e9) return v * 1000;
    return null;
  }
  if (typeof v === 'string') {
    const t = Date.parse(v);
    return Number.isNaN(t) ? null : t;
  }
  return null;
}

// Planned vs unplanned from an explicit flag when the source has one, else a
// conservative read of the cause text.
function inferType(cause: string | null, plannedFlag?: boolean | null): Outage['type'] {
  if (plannedFlag === true) return 'Planned';
  if (plannedFlag === false) return 'Unplanned';
  if (!cause) return null;
  // "Unplanned" / "Not planned" contain the substring "planned" — check first.
  if (/unplanned|not planned/i.test(cause)) return 'Unplanned';
  if (/planned|scheduled|maintenance|upgrad/i.test(cause)) return 'Planned';
  return 'Unplanned';
}

// ---------------------------------------------------------------------------
// adapter 1: ArcGIS point feeds

interface ArcgisSource {
  name: string; // utility label when the feed is single-utility
  state: string;
  url: string; // full query URL (f=json, outSR=4326, returnGeometry=true)
  parse: (attrs: Record<string, unknown>, lon: number, lat: number, i: number) => Outage | null;
}

const ARCGIS_SOURCES: ArcgisSource[] = [
  {
    // California statewide (Cal OES aggregates PG&E / SCE / SDG&E / SMUD).
    name: 'Cal OES',
    state: 'CA',
    url:
      'https://services.arcgis.com/BLN4oKB0N1YSgvY8/arcgis/rest/services/Power_Outages_(View)/FeatureServer/0/query' +
      `?where=${encodeURIComponent("OutageStatus='Active'")}&outFields=*&returnGeometry=true&outSR=4326&resultRecordCount=3000&f=json`,
    parse: (a, lon, lat) => ({
      id: `caloes-${str(a.IncidentId) ?? str(a.GlobalID) ?? `${lon},${lat}`}`,
      utility: str(a.UtilityCompany) ?? 'California utility',
      state: 'CA',
      lat,
      lon,
      start: toEpochMs(a.StartDate),
      estimatedRestore: toEpochMs(a.EstimatedRestoreDate),
      cause: str(a.Cause),
      customers: num(a.ImpactedCustomers),
      county: str(a.County),
      status: str(a.OutageStatus),
      type: /not planned|unplanned/i.test(str(a.OutageType) ?? '')
        ? 'Unplanned'
        : /planned/i.test(str(a.OutageType) ?? '')
          ? 'Planned'
          : null,
      aggregated: null,
    }),
  },
  {
    // Salt River Project — Phoenix metro. Truncated 10-char ArcGIS field names.
    name: 'Salt River Project',
    state: 'AZ',
    url:
      'https://services6.arcgis.com/l7uujk4hHifqabRB/arcgis/rest/services/SRPOutages/FeatureServer/0/query' +
      '?where=1%3D1&outFields=*&returnGeometry=true&outSR=4326&resultRecordCount=1000&f=json',
    parse: (a, lon, lat, i) => ({
      id: `srp-${num(a.outageId) ?? i}`,
      utility: 'Salt River Project',
      state: 'AZ',
      lat: num(a.latitude) ?? lat,
      lon: num(a.longitude) ?? lon,
      start: toEpochMs(a.outageBega),
      estimatedRestore: toEpochMs(a.estimatedR),
      cause: str(a.outageProb),
      customers: num(a.numberCust),
      county: str(a.crossRoadT),
      status: 'Active',
      type: str(a.isMaintena)?.toLowerCase() === 'true' ? 'Planned' : 'Unplanned',
      aggregated: null,
    }),
  },
  {
    // Sulphur Springs Valley EC — southeast Arizona co-op.
    name: 'SSVEC',
    state: 'AZ',
    url:
      'https://services.arcgis.com/oiVF7alPNKGlpRRF/arcgis/rest/services/Active_Outages_Public/FeatureServer/0/query' +
      '?where=1%3D1&outFields=*&returnGeometry=true&outSR=4326&resultRecordCount=1000&f=json',
    parse: (a, lon, lat, i) => ({
      id: `ssvec-${num(a.INCIDENT_ID) ?? i}`,
      utility: 'SSVEC',
      state: 'AZ',
      lat,
      lon,
      start: toEpochMs(a.TIME_OUTAGE),
      estimatedRestore: toEpochMs(a.TIME_RESTORED_EST),
      cause: str(a.CAUSE),
      customers: num(a.CUSTOMER_COUNT),
      county: str(a.REGION),
      status: str(a.STATUS),
      type: inferType(str(a.CAUSE)),
      aggregated: null,
    }),
  },
  {
    // Minnesota Power + Superior Water Light & Power (ALLETE) — NE MN + Superior WI.
    name: 'Minnesota Power / SWLP',
    state: 'MN',
    url:
      'https://services.arcgis.com/ehV0YC56b0w2eenG/arcgis/rest/services/OutageMap2021AGOL_viewLayer/FeatureServer/0/query' +
      '?where=1%3D1&outFields=*&returnGeometry=true&outSR=4326&resultRecordCount=1000&f=json',
    parse: (a, lon, lat, i) => ({
      id: `mnp-${str(a.ORDERID) ?? i}`,
      utility: 'Minnesota Power / SWLP',
      state: 'MN',
      lat,
      lon,
      start: toEpochMs(a.DATEOFF),
      estimatedRestore: toEpochMs(a.ETR),
      cause: str(a.CAUSE),
      customers: num(a.CUSTCOUNT),
      county: str(a.LOCATION),
      status: str(a.STATUS),
      type: inferType(str(a.CAUSE)),
      aggregated: null,
    }),
  },
  {
    // Riverside Public Utilities — CA municipal not covered by Cal OES.
    name: 'Riverside PU',
    state: 'CA',
    url:
      'https://services.arcgis.com/Fu2oOWg1Aw7azh41/arcgis/rest/services/ElectricOutageAGOL1/FeatureServer/0/query' +
      `?where=${encodeURIComponent("outage_active_flag='True'")}&outFields=*&returnGeometry=true&outSR=4326&resultRecordCount=500&f=json`,
    parse: (a, lon, lat, i) => ({
      id: `rpu-${str(a.outage_id) ?? num(a.outage_id) ?? i}`,
      utility: 'Riverside Public Utilities',
      state: 'CA',
      lat: num(a.outage_location_y) ?? lat,
      lon: num(a.outage_location_x) ?? lon,
      start: toEpochMs(a.outage_date),
      estimatedRestore: toEpochMs(a.outage_etr),
      cause: str(a.outage_cause),
      customers: num(a.customers_out_of_power),
      county: str(a.outage_streets_affected),
      status: str(a.outage_status),
      type: str(a.outage_planned_flag)?.toLowerCase() === 'true' ? 'Planned' : inferType(str(a.outage_cause)),
      aggregated: null,
    }),
  },
];

interface ArcgisQueryResult {
  features?: Array<{ attributes?: Record<string, unknown>; geometry?: { x?: number; y?: number } }>;
  error?: { message?: string };
}

async function fetchArcgisSource(src: ArcgisSource): Promise<Outage[]> {
  const j = await getJson<ArcgisQueryResult>(src.url);
  if (j.error) throw new Error(j.error.message ?? 'ArcGIS error');
  const out: Outage[] = [];
  (j.features ?? []).forEach((f, i) => {
    const x = f.geometry?.x;
    const y = f.geometry?.y;
    if (typeof x !== 'number' || typeof y !== 'number') return;
    const o = src.parse(f.attributes ?? {}, x, y, i);
    if (o && Number.isFinite(o.lat) && Number.isFinite(o.lon)) out.push(o);
  });
  return out;
}

// ---------------------------------------------------------------------------
// adapter 2: KUBRA Storm Center (kubra.io)

interface KubraSource {
  name: string;
  state: string;
  instanceId: string;
  viewId: string;
  bbox: [number, number, number, number]; // [west, south, east, north] service territory
}

// instanceId/viewId are long-lived per utility (harvested from each utility's
// public outage-map page); the data-path GUIDs inside currentState rotate every
// publish cycle, so they're re-resolved on every refresh.
const KUBRA_SOURCES: KubraSource[] = [
  { name: 'Oncor', state: 'TX', instanceId: '560abba3-7881-4741-b538-ca416b58ba1e', viewId: 'ca124b24-9a06-4b19-aeb3-1841a9c962e1', bbox: [-103.0, 28.5, -94.0, 34.5] },
  { name: 'Georgia Power', state: 'GA', instanceId: '7b38c047-7950-444b-a25c-9b3e5ab986eb', viewId: '67b44af5-3847-4ca3-9f4e-9190aac343d6', bbox: [-85.7, 30.3, -80.7, 35.1] },
  { name: 'JEA', state: 'FL', instanceId: '2bb4315d-ff9d-4937-a231-57b8a9df189c', viewId: '40a074f2-b303-42b7-b717-ed7d9d2ad9e2', bbox: [-82.3, 29.7, -81.2, 30.7] },
  { name: 'Colorado Springs Utilities', state: 'CO', instanceId: '7679ce5f-19fa-4ff6-9502-683324ed3f3a', viewId: 'b79da9e4-6406-41b7-8252-ad925d585a2f', bbox: [-105.4, 38.5, -104.3, 39.2] },
  { name: 'Cobb EMC', state: 'GA', instanceId: '57251972-7d71-4039-8075-c9c30a735174', viewId: '27d19b00-dc59-445d-acac-480c1d674258', bbox: [-85.1, 33.6, -84.2, 34.5] },
  { name: 'LG&E / KU', state: 'KY', instanceId: '877fd1e9-4162-473f-b782-d8a53a85326b', viewId: 'a6cee9e4-312b-4b77-9913-2ae371eb860d', bbox: [-89.4, 36.4, -82.2, 39.3] },
  { name: 'Evergy', state: 'KS', instanceId: 'b1493825-4ee3-4706-a986-99a763a733db', viewId: 'c1062d22-2919-487c-9000-e21b72b62278', bbox: [-99.0, 36.9, -93.4, 40.0] },
  { name: 'Versant Power', state: 'ME', instanceId: '6abd095a-98f2-40a2-bb75-d51133d0c2c8', viewId: '05bfafbb-0ad1-4ff1-8287-d32fd1ed7fce', bbox: [-70.6, 43.9, -66.7, 47.6] },
  { name: 'Appalachian Power', state: 'VA', instanceId: '6674f49e-0236-4ed8-a40a-b31747557ab7', viewId: '8cfe790f-59f3-4ce3-a73f-a9642227411f', bbox: [-83.6, 35.9, -79.4, 39.6] },
];

const KUBRA_SEED_ZOOM = 7;
const KUBRA_MAX_QK_LEN = 14;
const KUBRA_TILE_CAP = 150; // per utility, per refresh
const KUBRA_WALK_MS = 25_000; // whole-walk budget (refresh runs in background)

// Decode the FIRST coordinate of a Google encoded polyline (precision 5) —
// KUBRA outage geometries are single points encoded as one-coordinate lines.
function decodePolylineFirst(encoded: string): { lat: number; lon: number } | null {
  let index = 0;
  const next = (): number | null => {
    let result = 0;
    let shift = 0;
    let b: number;
    do {
      if (index >= encoded.length) return null;
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  const dlat = next();
  const dlon = next();
  if (dlat == null || dlon == null) return null;
  const lat = dlat / 1e5;
  const lon = dlon / 1e5;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon };
}

// Web-Mercator tile x/y at a zoom → Bing quadkey.
function quadkey(tx: number, ty: number, zoom: number): string {
  let qk = '';
  for (let z = zoom; z > 0; z--) {
    const mask = 1 << (z - 1);
    let digit = 0;
    if (tx & mask) digit += 1;
    if (ty & mask) digit += 2;
    qk += String(digit);
  }
  return qk;
}

function seedQuadkeys(bbox: [number, number, number, number], zoom: number): string[] {
  const [west, south, east, north] = bbox;
  const n = 1 << zoom;
  const lonToX = (lon: number) => Math.max(0, Math.min(n - 1, Math.floor(((lon + 180) / 360) * n)));
  const latToY = (lat: number) => {
    const rad = (lat * Math.PI) / 180;
    return Math.max(0, Math.min(n - 1, Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n)));
  };
  const x0 = lonToX(west);
  const x1 = lonToX(east);
  const y0 = latToY(north); // tile y grows southward
  const y1 = latToY(south);
  const keys: string[] = [];
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) keys.push(quadkey(x, y, zoom));
  return keys;
}

interface KubraRecord {
  id?: string;
  geom?: { p?: string[] };
  desc?: {
    cluster?: boolean;
    n_out?: number;
    inc_id?: string | number;
    cust_a?: { val?: number };
    etr?: string | null;
    start_time?: string | null;
    cause?: Record<string, string> | null;
    crew_status?: string | null;
  };
}

interface KubraCurrentState {
  stormcenterDeploymentId?: string;
  data?: {
    interval_generation_data?: string;
    cluster_interval_generation_data?: string;
    stormcenterDeploymentId?: string;
  };
}

async function fetchKubraSource(src: KubraSource): Promise<Outage[]> {
  const cs = await getJson<KubraCurrentState>(
    `https://kubra.io/stormcenter/api/v1/stormcenters/${src.instanceId}/views/${src.viewId}/currentState?preview=false`
  );
  const igd = cs.data?.interval_generation_data;
  const cigd = cs.data?.cluster_interval_generation_data;
  if (!igd || !cigd) throw new Error('KUBRA currentState missing data paths');

  // Cheap aggregate check first — skip the tile walk entirely when quiet.
  interface KubraSummary {
    summaryFileData?: { totals?: Array<{ total_outages?: number; total_cust_a?: { val?: number } }> };
  }
  const summary = await getJson<KubraSummary>(`https://kubra.io/${igd}/public/summary-1/data.json`).catch(() => null);
  const totals = summary?.summaryFileData?.totals?.[0];
  if (totals && !(totals.total_outages ?? 0) && !(totals.total_cust_a?.val ?? 0)) return [];

  // Cluster layer id from the view configuration (falls back to cluster-1).
  let clusterLayerId = 'cluster-1';
  const deployId = cs.stormcenterDeploymentId ?? cs.data?.stormcenterDeploymentId;
  if (deployId) {
    try {
      interface KubraConfig {
        config?: { layers?: { data?: { interval_generation_data?: Array<{ id?: string; type?: string }> } } };
      }
      const conf = await getJson<KubraConfig>(
        `https://kubra.io/stormcenter/api/v1/stormcenters/${src.instanceId}/views/${src.viewId}/configuration/${deployId}?preview=false`
      );
      const layers = conf.config?.layers?.data?.interval_generation_data ?? [];
      const cl = layers.find((l) => typeof l.type === 'string' && l.type.startsWith('CLUSTER_LAYER'));
      if (cl?.id) clusterLayerId = cl.id;
    } catch {
      /* keep fallback */
    }
  }

  // Quadkey-tile descent: a tile containing cluster records recurses into its
  // four children; a tile of leaves yields individual outages. {qkh} in the
  // cluster path is the reversed last-3 chars of the quadkey (KUBRA sharding).
  //
  // Loss-proofing: when a tile recurses, its cluster records are held in
  // `pending` and only released once all four children have been fetched. If
  // the walk stops early (tile cap / time budget), whatever is still pending
  // is emitted as aggregated cluster points — so a truncated walk degrades to
  // coarser markers instead of silently dropping outages.
  const deadline = Date.now() + KUBRA_WALK_MS;
  // The queue holds SIBLING GROUPS (a parent's four children together, seeds as
  // singletons) so a recursion step is atomic: a parent is either fully refined
  // by all four children or — if the cap/deadline stops us first — left parked
  // and flushed as an aggregate. Splitting siblings across the cap would emit a
  // child's leaves AND the parent cluster covering them (double-counting).
  const queue: string[][] = seedQuadkeys(src.bbox, KUBRA_SEED_ZOOM).map((qk) => [qk]);
  const outages: Outage[] = [];
  const pending = new Map<string, KubraRecord[]>(); // parent qk → cluster records awaiting children
  const childrenSeen = new Map<string, number>();
  let fetched = 0;

  const emitRecord = (rec: KubraRecord) => {
    const d = rec.desc ?? {};
    const pt = rec.geom?.p?.[0] ? decodePolylineFirst(rec.geom.p[0]) : null;
    if (!pt) return;
    const cause = d.cause ? (str(d.cause['EN-US']) ?? str(Object.values(d.cause)[0])) : null;
    const nOut = num(d.n_out);
    // inc_id is null for several utilities (e.g. Georgia Power / Oncor). The
    // fallback key must be stable ACROSS tiles — the same outage re-appears in
    // a re-walked child tile and in boundary-straddling siblings (with a
    // different per-tile rec.id), and only the coordinates identify it there,
    // letting the dedupe below collapse the duplicates.
    const incId =
      str(d.inc_id as string) ?? (typeof d.inc_id === 'number' ? String(d.inc_id) : null);
    outages.push({
      id: `kubra-${src.name}-${incId ?? `${pt.lat.toFixed(5)},${pt.lon.toFixed(5)}`}`,
      utility: src.name,
      state: src.state,
      lat: pt.lat,
      lon: pt.lon,
      start: toEpochMs(d.start_time),
      estimatedRestore: toEpochMs(d.etr),
      cause,
      customers: num(d.cust_a?.val),
      county: null,
      status: str(d.crew_status),
      type: inferType(cause),
      aggregated: d.cluster === true && nOut != null && nOut > 1 ? nOut : null,
    });
  };

  const fetchTile = async (qk: string): Promise<{ qk: string; records: KubraRecord[] }> => {
    const qkh = qk.slice(-3).split('').reverse().join('');
    const path = cigd.includes('{qkh}') ? cigd.replace('{qkh}', qkh) : cigd;
    const url = `https://kubra.io/${path}/public/${clusterLayerId}/${qk}.json`;
    try {
      const tile = await getJson<{ file_data?: KubraRecord[] }>(url);
      return { qk, records: tile.file_data ?? [] };
    } catch {
      return { qk, records: [] }; // 404 = empty tile — normal
    }
  };

  while (queue.length > 0 && Date.now() < deadline) {
    const group = queue.shift()!;
    if (fetched + group.length > KUBRA_TILE_CAP) break; // whole group or nothing
    fetched += group.length;
    const tiles = await Promise.all(group.map(fetchTile));
    for (const t of tiles) {
      const clusters = t.records.filter((r) => r.desc?.cluster === true);
      if (clusters.length > 0 && t.qk.length < KUBRA_MAX_QK_LEN) {
        // Recurse; park the clusters until all four children come back.
        pending.set(t.qk, clusters);
        queue.push([t.qk + '0', t.qk + '1', t.qk + '2', t.qk + '3']);
        // Leaf records sharing a tile with clusters are real outages — emit now
        // (if a child re-renders them, the coordinate-keyed dedupe collapses it).
        for (const rec of t.records) if (rec.desc?.cluster !== true) emitRecord(rec);
      } else {
        for (const rec of t.records) emitRecord(rec);
      }
      // Mark this tile as a fetched child of its parent; a parent with all four
      // children fetched has been fully refined — its parked clusters drop.
      const parent = t.qk.slice(0, -1);
      if (pending.has(parent)) {
        const n = (childrenSeen.get(parent) ?? 0) + 1;
        childrenSeen.set(parent, n);
        if (n >= 4) pending.delete(parent);
      }
    }
  }

  // Anything still pending was never fully refined — emit the parked clusters
  // as aggregate points rather than losing them.
  for (const clusters of pending.values()) for (const rec of clusters) emitRecord(rec);

  // Defensive dedupe (an outage can straddle a tile boundary re-walk).
  const seen = new Set<string>();
  return outages.filter((o) => (seen.has(o.id) ? false : (seen.add(o.id), true)));
}

// ---------------------------------------------------------------------------
// adapter 3: NISC hosted co-op outage maps (outagemap-data.cloud.coop)

interface NiscSource {
  tenant: string;
  name: string;
  state: string;
}

const NISC_SOURCES: NiscSource[] = [
  { tenant: 'sawnee', name: 'Sawnee EMC', state: 'GA' },
  { tenant: 'slemco', name: 'SLEMCO', state: 'LA' },
  { tenant: 'priceelectric', name: 'Price Electric Co-op', state: 'WI' },
  { tenant: 'cloverland', name: 'Cloverland Electric Co-op', state: 'MI' },
];

const NISC_HOST = 'https://outagemap-data.cloud.coop';

// Per-tenant map extents change ~never; cache them for the process lifetime.
const niscExtentCache = new Map<string, [number, number, number, number]>();

async function fetchNiscSource(src: NiscSource): Promise<Outage[]> {
  let extent = niscExtentCache.get(src.tenant);
  if (!extent) {
    interface NiscConfig {
      mapSettings?: { fullExtent?: number[] };
    }
    const conf = await getJson<NiscConfig>(`${NISC_HOST}/${src.tenant}/Hosted_Outage_Map/config.json`);
    const fe = conf.mapSettings?.fullExtent;
    if (!fe || fe.length < 4) throw new Error('NISC config missing fullExtent');
    extent = [fe[0], fe[1], fe[2], fe[3]];
    niscExtentCache.set(src.tenant, extent);
  }

  interface NiscSummary {
    outages?: Array<{
      id?: string;
      nbrOut?: number;
      timeOff?: number;
      estimateTime?: number;
      cause?: string;
      planned?: boolean;
      crewAssigned?: boolean;
      x?: number;
      y?: number;
    }>;
  }
  const summary = await getJson<NiscSummary>(`${NISC_HOST}/${src.tenant}/Hosted_Outage_Map/summary.json`);

  const out: Outage[] = [];
  (summary.outages ?? []).forEach((o, i) => {
    if (typeof o.x !== 'number' || typeof o.y !== 'number') return;
    // x/y are Web-Mercator meter offsets from the tenant map's SW corner.
    const mercX = extent![0] + o.x;
    const mercY = extent![1] + o.y;
    const lon = (mercX / 20037508.342789244) * 180;
    const lat = ((2 * Math.atan(Math.exp(mercY / 6378137)) - Math.PI / 2) * 180) / Math.PI;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
    const cause = str(o.cause);
    out.push({
      id: `nisc-${src.tenant}-${o.id ?? i}`,
      utility: src.name,
      state: src.state,
      lat,
      lon,
      start: toEpochMs(o.timeOff),
      estimatedRestore: toEpochMs(o.estimateTime),
      cause,
      customers: num(o.nbrOut),
      county: null,
      status: o.crewAssigned ? 'Crew assigned' : null,
      type: typeof o.planned === 'boolean' ? (o.planned ? 'Planned' : 'Unplanned') : inferType(cause),
      aggregated: null,
    });
  });
  return out;
}

// ---------------------------------------------------------------------------
// aggregation + background refresh (wind-route pattern: serve instantly)

async function fetchAllOutages(): Promise<OutagesResponse> {
  type Task = { name: string; state: string; run: () => Promise<Outage[]> };
  const tasks: Task[] = [
    ...ARCGIS_SOURCES.map((s) => ({ name: s.name, state: s.state, run: () => fetchArcgisSource(s) })),
    ...KUBRA_SOURCES.map((s) => ({ name: s.name, state: s.state, run: () => fetchKubraSource(s) })),
    ...NISC_SOURCES.map((s) => ({ name: s.name, state: s.state, run: () => fetchNiscSource(s) })),
  ];

  const results = await Promise.allSettled(tasks.map((t) => t.run()));
  const outages: Outage[] = [];
  const sources: SourceStatus[] = [];
  results.forEach((r, i) => {
    const t = tasks[i];
    if (r.status === 'fulfilled') {
      outages.push(...r.value);
      sources.push({ name: t.name, state: t.state, ok: true, count: r.value.length });
    } else {
      console.warn(`[outages] ${t.name} failed:`, r.reason instanceof Error ? r.reason.message : r.reason);
      sources.push({ name: t.name, state: t.state, ok: false, count: 0 });
    }
  });

  // Biggest impact first so a capped client render keeps the important ones.
  outages.sort((a, b) => (b.customers ?? 0) - (a.customers ?? 0));

  // Ids become Cesium entity ids client-side, which must be unique — suffix any
  // residual collision instead of letting the layer throw.
  const seenIds = new Set<string>();
  for (const o of outages) {
    let id = o.id;
    for (let k = 1; seenIds.has(id); k++) id = `${o.id}~${k}`;
    o.id = id;
    seenIds.add(id);
  }

  return { outages, sources, updated: Date.now() };
}

let latest: OutagesResponse | null = null;
// Serialized once per refresh — the snapshot is served identically to every
// polling client, so per-request JSON.stringify is wasted event-loop time.
let latestBody: Buffer | null = null;
let refreshing = false;
// Each rebuild fans out to ~18 utility sources (KUBRA alone can walk ~150 tile
// fetches per utility during a storm). Pause the loop while nobody has asked
// for outages recently; the stale-kick in the GET handler revives it.
let lastRequestedAt = 0;
const IDLE_AFTER_MS = 15 * 60_000;

async function refreshOutages(): Promise<void> {
  if (refreshing) return;
  refreshing = true;
  try {
    latest = await fetchAllOutages();
    latestBody = Buffer.from(JSON.stringify(latest));
  } catch (err) {
    console.error('[outages] refresh failed', err);
  } finally {
    refreshing = false;
  }
}

export function initOutagesStream(): void {
  void refreshOutages();
  setInterval(() => {
    if (Date.now() - lastRequestedAt > IDLE_AFTER_MS && latest) return; // idle — skip the fan-out
    void refreshOutages();
  }, REFRESH_MS);
}

router.get('/', (_req, res) => {
  lastRequestedAt = Date.now();
  if (latest && latestBody) {
    // Kick a refresh if the background loop went stale (or was idle-paused).
    if (Date.now() - latest.updated > REFRESH_MS * 2) void refreshOutages();
    res.type('application/json').send(latestBody);
    return;
  }
  // Cold start before the first refresh lands: answer empty-but-valid rather
  // than block toward the 30 s platform timeout; the client polls again.
  void refreshOutages();
  res.json({ outages: [], sources: [], updated: 0, error: 'warming up' } satisfies OutagesResponse);
});

export default router;
