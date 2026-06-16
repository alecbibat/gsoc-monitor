import { useState } from 'react';
import type * as Cesium from 'cesium';
import { CesiumContext } from './cesium/CesiumContext';
import { CesiumGlobe } from './cesium/CesiumGlobe';
import { EarthquakeLayer } from './layers/earthquakes/EarthquakeLayer';
import { AlertsLayer } from './layers/alerts/AlertsLayer';
import { RadarLayer } from './layers/radar/RadarLayer';
import { FlightLayer } from './layers/flights/FlightLayer';
import { HurricaneLayer } from './layers/hurricanes/HurricaneLayer';
import { TopBar } from './ui/TopBar';
import { Sidebar } from './ui/Sidebar';
import { PanelManager } from './panels/PanelManager';

export default function App() {
  // The viewer is created inside CesiumGlobe but is needed by UI that lives
  // outside the globe (search, etc.), so the provider lives here at the root.
  const [viewer, setViewer] = useState<Cesium.Viewer | null>(null);

  return (
    <CesiumContext.Provider value={viewer}>
      <div className="relative h-full w-full overflow-hidden bg-ink-950">
        <CesiumGlobe onReady={setViewer}>
          <RadarLayer />
          <EarthquakeLayer />
          <AlertsLayer />
          <HurricaneLayer />
          <FlightLayer />
        </CesiumGlobe>
        <TopBar />
        <Sidebar />
        <PanelManager />
      </div>
    </CesiumContext.Provider>
  );
}
