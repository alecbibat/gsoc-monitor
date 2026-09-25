import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import type * as Cesium from 'cesium';
import { ShareErrorBoundary } from './crisis/ShareErrorBoundary';
import { CesiumContext } from './cesium/CesiumContext';
import { CesiumGlobe } from './cesium/CesiumGlobe';
import { EarthquakeLayer } from './layers/earthquakes/EarthquakeLayer';
import { AlertsLayer } from './layers/alerts/AlertsLayer';
import { RadarLayer } from './layers/radar/RadarLayer';
import { RadarTimeline } from './layers/radar/RadarTimeline';
import { RadarHoverReadout } from './layers/radar/RadarHoverReadout';
import { RadarHotkeys } from './layers/radar/RadarHotkeys';
import { EarthTimeBar } from './ui/EarthTimeBar';
import { FlightLayer } from './layers/flights/FlightLayer';
import { HurricaneLayer } from './layers/hurricanes/HurricaneLayer';
import { LightningLayer } from './layers/lightning/LightningLayer';
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
import { WindProbeController } from './layers/wind/WindProbeController';
import { WindReadout } from './layers/wind/WindReadout';
import { MapLegends } from './ui/MapLegends';
import { TimeZonesCredit } from './layers/timezones/TimeZonesCredit';
import { ShipLayer } from './layers/ships/ShipLayer';
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
import { PinsOverviewSitrep } from './screensaver/PinsOverviewSitrep';
import { PinsVoice } from './screensaver/PinsVoice';
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
import { useCrisisMapFrameStore } from './ui/uiStore';
import { useRiskReportStore } from './riskreport/riskReportStore';
import { useScreensaverStore } from './screensaver/screensaverStore';
import { useHoverStore } from './screensaver/hoverStore';
import { AuthGate } from './auth/AuthGate';
import { lazyWithReload } from './lib/lazyWithReload';

// Detect share link — renders a completely separate read-only view. Lazy so the
// main bundle doesn't carry the share view or its Leaflet dependency (and the
// share page in turn skips the heavy globe bundle it never renders).
const shareToken = new URLSearchParams(window.location.search).get('share');
const CrisisShareView = lazy(() =>
  import('./crisis/CrisisShareView').then((m) => ({ default: m.CrisisShareView }))
);

// The crisis overlay is a full-screen view that renders nothing until the
// operator opens it, so its whole UI tree stays out of the entry chunk. The
// gate only subscribes to the (eager) store; share-link auto-publish keeps
// running in the always-mounted IncidentSync.
const CrisisOverlay = lazyWithReload(() =>
  import('./crisis/CrisisOverlay').then((m) => ({ default: m.CrisisOverlay }))
);
const RiskReportHost = lazyWithReload(() =>
  import('./riskreport/RiskReportHost').then((m) => ({ default: m.RiskReportHost }))
);

// While a crisis incident is open, the workspace overlay owns the screen and
// this wrapper pins the (single, always-mounted) globe into the dock's map
// window instead of the full viewport. Resizing the container keeps the
// Cesium viewer alive — reparenting would destroy and rebuild it — so camera,
// imagery and layers survive every open/close. z-50 keeps the frame above the
// base HUD (legends are z-30) but below the z-[2000] overlay, whose
// transparent map window is the only place it shows through. Drawing mode
// closes the overlay, so the frame snaps back to full viewport for it.
function GlobeFrame({ viewer, children }: { viewer: Cesium.Viewer | null; children: ReactNode }) {
  const docked = useCrisisStore((s) => s.open && s.activeIncidentId !== null);
  const rect = useCrisisMapFrameStore((s) => s.rect);
  const frame = docked ? rect : null;

  // Kick Cesium after every frame change — its own per-tick size check picks
  // resizes up eventually, but an explicit resize+render avoids a stale
  // stretched frame in requestRenderMode.
  useEffect(() => {
    if (!viewer || viewer.isDestroyed()) return;
    viewer.resize();
    viewer.scene.requestRender();
  }, [viewer, frame]);

  return (
    <div
      className={frame ? 'fixed z-[50] overflow-hidden' : 'absolute inset-0'}
      // Docked: the non-none transform makes this box the containing block for
      // the pick chooser's position:fixed layers, so its canvas-relative click
      // coordinates land inside the dock's map window (same trick as
      // CrisisShareGlobe's frame).
      style={frame ? { left: frame.left, top: frame.top, width: frame.width, height: frame.height, transform: 'translateZ(0)' } : undefined}
    >
      {children}
      <PickChooser bounds={frame ? { width: frame.width, height: frame.height } : undefined} />
    </div>
  );
}

// Height the bottom HUD must clear: the news ticker (which publishes its
// height, safe-area padding included, as --ticker-h) or, without it, the
// home-indicator inset.
const BOTTOM_CLEAR = 'max(var(--ticker-h, 0px), env(safe-area-inset-bottom, 0px))';

// Bottom-center dock: the Earth date bar and the radar scrubber stack here so
// both can be up at once without overlapping. Centred over the map, so on md+
// it's inset past the docked sidebar whenever that shows (the Sidebar hides it
// for the screensaver and hover orbit).
function BottomDock({ children }: { children: ReactNode }) {
  const screensaverActive = useScreensaverStore((s) => s.active);
  const hoverEngaged = useHoverStore((s) => s.active || s.picking);
  const sidebarDocked = !screensaverActive && !hoverEngaged;
  return (
    <div
      className={`pointer-events-none absolute inset-x-0 z-30 flex flex-col items-center gap-2 px-4 ${
        sidebarDocked ? 'md:left-72' : ''
      }`}
      style={{ bottom: `calc(${BOTTOM_CLEAR} + 12px)` }}
    >
      {children}
    </div>
  );
}

function CrisisOverlayGate() {
  const open = useCrisisStore((s) => s.open);
  if (!open) return null;
  return (
    <Suspense fallback={null}>
      <CrisisOverlay />
    </Suspense>
  );
}

function RiskReportGate() {
  const target = useRiskReportStore((s) => s.target);
  if (!target) return null;
  return (
    <Suspense fallback={null}>
      <RiskReportHost />
    </Suspense>
  );
}

export default function App() {
  const [viewer, setViewer] = useState<Cesium.Viewer | null>(null);

  if (shareToken) {
    return (
      <ShareErrorBoundary>
        <Suspense
          fallback={
            <div className="grid h-full place-items-center bg-black text-sm text-white/40">
              Loading shared view…
            </div>
          }
        >
          <CrisisShareView token={shareToken} />
        </Suspense>
      </ShareErrorBoundary>
    );
  }

  return (
    <AuthGate>
    <CesiumContext.Provider value={viewer}>
      {/* bg-black is the fallback; StarField canvas renders on top of it,
          and the transparent Cesium canvas sits above that. */}
      <div className="relative h-full w-full overflow-hidden bg-black">
        <StarField />
        <GlobeFrame viewer={viewer}>
        <CesiumGlobe onReady={setViewer}>
          <RadarLayer />
          <RadarHoverReadout />
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
          <WindProbeController />
          <LightningLayer />
          <FlightLayer />
          <ShipLayer />
          <SatelliteLayer />
          <LocationsLayer />
          <TimeZonesLayer />
          <OsmBuildingsLayer />
          <GoogleEarthLayer />
          <MeasureController />
          <FuelZoneController />
          <CrisisMapLayer />
          <ShipModelLayer />
        </CesiumGlobe>
        </GlobeFrame>
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
        <PinsOverviewSitrep />
        <PinsVoice />
        <ShipShockwave />
        <ScreensaverToast />
        <MeasureOverlay />
        <FuelZoneOverlay />
        <RadarHotkeys />
        {/* Bottom-right HUD stack: legend cards for active layers, then the
            wind probe readout anchored at the bottom of the stack. It sits
            above the bottom dock and, like it, clears the news ticker. Max
            height keeps the whole stack on-screen (short viewports): the
            legend list shrinks and scrolls, the readout keeps its natural
            size. */}
        <div
          className="pointer-events-none absolute right-4 z-30 flex w-[230px] flex-col gap-2"
          style={{ bottom: `calc(${BOTTOM_CLEAR} + 5.5rem)`, maxHeight: `calc(100% - 6.5rem - ${BOTTOM_CLEAR})` }}
        >
          <MapLegends />
          <WindReadout />
          <TimeZonesCredit />
        </div>
        <BottomDock>
          <EarthTimeBar />
          <RadarTimeline />
        </BottomDock>
        <HoverOverlay />
        <NewsTicker />
        <CrisisOverlayGate />
        <CrisisDrawController />
        <CrisisLayerPopup />
        <IncidentSync />
        <RiskReportGate />
      </div>
    </CesiumContext.Provider>
    </AuthGate>
  );
}
