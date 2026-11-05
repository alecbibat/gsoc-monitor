import { cache } from '../cache';
import type { RoadClosure, RoadClosuresFeed, RoadSourceStatus } from './types';

// ── Road closures around the followed parks ──────────────────────────────────
// Several feeds, each fetched on its own clock and cached on its own, so one
// slow or failing source never blanks the others: a source that fails serves
// its last good answer (and says so in `sources`), or contributes nothing if
// it has never answered. The combined list is what /api/roads/closures serves.

export interface RoadSource {
  key: string;
  /** Shown in the layer's status line and legend. */
  label: string;
  ttlMs: () => number;
  /** A reason the source is switched off (e.g. its API key isn't set), or null. */
  disabled?: () => string | null;
  fetch: (now: number) => Promise<RoadClosure[]>;
}

interface SourceResult {
  closures: RoadClosure[];
  fetchedAt: string;
}

const IMPACT_RANK = { closed: 1, restricted: 0 } as const;

export function sortClosures(list: RoadClosure[]): RoadClosure[] {
  return list.sort(
    (a, b) =>
      IMPACT_RANK[b.impact] - IMPACT_RANK[a.impact] ||
      a.parkCode.localeCompare(b.parkCode) ||
      a.title.localeCompare(b.title)
  );
}

/** Every enabled source's closures, merged; per-source health alongside. */
export async function collectRoadClosures(sources: readonly RoadSource[], now = Date.now()): Promise<RoadClosuresFeed> {
  const statuses: RoadSourceStatus[] = [];
  const all = new Map<string, RoadClosure>();
  const enabled = sources.filter((s) => {
    const why = s.disabled?.() ?? null;
    if (why) statuses.push({ source: s.key, label: s.label, ok: false, count: 0, error: null, fetchedAt: null, disabled: why });
    return !why;
  });
  const settled = await Promise.allSettled(
    enabled.map((s) =>
      cache.getOrFetch<SourceResult>(
        `roads:${s.key}`,
        s.ttlMs(),
        async () => ({ closures: await s.fetch(now), fetchedAt: new Date().toISOString() }),
        { staleOnError: true }
      )
    )
  );
  settled.forEach((r, i) => {
    const s = enabled[i];
    if (r.status === 'rejected') {
      const error = r.reason instanceof Error ? r.reason.message : String(r.reason);
      console.warn(`[roads] ${s.key} failed:`, error);
      statuses.push({ source: s.key, label: s.label, ok: false, count: 0, error, fetchedAt: null });
      return;
    }
    // A cached answer can outlive a closure's end time.
    const live = r.value.closures.filter((c) => !c.end || Date.parse(c.end) > now);
    for (const c of live) if (!all.has(c.id)) all.set(c.id, c);
    statuses.push({ source: s.key, label: s.label, ok: true, count: live.length, error: null, fetchedAt: r.value.fetchedAt });
  });
  return { closures: sortClosures([...all.values()]), sources: statuses, fetchedAt: new Date(now).toISOString() };
}
