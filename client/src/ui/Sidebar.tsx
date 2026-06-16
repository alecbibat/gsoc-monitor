import { useLayersStore } from '../store/layersStore';
import { useFlightsStatus } from '../layers/flights/flightsStore';
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
  const flightsStatus = useFlightsStatus();

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
          />
        </Section>

        <Section title="Tracking">
          <LayerToggle
            label="Flights (OpenSky)"
            active={active.flights}
            onToggle={() => toggleLayer('flights')}
            statusText={
              flightsStatus.tooWideView
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
        </Section>
      </div>
    </div>
  );
}
