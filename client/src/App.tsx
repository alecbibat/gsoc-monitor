import { useState } from 'react';
import type * as Cesium from 'cesium';
import { CesiumContext } from './cesium/CesiumContext';
import { CesiumGlobe } from './cesium/CesiumGlobe';
import { EarthquakeLayer } from './layers/earthquakes/EarthquakeLayer';
import { AlertsLayer } from './layers/alerts/AlertsLayer';
import { RadarLayer } from './layers/radar/RadarLayer';
import { FlightLayer } from './layers/flights/FlightLayer';
import { HurricaneLayer } from './layers/hurricanes/HurricaneLayer';
import { LightningLayer } from './layers/lightning/LightningLayer';
import { FireLayer } from './layers/fires/FireLayer';
import { ShipLayer } from './layers/ships/ShipLayer';
import { SatelliteLayer } from './layers/satellites/SatelliteLayer';
import { LocationsLayer } from './layers/locations/LocationsLayer';
import { TopBar } from './ui/TopBar';
import { Sidebar } from './ui/Sidebar';
import { StarField } from './ui/StarField';
import { PanelManager } from './panels/PanelManager';
import { ScreensaverController } from './screensaver/ScreensaverController';
import { NationalParksController } from './screensaver/NationalParksController';
import { ScreensaverToast } from './screensaver/ScreensaverToast';

export default function App() {
  const [viewer, setViewer] = useState<Cesium.Viewer | null>(null);

  return (
    <CesiumContext.Provider value={viewer}>
      {/* bg-black is the fallback; StarField canvas renders on top of it,
          and the transparent Cesium canvas sits above that. */}
      <div className="relative h-full w-full overflow-hidden bg-black">
        <StarField />
        <CesiumGlobe onReady={setViewer}>
          <RadarLayer />
          <EarthquakeLayer />
          <AlertsLayer />
          <HurricaneLayer />
          <FireLayer />
          <LightningLayer />
          <FlightLayer />
          <ShipLayer />
          <SatelliteLayer />
          <LocationsLayer />
        </CesiumGlobe>
        <TopBar />
        <Sidebar />
        <PanelManager />
        <ScreensaverController />
        <NationalParksController />
        <ScreensaverToast />
      </div>
    </CesiumContext.Provider>
  );
}
