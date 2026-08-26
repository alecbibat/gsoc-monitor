// ── Wildfire feed manifest ───────────────────────────────────────────────────
// The canonical, ordered list of everything the wildfire assembly acquires,
// shared by the assembly (which reports each feed's outcome as it lands) and
// the loading screen (which renders the acquisition console from it). Order
// here is display order. `maps` is the post-fetch snapshot-render stage — it
// only resolves after every data feed has, so it naturally reads as the
// finishing step.

export type FeedResult = 'ok' | 'failed' | 'skipped';

export interface WildfireFeedDef {
  id: string;
  label: string;
  source: string;
}

export const WILDFIRE_FEEDS = [
  { id: 'hotspots', label: 'Thermal hotspots · 24 h', source: 'FIRMS VIIRS' },
  { id: 'named-fires', label: 'Named incidents', source: 'NIFC WFIGS' },
  { id: 'alerts', label: 'Fire weather alerts', source: 'NWS' },
  { id: 'counties', label: 'County geometry', source: 'NWS' },
  { id: 'outlook', label: '7-day fire potential', source: 'NWCG PSA' },
  { id: 'fuel', label: 'Surface fuels · 3 mi', source: 'LANDFIRE' },
  { id: 'wind', label: 'Wind forecast · 48 h', source: 'OPEN-METEO' },
  { id: 'daily', label: '10-day forecast', source: 'OPEN-METEO' },
  { id: 'smoke', label: 'Smoke plumes', source: 'NOAA HMS' },
  { id: 'lightning', label: 'Lightning · 24 h', source: 'BLITZORTUNG' },
  { id: 'qpf', label: 'Forecast rainfall', source: 'NOAA WPC' },
  { id: 'maps', label: 'Exposure map render', source: 'Esri · OSM' },
] as const satisfies readonly WildfireFeedDef[];

export type WildfireFeedId = (typeof WILDFIRE_FEEDS)[number]['id'];

export type FeedProgress = Partial<Record<WildfireFeedId, FeedResult>>;

export type OnFeedResult = (id: WildfireFeedId, result: FeedResult) => void;
