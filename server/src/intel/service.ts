import { pool } from '../db';
import { runAdapter } from './adapters';
import { cachedPlace, geocodePlace } from './geocode';
import type { IntelItem, IntelResponse, IntelSource, SourceKind } from './types';

// Background OSINT ingest engine. Every REFRESH_MS it fans out over the built-in
// sources plus the team's watchlist rows, normalizes everything into IntelItem,
// geocodes the items that arrive without coordinates (budget-capped so we stay
// within Nominatim's usage policy), and merges the result into a rolling
// in-memory buffer. Nothing is persisted to a table — only the *sources* live in
// Postgres (watchlist_sources); the items themselves are ephemeral, exactly like
// the lightning/ships streams.

const REFRESH_MS = 90_000;
const BUFFER_CAP = 800; // most-recent N items kept in memory
const GEOCODE_BUDGET = 16; // max NEW network geocodes per cycle (cache hits are free)
const ITEM_MAX_AGE_MS = 36 * 60 * 60_000; // drop items older than 36h from the buffer

// Built-in sources demonstrate every category working out of the box, seeded to
// the property footprint (western-US parks) where a regional query makes sense.
// Verified live: Google News RSS, CA CHP dispatch, PulsePoint CAD, Chicago
// Socrata crime, Bluesky search. The team extends this via the watchlist.
const BUILTIN_SOURCES: IntelSource[] = [
  // --- scanner / dispatch ---------------------------------------------------
  {
    id: 'builtin-chp',
    kind: 'chp',
    label: 'CHP Dispatch (California)',
    builtin: true,
    active: true,
  },
  {
    id: 'builtin-pulsepoint-sf',
    kind: 'pulsepoint',
    label: 'PulsePoint · San Francisco Fire/EMS',
    config: { agencyId: 'EMS1384', category: 'scanner' },
    builtin: true,
    active: true,
  },
  // --- crime ----------------------------------------------------------------
  {
    id: 'builtin-crime-chicago',
    kind: 'socrata',
    label: 'Chicago Crime (live)',
    config: {
      domain: 'data.cityofchicago.org',
      dataset: 'ijzp-q8t2',
      dateField: 'date',
      latField: 'latitude',
      lonField: 'longitude',
      typeField: 'primary_type',
      descField: 'description',
      category: 'crime',
    },
    builtin: true,
    active: true,
  },
  // --- news, seeded to the property regions ---------------------------------
  {
    id: 'builtin-news-parks',
    kind: 'google-news',
    label: 'National Park Alerts',
    config: {
      query: '("national park") (closure OR evacuation OR rescue OR wildfire OR flooding)',
      category: 'news',
    },
    builtin: true,
    active: true,
  },
  {
    id: 'builtin-news-glacier-yellowstone',
    kind: 'google-news',
    label: 'Montana Parks (Glacier · Yellowstone)',
    config: {
      query: '(Glacier OR Yellowstone) (fire OR evacuation OR closure OR flood OR bear OR rescue)',
      category: 'news',
      staticGeo: { lat: 45.6, lon: -110.7, place: 'Yellowstone region' },
    },
    builtin: true,
    active: true,
  },
  {
    id: 'builtin-news-grand-canyon',
    kind: 'google-news',
    label: 'Grand Canyon Region',
    config: {
      query: '"Grand Canyon" (fire OR rescue OR closure OR heat OR flood OR incident)',
      category: 'news',
      staticGeo: { lat: 36.06, lon: -112.14, place: 'Grand Canyon' },
    },
    builtin: true,
    active: true,
  },
  // --- social ---------------------------------------------------------------
  {
    id: 'builtin-social-wildfire',
    kind: 'bluesky-search',
    label: 'Bluesky · Wildfire Watch',
    config: { query: 'wildfire evacuation', category: 'fire' },
    builtin: true,
    active: true,
  },
];

interface Buffered extends IntelItem {
  firstSeen: number;
}

// id → item, insertion-ordered. A Map gives O(1) dedup while preserving the
// order we need for the "newest first" response.
const buffer = new Map<string, Buffered>();
let lastUpdated = 0;
let lastErrors: string[] = [];
let lastSourceCount = 0;
// Places we've already tried (and failed) to geocode, so a stubborn headline
// can't burn the per-cycle budget every 90s forever. Bounded: when it fills up
// we drop the oldest half (insertion-ordered Set) — a re-tried miss just costs
// one geocode, so forgetting is cheap and keeps memory flat on a long uptime.
const geocodeMisses = new Set<string>();
const MISS_CAP = 4000;
function noteMiss(key: string): void {
  geocodeMisses.add(key);
  if (geocodeMisses.size > MISS_CAP) {
    let drop = geocodeMisses.size - MISS_CAP / 2;
    for (const k of geocodeMisses) {
      if (drop-- <= 0) break;
      geocodeMisses.delete(k);
    }
  }
}

async function loadDbSources(): Promise<IntelSource[]> {
  try {
    const { rows } = await pool.query<{
      id: string;
      kind: string;
      url: string | null;
      label: string;
      config: Record<string, unknown> | null;
      active: boolean;
    }>(
      `SELECT id::text, kind, url, label, config, active
         FROM watchlist_sources
        WHERE active = TRUE
        ORDER BY created_at ASC`
    );
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind as SourceKind,
      label: r.label,
      url: r.url ?? undefined,
      config: (r.config ?? {}) as IntelSource['config'],
      active: r.active,
      builtin: false,
    }));
  } catch (err) {
    // DB unreachable (migration may still be retrying) — degrade to built-ins.
    console.warn('[intel] could not load watchlist sources:', err instanceof Error ? err.message : err);
    return [];
  }
}

// Resolve coordinates for an item that arrived without them. Precedence: a
// precise geocodable place (PulsePoint address, CHP location) first, then the
// source's static region pin as a fallback. Returns true if the caller spent a
// network geocode (so the cycle can honor its budget).
async function locate(item: IntelItem, src: IntelSource, budgetLeft: number): Promise<boolean> {
  if (item.lat != null && item.lon != null) return false;

  const staticGeo = src.config?.staticGeo;
  if (item.place) {
    const cached = cachedPlace(item.place);
    if (cached) {
      item.lat = cached.lat;
      item.lon = cached.lon;
      return false;
    }
    const key = item.place.toLowerCase().trim();
    if (budgetLeft > 0 && !geocodeMisses.has(key)) {
      const hit = await geocodePlace(item.place);
      if (hit === 'error') {
        // Transient lookup failure — do NOT blacklist; retry in a later cycle.
      } else if (hit) {
        item.lat = hit.lat;
        item.lon = hit.lon;
      } else {
        noteMiss(key); // genuine "no result" — don't re-spend budget on it
      }
      // Whether it resolved or not, we spent the network call.
      if (item.lat == null && staticGeo) {
        item.lat = staticGeo.lat;
        item.lon = staticGeo.lon;
      }
      return true;
    }
  }

  // No place, or budget exhausted / already a known miss — fall back to region.
  if (item.lat == null && staticGeo) {
    item.lat = staticGeo.lat;
    item.lon = staticGeo.lon;
    item.place = item.place ?? staticGeo.place;
  }
  return false;
}

async function cycle(): Promise<void> {
  const dbSources = await loadDbSources();
  const sources = [...BUILTIN_SOURCES, ...dbSources];
  lastSourceCount = sources.length;

  const settled = await Promise.allSettled(sources.map((s) => runAdapter(s)));
  const errors: string[] = [];
  const fresh: Array<{ item: IntelItem; src: IntelSource }> = [];
  settled.forEach((res, i) => {
    const src = sources[i];
    if (res.status === 'fulfilled') {
      for (const item of res.value) fresh.push({ item, src });
    } else {
      errors.push(src.label);
      console.warn(`[intel] source "${src.label}" failed:`, res.reason?.message ?? res.reason);
    }
  });

  // Geocode the items that need it, newest first, honoring the per-cycle budget
  // AND Nominatim's ~1 req/s absolute policy: network lookups are spaced out,
  // not burst back-to-back (cache hits pay no delay).
  fresh.sort((a, b) => b.item.publishedAt - a.item.publishedAt);
  let budget = GEOCODE_BUDGET;
  for (const { item, src } of fresh) {
    const spent = await locate(item, src, budget);
    if (spent) {
      budget -= 1;
      if (budget > 0) await new Promise((r) => setTimeout(r, 1_100));
    }
  }

  // Merge into the rolling buffer (dedup by id; keep first-seen timestamp).
  const now = Date.now();
  for (const { item } of fresh) {
    // Clamp bogus future timestamps (a bad pubDate like "2050") — otherwise the
    // item sorts first forever and, worse, is never age-pruned, so at BUFFER_CAP
    // it would evict genuinely-recent items instead.
    if (item.publishedAt > now + 300_000) item.publishedAt = now;
    const existing = buffer.get(item.id);
    if (existing) {
      // Refresh mutable fields (a later cycle may have geocoded it) but keep the
      // original discovery time so ordering is stable.
      existing.lat = item.lat;
      existing.lon = item.lon;
      existing.place = item.place;
      existing.severity = item.severity;
    } else {
      buffer.set(item.id, { ...item, firstSeen: now });
    }
  }

  prune(now);
  lastErrors = errors;
  lastUpdated = now;
}

function prune(now: number): void {
  // Drop stale items, then trim to the newest BUFFER_CAP by publish time.
  for (const [id, item] of buffer) {
    if (now - Math.max(item.publishedAt, item.firstSeen) > ITEM_MAX_AGE_MS) buffer.delete(id);
  }
  if (buffer.size <= BUFFER_CAP) return;
  const sorted = [...buffer.values()].sort((a, b) => sortKey(b) - sortKey(a));
  buffer.clear();
  for (const item of sorted.slice(0, BUFFER_CAP)) buffer.set(item.id, item);
}

// Order by the more recent of publish time and first-seen: real-time scanner
// items carry a true recent timestamp; a news item republished with an old
// pubDate still surfaces near when we first saw it.
function sortKey(item: Buffered): number {
  return Math.max(item.publishedAt, item.firstSeen);
}

export function getIntel(): IntelResponse {
  const items = [...buffer.values()]
    .sort((a, b) => sortKey(b) - sortKey(a))
    .map(({ firstSeen: _firstSeen, ...rest }) => rest);
  return {
    items,
    updated: lastUpdated,
    sourceCount: lastSourceCount,
    errors: lastErrors,
  };
}

let started = false;
let cycleRunning = false;
export function initIntelStream(): void {
  if (started) return;
  started = true;
  // Kick off immediately, then on an interval. Errors are swallowed so a bad
  // cycle never takes the process down (mirrors the other background streams).
  // A slow cycle (many sources timing out + spaced geocodes) can outlast
  // REFRESH_MS — skip the tick rather than run two cycles concurrently, which
  // would double-spend the geocode budget and race the shared buffer.
  const run = async () => {
    if (cycleRunning) return;
    cycleRunning = true;
    try {
      await cycle();
    } catch (err) {
      console.error('[intel] cycle error:', err);
    } finally {
      cycleRunning = false;
    }
  };
  void run();
  setInterval(run, REFRESH_MS).unref();
}
