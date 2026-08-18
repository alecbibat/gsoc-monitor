import { useEffect, useRef, useState } from 'react';
import * as Cesium from 'cesium';
import { CesiumContext, useCesiumViewer } from '../cesium/CesiumContext';
import { CesiumGlobe } from '../cesium/CesiumGlobe';
import { useLayersStore } from '../store/layersStore';
import { BASEMAPS } from '../cesium/basemaps';
import type { BasemapId } from '../types';
import type { LocationGroup } from '../layers/locations/locations';
import { makePinIcon } from '../layers/locations/pinIcon';
import { resetCamera } from '../cesium/flyTo';
import { addLayerEntities } from './CrisisMapLayer';
import { shareLiveLayerLabel, type ShareLiveLayerId } from './shareLiveLayers';
import { LAYER_LEGENDS } from '../layers/layerLegends';
import type { DrawLayer } from './crisisStore';
import { RadarLayer } from '../layers/radar/RadarLayer';
import { RadarTimeline } from '../layers/radar/RadarTimeline';
import { PrecipLayer } from '../layers/precip/PrecipLayer';
import { HurricaneLayer } from '../layers/hurricanes/HurricaneLayer';
import { HurricaneTooltip } from '../layers/hurricanes/HurricaneTooltip';
import { LightningLayer } from '../layers/lightning/LightningLayer';
import { LightningHistoryLayer } from '../layers/lightning/LightningHistoryLayer';
import { WindLayer } from '../layers/wind/WindLayer';
import { WindArrowsLayer } from '../layers/wind/WindArrowsLayer';
import { FireLayer } from '../layers/fires/FireLayer';
import { WildfireLayer } from '../layers/wildfires/WildfireLayer';
import { SmokeLayer } from '../layers/smoke/SmokeLayer';
import { AqiLayer } from '../layers/aqi/AqiLayer';
import { FireOutlookLayer } from '../layers/fireOutlook/FireOutlookLayer';
import { FuelLayer } from '../layers/fuel/FuelLayer';
import { AlertsLayer } from '../layers/alerts/AlertsLayer';
import { EarthquakeLayer } from '../layers/earthquakes/EarthquakeLayer';
import { RiversLayer } from '../layers/rivers/RiversLayer';
import { OutageLayer } from '../layers/outages/OutageLayer';
import { NewsMapLayer } from '../layers/newsMap/NewsMapLayer';
import { IntelLayer } from '../layers/intel/IntelLayer';
import { PanelManager } from '../panels/PanelManager';
import { PickChooser } from '../panels/PickChooser';

// The share page is served from the same origin as the operator app, so the
// persisted layersStore would write to the operator's own 'gsoc-layers'
// localStorage key. Redirect persistence to a share-only key before any write —
// this module only ever loads on the share page (lazy import), so the operator
// app is unaffected.
useLayersStore.persist.setOptions({ name: 'gsoc-share-view-layers' });

// Force the layer flags to exactly the given enabled set. Everything else is
// switched off — including whatever the operator's persisted state hydrated
// (the store reads 'gsoc-layers' synchronously at import) and the metered
// layers (earth3d/osmBuildings are never in the prescription, so they land
// false here without a special case).
function applyShareLayerFlags(enabled: ShareLiveLayerId[]) {
  const on = new Set<string>(enabled);
  useLayersStore.setState((s) => ({
    active: Object.fromEntries(
      Object.keys(s.active).map((k) => [k, on.has(k)])
    ) as typeof s.active,
    // "Near internal pins" filtering is an operator concept — share maps always
    // show the global / camera-viewport view of hotspots and news.
    firesNearMiles: 0,
    newsNearMiles: 0,
  }));
}

// A signature of the drawn geometry only, so live snapshot updates that don't
// touch the drawings (log entries, status changes) never redraw the entities.
function drawSignature(layers: DrawLayer[]): string {
  return layers
    .map((l) => `${l.id}:${l.geometry}:${l.directional ? 'dir' : ''}:${l.color}:${l.name}:${l.visible}:${l.positions.map((p) => `${p.lat},${p.lon}`).join('|')}`)
    .join(';');
}

// Frame the combined extent of the visible drawn layers; falls back to the
// shared home view when nothing is drawn. Used for the initial open and the
// Reset control.
function frameDrawnExtent(viewer: Cesium.Viewer, layers: DrawLayer[], fly = false): void {
  const pts = layers.filter((l) => l.visible).flatMap((l) => l.positions);
  if (pts.length === 0) { if (fly) resetCamera(viewer); return; }
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const p of pts) {
    w = Math.min(w, p.lon); e = Math.max(e, p.lon);
    s = Math.min(s, p.lat); n = Math.max(n, p.lat);
  }
  const padLon = Math.max((e - w) * 0.4, 0.4);
  const padLat = Math.max((n - s) * 0.4, 0.4);
  const destination = Cesium.Rectangle.fromDegrees(
    Math.max(-180, w - padLon), Math.max(-90, s - padLat),
    Math.min(180, e + padLon), Math.min(90, n + padLat)
  );
  if (fly) viewer.camera.flyTo({ destination, duration: 1.4 });
  else viewer.camera.setView({ destination });
}

// Incident draw layers (perimeters, staging areas, …) on the share globe,
// reusing the exact entity styling the operator app uses.
function ShareDrawLayers({ layers }: { layers: DrawLayer[] }) {
  const viewer = useCesiumViewer();
  const dsRef = useRef<Cesium.CustomDataSource | null>(null);
  const fittedRef = useRef(false);
  const layersRef = useRef(layers);
  layersRef.current = layers;
  const sig = drawSignature(layers);

  useEffect(() => {
    if (!viewer) return;
    const ds = new Cesium.CustomDataSource('crisis-share-layers');
    dsRef.current = ds;
    viewer.dataSources.add(ds);
    // A replacement viewer (WebGL context-loss rebuild) starts back at the
    // default home view — let the extent fit below run again for it.
    fittedRef.current = false;
    return () => {
      viewer.dataSources.remove(ds, true);
      dsRef.current = null;
    };
  }, [viewer]);

  useEffect(() => {
    const ds = dsRef.current;
    if (!viewer || !ds) return;
    ds.entities.removeAll();
    const visible = layersRef.current.filter((l) => l.visible && l.positions.length > 0);
    visible.forEach((layer) => addLayerEntities(ds, layer));
    viewer.scene.requestRender();

    // Open on the combined extent of the drawings — once, the first time any
    // exist, so later snapshot updates never yank the viewer's camera around.
    if (fittedRef.current) return;
    if (visible.flatMap((l) => l.positions).length === 0) return;
    fittedRef.current = true;
    frameDrawnExtent(viewer, visible);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewer, sig]);

  return null;
}

// Pins for the property groups the incident team prescribed — the same markers
// the operator's locations layer draws, minus its internal detail panels.
function SharePinsLayer({ groups }: { groups: LocationGroup[] }) {
  const viewer = useCesiumViewer();
  const dsRef = useRef<Cesium.CustomDataSource | null>(null);
  const sig = groups.map((g) => g.id).join(',');

  useEffect(() => {
    if (!viewer) return;
    const ds = new Cesium.CustomDataSource('crisis-share-pins');
    dsRef.current = ds;
    viewer.dataSources.add(ds);
    return () => {
      viewer.dataSources.remove(ds, true);
      dsRef.current = null;
    };
  }, [viewer]);

  useEffect(() => {
    const ds = dsRef.current;
    if (!viewer || !ds) return;
    ds.entities.removeAll();
    for (const group of groups) {
      const pin = makePinIcon(group.color);
      for (const loc of group.locations) {
        ds.entities.add({
          // Anchored on the ellipsoid surface with the DEFAULT depth test
          // (no disableDepthTestDistance) — the globe then correctly occludes
          // pins on its far side instead of letting them show through.
          position: Cesium.Cartesian3.fromDegrees(loc.lon, loc.lat, 0),
          billboard: {
            image: pin.url,
            width: pin.width,
            height: pin.height,
            verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          },
          label: {
            text: loc.name,
            font: '600 12px Inter, sans-serif',
            fillColor: Cesium.Color.WHITE.withAlpha(0.92),
            outlineColor: Cesium.Color.BLACK.withAlpha(0.85),
            outlineWidth: 3,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            verticalOrigin: Cesium.VerticalOrigin.TOP,
            pixelOffset: new Cesium.Cartesian2(0, 4),
            distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 2_500_000),
          },
        });
      }
    }
    viewer.scene.requestRender();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewer, sig]);

  return null;
}

// Fly to the centre of a set of property pins, zoomed to fit their spread.
function zoomToPins(viewer: Cesium.Viewer, groups: LocationGroup[]): void {
  const locs = groups.flatMap((g) => g.locations);
  if (locs.length === 0) return;
  const avgLat = locs.reduce((s, l) => s + l.lat, 0) / locs.length;
  const avgLon = locs.reduce((s, l) => s + l.lon, 0) / locs.length;
  // Height from the pins' spread: metres per degree ≈ 111 km, longitude scaled
  // by cos(lat). Clamped so a single-site group still gets a useful close-up.
  const latSpanM = (Math.max(...locs.map((l) => l.lat)) - Math.min(...locs.map((l) => l.lat))) * 111_000;
  const lonSpanM =
    (Math.max(...locs.map((l) => l.lon)) - Math.min(...locs.map((l) => l.lon))) *
    111_000 * Math.cos((avgLat * Math.PI) / 180);
  const height = Math.min(2_500_000, Math.max(80_000, Math.hypot(latSpanM, lonSpanM) * 2.2));
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(avgLon, avgLat, height),
    duration: 1.6,
  });
}

const BASEMAP_ORDER: BasemapId[] = ['dark', 'light', 'satellite', 'topo'];

interface Props {
  liveLayers: ShareLiveLayerId[];
  // Live layers the recipient switched off via the legend chips (owned by the
  // share view so Reset and the chips stay in sync with the drawn-layer list).
  offLive: Set<ShareLiveLayerId>;
  onToggleLive: (id: ShareLiveLayerId) => void;
  onResetLayers: () => void;
  drawLayers: DrawLayer[];
  // Property groups prescribed by the incident team (primary first).
  pinGroups: LocationGroup[];
  primaryGroupId: string | null;
}

export function CrisisShareGlobe({
  liveLayers, offLive, onToggleLive, onResetLayers, drawLayers, pinGroups, primaryGroupId,
}: Props) {
  const [viewer, setViewer] = useState<Cesium.Viewer | null>(null);
  const [controlsOpen, setControlsOpen] = useState(true);
  const basemap = useLayersStore((s) => s.basemap);
  const setBasemap = useLayersStore((s) => s.setBasemap);

  const enabled = liveLayers.filter((id) => !offLive.has(id));
  const live = new Set<ShareLiveLayerId>(enabled);
  const sig = [...enabled].sort().join(',');
  // Color keys for the currently-shown live layers, listed under the globe.
  // Follows the chips: hiding a layer hides its legend too.
  const legends = LAYER_LEGENDS.filter((l) => live.has(l.id as ShareLiveLayerId));

  // Apply the initial state during the first render — before any layer
  // component mounts — so nothing ever flashes the operator's persisted flags
  // or basemap. The basemap is only forced here: after this, the map-type
  // switcher is the recipient's to use.
  useState(() => {
    useLayersStore.setState({ basemap: 'dark' });
    applyShareLayerFlags(enabled);
  });

  // Re-apply when the effective set changes — either the incident team changed
  // the prescription (arrives live via the share SSE stream) or the recipient
  // toggled a legend chip.
  const firstRef = useRef(true);
  useEffect(() => {
    if (firstRef.current) { firstRef.current = false; return; }
    applyShareLayerFlags(enabled);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  const handleZoomToIncident = () => {
    if (!viewer) return;
    // The incident's own property group is the incident location; fall back to
    // all prescribed pins, then to the drawn layers' extent.
    const primary = pinGroups.filter((g) => g.id === primaryGroupId);
    if (primary.length > 0) zoomToPins(viewer, primary);
    else if (pinGroups.length > 0) zoomToPins(viewer, pinGroups);
    else frameDrawnExtent(viewer, drawLayers, true);
  };

  const handleReset = () => {
    onResetLayers();
    useLayersStore.getState().setBasemap('dark');
    // drawLayers may carry viewer-side hides; Reset restores them all, so
    // frame everything the incident team has visible.
    if (viewer) frameDrawnExtent(viewer, drawLayers.map((l) => ({ ...l, visible: true })), true);
  };

  return (
    <div>
      <CesiumContext.Provider value={viewer}>
      <div
        className="relative h-[72vh] min-h-[440px] w-full overflow-hidden rounded-lg border border-white/10"
        // The non-none transform makes this box the containing block for
        // position:fixed descendants (hurricane tooltip, pick chooser), so
        // their canvas-based coordinates line up with the embedded globe
        // instead of the scrolled document viewport.
        style={{ background: '#05070a', transform: 'translateZ(0)' }}
      >
          <CesiumGlobe onReady={setViewer}>
            {live.has('radar') && <RadarLayer />}
            {live.has('precip') && <PrecipLayer />}
            {live.has('hurricanes') && <HurricaneLayer />}
            {live.has('lightning') && <LightningLayer />}
            {live.has('lightning') && <LightningHistoryLayer />}
            {live.has('wind') && <WindLayer />}
            {live.has('windArrows') && <WindArrowsLayer />}
            {live.has('fires') && <FireLayer />}
            {live.has('wildfires') && <WildfireLayer />}
            {live.has('smoke') && <SmokeLayer />}
            {live.has('aqi') && <AqiLayer />}
            {live.has('fireOutlook') && <FireOutlookLayer />}
            {live.has('fuel') && <FuelLayer />}
            {live.has('alerts') && <AlertsLayer />}
            {live.has('earthquakes') && <EarthquakeLayer />}
            {live.has('rivers') && <RiversLayer />}
            {live.has('outages') && <OutageLayer />}
            {live.has('newsMap') && <NewsMapLayer />}
            {live.has('intel') && <IntelLayer />}
            <ShareDrawLayers layers={drawLayers} />
            <SharePinsLayer groups={pinGroups} />
            {live.has('radar') && <RadarTimeline />}
          </CesiumGlobe>
          {live.has('hurricanes') && <HurricaneTooltip />}

          {/* Compact map controls: map style + camera shortcuts. Layer on/off
              toggles live below the frame (legend chips + the Map Layers
              list); property pins are prescribed by the incident team. */}
          <div className="absolute right-3 top-3 z-20 w-56 overflow-hidden rounded-lg border border-white/15 bg-ink-900/95 shadow-2xl backdrop-blur-sm">
            <button
              onClick={() => setControlsOpen((v) => !v)}
              className="flex w-full items-center justify-between px-3 py-2 text-left"
            >
              <span className="text-[11px] font-bold uppercase tracking-wider text-white/70">Map Controls</span>
              <span className="text-[11px] text-white/40">{controlsOpen ? '▾' : '▸'}</span>
            </button>
            {controlsOpen && (
              <div className="space-y-2.5 border-t border-white/10 px-3 py-2.5">
                <div>
                  <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-white/45">Map type</p>
                  <div className="grid grid-cols-2 gap-1.5">
                    {BASEMAP_ORDER.map((id) => (
                      <button
                        key={id}
                        onClick={() => setBasemap(id)}
                        className={`rounded-md px-1.5 py-1.5 text-[11px] font-medium transition ${
                          basemap === id
                            ? 'bg-accent/20 text-accent ring-1 ring-accent/40'
                            : 'bg-white/5 text-white/55 hover:bg-white/10'
                        }`}
                      >
                        {BASEMAPS[id].label}
                      </button>
                    ))}
                  </div>
                </div>
                {pinGroups.length > 0 && (
                  <div>
                    <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-white/45">Property pins</p>
                    <p className="text-[11px] leading-snug text-white/60">
                      {pinGroups.map((g) => `${g.icon} ${g.name}`).join(' · ')}
                    </p>
                  </div>
                )}
                <div className="flex gap-1.5">
                  <button
                    onClick={handleZoomToIncident}
                    className="flex-1 rounded border border-accent/35 bg-accent/10 px-2 py-1.5 text-[11px] font-medium text-accent transition hover:bg-accent/20"
                    title="Zoom to the incident property pins (or the drawn incident area)"
                  >
                    Zoom to Incident
                  </button>
                  <button
                    onClick={handleReset}
                    className="rounded border border-white/15 px-2.5 py-1.5 text-[11px] text-white/60 transition hover:border-white/30 hover:text-white"
                    title="Restore layers, map type and camera"
                  >
                    Reset
                  </button>
                </div>
              </div>
            )}
          </div>

          <PickChooser />
      </div>
      {/* OUTSIDE the transformed wrapper: each floating panel renders its own
          fixed-inset-0 overlay positioned from window coordinates, so it must
          anchor to the real viewport — inside the wrapper, wide screens would
          open panels past the clipped edge. Panels float over the page. */}
      <PanelManager />
      </CesiumContext.Provider>

      {/* Legend of the prescribed live feeds — each chip is a toggle — plus
          manual attribution (the global stylesheet hides Cesium's own credit
          widget). */}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-white/40">Live layers</span>
        {liveLayers.map((id) => {
          const off = offLive.has(id);
          return (
            <button
              key={id}
              onClick={() => onToggleLive(id)}
              aria-pressed={!off}
              title={off ? 'Show layer' : 'Hide layer'}
              className={`rounded-full border px-2 py-0.5 text-[10px] transition ${
                off
                  ? 'border-white/10 text-white/30 hover:border-white/25 hover:text-white/55'
                  : 'border-accent/25 bg-accent/10 text-accent/80 hover:border-accent/50'
              }`}
            >
              {shareLiveLayerLabel(id)}
            </button>
          );
        })}
        <span className="ml-auto text-[9px] text-white/30">
          Click a chip to toggle · drag to explore · © CARTO © OpenStreetMap contributors
        </span>
      </div>

      {/* Color keys for the shown live layers that need one. */}
      {legends.length > 0 && (
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {legends.map(({ id, title, Legend }) => (
            <div key={id} className="rounded-lg border border-white/10 bg-ink-950/60 px-3 pb-2.5 pt-2">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-white/45">
                {title}
              </div>
              <Legend />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
