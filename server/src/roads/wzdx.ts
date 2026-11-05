import { createHash } from 'crypto';
import { parkAreaFor, midpointOf } from './area';
import { compactLines, linesBbox, linesFromGeometry } from './geometry';
import type { RoadClosure, RoadImpact } from './types';

// ── Work Zone Data Exchange (WZDx) road events → RoadClosure ─────────────────
// WZDx is USDOT's open standard for road events, used by the NPS Data API's
// /roadevents and by state DOT feeds. v4 nests the common fields under
// core_details; v3 kept them on properties — both are read. Only closures and
// restrictions in force now, inside a followed park's area, are kept, and a
// closure WZDx reports once per direction is merged into one.

interface WzdxCore {
  event_type?: string;
  data_source_id?: string;
  road_names?: string[];
  road_name?: string;
  direction?: string;
  name?: string;
  description?: string;
  update_date?: string;
}

export interface WzdxFeature {
  id?: string | number;
  type?: string;
  geometry?: { type?: string; coordinates?: unknown } | null;
  properties?: WzdxCore & {
    core_details?: WzdxCore;
    Id?: string;
    road_event_id?: string;
    start_date?: string;
    end_date?: string;
    vehicle_impact?: string;
    event_status?: string;
    types_of_incident?: Array<{ description?: string; incident_type?: string; incident_category?: string }>;
    url?: string;
  };
}

export interface WzdxFeed {
  road_event_feed_info?: {
    data_sources?: Array<{ data_source_id?: string; organization_name?: string }>;
    update_date?: string;
  };
  feed_info?: WzdxFeed['road_event_feed_info'];
  features?: WzdxFeature[];
}

/** vehicle_impact → how bad; null for "all lanes open" and "unknown" (not a closure we can vouch for). */
export function wzdxImpact(vehicleImpact: string | null | undefined): RoadImpact | null {
  const v = (vehicleImpact ?? '').trim().toLowerCase();
  if (v === 'all-lanes-closed') return 'closed';
  if (!v || v === 'all-lanes-open' || v === 'unknown') return null;
  // some-lanes-closed(-merge-left/right/split), alternating-one-way, …
  return 'restricted';
}

const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

function isoOrNull(s: string | null | undefined): string | null {
  const t = s ? Date.parse(s) : NaN;
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

export interface WzdxSourceOpts {
  /** Feed key for ids, e.g. 'nps'. */
  source: string;
  /** Label for an event from a given data source (e.g. "Grand Teton (NPS)"). */
  labelFor: (dataSourceId: string | null) => string;
  now: number;
}

/** One WZDx feature → closure, or null if it isn't one in force inside a park area. */
export function normalizeWzdxFeature(f: WzdxFeature, opts: WzdxSourceOpts): RoadClosure | null {
  const p = f.properties ?? {};
  const core: WzdxCore = { ...p, ...(p.core_details ?? {}) };
  const impact = wzdxImpact(p.vehicle_impact);
  if (!impact) return null;
  const eventType = clean(core.event_type) || 'incident';
  if (eventType === 'detour') return null;
  if ((p.event_status ?? '').toLowerCase() === 'completed' || (p.event_status ?? '').toLowerCase() === 'cancelled') {
    return null;
  }

  const start = isoOrNull(p.start_date);
  const end = isoOrNull(p.end_date);
  if (start && Date.parse(start) > opts.now) return null; // planned, not yet in force
  if (end && Date.parse(end) <= opts.now) return null;

  const { lines: rawLines, point: rawPoint } = linesFromGeometry(f.geometry);
  const lines = compactLines(rawLines);
  const point = rawPoint ?? midpointOf(lines);
  if (lines.length === 0 && !point) return null;
  const parkCode = parkAreaFor(lines, point);
  if (!parkCode) return null;

  const roadNames = (core.road_names ?? (core.road_name ? [core.road_name] : [])).map(clean).filter(Boolean);
  const incidentText = (p.types_of_incident ?? []).map((t) => clean(t.description)).find(Boolean) ?? '';
  const description = clean(core.description) || incidentText;
  const title = clean(core.name) || (roadNames.length ? `${roadNames.join(' / ')} ${impact === 'closed' ? 'closed' : 'restricted'}` : 'Road closure');
  const ownId = clean(String(p.Id ?? p.road_event_id ?? f.id ?? '')) ||
    createHash('sha1').update(JSON.stringify([title, start, end, lines[0]?.[0] ?? point])).digest('hex').slice(0, 16);
  const dataSourceId = clean(core.data_source_id) || null;

  return {
    id: `${opts.source}:${ownId}`,
    source: opts.source,
    sourceLabel: opts.labelFor(dataSourceId),
    parkCode,
    title,
    roadNames,
    description,
    impact,
    eventType,
    direction: clean(core.direction) || null,
    start,
    end,
    updated: isoOrNull(core.update_date),
    lines,
    point,
    url: typeof p.url === 'string' && /^https?:\/\//.test(p.url) ? p.url : null,
  };
}

const near = (a: number[] | null, b: number[] | null) =>
  !!a && !!b && a.every((v, i) => Math.abs(v - b[i]) < 2e-4);

/**
 * Merge the per-direction copies WZDx publishes of one closure (same title,
 * text, roads and times): directions combine, and a copy whose lines cover the
 * same stretch (the reverse direction) adds none.
 */
export function mergeDirections(closures: readonly RoadClosure[]): RoadClosure[] {
  const groups = new Map<string, RoadClosure>();
  for (const c of closures) {
    const key = [c.source, c.title, c.description, c.roadNames.join('|'), c.start, c.end, c.impact].join('\u0001');
    const prev = groups.get(key);
    if (!prev) {
      groups.set(key, { ...c, lines: [...c.lines] });
      continue;
    }
    const dirs = new Set([...(prev.direction ?? '').split(', ').filter(Boolean), ...(c.direction ? [c.direction] : [])]);
    prev.direction = dirs.size ? [...dirs].join(', ') : null;
    for (const line of c.lines) {
      const bb = linesBbox([line]);
      const dup = prev.lines.some((l) => {
        const pb = linesBbox([l]);
        return near(pb, bb);
      });
      if (!dup) prev.lines.push(line);
    }
    if (!prev.point) prev.point = c.point;
  }
  return [...groups.values()];
}

/** A whole WZDx feed → merged closures in the park areas. */
export function normalizeWzdxFeed(feed: WzdxFeed, opts: Omit<WzdxSourceOpts, 'labelFor'> & { labelFor?: WzdxSourceOpts['labelFor']; defaultLabel: string }): RoadClosure[] {
  const info = feed.road_event_feed_info ?? feed.feed_info;
  const orgs = new Map((info?.data_sources ?? []).map((d) => [d.data_source_id ?? '', clean(d.organization_name)]));
  const labelFor = opts.labelFor ?? ((id: string | null) => {
    const org = id ? orgs.get(id) : '';
    return org ? `${org} (${opts.defaultLabel})` : opts.defaultLabel;
  });
  const out: RoadClosure[] = [];
  for (const f of feed.features ?? []) {
    const c = normalizeWzdxFeature(f, { source: opts.source, labelFor, now: opts.now });
    if (c) out.push(c);
  }
  return mergeDirections(out);
}
