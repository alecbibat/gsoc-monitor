import { cache } from '../cache';
import { npsGet, npsTtl } from './api';
import { NPS_PARK_BY_CODE, NPS_PARK_CODES } from './parks';
import { absUrl, parseNpsDate, plainText } from './text';

// ── NPS park alerts ──────────────────────────────────────────────────────────
// /alerts: what each park posts in the "Alerts in effect" banner on its
// nps.gov pages — dangers, closures (roads, trails, areas), cautions and
// general information. An alert stays listed until the park takes it down, so
// the list is "what's in effect now"; some run for months.

export type NpsAlertCategory = 'danger' | 'closure' | 'caution' | 'info';

export interface NpsAlertRoadEvent {
  id: string;
  title: string;
  url: string | null;
}

export interface NpsAlert {
  id: string;
  parkCode: string;
  park: string;
  parkFullName: string;
  category: NpsAlertCategory;
  /** NPS's own label: "Danger", "Park Closure", "Caution", "Information". */
  categoryLabel: string;
  title: string;
  /** Plain text; paragraphs separated by blank lines. */
  description: string;
  /** NPS's "more information" link; null when it gave none. */
  url: string | null;
  /** The park's current-conditions page, always present. */
  conditionsUrl: string;
  /** The calendar day NPS last indexed (posted or edited) it, YYYY-MM-DD. */
  postedDay: string | null;
  postedAt: number | null;
  roadEvents: NpsAlertRoadEvent[];
}

export interface NpsAlertsFeed {
  alerts: NpsAlert[];
  fetchedAt: string;
}

/** Raw /alerts record, as far as we read it. */
export interface RawNpsAlert {
  id?: string;
  url?: string;
  title?: string;
  description?: string;
  parkCode?: string;
  category?: string;
  lastIndexedDate?: string;
  relatedRoadEvents?: Array<{ id?: string; title?: string; url?: string; type?: string }>;
}

export function alertCategory(raw: string | null | undefined): NpsAlertCategory {
  switch ((raw ?? '').trim().toLowerCase()) {
    case 'danger':
      return 'danger';
    case 'park closure':
    case 'closure':
      return 'closure';
    case 'caution':
      return 'caution';
    default:
      return 'info';
  }
}

const CATEGORY_RANK: Record<NpsAlertCategory, number> = { danger: 3, closure: 2, caution: 1, info: 0 };

/** Most serious first, then most recently posted. */
export function compareAlerts(a: NpsAlert, b: NpsAlert): number {
  return CATEGORY_RANK[b.category] - CATEGORY_RANK[a.category] || (b.postedAt ?? 0) - (a.postedAt ?? 0);
}

/** One /alerts record → NpsAlert, or null when it isn't for a followed park or has no id. */
export function normalizeNpsAlert(raw: RawNpsAlert): NpsAlert | null {
  const parkCode = (raw.parkCode ?? '').trim().toLowerCase();
  const park = NPS_PARK_BY_CODE.get(parkCode);
  const id = (raw.id ?? '').trim();
  if (!park || !id) return null;
  const posted = parseNpsDate(raw.lastIndexedDate);
  const title = plainText(raw.title) || 'Park alert';
  return {
    id,
    parkCode,
    park: park.name,
    parkFullName: park.fullName,
    category: alertCategory(raw.category),
    categoryLabel: (raw.category ?? '').trim() || 'Information',
    title,
    description: plainText(raw.description),
    url: absUrl(raw.url),
    conditionsUrl: `https://www.nps.gov/${parkCode}/planyourvisit/conditions.htm`,
    postedDay: posted?.day ?? null,
    postedAt: posted?.ms ?? null,
    roadEvents: (raw.relatedRoadEvents ?? [])
      .filter((e) => e && (e.id || e.title))
      .map((e) => ({ id: (e.id ?? '').trim(), title: plainText(e.title) || title, url: absUrl(e.url) })),
  };
}

/** A whole /alerts response → followed parks' alerts, deduplicated, most serious first. */
export function normalizeNpsAlerts(rows: readonly RawNpsAlert[]): NpsAlert[] {
  const seen = new Set<string>();
  const out: NpsAlert[] = [];
  for (const raw of rows) {
    const a = normalizeNpsAlert(raw);
    if (!a || seen.has(a.id)) continue;
    seen.add(a.id);
    out.push(a);
  }
  return out.sort(compareAlerts);
}

const PAGE = 100;
// A followed park rarely has more than a dozen alerts in effect.
const MAX_PAGES = 3;

async function fetchAlerts(): Promise<NpsAlertsFeed> {
  const rows: RawNpsAlert[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await npsGet<{ total?: string; data?: RawNpsAlert[] }>('/alerts', {
      parkCode: NPS_PARK_CODES,
      limit: PAGE,
      start: page * PAGE,
    });
    const data = res.data ?? [];
    rows.push(...data);
    const total = Number(res.total);
    if (data.length < PAGE || !Number.isFinite(total) || rows.length >= total) break;
  }
  return { alerts: normalizeNpsAlerts(rows), fetchedAt: new Date().toISOString() };
}

// Alerts drive popups, so they refresh often; the 1,000/hour key quota is
// nowhere near this. Failures serve the last good list (never an empty one:
// the notifier would read an empty list followed by the real one as a burst
// of new alerts).
const ALERTS_TTL_MS = 5 * 60_000;

export function getNpsAlerts(): Promise<NpsAlertsFeed> {
  return cache.getOrFetch('nps:alerts:v1', npsTtl(ALERTS_TTL_MS), fetchAlerts, { staleOnError: true });
}
