import { Router } from 'express';
import { cache } from '../cache';

// GDELT GKG GeoJSON API (v1) — geocoded global news. Returns one GeoJSON point
// per article, tagged with the location the article is about: city-level where
// GDELT can resolve it (geores 3/4), country centroid otherwise (geores 1). We
// group those article-points into one pin per location, carrying the article
// links, a representative image, and average tone (sentiment). Free, no key.
//
// NOTE: needs outbound access to api.gdeltproject.org — if the deployment runs
// behind an egress allowlist, add that host or the layer surfaces a fetch error.
//
// Why GKG and not GEO 2.0: the newer /api/v2/geo/geo endpoint currently returns
// 404 from GDELT, while this original GKG endpoint is live and actually returns
// finer-grained coordinates. Hit GET /api/news-map/debug to inspect the raw
// upstream shape if a future GDELT change moves a field.

const router = Router();

const GKG_GEOJSON = 'https://api.gdeltproject.org/api/v1/gkg_geojson';
const OUTPUT_FIELDS = 'name,geores,url,domain,sharingimage,lang,tone,themes';

// This is a security-operations monitor, so default to safety/security-relevant
// coverage rather than general news. Override per request with ?query=. GDELT's
// boolean OR syntax works here.
const DEFAULT_QUERY =
  '(protest OR evacuation OR wildfire OR shooting OR explosion OR flooding OR "active shooter" OR lockdown OR hazmat OR riot OR derailment)';

const DEFAULT_TIMESPAN_MIN = 360; // 6h — fresh but enough volume to map
const MAX_ROWS = 250;
const TTL = 10 * 60_000; // GKG refreshes ~every 15 min; also stays well under
// GDELT's 1-request-per-5s limit since every client shares this cached result.

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
  tone: number | null; // avg GDELT tone; negative = more negative coverage
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

// GKG GeoJSON carries no article title, only the URL + domain. Most news URLs
// embed the headline as a slug, so derive a readable title from the path; fall
// back to the domain when the slug looks like an id/guid.
function titleFromUrl(url: string, domain: string): string {
  try {
    const segs = new URL(url).pathname.split('/').filter(Boolean);
    let best = '';
    let bestWords = 0;
    for (const seg of segs) {
      const words = seg.split(/[-_]/).filter((w) => /[a-z]{3,}/i.test(w));
      if (words.length > bestWords) {
        bestWords = words.length;
        best = seg;
      }
    }
    if (bestWords >= 3) {
      const text = best
        .replace(/\.[a-z0-9]+$/i, '')
        .replace(/[-_]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      const titled = text.replace(/\b([a-z])/g, (m) => m.toUpperCase());
      return titled.length > 90 ? `${titled.slice(0, 88)}…` : titled;
    }
  } catch {
    /* fall through to domain */
  }
  return domain || 'View article';
}

interface GkgFeature {
  geometry?: { coordinates?: unknown };
  properties?: Record<string, unknown>;
}

// Accumulator carries running tone sums; stripped to NewsMapEvent at the end.
interface Accum extends NewsMapEvent {
  _toneSum: number;
  _toneN: number;
}

function parseGkg(data: unknown, query: string): Result {
  const fc = data as { features?: unknown } | null;
  const feats: GkgFeature[] = Array.isArray(fc?.features) ? (fc!.features as GkgFeature[]) : [];

  const byKey = new Map<string, Accum>();
  for (const f of feats) {
    const c = f?.geometry?.coordinates;
    const lon = Array.isArray(c) ? num(c[0]) : null;
    const lat = Array.isArray(c) ? num(c[1]) : null;
    if (lon == null || lat == null || Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;

    const p = f?.properties ?? {};
    const name = typeof p.name === 'string' && p.name.trim() ? p.name.trim() : 'Unknown location';
    const key = `${name}|${lat.toFixed(2)}|${lon.toFixed(2)}`;

    let e = byKey.get(key);
    if (!e) {
      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
      e = {
        id: `${lat.toFixed(3)},${lon.toFixed(3)}:${slug}`,
        name,
        lat,
        lon,
        count: 0,
        image: null,
        tone: null,
        articles: [],
        _toneSum: 0,
        _toneN: 0,
      };
      byKey.set(key, e);
    }

    e.count++;
    const tone = num(p.urltone);
    if (tone != null) {
      e._toneSum += tone;
      e._toneN++;
    }
    const img =
      typeof p.urlsocialimage === 'string' && p.urlsocialimage.trim() ? p.urlsocialimage.trim() : null;
    if (!e.image && img) e.image = img;

    const url = typeof p.url === 'string' ? p.url : '';
    const domain = typeof p.domain === 'string' ? p.domain : '';
    if (url && e.articles.length < 6 && !e.articles.some((a) => a.url === url)) {
      e.articles.push({ title: titleFromUrl(url, domain), url });
    }
  }

  const events: NewsMapEvent[] = [...byKey.values()]
    .map((e) => ({
      id: e.id,
      name: e.name,
      lat: e.lat,
      lon: e.lon,
      count: e.count,
      image: e.image,
      tone: e._toneN ? Math.round((e._toneSum / e._toneN) * 10) / 10 : null,
      articles: e.articles,
    }))
    .sort((a, b) => b.count - a.count);

  return { events, updated: Date.now(), query };
}

async function fetchGkg(query: string, timespanMin: number): Promise<unknown> {
  const url =
    `${GKG_GEOJSON}?QUERY=${encodeURIComponent(query)}` +
    `&OUTPUTFIELDS=${encodeURIComponent(OUTPUT_FIELDS)}` +
    `&MAXROWS=${MAX_ROWS}&TIMESPAN=${timespanMin}`;
  const r = await fetch(url, {
    signal: AbortSignal.timeout(20_000),
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

// TIMESPAN is in minutes for the GKG API. Clamp to a sane 15min–24h window.
function readTimespan(raw: unknown): number {
  const n = typeof raw === 'string' ? parseInt(raw, 10) : NaN;
  return Number.isFinite(n) ? Math.min(1440, Math.max(15, n)) : DEFAULT_TIMESPAN_MIN;
}

router.get('/', async (req, res) => {
  const query = readQuery(req.query.query);
  const timespan = readTimespan(req.query.timespan);
  const key = `news-map:gkg:${query}:${timespan}`;

  try {
    const result = await cache.getOrFetch<Result>(
      key,
      TTL,
      async () => parseGkg(await fetchGkg(query, timespan), query),
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

// Inspect the raw upstream payload + how it groups into pins — used to confirm
// GDELT's field names against a live response (mirrors the webcams /debug route).
router.get('/debug', async (req, res) => {
  const query = readQuery(req.query.query);
  const timespan = readTimespan(req.query.timespan);
  try {
    const raw = await fetchGkg(query, timespan);
    const parsed = parseGkg(raw, query);
    const feats = (raw as { features?: unknown[] })?.features;
    res.json({
      query,
      timespanMin: timespan,
      rawFeatureCount: Array.isArray(feats) ? feats.length : null,
      sampleFeature: Array.isArray(feats) ? feats[0] ?? null : null,
      pinCount: parsed.events.length,
      pinSample: parsed.events.slice(0, 3),
    });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : 'GDELT unreachable' });
  }
});

export default router;
