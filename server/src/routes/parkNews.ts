import { Router } from 'express';
import { cache } from '../cache';

const router = Router();
const UA = 'Mozilla/5.0 (compatible; gsoc-monitor/1.0)';

interface ParkFeed {
  url: string;
  source: string;
  park: string;
  lat: number;
  lon: number;
}

// NPS RSS feeds: news releases and closures/alerts for each tracked park.
const PARK_FEEDS: ParkFeed[] = [
  { url: 'https://www.nps.gov/grca/news/rss.htm',   source: 'Grand Canyon NP News',    park: 'Grand Canyon',   lat: 36.056,  lon: -112.139 },
  { url: 'https://www.nps.gov/grca/alerts/rss.htm', source: 'Grand Canyon NP Alerts',  park: 'Grand Canyon',   lat: 36.056,  lon: -112.139 },
  { url: 'https://www.nps.gov/deva/news/rss.htm',   source: 'Death Valley NP News',    park: 'Death Valley',   lat: 36.505,  lon: -117.079 },
  { url: 'https://www.nps.gov/deva/alerts/rss.htm', source: 'Death Valley NP Alerts',  park: 'Death Valley',   lat: 36.505,  lon: -117.079 },
  { url: 'https://www.nps.gov/glac/news/rss.htm',   source: 'Glacier NP News',         park: 'Glacier',        lat: 48.694,  lon: -113.718 },
  { url: 'https://www.nps.gov/glac/alerts/rss.htm', source: 'Glacier NP Alerts',       park: 'Glacier',        lat: 48.694,  lon: -113.718 },
  { url: 'https://www.nps.gov/moru/news/rss.htm',   source: 'Mount Rushmore NM News',  park: 'Mount Rushmore', lat: 43.879,  lon: -103.459 },
  { url: 'https://www.nps.gov/moru/alerts/rss.htm', source: 'Mount Rushmore NM Alerts',park: 'Mount Rushmore', lat: 43.879,  lon: -103.459 },
  { url: 'https://www.nps.gov/yell/news/rss.htm',   source: 'Yellowstone NP News',     park: 'Yellowstone',    lat: 44.428,  lon: -110.588 },
  { url: 'https://www.nps.gov/yell/alerts/rss.htm', source: 'Yellowstone NP Alerts',   park: 'Yellowstone',    lat: 44.428,  lon: -110.588 },
  { url: 'https://www.nps.gov/romo/news/rss.htm',   source: 'Rocky Mountain NP News',  park: 'Rocky Mountain', lat: 40.343,  lon: -105.683 },
  { url: 'https://www.nps.gov/romo/alerts/rss.htm', source: 'Rocky Mountain NP Alerts',park: 'Rocky Mountain', lat: 40.343,  lon: -105.683 },
];

const CRITICAL_WORDS = ['life-threatening', 'critical', 'evacuate immediately'];
const URGENT_WORDS = [
  'closed', 'closure', 'emergency', 'hazard', 'warning', 'danger',
  'evacuation', 'wildfire', 'flood', 'road closed', 'trail closed', 'area closed',
];

function decodeXml(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'").replace(/&apos;/g, "'").replace(/&#x27;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
}

function xmlTag(block: string, name: string): string | null {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? decodeXml(m[1]) : null;
}

function extractImage(block: string): string | null {
  const patterns = [
    /<media:thumbnail[^>]*url="([^"]+)"/i,
    /<media:content[^>]*url="([^"]+)"[^>]*(?:medium="image"|type="image)/i,
    /<enclosure[^>]*url="([^"]+)"[^>]*type="image/i,
  ];
  for (const re of patterns) {
    const m = block.match(re);
    if (m && /^https?:\/\//.test(m[1])) return m[1];
  }
  return null;
}

function parkSeverity(text: string): 'alert' | 'urgent' | 'critical' {
  const t = text.toLowerCase();
  if (CRITICAL_WORDS.some((w) => t.includes(w))) return 'critical';
  if (URGENT_WORDS.some((w) => t.includes(w))) return 'urgent';
  return 'alert';
}

function parkCategory(text: string): string {
  const t = text.toLowerCase();
  if (/closure|closed|road|trail|access|parking|entrance|fee|transport|shuttle|direction/.test(t)) return 'disaster';
  if (/wildfire|fire|flood|storm|weather|earthquake/.test(t)) return 'disaster';
  return 'environment';
}

interface ParkItem {
  id: string;
  title: string;
  url: string;
  source: string;
  image: string | null;
  publishedAt: number;
  severity: 'alert' | 'urgent' | 'critical';
  category: string;
  countryName: string;
  lat: number;
  lon: number;
}

async function fetchParkFeed(feed: ParkFeed): Promise<ParkItem[]> {
  const r = await fetch(feed.url, {
    signal: AbortSignal.timeout(8_000),
    headers: { 'User-Agent': UA },
  });
  if (!r.ok) throw new Error(`${feed.source} HTTP ${r.status}`);
  const xml = await r.text();
  const blocks = xml.match(/<item[\s\S]*?<\/item>/gi) ?? [];
  const items: ParkItem[] = [];
  for (const block of blocks) {
    const title = xmlTag(block, 'title');
    const link = (xmlTag(block, 'link') || '').trim();
    if (!title || !link) continue;
    const desc = xmlTag(block, 'description') || '';
    const pub = xmlTag(block, 'pubDate');
    const when = pub ? Date.parse(pub) : NaN;
    items.push({
      id: Buffer.from(link).toString('base64').slice(0, 20),
      title,
      url: link,
      source: feed.source,
      image: extractImage(block),
      publishedAt: Number.isNaN(when) ? Date.now() : when,
      severity: parkSeverity(`${title} ${desc}`),
      category: parkCategory(`${title} ${desc}`),
      countryName: feed.park,
      lat: feed.lat,
      lon: feed.lon,
    });
  }
  return items;
}

const CACHE_KEY = 'park-news:v1';
const SUCCESS_TTL = 10 * 60_000;
let lastGood: { items: ParkItem[]; updated: number } | null = null;

router.get('/', async (_req, res) => {
  const cached = cache.get<{ items: ParkItem[]; updated: number }>(CACHE_KEY);
  if (cached) { res.json(cached); return; }

  try {
    const results = await Promise.allSettled(PARK_FEEDS.map(fetchParkFeed));
    const all: ParkItem[] = [];
    const seen = new Set<string>();
    for (const r of results) {
      if (r.status !== 'fulfilled') { console.error('[park-news] feed failed:', r.reason); continue; }
      for (const item of r.value) {
        if (seen.has(item.url)) continue;
        seen.add(item.url);
        all.push(item);
      }
    }
    all.sort((a, b) => b.publishedAt - a.publishedAt);
    const result = { items: all.slice(0, 200), updated: Date.now() };
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
