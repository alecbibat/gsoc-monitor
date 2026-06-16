import { Router } from 'express';
import { cache } from '../cache';

const router = Router();

// GDELT's DOC API hard-rate-limits shared datacenter IPs (Heroku), so we pull
// from major news RSS feeds instead — reliable from any IP, free, no key.
const FEEDS: Array<{ url: string; source: string }> = [
  { url: 'https://feeds.bbci.co.uk/news/world/rss.xml', source: 'BBC News' },
  { url: 'https://www.theguardian.com/world/rss', source: 'The Guardian' },
  { url: 'https://feeds.skynews.com/feeds/rss/world.xml', source: 'Sky News' },
  { url: 'https://feeds.npr.org/1001/rss.xml', source: 'NPR' },
  { url: 'https://www.aljazeera.com/xml/rss/all.xml', source: 'Al Jazeera' },
];

const CRITICAL_WORDS = [
  'killed', 'dead', 'deaths', 'explosion', 'bombing', 'attack', 'shooting',
  'tsunami', 'catastrophic', 'mass casualty', 'collapse', 'sinking', 'crash',
  'massacre', 'tornado kills', 'hostage', 'genocide', 'assassinat',
];
const URGENT_WORDS = [
  'warning', 'emergency', 'evacuation', 'injured', 'outbreak', 'flood',
  'tornado', 'hurricane', 'earthquake', 'eruption', 'wildfire', 'threat',
  'strike', 'troops', 'invasion', 'missile', 'arrested', 'rescue', 'protest',
  'airstrike', 'ceasefire', 'sanction',
];

// Place name → [lat, lon]. Cities are checked before countries so a more
// specific dateline wins. Longer names are matched first to avoid substrings.
const PLACES: Array<[string, number, number]> = [
  // Hotspot cities / regions
  ['Gaza', 31.5, 34.47], ['West Bank', 31.95, 35.3], ['Jerusalem', 31.78, 35.22],
  ['Tel Aviv', 32.08, 34.78], ['Beirut', 33.89, 35.5], ['Damascus', 33.51, 36.29],
  ['Tehran', 35.69, 51.39], ['Baghdad', 33.31, 44.36], ['Kabul', 34.53, 69.17],
  ['Kyiv', 50.45, 30.52], ['Kiev', 50.45, 30.52], ['Moscow', 55.75, 37.62],
  ['Crimea', 45.3, 34.4], ['Donetsk', 48.0, 37.8], ['Mariupol', 47.1, 37.55],
  ['London', 51.5, -0.13], ['Paris', 48.86, 2.35], ['Berlin', 52.52, 13.4],
  ['Madrid', 40.42, -3.7], ['Rome', 41.9, 12.5], ['Brussels', 50.85, 4.35],
  ['Washington', 38.9, -77.04], ['New York', 40.71, -74.0], ['Los Angeles', 34.05, -118.24],
  ['Beijing', 39.9, 116.4], ['Hong Kong', 22.32, 114.17], ['Shanghai', 31.23, 121.47],
  ['Tokyo', 35.68, 139.69], ['Seoul', 37.57, 126.98], ['Pyongyang', 39.04, 125.76],
  ['New Delhi', 28.61, 77.21], ['Mumbai', 19.08, 72.88], ['Karachi', 24.86, 67.0],
  ['Istanbul', 41.01, 28.98], ['Cairo', 30.04, 31.24], ['Khartoum', 15.5, 32.56],
  ['Kabul', 34.53, 69.17], ['Sanaa', 15.37, 44.19], ['Riyadh', 24.71, 46.68],
  ['Taipei', 25.03, 121.57], ['Manila', 14.6, 120.98], ['Jakarta', -6.21, 106.85],
  ['Sydney', -33.87, 151.21], ['Rio de Janeiro', -22.91, -43.17], ['Mexico City', 19.43, -99.13],
];

// Country fallbacks (used if no city matched).
const COUNTRIES: Array<[string, number, number]> = [
  ['United States', 39.5, -98.35], ['America', 39.5, -98.35], ['U.S.', 39.5, -98.35],
  ['United Kingdom', 54.0, -2.5], ['Britain', 54.0, -2.5], ['England', 52.5, -1.5],
  ['Ukraine', 49.0, 32.0], ['Russia', 61.5, 105.3], ['China', 35.86, 104.2],
  ['Israel', 31.4, 35.0], ['Palestin', 31.9, 35.2], ['Iran', 32.4, 53.7],
  ['Pakistan', 30.4, 69.3], ['India', 22.6, 79.0], ['Japan', 36.2, 138.3],
  ['France', 46.2, 2.2], ['Germany', 51.2, 10.5], ['Spain', 40.0, -4.0],
  ['Italy', 42.8, 12.8], ['Australia', -25.3, 133.8], ['Brazil', -14.2, -51.9],
  ['Mexico', 23.6, -102.6], ['Canada', 56.1, -106.3], ['Turkey', 38.9, 35.2],
  ['Syria', 34.8, 38.99], ['Yemen', 15.5, 48.0], ['Lebanon', 33.9, 35.5],
  ['Afghanistan', 33.9, 67.7], ['Iraq', 33.2, 43.7], ['Egypt', 26.8, 30.8],
  ['Sudan', 15.6, 32.5], ['Myanmar', 21.9, 95.9], ['Indonesia', -0.8, 113.9],
  ['Philippines', 12.9, 121.8], ['Taiwan', 23.7, 120.96], ['South Korea', 35.9, 127.8],
  ['North Korea', 40.3, 127.5], ['South Africa', -30.6, 22.9], ['Nigeria', 9.1, 8.7],
  ['Ethiopia', 9.1, 40.5], ['Venezuela', 6.4, -66.6], ['Argentina', -38.4, -63.6],
  ['Poland', 51.9, 19.1], ['Greece', 39.1, 21.8], ['Sweden', 60.1, 18.6],
  ['Haiti', 19.1, -72.3], ['Congo', -2.9, 23.7], ['Somalia', 5.2, 46.2],
];

interface NewsItem {
  id: string;
  title: string;
  url: string;
  source: string;
  image: string | null;
  publishedAt: number;
  severity: 'alert' | 'urgent' | 'critical';
  category: string;
  countryName: string | null;
  lat: number | null;
  lon: number | null;
}

interface NewsResult {
  items: NewsItem[];
  updated: number;
}

function decodeXml(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ') // strip any stray HTML tags
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function tag(block: string, name: string): string | null {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? decodeXml(m[1]) : null;
}

function extractImage(block: string): string | null {
  const patterns = [
    /<media:thumbnail[^>]*url="([^"]+)"/i,
    /<media:content[^>]*url="([^"]+)"[^>]*(?:medium="image"|type="image)/i,
    /<media:content[^>]*(?:medium="image"|type="image)[^>]*url="([^"]+)"/i,
    /<enclosure[^>]*url="([^"]+)"[^>]*type="image/i,
    /<img[^>]*src="([^"]+)"/i,
  ];
  for (const re of patterns) {
    const m = block.match(re);
    if (m && /^https?:\/\//.test(m[1])) return m[1];
  }
  return null;
}

function severity(text: string): 'alert' | 'urgent' | 'critical' {
  const t = text.toLowerCase();
  if (CRITICAL_WORDS.some((w) => t.includes(w))) return 'critical';
  if (URGENT_WORDS.some((w) => t.includes(w))) return 'urgent';
  return 'alert';
}

function guessCategory(text: string): string {
  const t = text.toLowerCase();
  if (/war|attack|military|troops|bomb|shoot|missile|terror|combat|soldier|airstrike|ceasefire|rebel/.test(t)) return 'conflict';
  if (/earthquake|flood|wildfire|tsunami|hurricane|cyclone|disaster|eruption|volcano|landslide|quake/.test(t)) return 'disaster';
  if (/storm|tornado|blizzard|typhoon|drought|heatwave|heat wave|hail|lightning/.test(t)) return 'weather';
  if (/president|election|congress|senate|parliament|minister|vote|referendum|government|coup|summit/.test(t)) return 'politics';
  if (/economy|market|inflation|stock|bank|trade|recession|gdp|tariff|interest rate|jobs/.test(t)) return 'economy';
  if (/virus|pandemic|epidemic|disease|vaccine|hospital|outbreak|cancer|health/.test(t)) return 'health';
  if (/climate|pollution|species|ocean|carbon|wildlife|emissions|deforestation/.test(t)) return 'environment';
  return 'politics';
}

// Find the most specific place mentioned in the headline (city beats country).
function geolocate(text: string): { name: string; lat: number; lon: number } | null {
  for (const [name, lat, lon] of PLACES) {
    if (new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text)) {
      return { name, lat, lon };
    }
  }
  for (const [name, lat, lon] of COUNTRIES) {
    if (new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i').test(text)) {
      return { name: name.replace(/\.$/, ''), lat, lon };
    }
  }
  return null;
}

async function fetchFeed(url: string, source: string): Promise<NewsItem[]> {
  const r = await fetch(url, {
    signal: AbortSignal.timeout(8_000),
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; gsoc-monitor/1.0)' },
  });
  if (!r.ok) throw new Error(`${source} HTTP ${r.status}`);
  const xml = await r.text();

  const items: NewsItem[] = [];
  const blocks = xml.match(/<item[\s\S]*?<\/item>/gi) ?? [];
  for (const block of blocks) {
    const title = tag(block, 'title');
    const link = (tag(block, 'link') || '').trim();
    if (!title || !link) continue;
    const desc = tag(block, 'description') || '';
    const pub = tag(block, 'pubDate');
    const when = pub ? Date.parse(pub) : NaN;
    const place = geolocate(`${title} ${desc}`);
    items.push({
      id: Buffer.from(link).toString('base64').slice(0, 20),
      title,
      url: link,
      source,
      image: extractImage(block),
      publishedAt: Number.isNaN(when) ? Date.now() : when,
      severity: severity(`${title} ${desc}`),
      category: guessCategory(`${title} ${desc}`),
      countryName: place?.name ?? null,
      lat: place?.lat ?? null,
      lon: place?.lon ?? null,
    });
  }
  return items;
}

async function fetchAllFeeds(extraFeeds: Array<{ url: string; source: string }> = []): Promise<NewsItem[]> {
  const allFeeds = [...FEEDS, ...extraFeeds];
  const results = await Promise.allSettled(allFeeds.map((f) => fetchFeed(f.url, f.source)));
  const all: NewsItem[] = [];
  const seen = new Set<string>();
  for (const res of results) {
    if (res.status !== 'fulfilled') {
      console.error('[news] feed failed:', res.reason);
      continue;
    }
    for (const item of res.value) {
      if (seen.has(item.url)) continue;
      seen.add(item.url);
      all.push(item);
    }
  }
  if (all.length === 0) throw new Error('all news feeds failed');
  return all.sort((a, b) => b.publishedAt - a.publishedAt).slice(0, 120);
}

const CACHE_KEY = 'news:rss';
const SUCCESS_TTL = 5 * 60_000;
const FAILURE_COOLDOWN = 60_000;

let lastGood: NewsResult | null = null;
let cooldownUntil = 0;

router.get('/', async (req, res) => {
  // Parse user-supplied extra RSS feeds from ?extra=<url-encoded-json>.
  let extraFeeds: Array<{ url: string; source: string }> = [];
  if (req.query.extra) {
    try {
      const parsed = JSON.parse(req.query.extra as string) as Array<{ url: string; label: string }>;
      extraFeeds = parsed.map((e) => ({ url: e.url, source: e.label || new URL(e.url).hostname }));
    } catch {
      // ignore malformed extra param
    }
  }

  // If extra feeds supplied, fetch base from cache then merge extras fresh.
  if (extraFeeds.length > 0) {
    let baseItems: NewsItem[] = [];
    const cached = cache.get<NewsResult>(CACHE_KEY);
    if (cached) {
      baseItems = cached.items;
    } else if (lastGood) {
      baseItems = lastGood.items;
    } else {
      try {
        baseItems = await fetchAllFeeds();
        const result: NewsResult = { items: baseItems, updated: Date.now() };
        cache.set(CACHE_KEY, result, SUCCESS_TTL);
        lastGood = result;
      } catch {
        // continue with empty base
      }
    }

    const extraResults = await Promise.allSettled(
      extraFeeds.map((f) => fetchFeed(f.url, f.source))
    );
    const baseUrls = new Set(baseItems.map((i) => i.url));
    const extraItems: NewsItem[] = [];
    for (const r of extraResults) {
      if (r.status !== 'fulfilled') {
        console.error('[news] extra feed failed:', r.reason);
        continue;
      }
      for (const item of r.value) {
        if (!baseUrls.has(item.url)) extraItems.push(item);
      }
    }

    const merged = [...extraItems, ...baseItems]
      .sort((a, b) => b.publishedAt - a.publishedAt)
      .slice(0, 120);
    res.json({ items: merged, updated: Date.now() });
    return;
  }

  // Standard path: cache → cooldown stale → fresh fetch.
  const cached = cache.get<NewsResult>(CACHE_KEY);
  if (cached) {
    res.json(cached);
    return;
  }
  if (Date.now() < cooldownUntil && lastGood) {
    res.json({ ...lastGood, stale: true });
    return;
  }

  try {
    const result: NewsResult = { items: await fetchAllFeeds(), updated: Date.now() };
    cache.set(CACHE_KEY, result, SUCCESS_TTL);
    lastGood = result;
    res.json(result);
  } catch (err) {
    console.error('[news] fetch failed:', err);
    cooldownUntil = Date.now() + FAILURE_COOLDOWN;
    if (lastGood) {
      res.json({ ...lastGood, stale: true });
    } else {
      res.status(502).json({ error: String(err), items: [], updated: Date.now() });
    }
  }
});

export default router;
