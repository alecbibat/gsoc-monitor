// Multi-state power outages, served by our /api/outages aggregator. The server
// merges three families of public sources — state-EM ArcGIS feeds (Cal OES CA,
// SRP + SSVEC AZ, Minnesota Power MN/WI, Riverside PU CA), the KUBRA Storm
// Center maps behind many large utilities (Oncor TX, Georgia Power + Cobb EMC
// GA, JEA FL, Colorado Springs Utilities CO, LG&E/KU KY, Evergy KS/MO, Versant
// ME, Appalachian Power VA/WV/TN), and NISC co-op outage maps (Sawnee GA,
// SLEMCO LA, Price Electric WI, Cloverland MI) — into one normalized shape.
// Several of those feeds are non-CORS or multi-step, which is why the browser
// can't fetch them itself.

import { api } from '../../api/client';
import type { OutagePoint, OutageSourceStatus } from '../../types';

export type Outage = OutagePoint;

export interface OutagesResult {
  outages: Outage[];
  sources: OutageSourceStatus[];
  error: string | null;
}

// Marker/accent color by outage type: unplanned (a real, unexpected outage) is
// the one to notice → red; planned/scheduled → amber; unknown → grey.
export function outageColor(type: string | null): string {
  if (type === 'Unplanned') return '#ff3b30';
  if (type === 'Planned') return '#eab308';
  return '#9ca3af';
}

export async function fetchOutages(): Promise<OutagesResult> {
  try {
    const r = await api.outages();
    return { outages: r.outages ?? [], sources: r.sources ?? [], error: r.error ?? null };
  } catch (err) {
    return { outages: [], sources: [], error: err instanceof Error ? err.message : 'unreachable' };
  }
}
