import { Router } from 'express';
import { cache } from '../cache';

const router = Router();

const GDELT_BASE = 'https://api.gdeltproject.org/api/v2/doc/doc';

// Keywords for severity classification
const CRITICAL_WORDS = [
  'killed', 'dead', 'deaths', 'explosion', 'bombing', 'attack', 'shooting',
  'tsunami', 'catastrophic', 'mass casualty', 'collapsed', 'sinking', 'crash',
  'wildfire spreads', 'tornado kills', 'hostage',
];
const URGENT_WORDS = [
  'warning', 'emergency', 'evacuation', 'injured', 'outbreak', 'flood',
  'tornado', 'hurricane', 'earthquake', 'eruption', 'fire', 'threat',
  'strike', 'troops', 'invasion', 'missile', 'arrested', 'rescue',
];

// Country name (as returned by GDELT) → approximate centroid [lat, lon]
const COUNTRY_CENTROIDS: Record<string, [number, number]> = {
  'United States': [39.5, -98.35], US: [39.5, -98.35],
  'United Kingdom': [54.37, -2.0], GB: [54.37, -2.0],
  Ukraine: [49.0, 32.0], UA: [49.0, 32.0],
  Russia: [61.52, 105.3], RU: [61.52, 105.3],
  China: [35.86, 104.2], CN: [35.86, 104.2],
  Israel: [31.0, 35.0], IL: [31.0, 35.0],
  Gaza: [31.5, 34.5], Palestine: [31.9, 35.2],
  Iran: [32.4, 53.7], IR: [32.4, 53.7],
  Pakistan: [30.4, 69.3], PK: [30.4, 69.3],
  India: [20.6, 79.0], IN: [20.6, 79.0],
  Japan: [36.2, 138.3], JP: [36.2, 138.3],
  France: [46.2, 2.2], FR: [46.2, 2.2],
  Germany: [51.2, 10.5], DE: [51.2, 10.5],
  Australia: [-25.3, 133.8], AU: [-25.3, 133.8],
  Brazil: [-14.2, -51.9], BR: [-14.2, -51.9],
  Mexico: [23.6, -102.6], MX: [23.6, -102.6],
  Canada: [56.1, -106.3], CA: [56.1, -106.3],
  Turkey: [38.9, 35.2], TR: [38.9, 35.2],
  Syria: [34.8, 38.99], SY: [34.8, 38.99],
  'Saudi Arabia': [23.9, 45.1], SA: [23.9, 45.1],
  'South Korea': [35.9, 127.8], KR: [35.9, 127.8],
  'North Korea': [40.3, 127.5], KP: [40.3, 127.5],
  Egypt: [26.8, 30.8], EG: [26.8, 30.8],
  Sudan: [15.6, 32.5], SD: [15.6, 32.5],
  Myanmar: [21.9, 95.9], MM: [21.9, 95.9],
  Indonesia: [-0.8, 113.9], ID: [-0.8, 113.9],
  Philippines: [12.9, 121.8], PH: [12.9, 121.8],
  Taiwan: [23.7, 120.96], TW: [23.7, 120.96],
  'South Africa': [-30.6, 22.9], ZA: [-30.6, 22.9],
  Nigeria: [9.1, 8.7], NG: [9.1, 8.7],
  Ethiopia: [9.1, 40.5], ET: [9.1, 40.5],
  Spain: [40.0, -4.0], ES: [40.0, -4.0],
  Italy: [42.8, 12.8], IT: [42.8, 12.8],
  Yemen: [15.5, 48.0], YE: [15.5, 48.0],
  Lebanon: [33.9, 35.5], LB: [33.9, 35.5],
  Afghanistan: [33.9, 67.7], AF: [33.9, 67.7],
};

interface GDELTArticle {
  url?: string;
  title?: string;
  seendate?: string;
  socialimage?: string;
  domain?: string;
  language?: string;
  sourcecountry?: string;
}

function parseSeen(s: string): number {
  const m = s.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/);
  if (!m) return Date.now();
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
}

function severity(title: string): 'alert' | 'urgent' | 'critical' {
  const t = title.toLowerCase();
  if (CRITICAL_WORDS.some((w) => t.includes(w))) return 'critical';
  if (URGENT_WORDS.some((w) => t.includes(w))) return 'urgent';
  return 'alert';
}

function guessCategory(title: string): string {
  const t = title.toLowerCase();
  if (/war|attack|military|troops|bomb|shoot|missile|terror|combat|soldier/.test(t)) return 'conflict';
  if (/earthquake|flood|wildfire|tsunami|hurricane|cyclone|disaster|eruption|volcano|landslide/.test(t)) return 'disaster';
  if (/storm|tornado|blizzard|typhoon|drought|rain|snow|hail|lightning|heat/.test(t)) return 'weather';
  if (/president|election|congress|senate|parliament|government|minister|vote|referendum/.test(t)) return 'politics';
  if (/economy|market|inflation|stock|bank|trade|recession|gdp|tariff|fed|interest rate/.test(t)) return 'economy';
  if (/virus|pandemic|epidemic|disease|vaccine|hospital|outbreak|cancer|health emergency/.test(t)) return 'health';
  if (/climate|pollution|species|ocean|carbon|forest|environment|emissions|wildlife/.test(t)) return 'environment';
  return 'conflict';
}

// Keep this tight — GDELT returns a plain-text error page (not JSON) when a
// query is too long or complex, which would look like a 502 to the client.
const NEWS_QUERY =
  'earthquake OR hurricane OR wildfire OR explosion OR airstrike OR war OR outbreak OR election OR eruption OR shooting';

async function fetchGdelt(query: string): Promise<GDELTArticle[]> {
  const url = new URL(GDELT_BASE);
  url.searchParams.set('query', query);
  url.searchParams.set('mode', 'artlist');
  url.searchParams.set('maxrecords', '100');
  url.searchParams.set('format', 'json');
  // 360min = 6 hours — confirmed valid GDELT timespan format.
  url.searchParams.set('timespan', '360min');
  url.searchParams.set('sort', 'DateDesc');

  const r = await fetch(url.toString(), {
    signal: AbortSignal.timeout(12_000),
    headers: { 'User-Agent': 'gsoc-monitor/1.0' },
  });
  if (!r.ok) throw new Error(`GDELT HTTP ${r.status}`);

  // GDELT sometimes returns a plain-text error (HTTP 200) instead of JSON when
  // a query is malformed or rate-limited. Read as text and parse defensively so
  // we surface a useful message rather than crashing on res.json().
  const text = await r.text();
  let data: { articles?: GDELTArticle[] };
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`GDELT non-JSON response: ${text.slice(0, 140).replace(/\s+/g, ' ')}`);
  }
  return data.articles ?? [];
}

router.get('/', async (_req, res) => {
  try {
    const items = await cache.getOrFetch('news:gdelt', 5 * 60_000, async () => {
      const raw = await fetchGdelt(NEWS_QUERY);
      const seen = new Set<string>();
      const out = [];
      for (const a of raw) {
        if (!a.url || !a.title || seen.has(a.url)) continue;
        seen.add(a.url);
        const centroid = a.sourcecountry ? COUNTRY_CENTROIDS[a.sourcecountry] : undefined;
        const image = a.socialimage && /^https?:\/\//.test(a.socialimage) ? a.socialimage : null;
        out.push({
          id: Buffer.from(a.url).toString('base64').slice(0, 16),
          title: a.title,
          url: a.url,
          source: a.domain ?? '',
          image,
          publishedAt: parseSeen(a.seendate ?? ''),
          severity: severity(a.title),
          category: guessCategory(a.title),
          countryName: a.sourcecountry ?? null,
          lat: centroid?.[0] ?? null,
          lon: centroid?.[1] ?? null,
        });
      }
      return out.sort((a, b) => b.publishedAt - a.publishedAt);
    });
    res.json({ items, updated: Date.now() });
  } catch (err) {
    console.error('[news] GDELT fetch failed:', err);
    res.status(502).json({ error: String(err), items: [], updated: Date.now() });
  }
});

export default router;
