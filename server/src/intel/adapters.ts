import crypto from 'crypto';
import type { IntelCategory, IntelItem, IntelSource, SourceKind } from './types';

// Every adapter fetches one source and returns normalized IntelItems. Items may
// arrive without coordinates (news/social); the service geocodes those later
// from the `place` field. All fetches are wrapped by Promise.allSettled in the
// service, so an adapter is free to throw on a dead source.

const UA = 'Mozilla/5.0 (compatible; gsoc-monitor-intel/1.0)';
const TIMEOUT_MS = 9_000;

async function fetchText(url: string, headers: Record<string, string> = {}): Promise<string> {
  const r = await fetch(url, {
    headers: { 'User-Agent': UA, ...headers },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.text();
}
async function fetchJson<T>(url: string, headers: Record<string, string> = {}): Promise<T> {
  return JSON.parse(await fetchText(url, headers)) as T;
}

function stableId(prefix: string, s: string): string {
  return `${prefix}-${crypto.createHash('sha1').update(s).digest('hex').slice(0, 16)}`;
}

// --- XML/RSS helpers (tolerant, regex-based — same approach as routes/news.ts) --
function decodeXml(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
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
// Atom <link href="..."/> or RSS <link>...</link>
function linkOf(block: string): string {
  const href = block.match(/<link[^>]*\bhref="([^"]+)"/i);
  if (href) return href[1];
  const t = tag(block, 'link');
  return t ? t.trim() : '';
}

// --- severity/category classification ---------------------------------------
const URGENT = /shooting|shots fired|active shooter|explosion|fatal|structure fire|evacuat|hazmat|mass casualty|officer down|pursuit|amber alert|hostage|swat/i;
const WATCH = /crash|collision|fire|assault|robbery|burglary|arrest|injur|flood|rescue|missing|threat|suspicious|road closed/i;
function severityOf(text: string): IntelItem['severity'] {
  if (URGENT.test(text)) return 'urgent';
  if (WATCH.test(text)) return 'watch';
  return 'info';
}
function newsCategory(text: string): IntelCategory {
  const t = text.toLowerCase();
  if (/wildfire|brush fire|structure fire|blaze/.test(t)) return 'fire';
  if (/crash|collision|pileup|derail|rollover/.test(t)) return 'crash';
  if (/shoot|robbery|burglary|homicide|assault|stabbing|arrest|theft/.test(t)) return 'crime';
  if (/storm|tornado|flood|hurricane|blizzard|heat|evacuat/.test(t)) return 'weather';
  return 'news';
}

// --- adapter 1: generic RSS/Atom (news sites, Mastodon .rss, Reddit .rss) -----
function parseRss(xml: string, src: IntelSource): IntelItem[] {
  const category = src.config?.category;
  const blocks = xml.match(/<item[\s\S]*?<\/item>|<entry[\s\S]*?<\/entry>/gi) ?? [];
  const out: IntelItem[] = [];
  for (const block of blocks.slice(0, 40)) {
    const title = tag(block, 'title');
    const url = linkOf(block).trim();
    if (!title || !url) continue;
    const desc = tag(block, 'description') || tag(block, 'summary') || tag(block, 'content') || null;
    const pub = tag(block, 'pubDate') || tag(block, 'published') || tag(block, 'updated');
    const when = pub ? Date.parse(pub) : NaN;
    const author = tag(block, 'dc:creator') || tag(block, 'author') || null;
    const blob = `${title} ${desc ?? ''}`;
    out.push({
      id: stableId('rss', url),
      kind: src.kind,
      source: src.label,
      category: category ?? newsCategory(blob),
      title,
      text: desc,
      author,
      url,
      publishedAt: Number.isNaN(when) ? Date.now() : when,
      lat: null,
      lon: null,
      place: null, // geocoded later from title if the source has no staticGeo
      severity: severityOf(blob),
    });
  }
  return out;
}

async function adaptRss(src: IntelSource): Promise<IntelItem[]> {
  if (!src.url) return [];
  return parseRss(await fetchText(src.url), src);
}

async function adaptGoogleNews(src: IntelSource): Promise<IntelItem[]> {
  const q = src.config?.query;
  if (!q) return [];
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`;
  const items = parseRss(await fetchText(url), { ...src, kind: 'google-news' });
  return items.map((i) => ({ ...i, category: src.config?.category ?? i.category }));
}

// --- adapter 2: Bluesky (author feed + keyword search) ----------------------
interface BskyPost {
  post?: {
    uri?: string;
    author?: { handle?: string; displayName?: string };
    record?: { text?: string; createdAt?: string };
    indexedAt?: string;
  };
}
interface BskySearchPost {
  uri?: string;
  author?: { handle?: string };
  record?: { text?: string; createdAt?: string };
  indexedAt?: string;
}
function bskyWebUrl(handle: string, uri: string): string {
  const rkey = uri.split('/').pop() ?? '';
  return `https://bsky.app/profile/${handle}/post/${rkey}`;
}
function bskyItem(src: IntelSource, text: string, at: string | undefined, handle: string, uri: string): IntelItem {
  const when = at ? Date.parse(at) : NaN;
  return {
    id: stableId('bsky', uri),
    kind: src.kind,
    source: src.label,
    category: src.config?.category ?? 'social',
    title: text.length > 140 ? `${text.slice(0, 137)}…` : text,
    text,
    author: `@${handle}`,
    url: bskyWebUrl(handle, uri),
    publishedAt: Number.isNaN(when) ? Date.now() : when,
    lat: null,
    lon: null,
    place: null,
    severity: severityOf(text),
  };
}
async function adaptBlueskyAuthor(src: IntelSource): Promise<IntelItem[]> {
  const handle = src.config?.handle?.replace(/^@/, '');
  if (!handle) return [];
  const data = await fetchJson<{ feed?: BskyPost[] }>(
    `https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=${encodeURIComponent(handle)}&limit=20`
  );
  const out: IntelItem[] = [];
  for (const f of data.feed ?? []) {
    const p = f.post;
    const text = p?.record?.text;
    if (!p?.uri || !text) continue;
    out.push(bskyItem(src, text, p.record?.createdAt ?? p.indexedAt, p.author?.handle ?? handle, p.uri));
  }
  return out;
}
async function adaptBlueskySearch(src: IntelSource): Promise<IntelItem[]> {
  const q = src.config?.query;
  if (!q) return [];
  // NB: search requires the api.bsky.app host (public.api.bsky.app 403s on search).
  const data = await fetchJson<{ posts?: BskySearchPost[] }>(
    `https://api.bsky.app/xrpc/app.bsky.feed.searchPosts?q=${encodeURIComponent(q)}&limit=25`
  );
  const out: IntelItem[] = [];
  for (const p of data.posts ?? []) {
    const text = p.record?.text;
    if (!p.uri || !text || !p.author?.handle) continue;
    out.push(bskyItem(src, text, p.record?.createdAt ?? p.indexedAt, p.author.handle, p.uri));
  }
  return out;
}

// --- adapter 3: PulsePoint fire/EMS CAD (AES-decrypted) ---------------------
// The webapp endpoint returns {ct, iv, s}; decrypt with the app's static
// passphrase via OpenSSL EVP_BytesToKey (MD5) + AES-256-CBC. Verified live.
const PP_PASSPHRASE = 'tombrady5rings';
function evpBytesToKey(passphrase: string, salt: Buffer, keyLen: number): Buffer {
  let derived = Buffer.alloc(0);
  let block = Buffer.alloc(0);
  while (derived.length < keyLen) {
    const h = crypto.createHash('md5');
    h.update(Buffer.concat([block, Buffer.from(passphrase, 'utf8'), salt]));
    block = h.digest();
    derived = Buffer.concat([derived, block]);
  }
  return derived.subarray(0, keyLen);
}
function pulsePointDecrypt(body: { ct: string; iv: string; s: string }): unknown {
  const key = evpBytesToKey(PP_PASSPHRASE, Buffer.from(body.s, 'hex'), 32);
  const dec = crypto.createDecipheriv('aes-256-cbc', key, Buffer.from(body.iv, 'hex'));
  let out = dec.update(Buffer.from(body.ct, 'base64'), undefined, 'utf8');
  out += dec.final('utf8');
  let s = out.trim();
  if (s.startsWith('"') && s.endsWith('"')) s = JSON.parse(s);
  return JSON.parse(s);
}
const PP_CALL_TYPES: Record<string, string> = {
  ME: 'Medical', TC: 'Traffic Collision', TCE: 'Traffic Collision (extrication)', VF: 'Vehicle Fire',
  SF: 'Structure Fire', RF: 'Residential Fire', CF: 'Commercial Fire', WF: 'Wildland Fire', OF: 'Outside Fire',
  GF: 'Grass Fire', HMR: 'Hazmat', HZ: 'Hazmat', EX: 'Explosion', WSR: 'Water Rescue', CMA: 'Carbon Monoxide',
  AA: 'Auto Aid', MA: 'Mutual Aid', FA: 'Fire Alarm', GAS: 'Gas Leak', ELF: 'Electrical Fire', TRWR: 'Rescue',
  TRLF: 'Rescue', LR: 'Rescue', PF: 'Fire', WCF: 'Fire', SC: 'Fire', RES: 'Rescue',
};
interface PPIncident {
  ID?: string;
  PulsePointIncidentCallType?: string;
  CallReceivedDateTime?: string;
  Latitude?: string;
  Longitude?: string;
  FullDisplayAddress?: string;
}
async function adaptPulsePoint(src: IntelSource): Promise<IntelItem[]> {
  const agencyId = src.config?.agencyId;
  if (!agencyId) return [];
  const body = await fetchJson<{ ct: string; iv: string; s: string }>(
    `https://api.pulsepoint.org/v1/webapp?resource=incidents&agencyid=${encodeURIComponent(agencyId)}`,
    { Referer: 'https://web.pulsepoint.org/' }
  );
  const data = pulsePointDecrypt(body) as { incidents?: { active?: PPIncident[]; recent?: PPIncident[] } };
  const list = [...(data.incidents?.active ?? []), ...(data.incidents?.recent ?? [])];
  const out: IntelItem[] = [];
  for (const inc of list.slice(0, 60)) {
    if (!inc.ID) continue;
    const label = PP_CALL_TYPES[inc.PulsePointIncidentCallType ?? ''] ?? inc.PulsePointIncidentCallType ?? 'Incident';
    const addr = inc.FullDisplayAddress ?? '';
    const lat = inc.Latitude ? parseFloat(inc.Latitude) : NaN;
    const lon = inc.Longitude ? parseFloat(inc.Longitude) : NaN;
    // Medical calls report 0,0 for privacy — keep them (with a geocodable address).
    const hasGeo = Number.isFinite(lat) && Number.isFinite(lon) && (lat !== 0 || lon !== 0);
    const when = inc.CallReceivedDateTime ? Date.parse(inc.CallReceivedDateTime) : NaN;
    out.push({
      id: stableId('pp', `${agencyId}:${inc.ID}`),
      kind: 'pulsepoint',
      source: src.label,
      category: src.config?.category ?? 'scanner',
      title: addr ? `${label} · ${addr}` : label,
      text: null,
      author: null,
      url: 'https://web.pulsepoint.org/',
      publishedAt: Number.isNaN(when) ? Date.now() : when,
      lat: hasGeo ? lat : null,
      lon: hasGeo ? lon : null,
      place: hasGeo ? null : addr || null,
      severity: severityOf(label),
    });
  }
  return out;
}

// --- adapter 4: California CHP dispatch (statewide XML) ----------------------
async function adaptChp(src: IntelSource): Promise<IntelItem[]> {
  const xml = await fetchText('https://media.chp.ca.gov/sa_xml/sa.xml');
  const blocks = xml.match(/<Log\b[\s\S]*?<\/Log>/gi) ?? [];
  const out: IntelItem[] = [];
  const strip = (s: string | null): string => (s ?? '').replace(/^"|"$/g, '').trim();
  for (const block of blocks.slice(0, 80)) {
    const id = (block.match(/<Log\s+ID\s*=\s*["']([^"']+)["']/i) || [])[1];
    if (!id) continue;
    const type = strip(tag(block, 'LogType'));
    const road = strip(tag(block, 'Location')); // the street/route
    const desc = strip(tag(block, 'LocationDesc')); // a direction/detail ("EB", "SR4 offramp")
    const loc = [road, desc].filter(Boolean).join(' ').trim();
    // LogTime is like `Jul  2 2026  6:02AM` (double spaces, no space before AM);
    // normalize so Date.parse accepts it. It carries a year but no zone — CA is
    // Pacific, so anchor to PDT (a winter PST reading lands ≤1h early, never future).
    const timeStr = strip(tag(block, 'LogTime'))
      .replace(/\s+/g, ' ')
      .replace(/(\d)(AM|PM)/i, '$1 $2');
    const latlon = strip(tag(block, 'LATLON')); // "lat:lon" in microdegrees
    let lat: number | null = null;
    let lon: number | null = null;
    const m = latlon.match(/^(\d+):(\d+)$/);
    if (m) {
      const la = parseInt(m[1], 10) / 1e6;
      const lo = -parseInt(m[2], 10) / 1e6; // western US → negative longitude
      if (la !== 0 && lo !== 0) {
        lat = la;
        lon = lo;
      }
    }
    const when = timeStr ? Date.parse(`${timeStr} PDT`) : NaN;
    out.push({
      id: stableId('chp', id),
      kind: 'chp',
      source: src.label,
      category: src.config?.category ?? (/collision|crash|traffic/i.test(type) ? 'crash' : 'scanner'),
      title: loc ? `${type} · ${loc}` : type || 'CHP incident',
      text: null,
      author: null,
      url: 'https://cad.chp.ca.gov/',
      publishedAt: Number.isNaN(when) || when > Date.now() + 3_600_000 ? Date.now() : when,
      lat,
      lon,
      place: lat == null && loc ? `${loc}, California` : null,
      severity: severityOf(type),
    });
  }
  return out;
}

// --- adapter 5: Socrata city crime open data --------------------------------
async function adaptSocrata(src: IntelSource): Promise<IntelItem[]> {
  const c = src.config ?? {};
  if (!c.domain || !c.dataset) return [];
  const dateField = c.dateField ?? 'date';
  const latField = c.latField ?? 'latitude';
  const lonField = c.lonField ?? 'longitude';
  const url =
    `https://${c.domain}/resource/${c.dataset}.json` +
    `?$order=${encodeURIComponent(dateField)}%20DESC&$limit=50`;
  const rows = await fetchJson<Array<Record<string, unknown>>>(url);
  const out: IntelItem[] = [];
  const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
  const num = (v: unknown): number | null => {
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? n : null;
  };
  for (const row of rows) {
    const type =
      (c.typeField && str(row[c.typeField])) ??
      str(row.primary_type) ??
      str(row.incident_category) ??
      str(row.crm_cd_desc) ??
      'Incident';
    const desc = (c.descField && str(row[c.descField])) ?? str(row.description) ?? null;
    const when = str(row[dateField]);
    const t = when ? Date.parse(when) : NaN;
    const lat = num(row[latField]);
    const lon = num(row[lonField]);
    const idBase = str(row.case_number) ?? str(row.id) ?? `${when}:${lat}:${lon}:${type}`;
    out.push({
      id: stableId('socrata', `${c.dataset}:${idBase}`),
      kind: 'socrata',
      source: src.label,
      category: src.config?.category ?? 'crime',
      title: desc ? `${type} · ${desc}` : type,
      text: str(row.block) ?? str(row.location_description) ?? null,
      author: null,
      url: `https://${c.domain}`,
      publishedAt: Number.isNaN(t) ? Date.now() : t,
      lat,
      lon,
      place: null,
      severity: severityOf(`${type} ${desc ?? ''}`),
    });
  }
  return out;
}

const ADAPTERS: Record<SourceKind, (src: IntelSource) => Promise<IntelItem[]>> = {
  rss: adaptRss,
  'google-news': adaptGoogleNews,
  'bluesky-author': adaptBlueskyAuthor,
  'bluesky-search': adaptBlueskySearch,
  pulsepoint: adaptPulsePoint,
  chp: adaptChp,
  socrata: adaptSocrata,
};

export async function runAdapter(src: IntelSource): Promise<IntelItem[]> {
  const fn = ADAPTERS[src.kind];
  if (!fn) return [];
  return fn(src);
}
