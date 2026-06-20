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
import { WebcamsLayer } from './layers/webcams/WebcamsLayer';
import { HurricaneTooltip } from './layers/hurricanes/HurricaneTooltip';
import { TopBar } from './ui/TopBar';
import { Sidebar } from './ui/Sidebar';
import { StarField } from './ui/StarField';
import { PanelManager } from './panels/PanelManager';
import { PickChooser } from './panels/PickChooser';
import { ScreensaverController } from './screensaver/ScreensaverController';
import { NationalParksController } from './screensaver/NationalParksController';
import { IssController } from './screensaver/IssController';
import { PinsController } from './screensaver/PinsController';
import { HoverController } from './screensaver/HoverController';
import { HoverOverlay } from './screensaver/HoverOverlay';
import { PinsContextBox } from './screensaver/PinsContextBox';
import { PinsFocusCard } from './screensaver/PinsFocusCard';
import { PinsLootBeam } from './screensaver/PinsLootBeam';
import { ScreensaverWatchCards } from './screensaver/ScreensaverWatchCards';
import { WebcamScreensaverCallouts } from './screensaver/WebcamScreensaverCallouts';
import { GoogleEarthLayer } from './layers/earth3d/GoogleEarthLayer';
import { OsmBuildingsLayer } from './layers/osmBuildings/OsmBuildingsLayer';
import { TrafficLayer } from './layers/traffic/TrafficLayer';
import { TimeZonesLayer } from './layers/timezones/TimeZonesLayer';
import { MeasureController } from './measure/MeasureController';
import { MeasureOverlay } from './measure/MeasureOverlay';
import { ScreensaverToast } from './screensaver/ScreensaverToast';
import { NewsTicker } from './widgets/news/NewsTicker';
import { CrisisOverlay } from './crisis/CrisisOverlay';
import { CrisisMapLayer } from './crisis/CrisisMapLayer';
import { CrisisDrawController } from './crisis/CrisisDrawController';
import { CrisisLayerPopup } from './crisis/CrisisLayerPopup';
import { CrisisShareView } from './crisis/CrisisShareView';
import { IncidentSync } from './crisis/IncidentSync';
import { AuthGate } from './auth/AuthGate';

// Detect share link — renders a completely separate read-only view
const shareToken = new URLSearchParams(window.location.search).get('share');

export default function App() {
  const [viewer, setViewer] = useState<Cesium.Viewer | null>(null);

  if (shareToken) {
    return <CrisisShareView token={shareToken} />;
  }

  return (
    <AuthGate>
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
          <WebcamsLayer />
          <TimeZonesLayer />
          <OsmBuildingsLayer />
          <GoogleEarthLayer />
          <TrafficLayer />
          <MeasureController />
          <CrisisMapLayer />
        </CesiumGlobe>
        <TopBar />
        <Sidebar />
        <HurricaneTooltip />
        <PanelManager />
        <ScreensaverController />
        <NationalParksController />
        <IssController />
        <PinsController />
        <HoverController />
        <PinsContextBox />
        <PinsFocusCard />
        <PinsLootBeam />
        <ScreensaverWatchCards />
        <WebcamScreensaverCallouts />
        <ScreensaverToast />
        <MeasureOverlay />
        <HoverOverlay />
        <PickChooser />
        <NewsTicker />
        <CrisisOverlay />
        <CrisisDrawController />
        <CrisisLayerPopup />
        <IncidentSync />
      </div>
    </CesiumContext.Provider>
    </AuthGate>
  );
}
