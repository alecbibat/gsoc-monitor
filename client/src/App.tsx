import { lazy, Suspense, useState } from 'react';
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
import { WildfireLayer } from './layers/wildfires/WildfireLayer';
import { OutageLayer } from './layers/outages/OutageLayer';
import { SmokeLayer } from './layers/smoke/SmokeLayer';
import { PrecipLayer } from './layers/precip/PrecipLayer';
import { AqiLayer } from './layers/aqi/AqiLayer';
import { FuelLayer } from './layers/fuel/FuelLayer';
import { WindLayer } from './layers/wind/WindLayer';
import { WindArrowsLayer } from './layers/wind/WindArrowsLayer';
import { XweatherLightningLayer } from './layers/xweather/XweatherLightningLayer';
import { XweatherHailLayer } from './layers/xweather/XweatherHailLayer';
import { WindProbeController } from './layers/wind/WindProbeController';
import { WindReadout } from './layers/wind/WindReadout';
import { RadarTimeline } from './layers/radar/RadarTimeline';
import { ShipLayer } from './layers/ships/ShipLayer';
import { NewsMapLayer } from './layers/newsMap/NewsMapLayer';
import { IntelLayer } from './layers/intel/IntelLayer';
import { ShipModelLayer } from './layers/ships/ShipModelLayer';
import { ShipShockwave } from './screensaver/ShipShockwave';
import { SatelliteLayer } from './layers/satellites/SatelliteLayer';
import { LocationsLayer } from './layers/locations/LocationsLayer';
import { HurricaneTooltip } from './layers/hurricanes/HurricaneTooltip';
import { TopBar } from './ui/TopBar';
import { TitleBadge } from './ui/TitleBadge';
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
import { PinsWatchTicker } from './screensaver/PinsWatchTicker';
import { GoogleEarthLayer } from './layers/earth3d/GoogleEarthLayer';
import { OsmBuildingsLayer } from './layers/osmBuildings/OsmBuildingsLayer';
import { TimeZonesLayer } from './layers/timezones/TimeZonesLayer';
import { MeasureController } from './measure/MeasureController';
import { MeasureOverlay } from './measure/MeasureOverlay';
import { FuelZoneController } from './fuelzone/FuelZoneController';
import { FuelZoneOverlay } from './fuelzone/FuelZoneOverlay';
import { ScreensaverToast } from './screensaver/ScreensaverToast';
import { NewsTicker } from './widgets/news/NewsTicker';
import { CrisisMapLayer } from './crisis/CrisisMapLayer';
import { CrisisDrawController } from './crisis/CrisisDrawController';
import { CrisisLayerPopup } from './crisis/CrisisLayerPopup';
import { IncidentSync } from './crisis/IncidentSync';
import { useCrisisStore } from './crisis/crisisStore';
import { useDashboardStore } from './dashboard/dashboardStore';
import { AuthGate } from './auth/AuthGate';

// Detect share link — renders a completely separate read-only view. Lazy so the
// main bundle doesn't carry the share view or its Leaflet dependency (and the
// share page in turn skips the heavy globe bundle it never renders).
const shareToken = new URLSearchParams(window.location.search).get('share');
const CrisisShareView = lazy(() =>
  import('./crisis/CrisisShareView').then((m) => ({ default: m.CrisisShareView }))
);

// The crisis overlay and status dashboard are full-screen views that render
// nothing until the operator opens them, so their whole UI trees stay out of
// the entry chunk. Both gates only subscribe to the (eager) stores; share-link
// auto-publish keeps running in the always-mounted IncidentSync.
const CrisisOverlay = lazy(() =>
  import('./crisis/CrisisOverlay').then((m) => ({ default: m.CrisisOverlay }))
);
const DashboardView = lazy(() =>
  import('./dashboard/DashboardView').then((m) => ({ default: m.DashboardView }))
);

function CrisisOverlayGate() {
  const open = useCrisisStore((s) => s.open);
  if (!open) return null;
  return (
    <Suspense fallback={null}>
      <CrisisOverlay />
    </Suspense>
  );
}

function DashboardGate() {
  const open = useDashboardStore((s) => s.open);
  if (!open) return null;
  return (
    <Suspense fallback={null}>
      <DashboardView />
    </Suspense>
  );
}

export default function App() {
  const [viewer, setViewer] = useState<Cesium.Viewer | null>(null);

  if (shareToken) {
    return (
      <Suspense
        fallback={
          <div className="grid h-full place-items-center bg-black text-sm text-white/40">
            Loading shared view…
          </div>
        }
      >
        <CrisisShareView token={shareToken} />
      </Suspense>
    );
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
          <WildfireLayer />
          <OutageLayer />
          <SmokeLayer />
          <PrecipLayer />
          <FireOutlookLayer />
          <RiversLayer />
          <AqiLayer />
          <FuelLayer />
          <WindLayer />
          <WindArrowsLayer />
          <XweatherLightningLayer />
          <XweatherHailLayer />
          <WindProbeController />
          <LightningLayer />
          <LightningHistoryLayer />
          <FlightLayer />
          <ShipLayer />
          <SatelliteLayer />
          <LocationsLayer />
          <NewsMapLayer />
          <IntelLayer />
          <TimeZonesLayer />
          <OsmBuildingsLayer />
          <GoogleEarthLayer />
          <MeasureController />
          <FuelZoneController />
          <CrisisMapLayer />
          <ShipModelLayer />
        </CesiumGlobe>
        <TopBar />
        <TitleBadge />
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
        <PinsWatchTicker />
        <ScreensaverToast />
        <MeasureOverlay />
        <FuelZoneOverlay />
        <WindReadout />
        <RadarTimeline />
        <HoverOverlay />
        <PickChooser />
        <NewsTicker />
        <CrisisOverlayGate />
        <CrisisDrawController />
        <CrisisLayerPopup />
        <IncidentSync />
        <DashboardGate />
      </div>
    </CesiumContext.Provider>
    </AuthGate>
  );
}
