import { Router } from 'express';
import { cache } from '../cache';
import { config } from '../config';

const router = Router();

// NPS Data API — documented, stable, JSON. Far more reliable than scraping
// per-park RSS pages (which NPS no longer publishes consistently). Both the
// alerts and news releases are batched into a single request each so the total
// hits stay to 2, well within DEMO_KEY's 5-req/hour-per-endpoint limit.
const NPS_API = 'https://developer.nps.gov/api/v1';

// Tracked parks: parkCode → display name + map anchor.
const PARKS: Array<{ code: string; name: string; lat: number; lon: number }> = [
  { code: 'grca', name: 'Grand Canyon',   lat: 36.056, lon: -112.139 },
  { code: 'deva', name: 'Death Valley',   lat: 36.505, lon: -117.079 },
  { code: 'glac', name: 'Glacier',        lat: 48.694, lon: -113.718 },
  { code: 'moru', name: 'Mount Rushmore', lat: 43.879, lon: -103.459 },
  { code: 'yell', name: 'Yellowstone',    lat: 44.428, lon: -110.588 },
  { code: 'romo', name: 'Rocky Mountain', lat: 40.343, lon: -105.683 },
];

// Latest N news releases to fetch across all parks combined; spread evenly.
const TOTAL_NEWS = 60; // 10 per park × 6 parks

const PARK_BY_CODE = new Map(PARKS.map((p) => [p.code, p]));

interface ParkItem {
  id: string;
  title: string;
  url: string;
  source: string;
  image: string | null;
  publishedAt: number;
  severity: 'alert' | 'urgent' | 'critical';
  category: string;
  countryName: string; // reused as the park name for display
  lat: number;
  lon: number;
}

interface NpsNewsRelease {
  id?: string;
  url?: string;
  title?: string;
  abstract?: string;
  parkCode?: string;
  releaseDate?: string;
  image?: { url?: string } | null;
}

interface NpsAlert {
  id?: string;
  url?: string;
  title?: string;
  description?: string;
  parkCode?: string;
  category?: string; // "Danger" | "Caution" | "Information" | "Park Closure"
  lastIndexedDate?: string;
}

function alertSeverity(category: string | undefined): 'alert' | 'urgent' | 'critical' {
  switch ((category ?? '').toLowerCase()) {
    case 'danger':
      return 'critical';
    case 'park closure':
    case 'caution':
      return 'urgent';
    default:
      return 'alert';
  }
}

function idFrom(url: string, fallback: string): string {
  const basis = url || fallback;
  return Buffer.from(basis).toString('base64').slice(0, 24);
}

async function npsFetch<T>(path: string): Promise<T> {
  const sep = path.includes('?') ? '&' : '?';
  const url = `${NPS_API}${path}${sep}api_key=${encodeURIComponent(config.npsApiKey)}`;
  const r = await fetch(url, {
    signal: AbortSignal.timeout(10_000),
    headers: { 'User-Agent': 'gsoc-monitor/1.0 (national-parks dashboard)' },
  });
  if (!r.ok) throw new Error(`NPS ${path} HTTP ${r.status}`);
  return (await r.json()) as T;
}

// Latest news releases across all tracked parks — single batched request.
async function fetchAllNewsReleases(): Promise<ParkItem[]> {
  const codes = PARKS.map((p) => p.code).join(',');
  const data = await npsFetch<{ data?: NpsNewsRelease[] }>(
    `/newsreleases?parkCode=${codes}&limit=${TOTAL_NEWS}`
  );
  const rows = data.data ?? [];
  const items: ParkItem[] = [];
  for (const n of rows) {
    const park = PARK_BY_CODE.get(n.parkCode ?? '');
    if (!park) continue;
    const when = n.releaseDate ? Date.parse(n.releaseDate) : NaN;
    const url = (n.url ?? '').trim();
    items.push({
      id: idFrom(url, n.id ?? `${park.code}-${n.title}`),
      title: n.title ?? 'Park news',
      url: url || `https://www.nps.gov/${park.code}/`,
      source: `${park.name} NP News`,
      image: n.image?.url ?? null,
      publishedAt: Number.isNaN(when) ? Date.now() : when,
      severity: 'alert',
      category: 'environment',
      countryName: park.name,
      lat: park.lat,
      lon: park.lon,
    });
  }
  return items;
}

// Current alerts/closures across all tracked parks (single request).
async function fetchAllAlerts(): Promise<ParkItem[]> {
  const codes = PARKS.map((p) => p.code).join(',');
  const data = await npsFetch<{ data?: NpsAlert[] }>(`/alerts?parkCode=${codes}&limit=120`);
  const rows = data.data ?? [];
  const items: ParkItem[] = [];
  for (const a of rows) {
    const park = PARK_BY_CODE.get(a.parkCode ?? '');
    if (!park) continue;
    const when = a.lastIndexedDate ? Date.parse(a.lastIndexedDate) : NaN;
    const url = (a.url ?? '').trim();
    items.push({
      id: idFrom(url, a.id ?? `${a.parkCode}-${a.title}`),
      title: a.category ? `${a.category}: ${a.title ?? ''}`.trim() : a.title ?? 'Park alert',
      url: url || `https://www.nps.gov/${park.code}/planyourvisit/conditions.htm`,
      source: `${park.name} NP Alerts`,
      image: null,
      publishedAt: Number.isNaN(when) ? Date.now() : when,
      severity: alertSeverity(a.category),
      category: 'disaster',
      countryName: park.name,
      lat: park.lat,
      lon: park.lon,
    });
  }
  return items;
}

const CACHE_KEY = 'park-news:v3';
const SUCCESS_TTL = 10 * 60_000;
let lastGood: { items: ParkItem[]; updated: number } | null = null;

router.get('/', async (_req, res) => {
  const cached = cache.get<{ items: ParkItem[]; updated: number }>(CACHE_KEY);
  if (cached) {
    res.json(cached);
    return;
  }

  try {
    const settled = await Promise.allSettled([
      fetchAllAlerts(),
      fetchAllNewsReleases(),
    ]);

    const all: ParkItem[] = [];
    const seen = new Set<string>();
    for (const r of settled) {
      if (r.status !== 'fulfilled') {
        console.error('[park-news] feed failed:', r.reason);
        continue;
      }
      for (const item of r.value) {
        if (seen.has(item.id)) continue;
        seen.add(item.id);
        all.push(item);
      }
    }

    // Alerts first (most actionable), then everything by recency.
    all.sort((a, b) => {
      const aAlert = a.category === 'disaster' ? 1 : 0;
      const bAlert = b.category === 'disaster' ? 1 : 0;
      if (aAlert !== bAlert) return bAlert - aAlert;
      return b.publishedAt - a.publishedAt;
    });

    const result = { items: all, updated: Date.now() };
    if (result.items.length > 0) {
      cache.set(CACHE_KEY, result, SUCCESS_TTL);
      lastGood = result;
    }
    res.json(result);
  } catch (err) {
    console.error('[park-news] fetch failed:', err);
    if (lastGood) res.json({ ...lastGood, stale: true });
    else res.status(502).json({ error: String(err), items: [], updated: Date.now() });
  }
});

export default router;
