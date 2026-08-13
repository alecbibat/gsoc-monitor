// What the forecast frames ARE, before anything decides how to draw them.
//
// The timeline already has a slot for frames after "now" — `nowcastFrames` in
// the store, appended by `buildTimeline` with `forecast: true`, hatched amber by
// `RadarTimeline`. That slot has been empty since RainViewer discontinued its
// own nowcast product (Stage 0). This fills it with frames we compute.
//
// The one thing that makes these different from every other frame in the
// system: there are no bytes for them anywhere. A RadarFrame's `path` is
// normally a CDN path that `radarTileUrl` turns into a tile request. A forecast
// frame's path is a marker, and anything that would fetch it must recognise it
// and not try.

import type { RadarFrame } from '../../../types';

// Lead times, in minutes past the newest observed frame.
//
// Capped well short of where advection stops meaning anything. Lagrangian
// persistence assumes storms neither grow, decay nor turn; that holds up for
// the first half hour and decays badly after an hour. The plan allows up to
// +60 — these three are what is shown by default, and the ceiling exists so
// nobody quietly raises it.
export const FORECAST_LEADS_MIN = [10, 20, 30] as const;
export const FORECAST_MAX_LEAD_MIN = 60;

// Frame paths cannot collide with a real one. RainViewer paths all begin with a
// slash; this cannot, and the marker is checked rather than parsed anywhere it
// matters.
const FORECAST_PREFIX = '#forecast+';

export function forecastFramePath(leadMinutes: number): string {
  return `${FORECAST_PREFIX}${leadMinutes}`;
}

export function isForecastPath(path: string): boolean {
  return path.startsWith(FORECAST_PREFIX);
}

// Minutes of lead carried by a forecast path, or null if it is a real frame.
export function forecastLeadMinutes(path: string): number | null {
  if (!isForecastPath(path)) return null;
  const lead = Number(path.slice(FORECAST_PREFIX.length));
  return Number.isFinite(lead) ? lead : null;
}

// Intensity multiplier for a lead time.
//
// This is a statement about CONFIDENCE, not about physics — persistence does
// not predict that rain weakens, and pysteps' own extrapolation applies no
// decay at all. It is here because a forecast rendered at exactly the strength
// of an observation claims to know as much as one, and the further out it
// reaches the less true that is. Gentle on purpose: 0.90 at +30 is a visible
// softening, not a different reading of the storm.
export function forecastDecay(leadMinutes: number): number {
  return Math.max(0.5, 1 - leadMinutes / 300);
}

// The forecast frames for a given "now".
//
// `nowTime` is the newest OBSERVED frame's time, so the forecast is anchored to
// real data rather than to the wall clock — if the feed stalls, the frames stay
// pinned to the last thing actually seen instead of drifting into a future
// built on nothing.
export function buildForecastFrames(nowTime: number): RadarFrame[] {
  return FORECAST_LEADS_MIN.map((lead) => ({
    time: nowTime + lead * 60,
    path: forecastFramePath(lead),
  }));
}
