import { useLayersStore } from '../store/layersStore';
import { useFlightsStatus } from '../layers/flights/flightsStore';
import { useAlertsStatus } from '../layers/alerts/alertsStore';
import { useHurricanesStatus } from '../layers/hurricanes/hurricanesStore';
import { useLightningStatus } from '../layers/lightning/lightningStore';
import { useFiresStatus } from '../layers/fires/firesStore';
import { useShipsStatus } from '../layers/ships/shipsStore';
import { useSatellitesStatus } from '../layers/satellites/satellitesStore';
import { useScreensaverStore } from '../screensaver/screensaverStore';
import { useCesiumViewer } from '../cesium/CesiumContext';
import { flyToLonLat } from '../cesium/flyTo';
import { LOCATION_GROUPS } from '../layers/locations/locations';
import { LayerToggle } from './LayerToggle';
import { Section } from './Section';
import { BasemapSwitcher } from './BasemapSwitcher';
import { RadarControls } from '../layers/radar/RadarControls';
import type { SatelliteGroup } from '../types';

const MAGNITUDES: Array<{ value: '1.0' | '2.5' | '4.5' | 'significant'; label: string }> = [
  { value: '1.0', label: 'M1.0+' },
  { value: '2.5', label: 'M2.5+' },
  { value: '4.5', label: 'M4.5+' },
  { value: 'significant', label: 'Significant' },
];

const SATELLITE_GROUPS: Array<{ value: SatelliteGroup; label: string }> = [
  { value: 'stations', label: 'Stations' },
  { value: 'visual', label: 'Brightest' },
  { value: 'gps', label: 'GPS' },
  { value: 'weather', label: 'Weather' },
  { value: 'starlink', label: 'Starlink' },
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
  const shipPaths = useLayersStore((s) => s.shipPaths);
  const setShipPaths = useLayersStore((s) => s.setShipPaths);
  const firesNearMiles = useLayersStore((s) => s.firesNearMiles);
  const setFiresNearMiles = useLayersStore((s) => s.setFiresNearMiles);
  const satelliteGroup = useLayersStore((s) => s.satelliteGroup);
  const setSatelliteGroup = useLayersStore((s) => s.setSatelliteGroup);
  const flightsStatus = useFlightsStatus();
  const alertsStatus = useAlertsStatus();
  const hurricanesStatus = useHurricanesStatus();
  const lightningStatus = useLightningStatus();
  const firesStatus = useFiresStatus();
  const shipsStatus = useShipsStatus();
  const satellitesStatus = useSatellitesStatus();
  const screensaverActive = useScreensaverStore((s) => s.active);
  const viewer = useCesiumViewer();
  const locationsActive = (active as Record<string, boolean>).locations ?? true;

  function shipsStatusText() {
    if (shipsStatus.noKey) return 'Set AISSTREAM_API_KEY to enable';
    if (shipsStatus.error) return shipsStatus.error;
    const conn = shipsStatus.connected ? ' · live' : '';
    return `${shipsStatus.count}/${shipsStatus.total} vessels tracked${conn}`;
  }

  function satellitesStatusText() {
    if (satellitesStatus.error) return satellitesStatus.error;
    if (satellitesStatus.loading) return 'Loading orbital data…';
    const shown = satellitesStatus.count.toLocaleString();
    if (satellitesStatus.total > satellitesStatus.count) {
      return `${shown} of ${satellitesStatus.total.toLocaleString()} satellites · live`;
    }
    return `${shown} satellites · live`;
  }

  return (
    <div
      className={`pointer-events-auto absolute left-0 top-0 z-10 flex h-full w-72 flex-col border-r border-white/10 bg-ink-900/85 pt-20 shadow-panel backdrop-blur-sm transition-transform duration-700 ease-in-out ${
        screensaverActive ? '-translate-x-full' : 'translate-x-0'
      }`}
    >
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
              (firesNearMiles > 0
                ? `${firesStatus.count.toLocaleString()} hotspots within ${firesNearMiles} mi of pins · 24h`
                : `${firesStatus.count.toLocaleString()} hotspots${
                    firesStatus.capped ? ' (top 2,500)' : ''
                  } · 24h`)
            }
          >
            <div className="pt-1">
              <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-white/30">
                Near pins
              </div>
              <div className="flex gap-1">
                {([0, 50, 100, 200] as const).map((mi) => (
                  <button
                    key={mi}
                    onClick={() => setFiresNearMiles(mi)}
                    className={`flex-1 rounded px-1 py-1 text-[11px] font-medium transition ${
                      firesNearMiles === mi
                        ? 'bg-accent/20 text-accent'
                        : 'bg-white/5 text-white/50 hover:bg-white/10'
                    }`}
                  >
                    {mi === 0 ? 'Off' : `${mi} mi`}
                  </button>
                ))}
              </div>
            </div>
          </LayerToggle>
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
            <label className="flex items-center gap-2 pt-1 text-[11px] text-white/60">
              <input
                type="checkbox"
                checked={shipPaths}
                onChange={(e) => setShipPaths(e.target.checked)}
                className="accent-accent"
              />
              Show past &amp; future paths
            </label>
          </LayerToggle>
        </Section>

        <Section title="Space">
          <LayerToggle
            label="Satellites (CelesTrak)"
            active={active.satellites}
            onToggle={() => toggleLayer('satellites')}
            statusText={satellitesStatusText()}
          >
            <div className="pt-1">
              <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-white/30">
                Group
              </div>
              <div className="flex flex-wrap gap-1">
                {SATELLITE_GROUPS.map((g) => (
                  <button
                    key={g.value}
                    onClick={() => setSatelliteGroup(g.value)}
                    className={`rounded px-1.5 py-1 text-[11px] font-medium transition ${
                      satelliteGroup === g.value
                        ? 'bg-accent/20 text-accent'
                        : 'bg-white/5 text-white/50 hover:bg-white/10'
                    }`}
                  >
                    {g.label}
                  </button>
                ))}
              </div>
            </div>
          </LayerToggle>
        </Section>

        <Section title="Locations">
          {/* Globe pin visibility toggle */}
          <div className="px-1 pb-1">
            <button
              onClick={() => toggleLayer('locations')}
              className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left transition hover:bg-white/5"
            >
              <span className="text-[13px] text-white/85">Show pins on map</span>
              <span
                className={`relative h-4 w-7 shrink-0 rounded-full transition ${
                  locationsActive ? 'bg-accent/70' : 'bg-white/15'
                }`}
              >
                <span
                  className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-transform ${
                    locationsActive ? 'translate-x-3.5' : 'translate-x-0.5'
                  }`}
                />
              </span>
            </button>
          </div>

          {/* Grouped location list */}
          {LOCATION_GROUPS.map((group) => (
            <div key={group.id} className="px-1">
              <div className="flex items-center gap-1.5 px-2 pb-0.5 pt-1 text-[10px] font-semibold uppercase tracking-wider text-white/35">
                <span>{group.icon}</span>
                <span>{group.name}</span>
              </div>
              <div className="space-y-px">
                {group.locations.map((loc) => (
                  <button
                    key={loc.name}
                    onClick={() =>
                      viewer && flyToLonLat(viewer, loc.lon, loc.lat, loc.altitudeM ?? 30_000)
                    }
                    className="flex w-full items-center gap-2 rounded px-3 py-1 text-left text-[12px] text-white/60 transition hover:bg-white/8 hover:text-white/90"
                  >
                    <span
                      className="h-1.5 w-1.5 shrink-0 rounded-full"
                      style={{ backgroundColor: group.color }}
                    />
                    {loc.name}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </Section>
      </div>
    </div>
  );
}
