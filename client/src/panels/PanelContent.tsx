import { EarthquakeDetails } from '../layers/earthquakes/EarthquakeDetails';
import { AlertDetails } from '../layers/alerts/AlertDetails';
import { FlightDetails } from '../layers/flights/FlightDetails';
import { HurricaneDetails } from '../layers/hurricanes/HurricaneDetails';
import { FireDetails } from '../layers/fires/FireDetails';
import { ShipDetails } from '../layers/ships/ShipDetails';
import { SatelliteDetails } from '../layers/satellites/SatelliteDetails';
import { LocationDetails } from '../layers/locations/LocationDetails';
import { WebcamDetails } from '../layers/webcams/WebcamDetails';
import { NewsMapDetails } from '../layers/newsMap/NewsMapDetails';
import { SmokeDetails } from '../layers/smoke/SmokeDetails';
import { AqiDetails } from '../layers/aqi/AqiDetails';
import { FuelZoneDetails } from '../fuelzone/FuelZoneDetails';
import { WindForecastDetails } from '../layers/wind/WindForecastDetails';
import { PropertyDetail } from '../widgets/proximity/PropertyDetail';
import { TimezonePanel } from '../layers/timezones/TimezonePanel';
import { WIDGET_BY_ID } from '../widgets/registry';
import type { PanelData } from './panelStore';

const ACCENT_BY_KIND: Record<string, string> = {
  earthquakes: 'border-accent-warn/40',
  alerts: 'border-accent-danger/40',
  flights: 'border-accent/40',
  radar: 'border-accent/40',
  hurricanes: 'border-accent-warn/40',
  fires: 'border-accent-warn/40',
  smoke: 'border-amber-500/40',
  aqi: 'border-green-500/40',
  'fuel-zone': 'border-orange-500/40',
  'wind-forecast': 'border-sky-500/40',
  ships: 'border-accent/40',
  satellites: 'border-sky-400/40',
  locations: 'border-violet-500/40',
  webcams: 'border-sky-400/40',
  newsMap: 'border-indigo-400/40',
  'property-watch': 'border-accent-ok/40',
};

// Border-accent class for a panel kind — widgets define their own; detail
// panels fall back to the kind map. Shared by the desktop floating panels and
// the mobile card deck.
export function panelAccent(kind: string): string {
  return WIDGET_BY_ID[kind]?.accentClass ?? ACCENT_BY_KIND[kind] ?? 'border-accent/40';
}

// The body of a panel — a widget, or a kind-specific detail view. Rendered
// inside either the desktop floating shell (Panel) or the mobile card deck.
export function PanelContent({ panel }: { panel: PanelData }) {
  const widget = WIDGET_BY_ID[panel.kind];
  return (
    <>
      {widget && widget.render()}
      {panel.kind === 'earthquakes' && <EarthquakeDetails payload={panel.payload as never} />}
      {panel.kind === 'alerts' && <AlertDetails payload={panel.payload as never} />}
      {panel.kind === 'flights' && <FlightDetails payload={panel.payload as never} />}
      {panel.kind === 'hurricanes' && <HurricaneDetails payload={panel.payload as never} />}
      {panel.kind === 'fires' && <FireDetails payload={panel.payload as never} />}
      {panel.kind === 'ships' && <ShipDetails payload={panel.payload as never} />}
      {panel.kind === 'satellites' && <SatelliteDetails payload={panel.payload as never} />}
      {panel.kind === 'locations' && <LocationDetails payload={panel.payload as never} />}
      {panel.kind === 'webcams' && <WebcamDetails payload={panel.payload as never} />}
      {panel.kind === 'newsMap' && <NewsMapDetails payload={panel.payload as never} />}
      {panel.kind === 'smoke' && <SmokeDetails payload={panel.payload as never} />}
      {panel.kind === 'aqi' && <AqiDetails payload={panel.payload as never} />}
      {panel.kind === 'fuel-zone' && <FuelZoneDetails payload={panel.payload as never} />}
      {panel.kind === 'wind-forecast' && <WindForecastDetails payload={panel.payload as never} />}
      {panel.kind === 'property-watch' && <PropertyDetail payload={panel.payload as never} />}
      {panel.kind === 'timezones' && <TimezonePanel payload={panel.payload} />}
    </>
  );
}
