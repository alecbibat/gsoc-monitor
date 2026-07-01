import { useState, type ReactNode } from 'react';
import { useLayersStore } from '../store/layersStore';
import { useFlightsStatus } from '../layers/flights/flightsStore';
import { useAlertsStatus } from '../layers/alerts/alertsStore';
import { useHurricanesStatus } from '../layers/hurricanes/hurricanesStore';
import { useLightningStatus } from '../layers/lightning/lightningStore';
import { useFiresStatus } from '../layers/fires/firesStore';
import { useWildfiresStatus } from '../layers/wildfires/wildfiresStore';
import { useSmokeStatus } from '../layers/smoke/smokeStore';
import { useAqiStatus } from '../layers/aqi/aqiStore';
import { useRiversStatus } from '../layers/rivers/riversStore';
import { RIVER_FILTERS } from '../layers/rivers/riverMeta';
import { useFuelStatus } from '../layers/fuel/fuelStore';
import { useWindStatus } from '../layers/wind/windStore';
import { useWindProbeStore } from '../layers/wind/windProbeStore';
import { FuelLegend } from '../layers/fuel/FuelLegend';
import { useFuelZoneStore } from '../fuelzone/fuelZoneStore';
import { useFireOutlookStore } from '../layers/fireOutlook/fireOutlookStore';
import { FireOutlookControls } from '../layers/fireOutlook/FireOutlookControls';
import { useShipsStatus } from '../layers/ships/shipsStore';
import { useNewsMapStore } from '../layers/newsMap/newsMapStore';
import { useSatellitesStatus } from '../layers/satellites/satellitesStore';
import { useScreensaverStore } from '../screensaver/screensaverStore';
import { useHoverStore } from '../screensaver/hoverStore';
import { useOsmStatus } from '../layers/osmBuildings/osmStore';
import { useTimeZonesStatus } from '../layers/timezones/timezonesStore';
import { useCesiumViewer } from '../cesium/CesiumContext';
import { flyToLonLat } from '../cesium/flyTo';
import { LOCATION_GROUPS } from '../layers/locations/locations';
import { FLEET_ROSTER, fleetColor } from '../layers/ships/fleet';
import { api } from '../api/client';
import { LayerToggle } from './LayerToggle';
import { Section } from './Section';
import { BasemapSwitcher } from './BasemapSwitcher';
import { ScreensaverControls } from './ScreensaverControls';
import { RadarControls } from '../layers/radar/RadarControls';
import { PrecipControls } from '../layers/precip/PrecipControls';
import { usePrecipStore, QPF_PERIOD_LABEL } from '../layers/precip/precipStore';
import { LightningControls } from '../layers/lightning/LightningControls';
import { useUiStore } from './uiStore';
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

// A compact collapsible sub-group for the Locations list — collapsed by default
// so the menu shows just headers (icon · name · count) until one is expanded.
function CollapsibleSubgroup({
  icon,
  name,
  count,
  children,
}: {
  icon: string;
  name: string;
  count: number;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="px-1">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-1.5 px-2 pb-0.5 pt-1 text-[10px] font-semibold uppercase tracking-wider text-white/35 transition hover:text-white/55"
      >
        <span>{icon}</span>
        <span className="flex-1 text-left">{name}</span>
        <span className="text-white/25">{count}</span>
        <span className={`transition-transform ${open ? 'rotate-0' : '-rotate-90'}`}>▾</span>
      </button>
      {open && <div className="space-y-px">{children}</div>}
    </div>
  );
}

export function Sidebar() {
  const active = useLayersStore((s) => s.active);
  const toggleLayer = useLayersStore((s) => s.toggleLayer);
  const earthquakeMagnitude = useLayersStore((s) => s.earthquakeMagnitude);
  const setEarthquakeFilter = useLayersStore((s) => s.setEarthquakeFilter);
  const shipFavoritesOnly = useLayersStore((s) => s.shipFavoritesOnly);
  const setShipFavoritesOnly = useLayersStore((s) => s.setShipFavoritesOnly);
  const shipFavorites = useLayersStore((s) => s.shipFavorites);
  const shipPaths = useLayersStore((s) => s.shipPaths);
  const setShipPaths = useLayersStore((s) => s.setShipPaths);
  const firesNearMiles = useLayersStore((s) => s.firesNearMiles);
  const setFiresNearMiles = useLayersStore((s) => s.setFiresNearMiles);
  const newsNearMiles = useLayersStore((s) => s.newsNearMiles);
  const setNewsNearMiles = useLayersStore((s) => s.setNewsNearMiles);
  const satelliteGroup = useLayersStore((s) => s.satelliteGroup);
  const setSatelliteGroup = useLayersStore((s) => s.setSatelliteGroup);
  const flightsStatus = useFlightsStatus();
  const alertsStatus = useAlertsStatus();
  const hurricanesStatus = useHurricanesStatus();
  const lightningStatus = useLightningStatus();
  const firesStatus = useFiresStatus();
  const wildfiresStatus = useWildfiresStatus();
  const smokeStatus = useSmokeStatus();
  const aqiStatus = useAqiStatus();
  const riversStatus = useRiversStatus();
  const precipPeriod = usePrecipStore((s) => s.period);
  const fireOutlookError = useFireOutlookStore((s) => s.error);
  const fuelStatus = useFuelStatus();
  const windStatus = useWindStatus();
  const windProbeEnabled = useWindProbeStore((s) => s.probeEnabled);
  const toggleWindProbe = useWindProbeStore((s) => s.toggleProbe);
  const fuelZoneActive = useFuelZoneStore((s) => s.active);
  const fuelZoneMode = useFuelZoneStore((s) => s.mode);
  const toggleFuelZone = useFuelZoneStore((s) => s.toggle);
  const shipsStatus = useShipsStatus();
  const newsMapStatus = useNewsMapStore();
  const satellitesStatus = useSatellitesStatus();
  const osmStatus = useOsmStatus();
  const timeZonesStatus = useTimeZonesStatus();
  const screensaverActive = useScreensaverStore((s) => s.active);
  // Hover mode (custom-point orbit) also takes over the screen, so collapse the
  // chrome while picking a point or orbiting, just like a screensaver.
  const hoverEngaged = useHoverStore((s) => s.active || s.picking);
  const chromeHidden = screensaverActive || hoverEngaged;
  const sidebarOpen = useUiStore((s) => s.sidebarOpen);
  const setSidebarOpen = useUiStore((s) => s.setSidebarOpen);
  const viewer = useCesiumViewer();
  const locationsActive = (active as Record<string, boolean>).locations ?? true;

  function shipsStatusText() {
    if (shipsStatus.noKey) return 'No AISSTREAM_API_KEY set in this environment';
    if (shipsStatus.error) return shipsStatus.error;
    // Distinguish the failure modes so "nothing shows" is diagnosable at a glance.
    if (shipsStatus.count > 0) {
      return `${shipsStatus.count}/${shipsStatus.total} ships · last-known${shipsStatus.streaming ? ' · live feed' : ''}`;
    }
    if (!shipsStatus.connected) return 'Stream offline — check the API key (see /api/ships/debug)';
    if (shipsStatus.messages === 0) return 'Subscribed · waiting for a ship to enter receiver range';
    return `Feed live (${shipsStatus.messages.toLocaleString()} msgs) · 0/${shipsStatus.total} ships in range yet`;
  }

  // Fly to a fleet ship from the roster. Ensures the ships layer is on so the
  // icon is visible where we land, and fetches a position on demand if the layer
  // hasn't loaded one yet (it defaults off).
  async function flyToShip(mmsi: string) {
    if (!(active as Record<string, boolean>).ships) toggleLayer('ships');
    let ship = useShipsStatus.getState().ships.find((s) => s.mmsi === mmsi);
    if (!ship) {
      try {
        const data = await api.ships();
        useShipsStatus.getState().setShips(data.ships);
        ship = data.ships.find((s) => s.mmsi === mmsi);
      } catch {
        /* no position available */
      }
    }
    if (ship && viewer) flyToLonLat(viewer, ship.longitude, ship.latitude, 250_000);
    setSidebarOpen(false);
  }

  function newsMapStatusText() {
    if (newsMapStatus.error) return newsMapStatus.error;
    const scope = newsNearMiles > 0 ? `within ${newsNearMiles} mi of pins` : 'worldwide';
    if (newsMapStatus.total === 0) return 'Awaiting geocoded news · 6h';
    return `${newsMapStatus.count} events ${scope} · 6h`;
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

  // On md+ the sidebar is always docked. On small screens it's an off-canvas
  // drawer toggled by the TopBar hamburger. The screensaver hides it entirely.
  const translate = chromeHidden
    ? '-translate-x-full'
    : sidebarOpen
      ? 'translate-x-0'
      : '-translate-x-full md:translate-x-0';

  return (
    <>
      {/* Mobile backdrop — tap to dismiss the drawer. */}
      {sidebarOpen && !chromeHidden && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm md:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-hidden
        />
      )}
      <div
        className={`pointer-events-auto absolute left-0 top-0 z-50 flex h-full w-72 max-w-[85vw] flex-col border-r border-white/10 bg-ink-900/95 pt-drawer shadow-panel backdrop-blur-sm transition-transform duration-500 ease-in-out md:z-10 md:max-w-none md:bg-ink-900/85 md:pt-drawer-md ${translate}`}
      >
        {/* Mobile-only close button. */}
        <button
          onClick={() => setSidebarOpen(false)}
          className="absolute right-2 top-safe rounded-md p-1.5 text-white/50 transition hover:bg-white/10 hover:text-white md:hidden"
          aria-label="Close menu"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <path d="M6 6L18 18M6 18L18 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
        <div className="hud-scroll flex-1 overflow-y-auto px-2 pb-4">
          {/* Screensaver modes — mobile only; desktop has them in the TopBar. */}
          <div className="md:hidden">
            <Section title="Screensaver">
              <div className="px-1 pb-1">
                <ScreensaverControls />
              </div>
            </Section>
          </div>
          <Section title="Base Map">
          <BasemapSwitcher />
          <LayerToggle
            label="Time Zones"
            active={active.timezones}
            onToggle={() => toggleLayer('timezones')}
            statusText={
              timeZonesStatus.error ??
              (timeZonesStatus.loading
                ? 'Loading zone boundaries…'
                : timeZonesStatus.ready
                  ? `${timeZonesStatus.count} zones · click zone for local time`
                  : 'Color-coded UTC offset bands · free')
            }
          />
          <LayerToggle
            label="3D Buildings & Terrain"
            active={(active as Record<string, boolean>).osmBuildings ?? false}
            onToggle={() => toggleLayer('osmBuildings')}
            statusText={
              osmStatus.error ??
              (osmStatus.loading
                ? 'Loading buildings & terrain…'
                : osmStatus.ready
                  ? 'OSM buildings + world terrain · free'
                  : 'Real 3D buildings worldwide · free (Cesium ion)')
            }
          />
          {/* Photorealistic 3D (Google) is intentionally hidden: it hits a
              metered Google API and we don't want it toggled by accident. The
              layer + store stay wired up (see GoogleEarthLayer / earthStore) so
              it can be re-enabled later — there's just no UI control for it. */}
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
            label="Precipitation Forecast (WPC)"
            active={(active as Record<string, boolean>).precip ?? false}
            onToggle={() => toggleLayer('precip')}
            statusText={`NOAA QPF accumulation · ${QPF_PERIOD_LABEL[precipPeriod]}`}
          >
            <PrecipControls />
          </LayerToggle>
          <LayerToggle
            label="Hurricanes (NHC + JTWC)"
            active={active.hurricanes}
            onToggle={() => toggleLayer('hurricanes')}
            statusText={
              hurricanesStatus.error ??
              ([
                hurricanesStatus.count > 0
                  ? `${hurricanesStatus.count} active system${hurricanesStatus.count === 1 ? '' : 's'}`
                  : null,
                hurricanesStatus.disturbances + hurricanesStatus.invests > 0
                  ? `${hurricanesStatus.disturbances + hurricanesStatus.invests} area${
                      hurricanesStatus.disturbances + hurricanesStatus.invests === 1 ? '' : 's'
                    } to watch`
                  : null,
              ]
                .filter(Boolean)
                .join(' · ') || 'No active tropical systems')
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
          >
            <LightningControls />
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
                {([0, 5, 50, 100, 200] as const).map((mi) => (
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
          <LayerToggle
            label="Named Fires (NIFC)"
            active={(active as Record<string, boolean>).wildfires ?? false}
            onToggle={() => toggleLayer('wildfires')}
            statusText={
              wildfiresStatus.error ??
              (wildfiresStatus.count > 0
                ? `${wildfiresStatus.count} active incident${
                    wildfiresStatus.count === 1 ? '' : 's'
                  } · acres, containment, crews`
                : 'Named fires + response · NIFC/WFIGS')
            }
          />
          <LayerToggle
            label="Smoke (NOAA HMS)"
            active={(active as Record<string, boolean>).smoke ?? false}
            onToggle={() => toggleLayer('smoke')}
            statusText={
              smokeStatus.error ??
              (smokeStatus.count > 0
                ? `${smokeStatus.count} polygons · ${smokeStatus.date ? smokeStatus.date.slice(0, 4) + '-' + smokeStatus.date.slice(4, 6) + '-' + smokeStatus.date.slice(6, 8) : ''}`
                : 'Satellite-detected smoke plumes · daily')
            }
          />
          <LayerToggle
            label="Air Quality (AirNow + PurpleAir)"
            active={(active as Record<string, boolean>).aqi ?? false}
            onToggle={() => toggleLayer('aqi')}
            statusText={
              aqiStatus.error
                ? aqiStatus.error
                : aqiStatus.noKey && aqiStatus.purpleAirNoKey
                  ? 'Set AIRNOW_API_KEY and/or PURPLEAIR_API_KEY'
                  : aqiStatus.count > 0
                    ? `${aqiStatus.count.toLocaleString()} sensors · worst AQI ${aqiStatus.worstAqi} (${aqiStatus.worstCategory})`
                    : 'EPA + community sensors · CONUS'
            }
          >
            <div className="flex flex-wrap gap-1.5 pt-1">
              {aqiStatus.noKey ? (
                <span className="rounded bg-white/5 px-2 py-1 text-[10px] text-white/30">
                  AirNow: no AIRNOW_API_KEY
                </span>
              ) : (
                <button
                  onClick={() => aqiStatus.toggleSource('airnow')}
                  className={`rounded px-2 py-1 text-[11px] font-medium transition ${
                    aqiStatus.showAirnow
                      ? 'bg-accent/20 text-accent'
                      : 'bg-white/5 text-white/40 hover:bg-white/10'
                  }`}
                >
                  AirNow{aqiStatus.airnowCount > 0 ? ` · ${aqiStatus.airnowCount.toLocaleString()}` : ''}
                </button>
              )}
              {aqiStatus.purpleAirNoKey ? (
                <span className="rounded bg-white/5 px-2 py-1 text-[10px] text-white/30">
                  PurpleAir: set PURPLEAIR_API_KEY
                </span>
              ) : (
                <button
                  onClick={() => aqiStatus.toggleSource('purpleair')}
                  className={`rounded px-2 py-1 text-[11px] font-medium transition ${
                    aqiStatus.showPurpleair
                      ? 'bg-purple-400/20 text-purple-300'
                      : 'bg-white/5 text-white/40 hover:bg-white/10'
                  }`}
                >
                  PurpleAir{aqiStatus.purpleairCount > 0 ? ` · ${aqiStatus.purpleairCount.toLocaleString()}` : ''}
                </button>
              )}
            </div>
            <p className="pt-1.5 text-[10px] leading-relaxed text-white/30">
              Numbered badges = AirNow reference monitors · dots = PurpleAir
              (PM2.5, EPA-corrected)
            </p>
          </LayerToggle>
          <LayerToggle
            label="Rivers & Floods (NWPS)"
            active={(active as Record<string, boolean>).rivers ?? false}
            onToggle={() => toggleLayer('rivers')}
            statusText={
              riversStatus.error
                ? riversStatus.error
                : riversStatus.counts
                  ? `${
                      riversStatus.counts.action +
                      riversStatus.counts.minor +
                      riversStatus.counts.moderate +
                      riversStatus.counts.major
                    } at/above action · ${riversStatus.total.toLocaleString()} shown`
                  : riversStatus.loading
                    ? 'Loading national gauges…'
                    : 'NOAA river forecast gauges · live'
            }
          >
            <div className="flex flex-wrap gap-1.5 pt-1">
              {RIVER_FILTERS.map((f) => (
                <button
                  key={f.value}
                  onClick={() => riversStatus.setFilter(f.value)}
                  className={`rounded px-1.5 py-1 text-[11px] font-medium transition ${
                    riversStatus.filter === f.value
                      ? 'bg-accent/20 text-accent'
                      : 'bg-white/5 text-white/50 hover:bg-white/10'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <button
              onClick={riversStatus.toggleForecast}
              className={`mt-1.5 flex w-full items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-[11px] font-semibold transition ${
                riversStatus.showForecast
                  ? 'bg-amber-400/20 text-amber-300'
                  : 'bg-white/5 text-white/55 hover:bg-white/10'
              }`}
            >
              <span>🔮</span>
              {riversStatus.showForecast ? 'Showing forecast-to-flood' : 'Highlight forecast-to-flood'}
            </button>
            <p className="pt-1.5 text-[10px] leading-relaxed text-white/30">
              Dot color = flood stage (cyan normal → purple major). Click a gauge
              for levels, thresholds &amp; forecast.
            </p>
          </LayerToggle>
          <LayerToggle
            label="Wind (GFS)"
            active={(active as Record<string, boolean>).wind ?? false}
            onToggle={() => toggleLayer('wind')}
            statusText={
              windStatus.error ??
              (windStatus.ready
                ? windStatus.stale
                  ? `Historical wind${
                      windStatus.grid?.updated
                        ? ` · as of ${new Date(windStatus.grid.updated).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`
                        : ''
                    } · peak ${Math.round(windStatus.maxSpeedMps * 2.23694)} mph`
                  : `Live surface wind · peak ${Math.round(windStatus.maxSpeedMps * 2.23694)} mph`
                : 'Animated global wind streamlines')
            }
          >
            <button
              onClick={toggleWindProbe}
              className={`mt-2 flex w-full items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-[11px] font-semibold transition ${
                windProbeEnabled
                  ? 'bg-accent/15 text-accent'
                  : 'bg-white/5 text-white/60 hover:bg-white/10'
              }`}
            >
              <span>🎯</span>
              {windProbeEnabled ? 'Probe on · right-click to pin' : 'Wind probe off'}
            </button>
          </LayerToggle>
          <LayerToggle
            label="7-Day Fire Potential (NWCG)"
            active={(active as Record<string, boolean>).fireOutlook ?? false}
            onToggle={() => toggleLayer('fireOutlook')}
            statusText={fireOutlookError ?? 'Significant fire potential · next 7 days · CONUS'}
          >
            <FireOutlookControls />
          </LayerToggle>
          <LayerToggle
            label="Fuel Models (LANDFIRE)"
            active={(active as Record<string, boolean>).fuel ?? false}
            onToggle={() => toggleLayer('fuel')}
            statusText={
              fuelStatus.error ?? 'Scott & Burgan 40 fuel models · CONUS · 30 m'
            }
          >
            <FuelLegend />
            <div className="mt-2">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-white/30">
                Analyze fuels in an area
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  onClick={() => toggleFuelZone('circle')}
                  className={`flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-[11px] font-semibold transition ${
                    fuelZoneActive && fuelZoneMode === 'circle'
                      ? 'bg-amber-400/20 text-amber-300'
                      : 'bg-white/5 text-white/60 hover:bg-white/10'
                  }`}
                >
                  <span>◎</span>
                  {fuelZoneActive && fuelZoneMode === 'circle' ? 'Drawing…' : 'Circle'}
                </button>
                <button
                  onClick={() => toggleFuelZone('polygon')}
                  className={`flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-[11px] font-semibold transition ${
                    fuelZoneActive && fuelZoneMode === 'polygon'
                      ? 'bg-amber-400/20 text-amber-300'
                      : 'bg-white/5 text-white/60 hover:bg-white/10'
                  }`}
                >
                  <span>⬠</span>
                  {fuelZoneActive && fuelZoneMode === 'polygon' ? 'Drawing…' : 'Polygon'}
                </button>
              </div>
            </div>
          </LayerToggle>
        </Section>

        <Section title="Open-Source Intel">
          <LayerToggle
            label="News (GDELT)"
            active={(active as Record<string, boolean>).newsMap ?? false}
            onToggle={() => toggleLayer('newsMap')}
            statusText={newsMapStatusText()}
          >
            <div className="pt-1">
              <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-white/30">
                Scope
              </div>
              <div className="flex gap-1">
                {([0, 100, 250, 500] as const).map((mi) => (
                  <button
                    key={mi}
                    onClick={() => setNewsNearMiles(mi)}
                    className={`flex-1 rounded px-1 py-1 text-[11px] font-medium transition ${
                      newsNearMiles === mi
                        ? 'bg-accent/20 text-accent'
                        : 'bg-white/5 text-white/50 hover:bg-white/10'
                    }`}
                  >
                    {mi === 0 ? 'Global' : `${mi} mi`}
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
                : `${flightsStatus.count} of 3 tails tracked`
            }
          />
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
          <button
            onClick={() => {
              if (!active.satellites) toggleLayer('satellites');
              if (satelliteGroup !== 'stations') setSatelliteGroup('stations');
              satellitesStatus.requestFocusIss();
            }}
            className="mx-1 mt-1 flex w-[calc(100%-0.5rem)] items-center gap-2 rounded-md border border-amber-300/30 bg-amber-300/10 px-2.5 py-1.5 text-left text-[12px] font-medium text-amber-100 transition hover:bg-amber-300/20"
          >
            <span className="text-[14px]">🛰️</span>
            Track the ISS
          </button>
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

          {/* Grouped location list — each group collapsible (collapsed by default) */}
          {LOCATION_GROUPS.map((group) => (
            <CollapsibleSubgroup
              key={group.id}
              icon={group.icon}
              name={group.name}
              count={group.locations.length}
            >
              {group.locations.map((loc) => (
                <button
                  key={loc.name}
                  onClick={() => {
                    if (viewer) flyToLonLat(viewer, loc.lon, loc.lat, loc.altitudeM ?? 30_000);
                    setSidebarOpen(false); // dismiss the drawer on mobile
                  }}
                  className="flex w-full items-center gap-2 rounded px-3 py-1 text-left text-[12px] text-white/60 transition hover:bg-white/8 hover:text-white/90"
                >
                  <span
                    className="h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{ backgroundColor: group.color }}
                  />
                  {loc.name}
                </button>
              ))}
            </CollapsibleSubgroup>
          ))}

          {/* Windstar fleet — same list, fly to a ship's live position */}
          <CollapsibleSubgroup icon="🚢" name="Windstar Ships" count={FLEET_ROSTER.length}>
            {FLEET_ROSTER.map((s) => {
              const live = shipsStatus.ships.find((x) => x.mmsi === s.mmsi);
              return (
                <button
                  key={s.mmsi}
                  onClick={() => flyToShip(s.mmsi)}
                  className="flex w-full items-center gap-2 rounded px-3 py-1 text-left text-[12px] text-white/60 transition hover:bg-white/8 hover:text-white/90"
                >
                  <span
                    className="h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{ backgroundColor: fleetColor(s.cls) }}
                  />
                  <span className="flex-1 truncate">{s.name}</span>
                  {live && live.speedKt != null && live.speedKt > 0.5 && (
                    <span className="shrink-0 font-mono text-[9px] text-white/30">
                      {live.speedKt.toFixed(0)} kt
                    </span>
                  )}
                </button>
              );
            })}
          </CollapsibleSubgroup>
        </Section>
        </div>
      </div>
    </>
  );
}
