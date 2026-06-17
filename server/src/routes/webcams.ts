import { Router } from 'express';
import { cache } from '../cache';
import { config } from '../config';

const router = Router();

// Windy Webcams API v3 — global aggregator of public webcams (scenic + traffic),
// searchable by lat/lon radius. Image URLs it returns are short-lived tokens, so
// the panel relies on the stable `player` embed for the live view rather than
// caching a tokened still. https://api.windy.com/webcams/docs
const WINDY_API = 'https://api.windy.com/webcams/api/v3';

// Property pins to search around — kept in sync with the client's
// LOCATION_GROUPS (client/src/layers/locations/locations.ts). Webcams are
// surfaced when they fall within RADIUS_MI of any one of these points.
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
const RADIUS_KM = RADIUS_MI * 1.60934;
// Merge pins closer than this into one search anchor to cut request volume; the
// query radius is widened by the merge distance so every original pin stays
// fully covered.
const MERGE_KM = 8;
const PER_ANCHOR_LIMIT = 50;

export interface Webcam {
  id: string;
  title: string;
  lat: number;
  lon: number;
  status: string;
  lastUpdated: number | null;
  previewUrl: string | null;
  playerEmbedUrl: string | null;
  detailUrl: string | null;
  providerUrl: string | null;
  categories: string[];
  nearestPin: string;
  distanceMi: number;
}

interface WindyWebcam {
  webcamId?: number | string;
  id?: number | string;
  title?: string;
  status?: string;
  lastUpdatedOn?: string;
  lastUpdated?: string;
  categories?: Array<{ id?: string; name?: string }>;
  location?: {
    latitude?: number;
    longitude?: number;
    lat?: number;
    lng?: number;
    lon?: number;
  };
  images?: {
    current?: { preview?: string; thumbnail?: string; icon?: string };
    preview?: string;
  };
  player?: { day?: string; live?: string; month?: string; year?: string; lifetime?: string };
  urls?: { detail?: string; provider?: string; edit?: string };
}

function haversineMi(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 3958.7613; // mean Earth radius, miles
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// Greedily merge nearby pins into search anchors. Each anchor's radius is grown
// to still reach RADIUS_MI past the farthest pin folded into it.
interface Anchor {
  lat: number;
  lon: number;
  radiusKm: number;
}
function buildAnchors(): Anchor[] {
  const anchors: Anchor[] = [];
  for (const p of PINS) {
    const near = anchors.find(
      (a) => haversineMi(a.lat, a.lon, p.lat, p.lon) * 1.60934 <= MERGE_KM
    );
    if (near) {
      const extraKm = haversineMi(near.lat, near.lon, p.lat, p.lon) * 1.60934;
      near.radiusKm = Math.max(near.radiusKm, RADIUS_KM + extraKm);
    } else {
      anchors.push({ lat: p.lat, lon: p.lon, radiusKm: RADIUS_KM });
    }
  }
  return anchors;
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
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function normalize(w: WindyWebcam): Webcam | null {
  const id = w.webcamId ?? w.id;
  const lat = num(w.location?.latitude ?? w.location?.lat);
  const lon = num(w.location?.longitude ?? w.location?.lng ?? w.location?.lon);
  if (id == null || lat == null || lon == null) return null;

  const whenStr = w.lastUpdatedOn ?? w.lastUpdated;
  const when = whenStr ? Date.parse(whenStr) : NaN;
  const np = nearestPin(lat, lon);

  return {
    id: String(id),
    title: (w.title ?? 'Webcam').trim() || 'Webcam',
    lat,
    lon,
    status: w.status ?? 'unknown',
    lastUpdated: Number.isNaN(when) ? null : when,
    previewUrl: w.images?.current?.preview ?? w.images?.preview ?? null,
    playerEmbedUrl: w.player?.day ?? w.player?.live ?? w.player?.lifetime ?? null,
    detailUrl: w.urls?.detail ?? null,
    providerUrl: w.urls?.provider ?? null,
    categories: (w.categories ?? []).map((c) => c.name ?? '').filter(Boolean),
    nearestPin: np.name,
    distanceMi: Math.round(np.distanceMi * 10) / 10,
  };
}

async function fetchAnchor(a: Anchor): Promise<WindyWebcam[]> {
  const radius = Math.min(250, Math.ceil(a.radiusKm));
  const url =
    `${WINDY_API}/webcams?nearby=${a.lat.toFixed(4)},${a.lon.toFixed(4)},${radius}` +
    `&include=categories,images,location,player,urls&limit=${PER_ANCHOR_LIMIT}`;
  const r = await fetch(url, {
    signal: AbortSignal.timeout(10_000),
    headers: {
      'x-windy-api-key': config.windyApiKey,
      'User-Agent': 'gsoc-monitor/1.0 (property webcam layer)',
    },
  });
  if (!r.ok) throw new Error(`Windy ${r.status}`);
  const data = (await r.json()) as { webcams?: WindyWebcam[]; result?: { webcams?: WindyWebcam[] } };
  return data.webcams ?? data.result?.webcams ?? [];
}

const CACHE_KEY = 'webcams:v1';
const SUCCESS_TTL = 6 * 60 * 60_000; // 6h — the set of nearby cams barely changes
let lastGood: { source: 'windy'; webcams: Webcam[]; updated: number } | null = null;

router.get('/', async (_req, res) => {
  if (!config.windyApiKey) {
    res.json({ source: 'no-key', webcams: [], updated: Date.now() });
    return;
  }

  const cached = cache.get<{ source: 'windy'; webcams: Webcam[]; updated: number }>(CACHE_KEY);
  if (cached) {
    res.json(cached);
    return;
  }

  try {
    const anchors = buildAnchors();
    const settled = await Promise.allSettled(anchors.map(fetchAnchor));

    const byId = new Map<string, Webcam>();
    for (const s of settled) {
      if (s.status !== 'fulfilled') {
        console.error('[webcams] anchor failed:', s.reason);
        continue;
      }
      for (const raw of s.value) {
        const cam = normalize(raw);
        if (!cam) continue;
        // Honor the "within 10 miles of a pin" rule exactly (the anchor radius
        // can reach a touch further once pins are merged).
        if (cam.distanceMi > RADIUS_MI + 0.1) continue;
        const prev = byId.get(cam.id);
        // Keep the instance attributed to the closest pin.
        if (!prev || cam.distanceMi < prev.distanceMi) byId.set(cam.id, cam);
      }
    }

    const webcams = [...byId.values()].sort((a, b) => a.distanceMi - b.distanceMi);
    const result = { source: 'windy' as const, webcams, updated: Date.now() };

    // Only cache/remember non-empty successes so a transient empty result
    // doesn't pin the layer blank for 6h.
    if (webcams.length > 0) {
      cache.set(CACHE_KEY, result, SUCCESS_TTL);
      lastGood = result;
    }
    res.json(result);
  } catch (err) {
    console.error('[webcams] fetch failed:', err);
    if (lastGood) res.json({ ...lastGood, stale: true });
    else res.status(502).json({ source: 'error', webcams: [], updated: Date.now(), error: String(err) });
  }
});

export default router;
