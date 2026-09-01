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
  | 'timezones'
  | 'newsMap'
  | 'wind'
  | 'windArrows'
  | 'rivers'
  | 'fireOutlook'
  | 'precip'
  | 'wildfires'
  | 'outages'
  | 'intel';

export type SatelliteGroup = 'stations' | 'visual' | 'gps' | 'weather' | 'starlink';

// Standalone dockable widgets that aren't tied to a clicked map entity.
export type WidgetId = 'news-feed' | 'proximity' | 'intel-feed';

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

export type BasemapId = 'dark' | 'light' | 'satellite' | 'topo' | 'earth';

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

// One breadcrumb of an aircraft's trail; `ground` marks taxi/parked fixes so
// the trail can clamp them to the surface, `altFt` colours the airborne ones.
export interface FlightTrackPoint {
  lat: number;
  lon: number;
  altFt: number | null;
  ground: boolean;
  t: number;
}

// Which tracked roster an aircraft belongs to.
export type FlightGroupId = 'company' | 'hurricane-hunters' | 'fire-tankers';

// A takeoff or landing the tracker witnessed. Coordinates are raw; the client
// resolves them to a nearby city for display.
export interface FlightEvent {
  id: string;
  reg: string;
  group: FlightGroupId;
  kind: 'takeoff' | 'landing';
  lat: number;
  lon: number;
  t: number;
}

// Static airframe identity looked up from registry/photo services, served
// alongside the live state once the server has resolved it.
export interface AircraftPhoto {
  src: string;
  link: string;
  photographer: string;
}

export interface AircraftInfo {
  manufacturer: string | null;
  model: string | null;
  icaoType: string | null;
  owner: string | null;
  photo: AircraftPhoto | null;
  fetchedAt: number;
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
  group?: FlightGroupId;
  trail?: FlightTrackPoint[];
  aircraftInfo?: AircraftInfo | null;
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

// Merged manifest from /api/radar: the global (RainViewer) frame list plus a
// server-computed schedule of US NEXRAD HD frames (IEM's 5-minute composite;
// the frame times ARE the tile URLs, so no upstream manifest exists for it).
export interface RadarManifest {
  global: { host: string; frames: RadarFrame[] } | null;
  us: { frames: number[]; intervalSec: number };
  generated: number;
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
  etaUtc?: number | null; // parsed AIS/provider ETA, epoch ms UTC
  etaText?: string | null; // provider's raw ETA string when unparseable
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
  stale?: boolean; // grid is historical (server snapshot/fallback), not live
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
  source?: string; // attribution, e.g. "NOAA GFS · Open-Meteo" or the met.no backup
  fallback?: boolean; // served by the backup provider (approximate local times)
}

// 10-day daily forecast (Open-Meteo via /api/wind/daily) in display-ready
// units: °F, mph, inches. Arrays are parallel with daily.time.
export interface DailyForecast {
  latitude: number;
  longitude: number;
  timezone: string;
  daily: {
    time: string[];
    weatherCode: number[];
    tMaxF: number[];
    tMinF: number[];
    precipIn: number[];
    precipProbPct: number[];
    windMaxMph: number[];
    gustMaxMph: number[];
  };
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
  /** Ranking group from the POI classifier — 0 is an exact category match, and
   *  anything above it is a documented fallback the panel labels honestly.
   *  Optional: responses cached before this shipped won't carry it. */
  tier?: number;
  /** What the place actually is ('Hospital · emergency dept', 'Urgent care',
   *  'Motel'), shown in place of the generic category name. */
  serviceLabel?: string;
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

// --- 7-Day Significant Fire Potential (NWCG Predictive Services) ------------
export interface FireOutlookDayCode {
  dryness: number | null; // fuel dryness 1 (normal) → 3 (very dry); 0/null = none
  type: string | null; // 'CRITICAL' | 'IGNITION' significant-fire-potential flag
}
export interface FireOutlookPsa {
  code: string; // Predictive Service Area id
  gacc: string; // Geographic Area Coordination Center
  rings: number[][][]; // outer ring(s), [lon,lat] pairs
  days: (FireOutlookDayCode | null)[]; // length 7
}
export interface FireOutlookResponse {
  updated: number;
  dates: (string | null)[]; // 7 ISO dates
  psas: FireOutlookPsa[];
}

// --- JTWC invests (tropical disturbances in the non-NHC basins) -------------
export type InvestPotential = 'Low' | 'Medium' | 'High' | 'Unknown';
export interface JtwcInvest {
  id: string; // e.g. "96W"
  basin: string;
  lat: number;
  lon: number;
  potential: InvestPotential;
}
export interface JtwcInvestsResponse {
  invests: JtwcInvest[];
  updated: number;
  error?: string;
}

// --- Power outages (multi-state server-side aggregation) ---------------------
export interface OutagePoint {
  id: string;
  utility: string;
  state: string | null;
  lat: number;
  lon: number;
  start: number | null; // epoch ms
  estimatedRestore: number | null; // epoch ms
  cause: string | null;
  customers: number | null;
  county: string | null;
  status: string | null;
  type: 'Planned' | 'Unplanned' | null;
  aggregated: number | null; // >1 when the point is a cluster of N outages
}
export interface OutageSourceStatus {
  name: string;
  state: string;
  ok: boolean;
  count: number;
}
export interface OutagesResponse {
  outages: OutagePoint[];
  sources: OutageSourceStatus[];
  updated: number;
  error?: string;
}

// --- AI duty-officer briefing -------------------------------------------------
export interface BriefingResponse {
  headline: string;
  narrative: string;
  source: 'ai' | 'rules';
  model?: string;
  updated: number;
}

// --- Rivers & floods (NOAA NWPS) -------------------------------------------
// Normalized flood tiers (most → least severe) plus the non-flood states kept.
export type FloodCat = 'major' | 'moderate' | 'minor' | 'action' | 'normal' | 'low' | 'none';

// One river gauge in the bulk national list (one map point each).
export interface RiverGauge {
  lid: string;
  name: string;
  lat: number;
  lon: number;
  state: string;
  cat: FloodCat; // observed flood tier
  fcat: FloodCat | null; // forecast tier (null = no current forecast)
  stage: number | null; // primary reading
  unit: string; // 'ft' for stage gauges, 'kcfs' for flow gauges
  flow: number | null; // secondary reading when primary is stage
  flowUnit: string;
  isFlow: boolean; // true when primary reading is flow, not stage
}

export interface RiversResponse {
  gauges: RiverGauge[];
  counts: Record<FloodCat, number>;
  updated: number;
  warming?: boolean; // server snapshot not ready yet — retry shortly
}

export interface RiverThreshold {
  cat: 'action' | 'minor' | 'moderate' | 'major';
  stage: number | null;
  flow: number | null;
}
export interface RiverSeriesPoint {
  t: number; // epoch seconds
  v: number; // primary value
}
export interface RiverCrest {
  time: string;
  stage: number;
}

export interface RiverDetail {
  lid: string;
  name: string;
  state: string;
  county: string;
  usgsId: string | null;
  primaryName: string; // 'Stage' | 'Flow'
  unit: string;
  flowUnit: string;
  isFlow: boolean;
  observed: { value: number | null; flow: number | null; cat: FloodCat | null; time: string | null };
  forecastCrest: { value: number | null; cat: FloodCat | null; time: string | null };
  trend: 'rising' | 'falling' | 'steady' | null;
  thresholds: RiverThreshold[];
  observedSeries: RiverSeriesPoint[];
  forecastSeries: RiverSeriesPoint[];
  impacts: Array<{ stage: number; statement: string }>;
  recentCrest: RiverCrest | null;
  recordCrest: RiverCrest | null;
  forecastReliability: string | null;
  inServiceMsg: string | null;
  updated: number;
}

// --- OSINT intel engine (Dataminr-style ingestion) --------------------------
// One normalized item from any source — scanner/dispatch, crime, crashes, news
// or social — plus the team-shared watchlist rows that produce them.
export type SourceKind =
  | 'rss'
  | 'google-news'
  | 'bluesky-author'
  | 'bluesky-search'
  | 'pulsepoint'
  | 'chp'
  | 'socrata';

export type IntelCategory =
  | 'scanner'
  | 'crime'
  | 'crash'
  | 'fire'
  | 'weather'
  | 'news'
  | 'social'
  | 'other';

export interface IntelItem {
  id: string;
  kind: SourceKind;
  source: string;
  category: IntelCategory;
  title: string;
  text: string | null;
  author: string | null;
  url: string;
  publishedAt: number;
  lat: number | null;
  lon: number | null;
  place: string | null;
  severity: 'info' | 'watch' | 'urgent';
}

export interface IntelResponse {
  items: IntelItem[];
  updated: number;
  sourceCount: number;
  errors: string[];
}

// A watchlist source row as returned by /api/watchlist.
export interface WatchlistSource {
  id: string;
  kind: SourceKind;
  url: string | null;
  label: string;
  config: {
    query?: string;
    handle?: string;
    agencyId?: string;
    domain?: string;
    dataset?: string;
    dateField?: string;
    category?: IntelCategory;
    [k: string]: unknown;
  };
  active: boolean;
  addedBy: string | null;
  createdAt: string;
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
