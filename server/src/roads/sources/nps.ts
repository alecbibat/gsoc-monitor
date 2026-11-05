import { npsGet, npsTtl } from '../../nps/api';
import { NPS_PARK_CODES } from '../../nps/parks';
import type { RoadSource } from '../service';
import { normalizeWzdxFeed, type WzdxFeed } from '../wzdx';

// NPS Data API /roadevents: the WZDx feed of the parks that publish to it.
// None of the six followed parks do yet; Grand Teton, whose roads lead into
// Yellowstone's South Entrance, does. Asked for those seven only (the whole
// feed is over a megabyte), so a followed park that starts publishing appears
// with no change here.
const ROAD_EVENT_PARKS = `${NPS_PARK_CODES},grte`;
export const npsRoadSource: RoadSource = {
  key: 'nps',
  label: 'NPS road events',
  ttlMs: () => npsTtl(15 * 60_000),
  fetch: async (now) => {
    const feed = await npsGet<WzdxFeed>('/roadevents', { parkCode: ROAD_EVENT_PARKS });
    return normalizeWzdxFeed(feed, { source: 'nps', now, defaultLabel: 'NPS' });
  },
};
