import { Router } from 'express';
import { cache } from '../cache';

const router = Router();

// State DOT traffic cameras near the property pins. Sources are pluggable: most
// states run the "ibi511" platform (/api/v2/get/cameras) or the older
// /api/GetCameras platform — both need a free per-state key — while California's
// Caltrans CWWP2 feed is open. Camera images are short-lived JPEGs proxied
// through /api/webcams/image so they display over HTTPS without hotlink issues.

// Property pins to search around — kept in sync with the client's
// LOCATION_GROUPS (client/src/layers/locations/locations.ts).
const PINS: Array<{ name: string; lat: number; lon: number }> = [
  { name: 'Cedar Creek Lodge', lat: 48.37014, lon: -114.18468 },
  { name: 'Village Inn (Glacier)', lat: 48.52903, lon: -113.99417 },
  { name: 'Lake McDonald Lodge', lat: 48.61749, lon: -113.87903 },
  { name: 'Swiftcurrent Motor Inn', lat: 48.79781, lon: -113.67699 },
  { name: 'Many Glacier Hotel', lat: 48.79667, lon: -113.6577 },
  { name: 'Oasis Death Valley Ranch', lat: 36.4584, lon: -116.86996 },
  { name: 'Oasis Death Valley Inn', lat: 36.45059, lon: -116.85343 },
  { name: 'Grand Canyon Railway & Hotel', lat: 35.25185, lon: -112.19152 },
  { name: 'Grand Canyon Village', lat: 36.05624, lon: -112.13939 },
  { name: 'Xanterra Corporate Office', lat: 39.60323, lon: -104.89349 },
  { name: 'Centennial Airport', lat: 39.57483, lon: -104.84767 },
  { name: 'Gardiner, Montana', lat: 45.03199, lon: -110.70578 },
  { name: 'Mammoth Hot Springs', lat: 44.97636, lon: -110.7017 },
  { name: 'Roosevelt Lodge Cabins', lat: 44.91266, lon: -110.41686 },
  { name: 'Canyon Village', lat: 44.73417, lon: -110.49071 },
  { name: 'Lake Yellowstone Hotel', lat: 44.55047, lon: -110.40003 },
  { name: 'Grant Village', lat: 44.39323, lon: -110.55551 },
  { name: 'Old Faithful Inn', lat: 44.45968, lon: -110.83115 },
  { name: 'Madison Campground', lat: 44.64424, lon: -110.86255 },
  { name: 'Mount Rushmore', lat: 43.87533, lon: -103.45342 },
  { name: 'Windstar Corporate Office', lat: 25.80916, lon: -80.33307 },
  { name: 'Holiday Vacations Office', lat: 44.79093, lon: -91.46245 },
  { name: 'VBT Bicycling Office', lat: 44.46096, lon: -73.12281 },
  { name: 'Sea Island Resort', lat: 31.18122, lon: -81.3502 },
  { name: 'Cog Railway', lat: 38.85606, lon: -104.93156 },
];

const RADIUS_MI = 10;

export interface Webcam {
  id: string;
  title: string;
  lat: number;
  lon: number;
  imageUrl: string | null; // proxied, auto-refreshing JPEG (the live view)
  source: string; // DOT name, e.g. "Arizona DOT"
  sourceUrl: string | null; // link to the state 511 site
  roadway: string | null;
  status: string; // 'active' | 'disabled' | 'unknown'
  lastUpdated: number | null;
  nearestPin: string;
  distanceMi: number;
}

interface RawCam {
  id: string;
  name: string;
  lat: number;
  lon: number;
  imageUrl: string | null; // upstream JPEG
  roadway?: string | null;
  status?: string;
}

function haversineMi(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 3958.7613;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function nearestPin(lat: number, lon: number): { name: string; distanceMi: number } {
  let best = { name: PINS[0].name, distanceMi: Infinity };
  for (const p of PINS) {
    const d = haversineMi(lat, lon, p.lat, p.lon);
    if (d < best.distanceMi) best = { name: p.name, distanceMi: d };
  }
  return best;
}

function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function pick<T = unknown>(o: Record<string, unknown>, ...keys: string[]): T | undefined {
  for (const k of keys) if (o[k] != null) return o[k] as T;
  return undefined;
}

// --- Providers -------------------------------------------------------------
// 'ibi511'   → GET https://{host}/api/v2/get/cameras?key=&format=json
// 'legacy511'→ GET https://{host}/api/GetCameras?key=&format=json
// 'caltrans' → open per-district CWWP2 JSON (no key)
type ProviderKind = 'ibi511' | 'legacy511' | 'caltrans';

interface ProviderConfig {
  code: string;
  name: string;
  kind: ProviderKind;
  host?: string; // for ibi511 / legacy511
  envKey?: string; // env var holding the API key
  site: string; // public 511 site
  districts?: string[]; // for caltrans (e.g. ['d8','d9'])
}

const PROVIDERS: ProviderConfig[] = [
  // California — open Caltrans feed (no key). Death Valley straddles D8/D9.
  { code: 'CA', name: 'Caltrans', kind: 'caltrans', districts: ['d8', 'd9'], site: 'https://cwwp2.dot.ca.gov' },
  // ibi511 platform — confirmed hosts. Need a free per-state developer key.
  { code: 'AZ', name: 'Arizona DOT', kind: 'ibi511', host: 'www.az511.com', envKey: 'AZ511_API_KEY', site: 'https://az511.com' },
  { code: 'GA', name: 'Georgia DOT', kind: 'ibi511', host: 'ga.ibi511.com', envKey: 'GA511_API_KEY', site: 'https://511ga.org' },
  { code: 'FL', name: 'Florida DOT', kind: 'ibi511', host: 'fl.ibi511.com', envKey: 'FL511_API_KEY', site: 'https://fl511.com' },
  // Legacy /api/GetCameras platform.
  { code: 'WI', name: 'Wisconsin DOT', kind: 'legacy511', host: '511wi.gov', envKey: 'WI511_API_KEY', site: 'https://511wi.gov' },
];

// Hostnames whose images the proxy is allowed to fetch (SSRF guard). Extend as
// providers are added.
const IMG_HOST_ALLOW = [
  '.dot.ca.gov',
  '.ibi511.com',
  'az511.com',
  '.az511.com',
  'az511.gov',
  '.az511.gov',
  '511wi.gov',
  '.511wi.gov',
  'fl511.com',
  '.fl511.com',
  '511ga.org',
  '.511ga.org',
];

function imageHostAllowed(host: string): boolean {
  const h = host.toLowerCase();
  return IMG_HOST_ALLOW.some((a) => (a.startsWith('.') ? h.endsWith(a) : h === a));
}

function proxied(url: string | null): string | null {
  if (!url) return null;
  return `/api/webcams/image?u=${encodeURIComponent(url)}`;
}

async function fetchJson(url: string): Promise<unknown> {
  const r = await fetch(url, {
    signal: AbortSignal.timeout(12_000),
    headers: { 'User-Agent': 'gsoc-monitor/1.0 (property webcam layer)', Accept: 'application/json' },
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

function asArray(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) return data as Record<string, unknown>[];
  if (data && typeof data === 'object') {
    const o = data as Record<string, unknown>;
    const arr = o.cameras ?? o.Cameras ?? o.data ?? o.results;
    if (Array.isArray(arr)) return arr as Record<string, unknown>[];
  }
  return [];
}

// ibi511: each camera carries Latitude/Longitude/Location/Roadway and a Views[]
// array whose first entry holds the image Url + Status.
function parseIbi511(data: unknown): RawCam[] {
  const out: RawCam[] = [];
  for (const c of asArray(data)) {
    const lat = num(pick(c, 'Latitude', 'latitude'));
    const lon = num(pick(c, 'Longitude', 'longitude'));
    if (lat == null || lon == null) continue;
    const views = (pick<Record<string, unknown>[]>(c, 'Views', 'views') ?? []) as Record<string, unknown>[];
    const v0 = Array.isArray(views) ? views[0] : undefined;
    const imageUrl =
      (v0 && (pick<string>(v0, 'Url', 'url', 'ImageUrl', 'imageUrl') ?? null)) ??
      (pick<string>(c, 'ImageUrl', 'imageUrl', 'Url', 'url') ?? null);
    const status = v0 ? pick<string>(v0, 'Status', 'status') : pick<string>(c, 'Status', 'status');
    out.push({
      id: String(pick(c, 'Id', 'id', 'SourceId') ?? `${lat},${lon}`),
      name: String(pick(c, 'Location', 'location', 'Name', 'name', 'Roadway') ?? 'Traffic camera'),
      lat,
      lon,
      imageUrl: imageUrl ?? null,
      roadway: (pick<string>(c, 'Roadway', 'roadway') ?? null) || null,
      status: (status ?? 'unknown').toString().toLowerCase().includes('disab') ? 'disabled' : 'active',
    });
  }
  return out;
}

// legacy /api/GetCameras: flat camera objects with Latitude/Longitude/Url.
function parseLegacy511(data: unknown): RawCam[] {
  const out: RawCam[] = [];
  for (const c of asArray(data)) {
    const lat = num(pick(c, 'Latitude', 'latitude'));
    const lon = num(pick(c, 'Longitude', 'longitude'));
    if (lat == null || lon == null) continue;
    const disabled = String(pick(c, 'Disabled', 'disabled') ?? '').toLowerCase() === 'true';
    out.push({
      id: String(pick(c, 'ID', 'Id', 'id') ?? `${lat},${lon}`),
      name: String(pick(c, 'Name', 'name', 'Location', 'RoadwayName') ?? 'Traffic camera'),
      lat,
      lon,
      imageUrl: (pick<string>(c, 'Url', 'url', 'ImageUrl', 'imageUrl') ?? null) || null,
      roadway: (pick<string>(c, 'RoadwayName', 'Roadway', 'roadway') ?? null) || null,
      status: disabled ? 'disabled' : 'active',
    });
  }
  return out;
}

// Caltrans CWWP2: { data: [ { cctv: { location:{latitude,longitude,locationName},
// imageData:{ static:{ currentImageURL } } } } ] }
function parseCaltrans(data: unknown): RawCam[] {
  const out: RawCam[] = [];
  const rows = (data && typeof data === 'object' ? (data as Record<string, unknown>).data : null) ?? [];
  if (!Array.isArray(rows)) return out;
  for (const row of rows as Record<string, unknown>[]) {
    const cctv = (row.cctv ?? row.CCTV) as Record<string, unknown> | undefined;
    if (!cctv) continue;
    const loc = cctv.location as Record<string, unknown> | undefined;
    const img = cctv.imageData as Record<string, unknown> | undefined;
    const stat = img?.static as Record<string, unknown> | undefined;
    const lat = num(loc?.latitude);
    const lon = num(loc?.longitude);
    if (lat == null || lon == null) continue;
    const url = (stat?.currentImageURL as string) ?? null;
    out.push({
      id: String(cctv.index ?? `${lat},${lon}`),
      name: String(loc?.locationName || loc?.nearbyPlace || 'Caltrans camera'),
      lat,
      lon,
      imageUrl: url && url.trim() ? url.trim() : null,
      roadway: (loc?.route as string) ?? null,
      status: 'active',
    });
  }
  return out;
}

async function runProvider(p: ProviderConfig): Promise<{ configured: boolean; cams: RawCam[] }> {
  if (p.kind === 'caltrans') {
    const lists = await Promise.allSettled(
      (p.districts ?? []).map(async (d) => {
        const dd = d.replace('d', '').padStart(2, '0');
        return parseCaltrans(await fetchJson(`https://cwwp2.dot.ca.gov/data/${d}/cctv/cctvStatusD${dd}.json`));
      })
    );
    const cams = lists.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
    return { configured: true, cams };
  }

  const key = p.envKey ? process.env[p.envKey] : undefined;
  if (!key) return { configured: false, cams: [] };
  const path = p.kind === 'ibi511' ? 'api/v2/get/cameras' : 'api/GetCameras';
  const data = await fetchJson(`https://${p.host}/${path}?key=${encodeURIComponent(key)}&format=json`);
  const cams = p.kind === 'ibi511' ? parseIbi511(data) : parseLegacy511(data);
  return { configured: true, cams };
}

const CACHE_KEY = 'webcams:dot:v1';
const SUCCESS_TTL = 6 * 60 * 60_000; // 6h — the set of nearby cams barely changes
type Result = {
  webcams: Webcam[];
  updated: number;
  providers: Array<{ code: string; name: string; configured: boolean; count: number; error: string | null }>;
};
let lastGood: Result | null = null;

router.get('/', async (_req, res) => {
  const cached = cache.get<Result>(CACHE_KEY);
  if (cached) {
    res.json(cached);
    return;
  }

  const settled = await Promise.allSettled(PROVIDERS.map((p) => runProvider(p)));

  const byId = new Map<string, Webcam>();
  const providers: Result['providers'] = [];

  settled.forEach((s, i) => {
    const p = PROVIDERS[i];
    if (s.status !== 'fulfilled') {
      providers.push({ code: p.code, name: p.name, configured: true, count: 0, error: String(s.reason) });
      return;
    }
    let near = 0;
    for (const raw of s.value.cams) {
      const np = nearestPin(raw.lat, raw.lon);
      if (np.distanceMi > RADIUS_MI) continue;
      near++;
      const id = `${p.code}:${raw.id}`;
      const cam: Webcam = {
        id,
        title: raw.name,
        lat: raw.lat,
        lon: raw.lon,
        imageUrl: proxied(raw.imageUrl),
        source: p.name,
        sourceUrl: p.site,
        roadway: raw.roadway ?? null,
        status: raw.status ?? 'unknown',
        lastUpdated: null,
        nearestPin: np.name,
        distanceMi: Math.round(np.distanceMi * 10) / 10,
      };
      const prev = byId.get(id);
      if (!prev || cam.distanceMi < prev.distanceMi) byId.set(id, cam);
    }
    providers.push({ code: p.code, name: p.name, configured: s.value.configured, count: near, error: null });
  });

  const webcams = [...byId.values()].sort((a, b) => a.distanceMi - b.distanceMi);
  const result: Result = { webcams, updated: Date.now(), providers };

  // Cache only when at least one provider returned cams, so a transient
  // all-fail doesn't pin the layer blank for 6h.
  if (webcams.length > 0) {
    cache.set(CACHE_KEY, result, SUCCESS_TTL);
    lastGood = result;
  } else if (lastGood) {
    res.json({ ...lastGood, stale: true });
    return;
  }
  res.json(result);
});

// Image proxy — fetches the upstream JPEG and serves it over our origin so the
// browser gets HTTPS, no hotlink-referrer issues, and no CORS. Restricted to
// known DOT hosts to avoid being an open proxy.
router.get('/image', async (req, res) => {
  const u = typeof req.query.u === 'string' ? req.query.u : '';
  let parsed: URL;
  try {
    parsed = new URL(u);
  } catch {
    res.status(400).end();
    return;
  }
  if (!/^https?:$/.test(parsed.protocol) || !imageHostAllowed(parsed.hostname)) {
    res.status(403).end();
    return;
  }
  try {
    const upstream = await fetch(parsed.toString(), {
      signal: AbortSignal.timeout(10_000),
      headers: { 'User-Agent': 'gsoc-monitor/1.0', Accept: 'image/*' },
    });
    if (!upstream.ok || !upstream.body) {
      res.status(502).end();
      return;
    }
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=20');
    const buf = Buffer.from(await upstream.arrayBuffer());
    res.end(buf);
  } catch {
    res.status(504).end();
  }
});

router.get('/debug', async (_req, res) => {
  const cached = cache.get<Result>(CACHE_KEY);
  res.json({
    providers: PROVIDERS.map((p) => ({
      code: p.code,
      name: p.name,
      kind: p.kind,
      configured: p.kind === 'caltrans' ? true : Boolean(p.envKey && process.env[p.envKey]),
      envKey: p.envKey ?? null,
    })),
    lastResult: cached
      ? { count: cached.webcams.length, providers: cached.providers, updated: cached.updated }
      : null,
    pendingStates: ['CO (COtrip)', 'WY (no public API)', 'MT', 'SD', 'VT'],
  });
});

export default router;
