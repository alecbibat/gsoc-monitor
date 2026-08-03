import { useEffect, useRef, useState } from 'react';
import * as Cesium from 'cesium';
import { CesiumContext, useCesiumViewer } from '../cesium/CesiumContext';
import { CesiumGlobe } from '../cesium/CesiumGlobe';
import { useLayersStore } from '../store/layersStore';
import { addLayerEntities } from './CrisisMapLayer';
import { shareLiveLayerLabel, type ShareLiveLayerId } from './shareLiveLayers';
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

// Force the layer flags to exactly the prescribed set. Everything not
// prescribed is switched off — including whatever the operator's persisted
// state hydrated (the store reads 'gsoc-layers' synchronously at import) and
// the metered layers (earth3d/osmBuildings are never in the prescription, so
// they land false here without a special case).
function applyShareLayerConfig(liveLayers: ShareLiveLayerId[]) {
  const on = new Set<string>(liveLayers);
  useLayersStore.setState((s) => ({
    active: Object.fromEntries(
      Object.keys(s.active).map((k) => [k, on.has(k)])
    ) as typeof s.active,
    basemap: 'dark',
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
    .map((l) => `${l.id}:${l.geometry}:${l.color}:${l.name}:${l.visible}:${l.positions.map((p) => `${p.lat},${p.lon}`).join('|')}`)
    .join(';');
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
    const pts = visible.flatMap((l) => l.positions);
    if (pts.length === 0) return;
    fittedRef.current = true;
    let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
    for (const p of pts) {
      w = Math.min(w, p.lon); e = Math.max(e, p.lon);
      s = Math.min(s, p.lat); n = Math.max(n, p.lat);
    }
    const padLon = Math.max((e - w) * 0.4, 0.4);
    const padLat = Math.max((n - s) * 0.4, 0.4);
    viewer.camera.setView({
      destination: Cesium.Rectangle.fromDegrees(
        Math.max(-180, w - padLon), Math.max(-90, s - padLat),
        Math.min(180, e + padLon), Math.min(90, n + padLat)
      ),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewer, sig]);

  return null;
}

interface Props {
  liveLayers: ShareLiveLayerId[];
  drawLayers: DrawLayer[];
}

export function CrisisShareGlobe({ liveLayers, drawLayers }: Props) {
  const [viewer, setViewer] = useState<Cesium.Viewer | null>(null);
  const live = new Set<ShareLiveLayerId>(liveLayers);
  const sig = [...liveLayers].sort().join(',');

  // Apply the prescription during the first render — before any layer
  // component mounts — so nothing ever flashes the operator's persisted flags
  // or basemap.
  useState(() => applyShareLayerConfig(liveLayers));

  // Re-apply when the incident team changes the prescription (arrives live via
  // the share SSE stream) — layers appear/disappear for viewers in real time.
  const firstRef = useRef(true);
  useEffect(() => {
    if (firstRef.current) { firstRef.current = false; return; }
    applyShareLayerConfig(liveLayers);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  return (
    <div>
      <CesiumContext.Provider value={viewer}>
      <div
        className="relative h-[72vh] min-h-[440px] w-full overflow-hidden rounded-lg border border-white/8"
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
            {live.has('radar') && <RadarTimeline />}
          </CesiumGlobe>
          {live.has('hurricanes') && <HurricaneTooltip />}
          <PickChooser />
      </div>
      {/* OUTSIDE the transformed wrapper: each floating panel renders its own
          fixed-inset-0 overlay positioned from window coordinates, so it must
          anchor to the real viewport — inside the wrapper, wide screens would
          open panels past the clipped edge. Panels float over the page. */}
      <PanelManager />
      </CesiumContext.Provider>

      {/* Passive legend of the prescribed live feeds + manual attribution (the
          global stylesheet hides Cesium's own credit widget). */}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span className="text-[9px] font-semibold uppercase tracking-wider text-white/30">Live layers</span>
        {liveLayers.map((id) => (
          <span
            key={id}
            className="rounded-full border border-accent/25 bg-accent/8 px-2 py-0.5 text-[9px] text-accent/80"
          >
            {shareLiveLayerLabel(id)}
          </span>
        ))}
        <span className="ml-auto text-[8px] text-white/20">
          Drag to explore · click features for details · © CARTO © OpenStreetMap contributors
        </span>
      </div>
    </div>
  );
}
