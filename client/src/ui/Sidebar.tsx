import { useLayersStore } from '../store/layersStore';
import { useFlightsStatus } from '../layers/flights/flightsStore';
import { useAlertsStatus } from '../layers/alerts/alertsStore';
import { useHurricanesStatus } from '../layers/hurricanes/hurricanesStore';
import { useLightningStatus } from '../layers/lightning/lightningStore';
import { useFiresStatus } from '../layers/fires/firesStore';
import { useShipsStatus } from '../layers/ships/shipsStore';
import { LayerToggle } from './LayerToggle';
import { Section } from './Section';
import { BasemapSwitcher } from './BasemapSwitcher';
import { RadarControls } from '../layers/radar/RadarControls';

const MAGNITUDES: Array<{ value: '1.0' | '2.5' | '4.5' | 'significant'; label: string }> = [
  { value: '1.0', label: 'M1.0+' },
  { value: '2.5', label: 'M2.5+' },
  { value: '4.5', label: 'M4.5+' },
  { value: 'significant', label: 'Significant' },
];

export function Sidebar() {
  const active = useLayersStore((s) => s.active);
  const toggleLayer = useLayersStore((s) => s.toggleLayer);
  const earthquakeMagnitude = useLayersStore((s) => s.earthquakeMagnitude);
  const setEarthquakeFilter = useLayersStore((s) => s.setEarthquakeFilter);
  const flightFavoritesOnly = useLayersStore((s) => s.flightFavoritesOnly);
  const setFlightFavoritesOnly = useLayersStore((s) => s.setFlightFavoritesOnly);
  const flightFavorites = useLayersStore((s) => s.flightFavorites);
  const shipFavoritesOnly = useLayersStore((s) => s.shipFavoritesOnly);
  const setShipFavoritesOnly = useLayersStore((s) => s.setShipFavoritesOnly);
  const shipFavorites = useLayersStore((s) => s.shipFavorites);
  const flightsStatus = useFlightsStatus();
  const alertsStatus = useAlertsStatus();
  const hurricanesStatus = useHurricanesStatus();
  const lightningStatus = useLightningStatus();
  const firesStatus = useFiresStatus();
  const shipsStatus = useShipsStatus();

  function shipsStatusText() {
    if (shipsStatus.noKey) return 'Set AISSTREAM_API_KEY to enable';
    if (shipsStatus.error) return shipsStatus.error;
    const conn = shipsStatus.connected ? ' · live' : '';
    return `${shipsStatus.count}/${shipsStatus.total} vessels tracked${conn}`;
  }

  return (
    <div className="pointer-events-auto absolute left-0 top-0 z-10 flex h-full w-72 flex-col border-r border-white/10 bg-ink-900/85 pt-20 shadow-panel backdrop-blur-sm">
      <div className="hud-scroll flex-1 overflow-y-auto px-2 pb-4">
        <Section title="Base Map">
          <BasemapSwitcher />
        </Section>

        <Section title="Weather">
          <LayerToggle
            label="Precipitation Radar"
            active={active.radar}
            onToggle={() => toggleLayer('radar')}
          >
            <RadarControls />
          </LayerToggle>
          <LayerToggle
            label="Hurricanes (NHC)"
            active={active.hurricanes}
            onToggle={() => toggleLayer('hurricanes')}
            statusText={
              hurricanesStatus.error ??
              (hurricanesStatus.count > 0
                ? `${hurricanesStatus.count} active system${hurricanesStatus.count === 1 ? '' : 's'}`
                : 'No active tropical systems')
            }
          />
          <LayerToggle
            label="Lightning (Blitzortung)"
            active={active.lightning}
            onToggle={() => toggleLayer('lightning')}
            statusText={
              lightningStatus.error
                ? lightningStatus.error
                : lightningStatus.connected
                  ? `${lightningStatus.ratePerMin} strikes/min · live`
                  : 'Connecting to network…'
            }
          />
        </Section>

        <Section title="Hazards">
          <LayerToggle
            label="Earthquakes (USGS)"
            active={active.earthquakes}
            onToggle={() => toggleLayer('earthquakes')}
          >
            <div className="flex flex-wrap gap-1.5 pt-1">
              {MAGNITUDES.map((m) => (
                <button
                  key={m.value}
                  onClick={() => setEarthquakeFilter({ magnitude: m.value })}
                  className={`rounded px-1.5 py-1 text-[11px] font-medium transition ${
                    earthquakeMagnitude === m.value
                      ? 'bg-accent/20 text-accent'
                      : 'bg-white/5 text-white/50 hover:bg-white/10'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </LayerToggle>
          <LayerToggle
            label="NWS Alerts"
            active={active.alerts}
            onToggle={() => toggleLayer('alerts')}
            statusText={alertsStatus.error ?? `${alertsStatus.count} active alerts`}
          />
          <LayerToggle
            label="Wildfires (NASA FIRMS)"
            active={active.fires}
            onToggle={() => toggleLayer('fires')}
            statusText={
              firesStatus.error ??
              `${firesStatus.count.toLocaleString()} hotspots${
                firesStatus.capped ? ' (top 2,500)' : ''
              } · 24h`
            }
          />
        </Section>

        <Section title="Tracking">
          <LayerToggle
            label="Flights (ADS-B)"
            active={active.flights}
            onToggle={() => toggleLayer('flights')}
            statusText={
              flightsStatus.error
                ? flightsStatus.error
                : flightsStatus.tooWideView
                  ? 'Zoom in to load live flights'
                  : `${flightsStatus.count} aircraft in view`
            }
          >
            <label className="flex items-center gap-2 pt-1 text-[11px] text-white/60">
              <input
                type="checkbox"
                checked={flightFavoritesOnly}
                onChange={(e) => setFlightFavoritesOnly(e.target.checked)}
                className="accent-accent"
              />
              Show favorites only ({flightFavorites.length})
            </label>
          </LayerToggle>
          <LayerToggle
            label="Ships (AIS)"
            active={active.ships}
            onToggle={() => toggleLayer('ships')}
            statusText={shipsStatusText()}
          >
            <label className="flex items-center gap-2 pt-1 text-[11px] text-white/60">
              <input
                type="checkbox"
                checked={shipFavoritesOnly}
                onChange={(e) => setShipFavoritesOnly(e.target.checked)}
                className="accent-accent"
              />
              Show favorites only ({shipFavorites.length})
            </label>
          </LayerToggle>
        </Section>
      </div>
    </div>
  );
}
