export type LayerId =
  | 'radar'
  | 'earthquakes'
  | 'alerts'
  | 'flights'
  | 'hurricanes'
  | 'lightning'
  | 'fires'
  | 'smoke'
  | 'aqi'
  | 'fuel'
  | 'ships'
  | 'satellites'
  | 'locations'
  | 'osmBuildings'
  | 'earth3d'
  | 'traffic'
  | 'timezones'
  | 'webcams'
  | 'newsMap'
  | 'wind';

export type SatelliteGroup = 'stations' | 'visual' | 'gps' | 'weather' | 'starlink';

// Standalone dockable widgets that aren't tied to a clicked map entity.
export type WidgetId = 'news-feed' | 'proximity';

// Anything that can occupy a dockable panel. 'property-watch' is a popped-out
// single-property hazard window spawned from the Property Watch widget.
// 'fuel-zone' is the draw-a-circle LANDFIRE fuel breakdown result.
// 'wind-forecast' is the per-point forecast for a dropped wind probe.
export type PanelKind =
  | LayerId
  | WidgetId
  | 'property-watch'
  | 'fuel-zone'
  | 'wind-forecast';

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
  streaming?: boolean; // messages flowing in the last 60s
  messages?: number; // total AIS messages seen since boot
  matched?: number; // allowlisted ships correlated to a live MMSI
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

// Geocoded news points for the on-map News (GDELT) layer. Distinct from the
// NewsItem ticker feed above: each event is a place with one or more articles.
export interface NewsMapArticle {
  title: string;
  url: string;
}

export interface NewsMapEvent {
  id: string;
  name: string;
  lat: number;
  lon: number;
  count: number;
  image: string | null;
  tone: number | null; // avg GDELT tone; negative = more negative coverage
  articles: NewsMapArticle[];
}

export interface NewsMapResponse {
  events: NewsMapEvent[];
  updated: number;
  query: string;
  error?: string;
}

export interface SmokePolygon {
  id: string;
  density: 'Light' | 'Medium' | 'Heavy';
  coords: number[][]; // [lon, lat] pairs
  satellite?: string;
  startTime?: string;
  endTime?: string;
}

export interface SmokeResponse {
  polygons: SmokePolygon[];
  date: string;
  updated: number;
  source: string;
  error?: string;
}

export interface AqiStation {
  id: string;
  source: 'airnow' | 'purpleair';
  lat: number;
  lon: number;
  aqi: number;
  categoryNum: number;  // 1=Good … 6=Hazardous
  categoryName: string;
  parameter: string;    // dominant pollutant name
  reportingArea: string;
  state: string;
  hourObserved: number; // -1 for PurpleAir (use lastSeen)
  timezone: string;
  all: Array<{ parameter: string; aqi: number; category: string }>;
  // PurpleAir-only extras
  pm25?: number;        // EPA-corrected PM2.5 (µg/m³)
  pm25Raw?: number;     // raw cf_1 PM2.5 before correction
  humidity?: number;    // % RH used in the correction
  confidence?: number;  // PurpleAir 0–100 channel-agreement score
  lastSeen?: number;    // epoch seconds of the sensor's last report
}

export interface AqiResponse {
  stations: AqiStation[];
  updated: number;
  noKey?: boolean;            // AirNow key missing
  purpleAirNoKey?: boolean;   // PurpleAir key missing
  counts?: { airnow: number; purpleair: number };
  error?: string;
}

// Global wind field sampled on a regular lat/lon grid. Row-major (row = latitude
// south→north, col = longitude west→east); u/v are the eastward/northward wind
// components in m/s. Column `nx` wraps back to column 0 (the grid spans 360°).
export interface WindGrid {
  nx: number;
  ny: number;
  lon0: number;
  lat0: number;
  dLon: number;
  dLat: number;
  u: number[];
  v: number[];
  speedMax: number;
  updated: number;
}

// Per-point wind forecast for a dropped wind probe (NOAA GFS via Open-Meteo).
// Hourly arrays are parallel (time[i] ↔ speed/dir/gust[i]); speeds are m/s,
// direction is the meteorological "from" bearing in degrees. Times are local to
// the forecast point (see utcOffsetSeconds).
export interface WindForecast {
  latitude: number;
  longitude: number;
  timezone: string;
  timezoneAbbr: string;
  utcOffsetSeconds: number;
  hourly: { time: string[]; speed: number[]; dir: number[]; gust: number[] };
  daily: { time: string[]; speedMax: number[]; gustMax: number[]; dirDominant: number[] };
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

export interface Webcam {
  id: string;
  title: string;
  lat: number;
  lon: number;
  imageUrl: string | null; // proxied, auto-refreshing JPEG (the live view)
  source: string; // DOT name, e.g. "Arizona DOT"
  sourceUrl: string | null; // link to the state 511 site
  roadway: string | null;
  status: string; // 'active' | 'disabled' | 'unknown'
  lastUpdated: number | null;
  nearestPin: string;
  distanceMi: number;
}

export interface WebcamProviderStatus {
  code: string;
  name: string;
  configured: boolean;
  count: number;
  error: string | null;
}

export interface WebcamsResponse {
  webcams: Webcam[];
  updated: number;
  providers: WebcamProviderStatus[];
  stale?: boolean;
}

// Windowed lightning history from the server's rolling Blitzortung buffer.
// Coordinates are parallel arrays; `t` is epoch SECONDS.
export interface LightningHistoryResponse {
  lat: number[];
  lon: number[];
  t: number[];
  windowMin: number;
  totalInWindow: number; // count in the window before any thinning
  returned: number; // points actually returned (≤ totalInWindow)
  thinned: boolean; // true when the window was strided down to fit the cap
  coverageMin: number; // how far back the buffer actually reaches (≤ windowMin)
  connected: boolean; // collector's live connection state
  updated: number; // epoch seconds
}
