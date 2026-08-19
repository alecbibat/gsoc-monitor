import { useEffect, useRef, useState } from 'react';
import * as Cesium from 'cesium';
import { CesiumContext, useCesiumViewer } from '../cesium/CesiumContext';
import { CesiumGlobe } from '../cesium/CesiumGlobe';
import { useLayersStore } from '../store/layersStore';
import { BASEMAPS } from '../cesium/basemaps';
import type { BasemapId } from '../types';
import type { LocationGroup } from '../layers/locations/locations';
import { makePinIcon } from '../layers/locations/pinIcon';
import {
  SHIP_MARKER, shipAlpha, shipHullUri, shipNameLabel, shipReticleUri,
} from '../layers/ships/shipMarkers';
import { createPingPump, pingBillboard } from '../layers/ships/shipPing';
import { isShipGroupId, type IncidentVessel } from './incidentShips';
import { resetCamera } from '../cesium/flyTo';
import { addLayerEntities, layerIdFromEntity } from './CrisisMapLayer';
import { measureLayer } from './layerMeasure';
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
import { MeasureController } from '../measure/MeasureController';
import { MeasureOverlay } from '../measure/MeasureOverlay';
import { useMeasureStore } from '../measure/measureStore';

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

// Click-to-identify for the drawn layers: tap a shape, see what it is and what
// it measures. Read-only — the operator's version of this popup can open the
// incident behind it, which is exactly what a share viewer must not do.
function ShareLayerInspector({
  layers,
  picked,
  onPick,
}: {
  layers: DrawLayer[];
  picked: PickedShareLayer | null;
  onPick: (p: PickedShareLayer | null) => void;
}) {
  const viewer = useCesiumViewer();
  const layersRef = useRef(layers);
  layersRef.current = layers;
  const pickedRef = useRef(picked);
  pickedRef.current = picked;

  useEffect(() => {
    if (!viewer) return;
    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    handler.setInputAction((e: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
      // The measure tool owns the cursor while it's running; a click there is
      // a vertex, not an inspection.
      if (useMeasureStore.getState().active) return;
      const hit = viewer.scene.pick(e.position);
      const layerId = layerIdFromEntity((hit?.id as Cesium.Entity | undefined)?.id);
      const layer = layerId ? layersRef.current.find((l) => l.id === layerId) : null;
      if (layer) onPick({ layerId: layer.id, x: e.position.x, y: e.position.y });
      else if (pickedRef.current) onPick(null);
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
    return () => handler.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewer]);

  return null;
}

// The card itself, positioned inside the map frame at the click point.
function ShareLayerCard({
  layer,
  at,
  frame,
  onClose,
}: {
  layer: DrawLayer;
  at: { x: number; y: number };
  frame: { width: number; height: number };
  onClose: () => void;
}) {
  const measure = measureLayer(layer);
  const CARD_W = 232;
  // Keep the card inside the map frame however close to an edge the click was.
  const left = Math.max(8, Math.min(at.x + 14, frame.width - CARD_W - 8));
  const top = Math.max(8, Math.min(at.y - 8, Math.max(8, frame.height - 150)));

  return (
    <div
      className="absolute z-30 overflow-hidden rounded-xl border border-white/15 bg-ink-950/95 shadow-2xl backdrop-blur-md"
      style={{ left, top, width: CARD_W }}
    >
      <div className="h-1 w-full" style={{ background: layer.color }} />
      <div className="flex items-start gap-2 p-3">
        <div className="mt-0.5 h-3 w-3 shrink-0 rounded-full" style={{ background: layer.color }} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-semibold text-white/90">{layer.name}</div>
          <div className="text-[10px] text-white/40">
            {layer.type} · {layer.geometry === 'line' && layer.directional ? 'directional line' : layer.geometry}
            {' · '}{layer.positions.length} pts
          </div>
          {measure.kind !== 'none' && (
            <div className="mt-1 text-[11px] leading-snug text-accent/85">
              {measure.primary}
              {measure.detail && <div className="text-[10px] text-white/40">{measure.detail}</div>}
            </div>
          )}
        </div>
        <button
          onClick={onClose}
          className="shrink-0 text-[12px] text-white/30 transition hover:text-white/60"
          aria-label="Close"
        >
          <span aria-hidden="true">✕</span>
        </button>
      </div>
    </div>
  );
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

// The incident's vessels as live AIS contacts — the same sonar-contact marker
// the operator's ships layer draws: expanding ping rings, a reticle, the
// heading-rotated hull and a nametag, all sharing the fleet-wide ping clock.
// The frame pump idles whenever no contact is on screen, so an idle share page
// costs a phone nothing.
//
// Only the ships the incident team attached are ever drawn here; the rest of
// the fleet is not part of the share payload.
function ShareShipsLayer({ vessels }: { vessels: IncidentVessel[] }) {
  const viewer = useCesiumViewer();
  const dsRef = useRef<Cesium.CustomDataSource | null>(null);
  const pumpRef = useRef<ReturnType<typeof createPingPump> | null>(null);
  // Positions participate: unlike fixed property pins, a contact must move
  // when the feed reports a new fix.
  const sig = vessels
    .map((v) =>
      v.ship
        ? `${v.roster.mmsi}:${v.ship.latitude}:${v.ship.longitude}:${v.ship.heading ?? ''}:${v.ship.course ?? ''}:${shipAlpha(v.ship.lastSeenSec)}`
        : `${v.roster.mmsi}:none`
    )
    .join('|');

  useEffect(() => {
    if (!viewer) return;
    const ds = new Cesium.CustomDataSource('crisis-share-vessels');
    dsRef.current = ds;
    viewer.dataSources.add(ds);
    pumpRef.current = createPingPump(viewer);
    return () => {
      pumpRef.current?.dispose();
      pumpRef.current = null;
      viewer.dataSources.remove(ds, true);
      dsRef.current = null;
    };
  }, [viewer]);

  useEffect(() => {
    const ds = dsRef.current;
    if (!viewer || !ds) return;
    ds.entities.removeAll();
    for (const v of vessels) {
      // A vessel with no reported position is listed in the report's Vessels
      // card as unknown — it is never pinned at a guessed spot on the map.
      if (!v.ship) continue;
      const { latitude: lat, longitude: lon } = v.ship;
      const bearing = v.ship.heading ?? v.ship.course ?? 0;
      // Same staleness fade as the operator globe: a contact that stopped
      // reporting hours ago must not read as a live fix.
      const alpha = shipAlpha(v.ship.lastSeenSec);
      const tint = Cesium.Color.WHITE.withAlpha(alpha);
      // Rings first: they expand out from under the marker and must not cover
      // it, so they sit lowest in the stack (sub-metre altitude lifts break the
      // depth tie between the billboards stacked on one position).
      for (let ring = 0; ring < SHIP_MARKER.ping.count; ring++) {
        ds.entities.add({
          position: Cesium.Cartesian3.fromDegrees(lon, lat, 0),
          billboard: pingBillboard(v.color, ring, alpha),
        });
      }
      ds.entities.add({
        position: Cesium.Cartesian3.fromDegrees(lon, lat, 1),
        billboard: {
          image: shipReticleUri(v.color, false),
          width: SHIP_MARKER.reticlePx,
          height: SHIP_MARKER.reticlePx,
          color: tint,
          scaleByDistance: SHIP_MARKER.scaleByDistance,
        },
      });
      ds.entities.add({
        position: Cesium.Cartesian3.fromDegrees(lon, lat, 2),
        billboard: {
          image: shipHullUri(v.color, false),
          width: SHIP_MARKER.hullPx,
          height: SHIP_MARKER.hullPx,
          rotation: Cesium.Math.toRadians(-bearing),
          alignedAxis: Cesium.Cartesian3.UNIT_Z,
          color: tint,
          scaleByDistance: SHIP_MARKER.scaleByDistance,
        },
        label: shipNameLabel(v.roster.name, v.color, alpha),
      });
    }
    // Positioned contacts only: the pump idles when none of them is in view.
    pumpRef.current?.setPositions(
      vessels
        .filter((v) => v.ship !== null)
        .map((v) => ({ lon: v.ship!.longitude, lat: v.ship!.latitude }))
    );
    pumpRef.current?.ensure();
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

/** A drawn layer the viewer tapped, with the click point inside the map frame. */
interface PickedShareLayer {
  layerId: string;
  x: number;
  y: number;
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
  // Vessels attached to the incident, with whatever live position the AIS feed
  // has for each (null while none has been reported).
  vessels: IncidentVessel[];
  // The positioned subset of those vessels as a location group, for camera
  // framing. Null until at least one position lands.
  shipGroup: LocationGroup | null;
}

export function CrisisShareGlobe({
  liveLayers, offLive, onToggleLive, onResetLayers, drawLayers, pinGroups, primaryGroupId,
  vessels, shipGroup,
}: Props) {
  const [viewer, setViewer] = useState<Cesium.Viewer | null>(null);
  const [controlsOpen, setControlsOpen] = useState(true);
  const basemap = useLayersStore((s) => s.basemap);
  const setBasemap = useLayersStore((s) => s.setBasemap);
  // Measuring is a viewer-side tool: nothing it draws is published, and it
  // never touches the incident's own layers.
  const measuring = useMeasureStore((s) => s.active);
  const toggleMeasure = useMeasureStore((s) => s.toggle);
  // The drawn layer the viewer last tapped, if it still exists — a live
  // snapshot update can delete the layer out from under an open card.
  const [picked, setPicked] = useState<PickedShareLayer | null>(null);
  const pickedLayer = picked ? drawLayers.find((l) => l.id === picked.layerId) ?? null : null;
  const frameRef = useRef<HTMLDivElement | null>(null);
  const frame = frameRef.current;

  // Leaving the page (or a live update swapping the globe out) must not strand
  // the tool in the store — it is a module singleton.
  useEffect(() => () => { useMeasureStore.getState().exit(); }, []);

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

  // Open framed on the vessels when they are the whole map: drawn layers claim
  // the initial camera when they exist (ShareDrawLayers fits them once), and a
  // vessels-only incident would otherwise open on the default home view with
  // its ships somewhere off-screen. Runs once, when the first position lands,
  // so later fixes never yank a viewer's camera around.
  const shipsFramedRef = useRef(false);
  useEffect(() => {
    if (!viewer || shipsFramedRef.current || !shipGroup) return;
    if (pinGroups.length > 0) return;
    if (drawLayers.some((l) => l.visible && l.positions.length > 0)) return;
    shipsFramedRef.current = true;
    zoomToPins(viewer, [shipGroup]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewer, shipGroup]);

  const handleZoomToIncident = () => {
    if (!viewer) return;
    // The incident's own property group is the incident location; when that
    // property IS the fleet, the vessels are it. Then fall back to all
    // prescribed pins, any positioned vessels, then the drawn layers' extent.
    const primary = pinGroups.filter((g) => g.id === primaryGroupId);
    if (isShipGroupId(primaryGroupId) && shipGroup) zoomToPins(viewer, [shipGroup]);
    else if (primary.length > 0) zoomToPins(viewer, primary);
    else if (pinGroups.length > 0) zoomToPins(viewer, pinGroups);
    else if (shipGroup) zoomToPins(viewer, [shipGroup]);
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
        ref={frameRef}
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
            <ShareShipsLayer vessels={vessels} />
            <ShareLayerInspector layers={drawLayers} picked={picked} onPick={setPicked} />
            <MeasureController />
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
                {vessels.length > 0 && (
                  <div>
                    <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-white/45">Vessels</p>
                    <p className="text-[11px] leading-snug text-white/60">
                      {vessels.map((v) => v.roster.name).join(' · ')}
                    </p>
                    {shipGroup === null && (
                      <p className="text-[10px] leading-snug text-white/35">Waiting for a position report</p>
                    )}
                  </div>
                )}
                <button
                  onClick={() => { setPicked(null); toggleMeasure(); }}
                  aria-pressed={measuring}
                  className={`w-full rounded border px-2 py-1.5 text-[11px] font-medium transition ${
                    measuring
                      ? 'border-accent/50 bg-accent/20 text-accent'
                      : 'border-white/15 text-white/60 hover:border-white/30 hover:text-white'
                  }`}
                  title="Measure distance between points, the length of a path, or the radius of a circle"
                >
                  {measuring ? 'Measuring — tap to stop' : 'Measure distance'}
                </button>
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
          {picked && pickedLayer && frame && (
            <ShareLayerCard
              layer={pickedLayer}
              at={picked}
              frame={{ width: frame.clientWidth, height: frame.clientHeight }}
              onClose={() => setPicked(null)}
            />
          )}
          {/* Anchored to the map frame (which is position:relative), so the
              readout sits over the globe rather than the whole report. */}
          <MeasureOverlay />
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
