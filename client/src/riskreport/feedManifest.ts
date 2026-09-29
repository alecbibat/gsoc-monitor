// ── Risk-report feed manifests ───────────────────────────────────────────────
// The canonical, ordered list of everything each hazard's assembly acquires,
// shared by the assembly (which reports each feed's outcome as it lands) and
// the loading screen (which renders the acquisition console from it). Order
// here is display order. `maps` is the post-fetch snapshot-render stage — it
// only resolves after every data feed has, so it naturally reads as the
// finishing step.

export type FeedResult = 'ok' | 'failed' | 'skipped';

export interface FeedDef {
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
] as const satisfies readonly FeedDef[];

export type WildfireFeedId = (typeof WILDFIRE_FEEDS)[number]['id'];

// `gauge-detail` waits on `gauges` (it needs the nearby list to pick which
// forecast points to open), so it settles after it on every run.
export const FLOOD_FEEDS = [
  { id: 'alerts', label: 'Flood & surge alerts', source: 'NWS' },
  { id: 'counties', label: 'County geometry', source: 'NWS' },
  { id: 'gauges', label: 'River gauges · 100 mi', source: 'NOAA NWPS' },
  { id: 'gauge-detail', label: 'Gauge forecasts & impacts', source: 'NOAA NWPS' },
  { id: 'ero', label: 'Excessive rainfall outlook', source: 'NOAA WPC' },
  { id: 'qpf', label: 'Forecast rainfall', source: 'NOAA WPC' },
  { id: 'fema', label: 'Flood zone · NFHL', source: 'FEMA' },
  { id: 'precip', label: 'Recent & hourly rain', source: 'OPEN-METEO' },
  { id: 'discharge', label: 'River discharge · 30 d', source: 'GLOFAS' },
  { id: 'burn-scars', label: 'Burn scars', source: 'NIFC WFIGS' },
  { id: 'daily', label: '10-day forecast', source: 'OPEN-METEO' },
  { id: 'maps', label: 'Exposure map render', source: 'Esri · OSM' },
] as const satisfies readonly FeedDef[];

export type FloodFeedId = (typeof FLOOD_FEEDS)[number]['id'];

export type RiskFeedId = WildfireFeedId | FloodFeedId;

export type FeedProgress = Partial<Record<RiskFeedId, FeedResult>>;

export type OnFeedResult<Id extends RiskFeedId = WildfireFeedId> = (id: Id, result: FeedResult) => void;
