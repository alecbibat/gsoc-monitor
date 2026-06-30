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
import { LightningHistoryLayer } from './layers/lightning/LightningHistoryLayer';
import { RiversLayer } from './layers/rivers/RiversLayer';
import { FireOutlookLayer } from './layers/fireOutlook/FireOutlookLayer';
import { FireLayer } from './layers/fires/FireLayer';
import { SmokeLayer } from './layers/smoke/SmokeLayer';
import { AqiLayer } from './layers/aqi/AqiLayer';
import { FuelLayer } from './layers/fuel/FuelLayer';
import { WindLayer } from './layers/wind/WindLayer';
import { WindProbeController } from './layers/wind/WindProbeController';
import { WindReadout } from './layers/wind/WindReadout';
import { RadarTimeline } from './layers/radar/RadarTimeline';
import { ShipLayer } from './layers/ships/ShipLayer';
import { NewsMapLayer } from './layers/newsMap/NewsMapLayer';
import { ShipModelLayer } from './layers/ships/ShipModelLayer';
import { ShipShockwave } from './screensaver/ShipShockwave';
import { SatelliteLayer } from './layers/satellites/SatelliteLayer';
import { LocationsLayer } from './layers/locations/LocationsLayer';
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
import { HoverContextBox } from './screensaver/HoverContextBox';
import { HoverFocusCard } from './screensaver/HoverFocusCard';
import { PinsContextBox } from './screensaver/PinsContextBox';
import { PinsFocusCard } from './screensaver/PinsFocusCard';
import { ShipFocusCard } from './screensaver/ShipFocusCard';
import { PinsLootBeam } from './screensaver/PinsLootBeam';
import { PinsVoice } from './screensaver/PinsVoice';
import { ScreensaverWatchCards } from './screensaver/ScreensaverWatchCards';
import { GoogleEarthLayer } from './layers/earth3d/GoogleEarthLayer';
import { OsmBuildingsLayer } from './layers/osmBuildings/OsmBuildingsLayer';
import { TimeZonesLayer } from './layers/timezones/TimeZonesLayer';
import { MeasureController } from './measure/MeasureController';
import { MeasureOverlay } from './measure/MeasureOverlay';
import { FuelZoneController } from './fuelzone/FuelZoneController';
import { FuelZoneOverlay } from './fuelzone/FuelZoneOverlay';
import { ScreensaverToast } from './screensaver/ScreensaverToast';
import { NewsTicker } from './widgets/news/NewsTicker';
import { CrisisOverlay } from './crisis/CrisisOverlay';
import { CrisisMapLayer } from './crisis/CrisisMapLayer';
import { CrisisDrawController } from './crisis/CrisisDrawController';
import { CrisisLayerPopup } from './crisis/CrisisLayerPopup';
import { CrisisShareView } from './crisis/CrisisShareView';
import { IncidentSync } from './crisis/IncidentSync';
import { DashboardView } from './dashboard/DashboardView';
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
          <SmokeLayer />
          <FireOutlookLayer />
          <RiversLayer />
          <AqiLayer />
          <FuelLayer />
          <WindLayer />
          <WindProbeController />
          <LightningLayer />
          <LightningHistoryLayer />
          <FlightLayer />
          <ShipLayer />
          <SatelliteLayer />
          <LocationsLayer />
          <NewsMapLayer />
          <TimeZonesLayer />
          <OsmBuildingsLayer />
          <GoogleEarthLayer />
          <MeasureController />
          <FuelZoneController />
          <CrisisMapLayer />
          <ShipModelLayer />
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
        <HoverContextBox />
        <HoverFocusCard />
        <ShipFocusCard />
        <PinsLootBeam />
        <PinsVoice />
        <ShipShockwave />
        <ScreensaverWatchCards />
        <ScreensaverToast />
        <MeasureOverlay />
        <FuelZoneOverlay />
        <WindReadout />
        <RadarTimeline />
        <HoverOverlay />
        <PickChooser />
        <NewsTicker />
        <CrisisOverlay />
        <CrisisDrawController />
        <CrisisLayerPopup />
        <IncidentSync />
        <DashboardView />
      </div>
    </CesiumContext.Provider>
    </AuthGate>
  );
}
