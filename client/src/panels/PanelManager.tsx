import { usePanelStore } from './panelStore';
import { Panel } from './Panel';
import { EarthquakeDetails } from '../layers/earthquakes/EarthquakeDetails';
import { AlertDetails } from '../layers/alerts/AlertDetails';
import { FlightDetails } from '../layers/flights/FlightDetails';

const ACCENT_BY_KIND: Record<string, string> = {
  earthquakes: 'border-accent-warn/40',
  alerts: 'border-accent-danger/40',
  flights: 'border-accent/40',
  radar: 'border-accent/40',
};

export function PanelManager() {
  const panels = usePanelStore((s) => s.panels);

  return (
    <>
      {panels.map((panel) => (
        <Panel key={panel.id} panel={panel} accentClass={ACCENT_BY_KIND[panel.kind]}>
          {panel.kind === 'earthquakes' && (
            <EarthquakeDetails payload={panel.payload as never} />
          )}
          {panel.kind === 'alerts' && <AlertDetails payload={panel.payload as never} />}
          {panel.kind === 'flights' && <FlightDetails payload={panel.payload as never} />}
        </Panel>
      ))}
    </>
  );
}
