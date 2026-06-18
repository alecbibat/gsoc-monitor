import * as Cesium from 'cesium';
import { useEffect, useRef, useState } from 'react';
import { BASEMAPS } from './basemaps';
import { getPanelData } from './entityPanelLink';
import { useLayersStore } from '../store/layersStore';
import { usePanelStore } from '../panels/panelStore';
import { usePickChooserStore, type PanelOpenData } from '../panels/pickChooserStore';
import { useMeasureStore } from '../measure/measureStore';
import { useHoverStore } from '../screensaver/hoverStore';
import { useScreensaverStore } from '../screensaver/screensaverStore';
import { usePerfStore, QUALITY_SETTINGS } from '../perf/perfStore';
import { HOME_VIEW } from './flyTo';

interface Props {
  children?: React.ReactNode;
  onReady?: (viewer: Cesium.Viewer | null) => void;
}

function applyAdjust(
  layer: Cesium.ImageryLayer,
  adjust?: { brightness?: number; contrast?: number; saturation?: number; gamma?: number }
) {
  if (!adjust) return;
  if (adjust.brightness != null) layer.brightness = adjust.brightness;
  if (adjust.contrast != null) layer.contrast = adjust.contrast;
  if (adjust.saturation != null) layer.saturation = adjust.saturation;
  if (adjust.gamma != null) layer.gamma = adjust.gamma;
}

// Place-label overlays fade out as the camera descends so town names stop
// scaling up and overlapping terrain at close range, and fade back in for the
// regional/global view where they add context. A smooth alpha ramp (rather than
// a hard show/hide) removes the pop at the boundary.
//
// During the pins screensaver the fade happens far higher up, so the cinematic
// close-ups carry no resizing labels at all while the zoomed-out overview keeps
// them — labels fade out early in the descent, while they're still tiny.
const LABELS_FADE = { near: 55_000,  far: 80_000 };       // normal browsing
const PINS_FADE   = { near: 500_000, far: 1_500_000 };    // pins screensaver

// Overlay alpha (0–1) for a camera height within a fade band.
function labelAlphaAt(height: number, band: { near: number; far: number }): number {
  if (height >= band.far) return 1;
  if (height <= band.near) return 0;
  return (height - band.near) / (band.far - band.near);
}

function currentLabelBand(): { near: number; far: number } {
  const ss = useScreensaverStore.getState();
  return ss.active && ss.mode === 'pins' ? PINS_FADE : LABELS_FADE;
}

export function CesiumGlobe({ children, onReady }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [viewer, setViewer] = useState<Cesium.Viewer | null>(null);
  const baseLayerRef = useRef<Cesium.ImageryLayer | null>(null);
  const overlayLayerRef = useRef<Cesium.ImageryLayer | null>(null);
  const basemap = useLayersStore((s) => s.basemap);
  const qualityLevel = usePerfStore((s) => s.qualityLevel);

  // WebGL context-loss recovery. Bumping recreateKey tears down and rebuilds
  // the viewer on a fresh GPU context; contextLost drives the overlay shown
  // while that happens; recoverAttemptsRef bounds retries so a permanently dead
  // GPU can't loop forever.
  const [recreateKey, setRecreateKey] = useState(0);
  const [contextLost, setContextLost] = useState(false);
  const recoverAttemptsRef = useRef(0);
  const recoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const v = new Cesium.Viewer(containerRef.current, {
      baseLayer: false,
      animation: false,
      timeline: false,
      baseLayerPicker: false,
      geocoder: false,
      homeButton: false,
      sceneModePicker: false,
      navigationHelpButton: false,
      fullscreenButton: false,
      infoBox: false,
      selectionIndicator: false,
      shadows: false,
      // alpha:true lets the WebGL canvas be transparent so our CSS star
      // field shows through wherever there's no globe or UI.
      //
      // NB: preserveDrawingBuffer is deliberately OFF. Turning it on forces the
      // browser to keep the full back buffer every frame, and the extra GPU
      // memory pressure caused the context to be lost (permanent black screen)
      // during the pins screensaver's continuous full-rate zooms. Screenshots
      // (crisis layer thumbnails) instead capture synchronously right after a
      // forced render, which works without it — see CrisisDrawController.
      contextOptions: { webgl: { alpha: true } },
    });

    v.scene.requestRenderMode = true;
    v.scene.maximumRenderTimeChange = 1;

    v.scene.globe.enableLighting = true;
    v.scene.globe.baseColor = Cesium.Color.fromCssColorString('#05070a');
    v.scene.globe.depthTestAgainstTerrain = false;
    v.scene.globe.preloadAncestors = true;
    v.scene.fog.enabled = true;
    v.scene.skyAtmosphere!.hueShift = -0.05;

    // Transparent background so the StarField canvas shows through.
    v.scene.backgroundColor = new Cesium.Color(0, 0, 0, 0);
    // Replace blurry default star-cube-map with nothing; stars come from StarField.
    if (v.scene.skyBox) v.scene.skyBox.show = false;

    v.camera.setView({
      destination: Cesium.Cartesian3.fromDegrees(HOME_VIEW.lon, HOME_VIEW.lat, HOME_VIEW.height),
    });

    v.screenSpaceEventHandler.setInputAction(
      (click: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
        // While the measure tool owns the cursor, don't open entity panels.
        if (useMeasureStore.getState().active) return;
        // While hover mode is waiting for an orbit center, the HoverController
        // consumes the click — don't also open a panel.
        if (useHoverStore.getState().picking) return;

        // drillPick (not pick) so overlapping features — e.g. several stacked
        // NWS alerts — all surface. Dedupe by panel id, keeping topmost order.
        const picked = v.scene.drillPick(click.position, 16);
        const seen = new Set<string>();
        const datas: PanelOpenData[] = [];
        for (const p of picked) {
          const d = getPanelData(p?.id);
          if (d && !seen.has(d.id)) {
            seen.add(d.id);
            datas.push(d);
          }
        }

        const chooser = usePickChooserStore.getState();
        if (datas.length === 0) {
          chooser.hide();
          return;
        }
        if (datas.length === 1) {
          chooser.hide();
          usePanelStore.getState().open(datas[0]);
          v.scene.requestRender();
          return;
        }
        // Several features under one click — let the user choose which to open.
        chooser.show(datas, click.position.x, click.position.y);
      },
      Cesium.ScreenSpaceEventType.LEFT_CLICK
    );

    // ── WebGL context-loss recovery ──────────────────────────────────────────
    // A lost GPU context otherwise leaves Cesium showing a permanent black
    // screen: the browser only ever fires `webglcontextrestored` if the lost
    // event was defaultPrevented, and even then Cesium can't rebuild its GPU
    // resources on the old context. So we preventDefault (to stop the console
    // error storm and signal intent to recover), shed the screensaver's heavy
    // render load, and rebuild the whole viewer on a brand-new context by
    // bumping recreateKey.
    const canvas = v.canvas;
    const onContextLost = (e: Event) => {
      e.preventDefault();
      console.warn('[cesium] WebGL context lost — rebuilding viewer');
      useScreensaverStore.getState().stop();
      setContextLost(true);
      if (recoverAttemptsRef.current < 4) {
        recoverAttemptsRef.current += 1;
        if (recoverTimerRef.current) clearTimeout(recoverTimerRef.current);
        // Small beat so the GPU can settle before we ask it for a fresh context.
        recoverTimerRef.current = setTimeout(() => setRecreateKey((k) => k + 1), 600);
      }
    };
    const onContextRestored = () => {
      console.info('[cesium] WebGL context restored');
    };
    canvas.addEventListener('webglcontextlost', onContextLost, false);
    canvas.addEventListener('webglcontextrestored', onContextRestored, false);

    setViewer(v);
    onReady?.(v);
    // A fresh viewer is live — drop the recovery overlay. Let the attempt
    // counter decay after a stable spell so an unrelated future loss still
    // gets the full set of retries.
    setContextLost(false);
    const decay = setTimeout(() => { recoverAttemptsRef.current = 0; }, 30_000);

    return () => {
      clearTimeout(decay);
      if (recoverTimerRef.current) clearTimeout(recoverTimerRef.current);
      canvas.removeEventListener('webglcontextlost', onContextLost);
      canvas.removeEventListener('webglcontextrestored', onContextRestored);
      onReady?.(null);
      // Drop layer refs so the rebuilt viewer starts from a clean slate rather
      // than trying to remove imagery layers that belonged to the dead viewer.
      baseLayerRef.current = null;
      overlayLayerRef.current = null;
      try { v.destroy(); } catch { /* context may already be gone */ }
      setViewer(null);
    };
  }, [onReady, recreateKey]);

  useEffect(() => {
    if (!viewer) return;
    const layers = viewer.imageryLayers;
    const def = BASEMAPS[basemap];

    const prevBase = baseLayerRef.current;
    const prevOverlay = overlayLayerRef.current;

    // Add the new base imagery and (optionally) its label overlay, then lower
    // each to the bottom so the final stack is base → overlay → data layers.
    const baseLayer = layers.addImageryProvider(def.build());
    applyAdjust(baseLayer, def.adjust);

    let overlayLayer: Cesium.ImageryLayer | null = null;
    if (def.overlay) {
      overlayLayer = layers.addImageryProvider(def.overlay.build());
      applyAdjust(overlayLayer, def.overlay.adjust);
      // Match the new overlay to the current zoom so swapping basemaps while
      // zoomed in doesn't briefly flash labels back on.
      const h = viewer.camera.positionCartographic?.height ?? Number.POSITIVE_INFINITY;
      overlayLayer.alpha = labelAlphaAt(h, currentLabelBand());
      overlayLayer.show = overlayLayer.alpha > 0.001;
      layers.lowerToBottom(overlayLayer);
    }
    layers.lowerToBottom(baseLayer);

    // Remove the previous layers only after the new ones are in place so the
    // swap doesn't flash the empty globe.
    if (prevOverlay) layers.remove(prevOverlay, true);
    if (prevBase) layers.remove(prevBase, true);

    baseLayerRef.current = baseLayer;
    overlayLayerRef.current = overlayLayer;
    viewer.scene.requestRender();
  }, [viewer, basemap]);

  // Smoothly fade the place-label overlay with camera height. Driven from
  // preRender so the alpha ramps every frame during programmatic flights (pin
  // fly-tos, screensaver tours) and interactive zoom — no pop, no stepping.
  useEffect(() => {
    if (!viewer) return;
    const scene = viewer.scene;

    const sync = () => {
      const overlay = overlayLayerRef.current;
      if (!overlay) return;
      const h = viewer.camera.positionCartographic?.height ?? Number.POSITIVE_INFINITY;
      const a = labelAlphaAt(h, currentLabelBand());
      if (Math.abs(a - overlay.alpha) > 0.001) {
        overlay.alpha = a;
        overlay.show = a > 0.001;
      }
    };

    const off = scene.preRender.addEventListener(sync);
    sync();
    return () => off();
  }, [viewer]);

  // During a close ship orbit the camera descends to ~850 m above open ocean.
  // High-zoom ocean tiles are often unavailable, so Cesium shows a gray "no
  // data" placeholder. Switching baseColor to a dark ocean blue makes those
  // gaps invisible — they blend with the surrounding water rather than
  // flashing an ugly gray rectangle.
  useEffect(() => {
    if (!viewer) return;
    const OCEAN   = Cesium.Color.fromCssColorString('#04111f');
    const DEFAULT = Cesium.Color.fromCssColorString('#05070a');
    const update = () => {
      const ss = useScreensaverStore.getState();
      const shipFocus = ss.active && ss.mode === 'pins' && ss.currentPoi?.category === 'ship';
      viewer.scene.globe.baseColor = shipFocus ? OCEAN : DEFAULT;
      viewer.scene.requestRender();
    };
    update();
    const unsub = useScreensaverStore.subscribe(update);
    return () => {
      unsub();
      viewer.scene.globe.baseColor = DEFAULT;
    };
  }, [viewer]);

  // Render quality: graduated trade of resolution, anti-aliasing, terrain detail
  // and atmosphere/lighting for frame rate, driven by the quality slider.
  useEffect(() => {
    if (!viewer) return;
    const scene = viewer.scene;
    const globe = scene.globe;
    const s = QUALITY_SETTINGS[qualityLevel];
    viewer.resolutionScale = s.resolutionScale;
    scene.postProcessStages.fxaa.enabled = s.fxaa;
    try {
      scene.msaaSamples = s.msaa;
    } catch {
      /* MSAA unsupported — ignore */
    }
    globe.maximumScreenSpaceError = s.maximumScreenSpaceError; // coarser = fewer tiles
    globe.enableLighting = s.lighting;
    globe.showGroundAtmosphere = s.atmosphere;
    scene.fog.enabled = s.fog;
    if (scene.skyAtmosphere) scene.skyAtmosphere.show = s.atmosphere;
    scene.requestRender();
  }, [viewer, qualityLevel]);

  return (
    <div ref={containerRef} className="absolute inset-0">
      {children}
      {contextLost && (
        <div className="pointer-events-auto absolute inset-0 z-[5000] flex flex-col items-center justify-center gap-3 bg-ink-950/90 backdrop-blur-sm">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-white/20 border-t-white/70" />
          <div className="text-[13px] font-medium text-white/80">Restarting graphics…</div>
          <div className="max-w-xs text-center text-[11px] leading-snug text-white/40">
            The 3D view lost its GPU context and is rebuilding. If it doesn&apos;t
            come back, reload the page.
          </div>
          <button
            onClick={() => window.location.reload()}
            className="mt-1 rounded border border-white/15 px-3 py-1.5 text-[11px] text-white/55 transition hover:border-white/30 hover:text-white"
          >
            Reload now
          </button>
        </div>
      )}
    </div>
  );
}
