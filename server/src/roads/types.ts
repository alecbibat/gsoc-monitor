// One road closure or restriction, whatever feed it came from — the shape the
// road-closures layer draws. Mirrored in client/src/types/index.ts.

export type RoadImpact = 'closed' | 'restricted';

export interface RoadClosure {
  /** Unique across sources: `${source}:${source's own id}`. */
  id: string;
  /** Feed key, e.g. 'nps', 'az511'. */
  source: string;
  /** Who reported it, for the panel: "Grand Teton (NPS)", "Arizona DOT (AZ511)". */
  sourceLabel: string;
  /** The followed park whose area it falls in. */
  parkCode: string;
  /** Short headline, e.g. "Winter Road Closure" or "US-89 closed". */
  title: string;
  roadNames: string[];
  /** Plain text. */
  description: string;
  /** All lanes closed vs. reduced (lane closures, alternating one-way, restrictions). */
  impact: RoadImpact;
  /** The feed's own event kind: incident, work-zone, restriction, seasonal, … */
  eventType: string;
  direction: string | null;
  start: string | null;
  end: string | null;
  updated: string | null;
  /** Polylines of [lon, lat]. Empty when the feed gave only a point. */
  lines: number[][][];
  /** Where the marker goes: the feed's point, else the middle of the longest line. */
  point: [number, number] | null;
  url: string | null;
}

export interface RoadSourceStatus {
  source: string;
  label: string;
  ok: boolean;
  /** Closures it contributed (after the area filter). */
  count: number;
  error: string | null;
  fetchedAt: string | null;
  /** Why it is off (e.g. a key not configured), when it is. */
  disabled?: string;
}

export interface RoadClosuresFeed {
  closures: RoadClosure[];
  sources: RoadSourceStatus[];
  fetchedAt: string;
}
