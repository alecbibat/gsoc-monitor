import { Router } from 'express';
import { cache } from '../cache';

// GDELT GEO 2.0 — geocoded global news. The GEO API returns a GeoJSON
// FeatureCollection where each point is a place currently mentioned in news
// coverage, carrying an article count and an HTML blob of headline links.
// Free, no API key. NOTE: this needs outbound access to api.gdeltproject.org —
// if the deployment runs behind an egress allowlist, add that host or the
// layer will surface a fetch error.
//
// Field names in the GeoJSON properties (name / count / shareimage / html) are
// parsed defensively; hit GET /api/news-map/debug to see the raw upstream
// shape if a future GDELT change moves something.

const router = Router();

const GDELT_GEO = 'https://api.gdeltproject.org/api/v2/geo/geo';

// This is a security-operations monitor, so default to safety/security-relevant
// coverage rather than general news. Override per request with ?query=. Keep it
// a single OR group in GDELT's query syntax.
const DEFAULT_QUERY =
  '(protest OR evacuation OR wildfire OR shooting OR explosion OR flooding OR "active shooter" OR lockdown OR hazmat OR riot OR derailment)';

const TTL = 10 * 60_000; // GDELT refreshes roughly every 15 min
const MAX_POINTS = 250;

export interface NewsArticle {
  title: string;
  url: string;
}

export interface NewsMapEvent {
  id: string;
  name: string;
  lat: number;
  lon: number;
  count: number;
  image: string | null;
  articles: NewsArticle[];
}

interface Result {
  events: NewsMapEvent[];
  updated: number;
  query: string;
}

function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

// GDELT bundles a point's articles into an HTML popup blob. Pull the
// <a href="URL">TITLE</a> pairs back out, stripping any nested markup.
function parseArticles(html: unknown, cap = 6): NewsArticle[] {
  if (typeof html !== 'string') return [];
  const out: NewsArticle[] = [];
  const re = /<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null && out.length < cap) {
    const url = m[1]?.trim();
    const title = m[2]?.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
    if (url && title) out.push({ title, url });
  }
  return out;
}

interface GeoFeature {
  geometry?: { coordinates?: unknown };
  properties?: Record<string, unknown>;
}

function parseGeo(data: unknown, query: string): Result {
  const fc = data as { features?: unknown } | null;
  const feats: GeoFeature[] = Array.isArray(fc?.features) ? (fc!.features as GeoFeature[]) : [];
  const events: NewsMapEvent[] = [];

  feats.forEach((f, i) => {
    const coords = f?.geometry?.coordinates;
    const lon = Array.isArray(coords) ? num(coords[0]) : null;
    const lat = Array.isArray(coords) ? num(coords[1]) : null;
    if (lon == null || lat == null || Math.abs(lat) > 90 || Math.abs(lon) > 180) return;

    const p = f?.properties ?? {};
    const name = typeof p.name === 'string' && p.name.trim() ? p.name.trim() : 'Unknown location';
    const image =
      typeof p.shareimage === 'string' && p.shareimage.trim() ? p.shareimage.trim() : null;

    events.push({
      id: `${lat.toFixed(4)},${lon.toFixed(4)}:${i}`,
      name,
      lat,
      lon,
      count: num(p.count) ?? 0,
      image,
      articles: parseArticles(p.html),
    });
  });

  return { events, updated: Date.now(), query };
}

async function fetchGeo(query: string, timespan: string): Promise<unknown> {
  const url =
    `${GDELT_GEO}?query=${encodeURIComponent(query)}` +
    `&format=GeoJSON&mode=PointData&timespan=${encodeURIComponent(timespan)}&maxpoints=${MAX_POINTS}`;
  const r = await fetch(url, {
    signal: AbortSignal.timeout(15_000),
    headers: {
      'User-Agent': 'gsoc-monitor/1.0 (news map layer)',
      Accept: 'application/json',
    },
  });
  if (!r.ok) throw new Error(`GDELT HTTP ${r.status}`);
  return r.json();
}

function readQuery(raw: unknown): string {
  return typeof raw === 'string' && raw.trim() ? raw.trim() : DEFAULT_QUERY;
}

// Accept GDELT-style spans like 24h, 1440min, 7d, 2w; otherwise default to 24h.
function readTimespan(raw: unknown): string {
  return typeof raw === 'string' && /^\d+(min|h|d|w|m)$/i.test(raw.trim()) ? raw.trim() : '24h';
}

router.get('/', async (req, res) => {
  const query = readQuery(req.query.query);
  const timespan = readTimespan(req.query.timespan);
  const key = `news-map:${query}:${timespan}`;

  try {
    const result = await cache.getOrFetch<Result>(
      key,
      TTL,
      async () => parseGeo(await fetchGeo(query, timespan), query),
      { staleOnError: true },
    );
    res.json(result);
  } catch (err) {
    res.status(502).json({
      events: [],
      updated: Date.now(),
      query,
      error: err instanceof Error ? err.message : 'GDELT unreachable',
    });
  }
});

// Inspect the raw upstream payload + how it parses — used to confirm GDELT's
// field names against a live response (mirrors the webcams /debug route).
router.get('/debug', async (req, res) => {
  const query = readQuery(req.query.query);
  const timespan = readTimespan(req.query.timespan);
  try {
    const raw = await fetchGeo(query, timespan);
    const parsed = parseGeo(raw, query);
    const feats = (raw as { features?: unknown[] })?.features;
    res.json({
      query,
      timespan,
      featureCount: Array.isArray(feats) ? feats.length : null,
      sampleFeature: Array.isArray(feats) ? feats[0] ?? null : null,
      parsedCount: parsed.events.length,
      parsedSample: parsed.events.slice(0, 3),
    });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : 'GDELT unreachable' });
  }
});

export default router;
