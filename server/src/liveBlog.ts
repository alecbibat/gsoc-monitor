import { cache } from './cache';

// HuffPost's rolling "Live Updates" blog, for the ticker's second row. The
// entry page carries a schema.org LiveBlogPosting in its JSON-LD with one
// BlogPosting per update (headline, permalink, time), so there is no markup to
// scrape. HuffPost opens a new entry every week or so and links it all over
// its homepage, which is how the current one is found.

export interface LiveBlogItem {
  id: string;
  title: string;
  url: string;
  publishedAt: number;
}

export interface LiveBlog {
  /** The live blog's own headline. */
  title: string;
  url: string;
  /** Newest first. */
  items: LiveBlogItem[];
  updated: number;
}

const HOME_URL = 'https://www.huffpost.com/';
/** Used when the homepage can't be read or links no live blog. */
const FALLBACK_URL = 'https://www.huffpost.com/entry/live-updates_n_6afac912e4b04eba4d44b5f2';
const MAX_ITEMS = 30;
const PAGE_TTL = 2 * 60_000;
const DISCOVERY_TTL = 30 * 60_000;

/** House-keeping posts the blog pins among its updates. */
const FILLER = /^read more from huffpost$/i;

interface LdUpdate {
  headline?: unknown;
  url?: unknown;
  datePublished?: unknown;
}

function ldBlocks(html: string): unknown[] {
  const out: unknown[] = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    try {
      const parsed: unknown = JSON.parse(m[1]);
      const graph = (parsed as { '@graph'?: unknown })?.['@graph'];
      if (Array.isArray(parsed)) out.push(...parsed);
      else if (Array.isArray(graph)) out.push(...graph);
      else out.push(parsed);
    } catch {
      // not JSON: skip the block
    }
  }
  return out;
}

/** The live blog in an entry page's JSON-LD, or null when the page has none. */
export function parseLiveBlog(html: string): Omit<LiveBlog, 'updated'> | null {
  const post = ldBlocks(html).find(
    (b): b is { headline?: unknown; url?: unknown; liveBlogUpdate?: unknown } =>
      !!b && typeof b === 'object' && (b as { '@type'?: unknown })['@type'] === 'LiveBlogPosting'
  );
  if (!post || !Array.isArray(post.liveBlogUpdate)) return null;

  const items: LiveBlogItem[] = [];
  const seen = new Set<string>();
  for (const u of post.liveBlogUpdate as LdUpdate[]) {
    if (!u || typeof u.headline !== 'string' || typeof u.url !== 'string') continue;
    const title = u.headline.replace(/\s+/g, ' ').trim();
    if (!title || FILLER.test(title) || !/^https:\/\//.test(u.url) || seen.has(u.url)) continue;
    seen.add(u.url);
    const when = typeof u.datePublished === 'string' ? Date.parse(u.datePublished) : NaN;
    items.push({
      id: u.url.match(/liveblog_([0-9a-f]+)/i)?.[1] ?? u.url,
      title,
      url: u.url,
      publishedAt: Number.isNaN(when) ? 0 : when,
    });
  }
  items.sort((a, b) => b.publishedAt - a.publishedAt);
  return {
    title: typeof post.headline === 'string' ? post.headline.replace(/:\s*Live Updates$/i, '').trim() : '',
    url: typeof post.url === 'string' ? post.url : '',
    items: items.slice(0, MAX_ITEMS),
  };
}

/** The live-updates entry the homepage links most, or null when it links none. */
export function findLiveBlogUrl(homeHtml: string): string | null {
  const counts = new Map<string, number>();
  const re = /https:\/\/www\.huffpost\.com\/entry\/live-updates_n_[0-9a-f]+/g;
  for (const m of homeHtml.match(re) ?? []) counts.set(m, (counts.get(m) ?? 0) + 1);
  let best: string | null = null;
  for (const [url, n] of counts) if (!best || n > (counts.get(best) ?? 0)) best = url;
  return best;
}

async function fetchHtml(url: string): Promise<string> {
  const r = await fetch(url, {
    signal: AbortSignal.timeout(12_000),
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; gsoc-monitor/1.0)', Accept: 'text/html' },
  });
  if (!r.ok) throw new Error(`HuffPost HTTP ${r.status}`);
  return r.text();
}

/** HUFFPOST_LIVE_URL pins an entry; otherwise the homepage's current one. */
async function currentUrl(): Promise<string> {
  const pinned = process.env.HUFFPOST_LIVE_URL?.trim();
  if (pinned) return pinned;
  try {
    return await cache.getOrFetch<string>(
      'liveblog:url',
      DISCOVERY_TTL,
      async () => findLiveBlogUrl(await fetchHtml(HOME_URL)) ?? FALLBACK_URL,
      { staleOnError: true }
    );
  } catch (err) {
    console.error('[liveblog] homepage lookup failed:', err);
    return FALLBACK_URL;
  }
}

export async function getLiveBlog(): Promise<LiveBlog> {
  const url = await currentUrl();
  return cache.getOrFetch<LiveBlog>(
    `liveblog:page:${url}`,
    PAGE_TTL,
    async () => {
      const parsed = parseLiveBlog(await fetchHtml(url));
      if (!parsed) throw new Error('no live blog on the page');
      return { ...parsed, url: parsed.url || url, updated: Date.now() };
    },
    { staleOnError: true }
  );
}
