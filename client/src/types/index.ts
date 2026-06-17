export type LayerId =
  | 'radar'
  | 'earthquakes'
  | 'alerts'
  | 'flights'
  | 'hurricanes'
  | 'lightning'
  | 'fires'
  | 'ships'
  | 'satellites'
  | 'locations'
  | 'osmBuildings'
  | 'earth3d'
  | 'traffic'
  | 'timezones'
  | 'webcams';

export type SatelliteGroup = 'stations' | 'visual' | 'gps' | 'weather' | 'starlink';

// Standalone dockable widgets that aren't tied to a clicked map entity.
export type WidgetId = 'pentagon-pizza' | 'news-feed' | 'fear-greed' | 'defcon' | 'proximity';

// Anything that can occupy a dockable panel. 'property-watch' is a popped-out
// single-property hazard window spawned from the Property Watch widget.
export type PanelKind = LayerId | WidgetId | 'property-watch';

export type BasemapId = 'dark' | 'light' | 'satellite' | 'topo';

export interface SelectionRef {
  kind: LayerId;
  id: string;
}

export interface EarthquakeProps {
  mag: number;
  place: string;
  time: number;
  updated: number;
  url: string;
  detail: string;
  felt: number | null;
  tsunami: number;
  alert: string | null;
  status: string;
  type: string;
  title: string;
}

export interface EarthquakeFeature {
  id: string;
  type: 'Feature';
  properties: EarthquakeProps;
  geometry: { type: 'Point'; coordinates: [number, number, number] };
}

export interface NwsAlertProps {
  id: string;
  event: string;
  headline: string | null;
  description: string;
  instruction: string | null;
  severity: string;
  certainty: string;
  urgency: string;
  area: string;
  senderName: string;
  effective: string;
  expires: string;
  areaDesc: string;
}

export interface NwsAlertFeature {
  id: string;
  type: 'Feature';
  properties: NwsAlertProps;
  geometry: GeoJSON.Geometry | null;
}

export interface FlightState {
  icao24: string;
  callsign: string | null;
  registration: string | null;
  type: string | null;
  latitude: number | null;
  longitude: number | null;
  altitudeFt: number | null;
  onGround: boolean;
  groundSpeedKt: number | null;
  track: number | null;
  verticalRateFpm: number | null;
  squawk: string | null;
  lastSeenSec: number;
}

export interface SatelliteTle {
  name: string;
  satnum: string;
  intlDesig: string;
  line1: string;
  line2: string;
}

export interface SatellitesResponse {
  group: SatelliteGroup;
  satellites: SatelliteTle[];
  updated: number;
}

export interface RadarFrame {
  time: number;
  path: string;
}

export interface RadarManifest {
  host: string;
  radar: {
    past: RadarFrame[];
    nowcast: RadarFrame[];
  };
  satellite: {
    infrared: RadarFrame[];
  };
}

export interface ShipTrackPoint {
  lat: number;
  lon: number;
  t: number;
}

export interface ShipState {
  mmsi: string;
  imo: number | null;
  name: string | null;
  callsign: string | null;
  shipType: number | null;
  latitude: number;
  longitude: number;
  speedKt: number | null;
  heading: number | null;
  course: number | null;
  navStatus: number | null;
  destination: string | null;
  lastSeenSec: number;
  track?: ShipTrackPoint[];
}

export interface ShipsResponse {
  source: 'aisstream' | 'no-key' | 'error';
  ships: ShipState[];
  updated: number;
  connected?: boolean;
  total?: number; // size of the allowlist
}

export interface NewsItem {
  id: string;
  title: string;
  url: string;
  source: string;
  image: string | null;
  publishedAt: number;
  severity: 'alert' | 'urgent' | 'critical';
  category: 'conflict' | 'disaster' | 'weather' | 'politics' | 'economy' | 'health' | 'environment';
  countryName: string | null;
  lat: number | null;
  lon: number | null;
}

export interface NewsResponse {
  items: NewsItem[];
  updated: number;
}

export interface RouteStep {
  instruction: string;
  distanceM: number;
}

export interface DirectionsLeg {
  name: string;
  category: 'hospital' | 'hotel' | 'police' | 'fire_station';
  lat: number;
  lon: number;
  distanceM: number;
  durationS: number;
  geometry: Array<[number, number]>; // [lon, lat] pairs
  steps: RouteStep[];
  routed: boolean; // false = straight-line fallback (OSRM had no route)
}

export interface DirectionsResponse {
  origin: { lat: number; lon: number };
  hospitals: DirectionsLeg[];
  hotels: DirectionsLeg[];
  police: DirectionsLeg[];
  fireStations: DirectionsLeg[];
}

export interface DriveResult {
  distanceM: number;
  durationS: number;
  geometry: Array<[number, number]>; // [lon, lat] pairs
  steps: RouteStep[];
  routed: boolean;
}

export interface PizzaPlaceBusyness {
  name: string;
  area: string;
  live: number | null; // current busyness 0-100, null when unavailable
  forecast: number | null; // typical busyness for this hour 0-100
  delta: number | null; // live minus forecast (positive = busier than usual)
}

export interface PizzaBusyness {
  // 'besttime' = live data; otherwise the widget uses its modeled signal.
  source: 'besttime' | 'no-key' | 'error';
  places: PizzaPlaceBusyness[];
  updated: number;
}

export interface Webcam {
  id: string;
  title: string;
  lat: number;
  lon: number;
  status: string;
  lastUpdated: number | null; // epoch ms, or null if unknown
  previewUrl: string | null; // tokened still (short-lived) — fallback only
  playerEmbedUrl: string | null; // stable iframe live view
  detailUrl: string | null; // webcam page on Windy
  providerUrl: string | null; // owner's site, when known
  categories: string[];
  nearestPin: string;
  distanceMi: number;
}

export interface WebcamsResponse {
  source: 'windy' | 'no-key' | 'error';
  webcams: Webcam[];
  updated: number;
  stale?: boolean;
}
