import type { LayerId } from '../types';

// Live data layers an incident can prescribe for its public share-link map.
//
// Deliberately a curated subset of the app's LayerId set: everything offered
// here is served by public, keyless read paths that anonymous share viewers can
// hit safely. Excluded on purpose: internal tracking layers (flights, ships,
// satellites, locations — company-specific assets), the metered/keyed layers
// (earth3d, osmBuildings via Cesium ion terrain), and cosmetic layers
// (timezones).
export type ShareLiveLayerId = Extract<
  LayerId,
  | 'radar' | 'goes' | 'precip' | 'hurricanes' | 'lightning' | 'wind' | 'windArrows'
  | 'fires' | 'wildfires' | 'smoke' | 'aqi' | 'fireOutlook' | 'fuel'
  | 'alerts' | 'earthquakes' | 'rivers' | 'outages'
  | 'newsMap' | 'intel'
>;

export interface ShareLiveLayerDef {
  id: ShareLiveLayerId;
  label: string;
  hint: string; // short data-source note shown under the toggle in the editor
}

export interface ShareLiveLayerGroup {
  name: string;
  layers: ShareLiveLayerDef[];
}

export const SHARE_LIVE_LAYER_GROUPS: ShareLiveLayerGroup[] = [
  {
    name: 'Weather',
    layers: [
      { id: 'radar',      label: 'Precipitation Radar',    hint: 'RainViewer composite · animated' },
      { id: 'goes',       label: 'Live Satellite (GOES)',  hint: 'GeoColor · 10-min loop' },
      { id: 'precip',     label: 'Precip Forecast (WPC)',  hint: 'NOAA QPF accumulation' },
      { id: 'hurricanes', label: 'Hurricanes',             hint: 'NHC + JTWC tracks & cones' },
      { id: 'lightning',  label: 'Lightning',              hint: 'Blitzortung · live strikes' },
      { id: 'wind',       label: 'Wind Particles (GFS)',   hint: 'Animated · heavier on weak GPUs' },
      { id: 'windArrows', label: 'Wind Streamlines',       hint: 'Flow lines colored by speed' },
    ],
  },
  {
    name: 'Fire & Smoke',
    layers: [
      { id: 'fires',       label: 'Hotspots (NASA FIRMS)',  hint: 'VIIRS thermal · 24h' },
      { id: 'wildfires',   label: 'Named Fires (NIFC)',     hint: 'Incidents + perimeters' },
      { id: 'smoke',       label: 'Smoke (NOAA HMS)',       hint: 'Satellite smoke plumes' },
      { id: 'aqi',         label: 'Air Quality',            hint: 'AirNow + PurpleAir · CONUS' },
      { id: 'fireOutlook', label: '7-Day Fire Potential',   hint: 'NWCG outlook · CONUS' },
      { id: 'fuel',        label: 'Fuel Models (LANDFIRE)', hint: 'FBFM40 · CONUS' },
    ],
  },
  {
    name: 'Hazards & Alerts',
    layers: [
      { id: 'alerts',      label: 'NWS Alerts',           hint: 'Active watches & warnings' },
      { id: 'earthquakes', label: 'Earthquakes (USGS)',   hint: 'M2.5+ · past day' },
      { id: 'rivers',      label: 'Rivers & Floods',      hint: 'NOAA gauge network · live' },
      { id: 'outages',     label: 'Power Outages',        hint: 'Multi-state utility feeds' },
    ],
  },
  {
    name: 'Open-Source Intel',
    layers: [
      { id: 'newsMap', label: 'News (GDELT)', hint: 'Geocoded events · 6h' },
      { id: 'intel',   label: 'Intel Feed',   hint: 'Scanner · crime · social' },
    ],
  },
];

export const SHARE_LIVE_LAYERS: ShareLiveLayerDef[] =
  SHARE_LIVE_LAYER_GROUPS.flatMap((g) => g.layers);

const VALID_IDS = new Set<string>(SHARE_LIVE_LAYERS.map((l) => l.id));

// Guard for ids arriving from persisted incidents / share snapshots, which may
// predate this feature or carry ids removed in a later release.
export function isShareLiveLayerId(id: string): id is ShareLiveLayerId {
  return VALID_IDS.has(id);
}

export function shareLiveLayerLabel(id: ShareLiveLayerId): string {
  return SHARE_LIVE_LAYERS.find((l) => l.id === id)?.label ?? id;
}
