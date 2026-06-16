import { usePanelStore } from './panelStore';
import { Panel } from './Panel';
import { EarthquakeDetails } from '../layers/earthquakes/EarthquakeDetails';
import { AlertDetails } from '../layers/alerts/AlertDetails';
import { FlightDetails } from '../layers/flights/FlightDetails';
import { HurricaneDetails } from '../layers/hurricanes/HurricaneDetails';
import { FireDetails } from '../layers/fires/FireDetails';
import { ShipDetails } from '../layers/ships/ShipDetails';
import { LocationDetails } from '../layers/locations/LocationDetails';
import { WIDGET_BY_ID } from '../widgets/registry';

const ACCENT_BY_KIND: Record<string, string> = {
  earthquakes: 'border-accent-warn/40',
  alerts: 'border-accent-danger/40',
  flights: 'border-accent/40',
  radar: 'border-accent/40',
  hurricanes: 'border-accent-warn/40',
  fires: 'border-accent-warn/40',
  ships: 'border-accent/40',
  locations: 'border-violet-500/40',
};

export function PanelManager() {
  const panels = usePanelStore((s) => s.panels);

  return (
    <>
      {panels.map((panel) => {
        const widget = WIDGET_BY_ID[panel.kind];
        const accentClass = widget?.accentClass ?? ACCENT_BY_KIND[panel.kind];
        return (
          <Panel key={panel.id} panel={panel} accentClass={accentClass}>
            {widget && widget.render()}
            {panel.kind === 'earthquakes' && (
              <EarthquakeDetails payload={panel.payload as never} />
            )}
            {panel.kind === 'alerts' && <AlertDetails payload={panel.payload as never} />}
            {panel.kind === 'flights' && <FlightDetails payload={panel.payload as never} />}
            {panel.kind === 'hurricanes' && (
              <HurricaneDetails payload={panel.payload as never} />
            )}
            {panel.kind === 'fires' && <FireDetails payload={panel.payload as never} />}
            {panel.kind === 'ships' && <ShipDetails payload={panel.payload as never} />}
            {panel.kind === 'locations' && (
              <LocationDetails payload={panel.payload as never} />
            )}
          </Panel>
        );
      })}
    </>
  );
}
