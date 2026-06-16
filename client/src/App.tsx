import { CesiumGlobe } from './cesium/CesiumGlobe';
import { EarthquakeLayer } from './layers/earthquakes/EarthquakeLayer';
import { AlertsLayer } from './layers/alerts/AlertsLayer';
import { RadarLayer } from './layers/radar/RadarLayer';
import { FlightLayer } from './layers/flights/FlightLayer';
import { TopBar } from './ui/TopBar';
import { Sidebar } from './ui/Sidebar';
import { PanelManager } from './panels/PanelManager';

export default function App() {
  return (
    <div className="relative h-full w-full overflow-hidden bg-ink-950">
      <CesiumGlobe>
        <RadarLayer />
        <EarthquakeLayer />
        <AlertsLayer />
        <FlightLayer />
      </CesiumGlobe>
      <TopBar />
      <Sidebar />
      <PanelManager />
    </div>
  );
}
