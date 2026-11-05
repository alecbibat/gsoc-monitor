import { cache } from '../cache';
import { npsGet, npsTtl } from './api';
import { NPS_PARK_BY_CODE, NPS_PARK_CODES, type NpsPark } from './parks';
import { absUrl, parseNpsDate, plainText } from './text';

// ── NPS news releases ────────────────────────────────────────────────────────
// /newsreleases: each park's press releases (road openings and closures,
// incidents, rescues, fire updates, seasonal changes, events). The newest
// across the followed parks feed the ticker and the National Parks panel.

export interface NpsNewsItem {
  id: string;
  parkCode: string;
  park: string;
  parkFullName: string;
  title: string;
  abstract: string;
  url: string;
  image: { url: string; alt: string; credit: string } | null;
  /** The calendar day of release, YYYY-MM-DD. */
  releasedDay: string | null;
  /** Epoch ms (a bare date reads as 12:00 UTC that day). */
  releasedAt: number;
}

export interface NpsNewsFeed {
  news: NpsNewsItem[];
  fetchedAt: string;
}

export interface RawNpsNewsRelease {
  id?: string;
  url?: string;
  title?: string;
  abstract?: string;
  parkCode?: string;
  relatedParks?: Array<{ parkCode?: string }>;
  releaseDate?: string;
  image?: { url?: string; altText?: string; credit?: string; title?: string } | null;
}

/** The followed park a release is about: its own parkCode, else the first related park we follow. */
export function releasePark(raw: RawNpsNewsRelease): NpsPark | undefined {
  const own = NPS_PARK_BY_CODE.get((raw.parkCode ?? '').trim().toLowerCase());
  if (own) return own;
  for (const rp of raw.relatedParks ?? []) {
    const hit = NPS_PARK_BY_CODE.get((rp?.parkCode ?? '').trim().toLowerCase());
    if (hit) return hit;
  }
  return undefined;
}

export function normalizeNewsRelease(raw: RawNpsNewsRelease, now = Date.now()): NpsNewsItem | null {
  const park = releasePark(raw);
  const title = plainText(raw.title);
  if (!park || !title) return null;
  const url = absUrl(raw.url) ?? `https://www.nps.gov/${park.code}/learn/news/newsreleases.htm`;
  const released = parseNpsDate(raw.releaseDate);
  const imageUrl = absUrl(raw.image?.url);
  return {
    id: (raw.id ?? '').trim() || url,
    parkCode: park.code,
    park: park.name,
    parkFullName: park.fullName,
    title,
    abstract: plainText(raw.abstract),
    url,
    image: imageUrl
      ? { url: imageUrl, alt: plainText(raw.image?.altText ?? raw.image?.title), credit: plainText(raw.image?.credit) }
      : null,
    releasedDay: released?.day ?? null,
    releasedAt: released?.ms ?? now,
  };
}

/** A /newsreleases response → followed parks' releases, deduplicated, newest first. */
export function normalizeNewsReleases(rows: readonly RawNpsNewsRelease[], now = Date.now()): NpsNewsItem[] {
  const seen = new Set<string>();
  const out: NpsNewsItem[] = [];
  for (const raw of rows) {
    const n = normalizeNewsRelease(raw, now);
    if (!n || seen.has(n.id)) continue;
    seen.add(n.id);
    out.push(n);
  }
  return out.sort((a, b) => b.releasedAt - a.releasedAt);
}

// The newest 50 across the six parks reach back a month or two; the ticker
// shows the last few weeks of them.
const NEWS_LIMIT = 50;
const NEWS_TTL_MS = 20 * 60_000;

async function fetchNews(): Promise<NpsNewsFeed> {
  const res = await npsGet<{ data?: RawNpsNewsRelease[] }>('/newsreleases', {
    parkCode: NPS_PARK_CODES,
    limit: NEWS_LIMIT,
    sort: '-releaseDate',
  });
  return { news: normalizeNewsReleases(res.data ?? []), fetchedAt: new Date().toISOString() };
}

export function getNpsNews(): Promise<NpsNewsFeed> {
  return cache.getOrFetch('nps:news:v1', npsTtl(NEWS_TTL_MS), fetchNews, { staleOnError: true });
}
