export type LayerId =
  | 'radar'
  | 'earthquakes'
  | 'alerts'
  | 'flights'
  | 'hurricanes'
  | 'lightning'
  | 'fires'
  | 'ships';

// Standalone dockable widgets that aren't tied to a clicked map entity.
export type WidgetId = 'pentagon-pizza';

// Anything that can occupy a dockable panel.
export type PanelKind = LayerId | WidgetId;

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

export interface ShipState {
  mmsi: string;
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
}

export interface ShipsResponse {
  source: 'aisstream' | 'no-key' | 'error';
  ships: ShipState[];
  updated: number;
  connected?: boolean;
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
