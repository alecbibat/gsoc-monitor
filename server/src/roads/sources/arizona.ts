import { fetchJson } from '../http';
import type { RoadSource } from '../service';
import { normalizeWzdxFeed, type WzdxFeed } from '../wzdx';

// ADOT's public WZDx feed (az511.gov, no key): Arizona's planned work zones,
// e.g. I-40 lane and full closures between Williams and Flagstaff, US-180 and
// SR-64 to the South Rim. Work zones only — crashes, weather and other
// incidents are in AZ511's keyed events API, not here. Large (a few MB for the
// whole state), so it is fetched every half hour; only what falls in the
// Grand Canyon's area is kept.
export const AZ_WZDX_URL = 'https://az511.gov/api/wzdx';

export const arizonaWzdxSource: RoadSource = {
  key: 'az-wzdx',
  label: 'Arizona DOT work zones',
  ttlMs: () => 30 * 60_000,
  fetch: async (now) =>
    normalizeWzdxFeed(await fetchJson<WzdxFeed>(AZ_WZDX_URL, 45_000), {
      source: 'az-wzdx',
      now,
      labelFor: () => 'Arizona DOT work zone (AZ511)',
      defaultLabel: 'AZ511',
    }),
};
