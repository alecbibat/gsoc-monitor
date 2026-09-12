import * as Cesium from 'cesium';
import { useEffect, useRef, useState } from 'react';
import { BASEMAPS } from './basemaps';
import { useEarthBasemapStore } from './earthBasemap';
import { getPanelData } from './entityPanelLink';
import { useLayersStore } from '../store/layersStore';
import { usePanelStore } from '../panels/panelStore';
import { usePickChooserStore, type PanelOpenData } from '../panels/pickChooserStore';
import { useMeasureStore } from '../measure/measureStore';
import { useFuelZoneStore } from '../fuelzone/fuelZoneStore';
import { useHoverStore } from '../screensaver/hoverStore';
import { useScreensaverStore } from '../screensaver/screensaverStore';
import { QUALITY_SETTINGS } from '../perf/perfStore';
import { getGpuInfo, describeGpu } from '../perf/gpuInfo';
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

// Automatic GPU recovery reloads the page to get a fresh graphics process. On a
// transiently-crashing GPU that self-heals; on permanently-broken hardware it
// would reload-loop forever. Bound it: at most 3 reloads in a 2-minute window,
// after which we stop and fall back to the manual recovery overlay. The counter
// lives in sessionStorage so it survives the reload, and is cleared once a
// viewer has run stably (see the decay timer), so normal long-running sessions
// always get a fresh budget.
const RELOAD_KEY = 'cesium-gpu-reloads';
function mayAutoReload(): boolean {
  try {
    const now = Date.now();
    const raw = sessionStorage.getItem(RELOAD_KEY);
    const recent: number[] = (raw ? (JSON.parse(raw) as number[]) : []).filter(
      (t) => now - t < 120_000
    );
    if (recent.length >= 3) return false; // 3 strikes in 2 min — stop the loop
    recent.push(now);
    sessionStorage.setItem(RELOAD_KEY, JSON.stringify(recent));
    return true;
  } catch {
    return true; // no sessionStorage — don't block recovery
  }
}
function clearReloadBudget() {
  try {
    sessionStorage.removeItem(RELOAD_KEY);
  } catch {
    /* ignore */
  }
}

export function CesiumGlobe({ children, onReady }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [viewer, setViewer] = useState<Cesium.Viewer | null>(null);
  const baseLayerRef = useRef<Cesium.ImageryLayer | null>(null);
  const overlayLayerRef = useRef<Cesium.ImageryLayer | null>(null);
  const basemap = useLayersStore((s) => s.basemap);
  // The Earth map type bakes its date + AM/PM pass into the provider URL, so
  // stepping either one must rebuild the base imagery. Collapsed to '' for the
  // stateless basemaps so their rebuild effect never fires on date changes.
  const earthDate = useEarthBasemapStore((s) => s.date);
  const earthPass = useEarthBasemapStore((s) => s.pass);
  const earthKey = basemap === 'earth' ? `${earthDate}|${earthPass}` : '';
  // Always render at max quality — the user-facing quality control was removed.
  const qualityLevel = 'quality' as const;

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
    const mountTime = performance.now();

    let v: Cesium.Viewer;
    try {
      v = new Cesium.Viewer(containerRef.current, {
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
    } catch (err) {
      // Constructing the viewer needs a live WebGL context. Right after a GPU-
      // process crash the context is briefly unavailable and this throws — which
      // would otherwise leave the effect half-run and the view permanently black.
      // Mark the context lost so the auto-reload backstop below takes over (a
      // full page reload always comes up with a fresh GPU process).
      console.error('[cesium] could not create WebGL viewer — scheduling reload', err);
      setContextLost(true);
      return;
    }

    v.scene.requestRenderMode = true;
    v.scene.maximumRenderTimeChange = 1;

    v.scene.globe.enableLighting = true;
    v.scene.globe.baseColor = Cesium.Color.fromCssColorString('#05070a');
    v.scene.globe.depthTestAgainstTerrain = false;
    // preloadAncestors keeps a tile's whole ancestor chain resident as fallback.
    // It was switched on with the gray-ocean fix, but it's the ship orbit's worst
    // enemy: diving from the overview onto a never-loaded patch of open ocean
    // forces Cesium to load that fresh tile column at *every* zoom level at once —
    // a burst of GPU tile uploads the instant the orbit arrives, which is exactly
    // the kind of spike that black-screens weak integrated GPUs. The dark-ocean
    // baseColor blend (below) hides the gray placeholder without it, so keep it off.
    v.scene.globe.preloadAncestors = false;
    v.scene.fog.enabled = true;
    v.scene.skyAtmosphere!.hueShift = -0.05;

    // Transparent background so the StarField canvas shows through.
    v.scene.backgroundColor = new Cesium.Color(0, 0, 0, 0);
    // Replace blurry default star-cube-map with nothing; stars come from StarField.
    if (v.scene.skyBox) v.scene.skyBox.show = false;

    v.camera.setView({
      destination: Cesium.Cartesian3.fromDegrees(HOME_VIEW.lon, HOME_VIEW.lat, HOME_VIEW.height),
    });

    // --- No entity camera-locking ----------------------------------------------
    // Cesium's built-in double-click handler sets viewer.trackedEntity, which
    // moves the camera into that entity's reference frame: the globe then spins
    // around the ship (or pin) forever, and every camera.flyTo — Reset included
    // — is overridden while tracking is on. Nothing here wants that mode, so
    // drop the handler and clear the property if anything else ever sets it.
    v.screenSpaceEventHandler.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
    v.trackedEntity = undefined;
    const untrack = v.trackedEntityChanged.addEventListener(() => {
      if (v!.trackedEntity !== undefined) v!.trackedEntity = undefined;
    });

    // --- Make zoom and rotate distinct gestures --------------------------------
    // Cesium's default wheel/pinch zoom steers toward the cursor / pinch
    // midpoint, so zooming visibly rotates the globe whenever the pointer is
    // off-center — and a two-finger pinch additionally tilts. Split them:
    // drag rotates, wheel zooms straight along the view axis (screen center),
    // pinch only zooms, and tilt stays available on deliberate inputs
    // (middle-drag, or Ctrl+drag).
    const camCtrl = v.scene.screenSpaceCameraController;
    camCtrl.zoomEventTypes = [Cesium.CameraEventType.PINCH]; // wheel is handled manually below
    camCtrl.tiltEventTypes = [
      Cesium.CameraEventType.MIDDLE_DRAG,
      { eventType: Cesium.CameraEventType.LEFT_DRAG, modifier: Cesium.KeyboardEventModifier.CTRL },
      { eventType: Cesium.CameraEventType.RIGHT_DRAG, modifier: Cesium.KeyboardEventModifier.CTRL },
    ];
    const MIN_CAM_H = 150; // meters — don't dive into the ground
    const MAX_CAM_H = 45_000_000;
    camCtrl.minimumZoomDistance = MIN_CAM_H;
    camCtrl.maximumZoomDistance = MAX_CAM_H;

    // Radial wheel zoom: each notch multiplies camera height by a constant
    // factor, so one tick feels the same at street scale and globe scale, and
    // the view never drifts sideways while zooming.
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const cam = v.camera;
      const h = cam.positionCartographic?.height;
      if (h == null || !Number.isFinite(h)) return;
      // Normalize wheels (line deltas) vs. trackpads (pixel deltas), and clamp
      // huge momentum flicks to a sane number of steps.
      const lines = e.deltaMode === WheelEvent.DOM_DELTA_LINE ? e.deltaY : e.deltaY / 100;
      const steps = Math.max(-4, Math.min(4, lines));
      if (steps === 0) return;
      const targetH = Math.min(MAX_CAM_H, Math.max(MIN_CAM_H, h * Math.pow(0.82, -steps)));
      const amount = h - targetH; // >0 → zoom in
      if (amount > 0) cam.zoomIn(amount);
      else if (amount < 0) cam.zoomOut(-amount);
      // zoomIn moves along the view vector, so under tilt the height change is
      // approximate — hard-stop the floor so we can't tunnel under terrain.
      const h2 = cam.positionCartographic?.height;
      if (h2 != null && h2 < MIN_CAM_H) cam.zoomOut(MIN_CAM_H - h2);
      v.scene.requestRender();
    };
    v.canvas.addEventListener('wheel', onWheel, { passive: false });

    v.screenSpaceEventHandler.setInputAction(
      (click: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
        // While the measure tool owns the cursor, don't open entity panels.
        if (useMeasureStore.getState().active) return;
        // Same for the fuel-zone draw tool.
        if (useFuelZoneStore.getState().active) return;
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
      // Leave a breadcrumb so a recurring black-screen is diagnosable: which GPU,
      // how long it survived, what was being asked of it. A short uptime on a
      // software/virtual GPU points at the renderer being too heavy; a loss only
      // while 3D buildings are on points at tile-memory exhaustion.
      const gpu = getGpuInfo();
      console.warn('[cesium] WebGL context lost — rebuilding viewer', {
        gpu: describeGpu(gpu),
        vendor: gpu.vendor,
        maxTextureSize: gpu.maxTextureSize,
        quality: qualityLevel,
        uptimeSec: Math.round((performance.now() - mountTime) / 1000),
        osm3D: useLayersStore.getState().active.osmBuildings,
        google3D: useLayersStore.getState().active.earth3d,
        screensaver: useScreensaverStore.getState().active,
        statusMessage: (e as WebGLContextEvent).statusMessage || '(none)',
      });
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
    // Dev-only escape hatch so headless test drivers (and console debugging)
    // can steer the camera / inspect imagery layers without UI scripting.
    if (import.meta.env.DEV) {
      (window as unknown as Record<string, unknown>).__viewer = v;
      (window as unknown as Record<string, unknown>).Cesium = Cesium;
    }
    onReady?.(v);
    // A fresh viewer is live — drop the recovery overlay. Let the attempt
    // counter decay after a stable spell so an unrelated future loss still
    // gets the full set of retries, and clear the auto-reload budget so a
    // long-running session that crashes much later isn't denied a reload.
    setContextLost(false);
    const decay = setTimeout(() => {
      recoverAttemptsRef.current = 0;
      clearReloadBudget();
    }, 30_000);

    return () => {
      clearTimeout(decay);
      if (recoverTimerRef.current) clearTimeout(recoverTimerRef.current);
      v.canvas.removeEventListener('wheel', onWheel);
      untrack();
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

    // Add the new base imagery at the bottom of the stack and its label
    // overlay at the very top, so the final order is base → data layers
    // (weather etc.) → place labels. Labels above weather keeps city names
    // legible under weather imagery.
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
      layers.raiseToTop(overlayLayer);
    }
    layers.lowerToBottom(baseLayer);

    // Remove the previous layers only after the new ones are in place so the
    // swap doesn't flash the empty globe.
    if (prevOverlay) layers.remove(prevOverlay, true);
    if (prevBase) layers.remove(prevBase, true);

    baseLayerRef.current = baseLayer;
    overlayLayerRef.current = overlayLayer;
    viewer.scene.requestRender();
  }, [viewer, basemap, earthKey]);

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


  // Render quality: graduated trade of anti-aliasing, terrain detail,
  // resolution and atmosphere/lighting for frame rate, driven by the quality
  // slider. The slider is the single, explicit control over render load — there
  // is no automatic GPU-based capping; pick a lighter tier if a weak client
  // struggles.
  useEffect(() => {
    if (!viewer) return;
    const scene = viewer.scene;
    const globe = scene.globe;
    const s = QUALITY_SETTINGS[qualityLevel];
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
    viewer.resolutionScale = s.resolutionScale;
    scene.requestRender();
  }, [viewer, qualityLevel]);

  // Automatic recovery backstop for unattended clients (kiosks / thin clients).
  // The in-place rebuild tries to restore the 3D view on a fresh context, but if
  // the GPU process is still down the rebuild throws or yields another dead
  // context — and we'd otherwise sit on a black screen behind a manual "Reload"
  // button no one is there to press. If `contextLost` hasn't cleared (i.e. a
  // working viewer hasn't taken over) within a few seconds, force a full page
  // reload: that always comes up with a brand-new GPU process and, because the
  // screensaver state isn't persisted, with the screensaver off.
  useEffect(() => {
    if (!contextLost) return;
    const t = window.setTimeout(() => {
      if (mayAutoReload()) {
        console.error('[cesium] graphics did not recover in time — reloading page');
        window.location.reload();
      } else {
        // Out of reload budget — the GPU looks permanently broken. Stop looping
        // and leave the manual recovery overlay up for a human to deal with.
        console.error('[cesium] graphics unrecoverable after repeated reloads — manual reload required');
      }
    }, 7_000);
    return () => window.clearTimeout(t);
  }, [contextLost]);

  // GPU-stall / context-loss watchdog (last-resort recovery).
  //
  // A GPU-process crash on a thin client blacks out the whole page. Sometimes it
  // fires `webglcontextlost` (handled above); sometimes it just stops completing
  // frames while the JS thread keeps running. There's no way to repaint once the
  // compositor is gone, so either signal triggers a full reload to get a fresh
  // GPU context. Two independent detectors, because each covers a gap the other
  // misses:
  //   1. The GL context itself reporting `isContextLost()` — authoritative, and
  //      fires even if the `webglcontextlost` event was missed.
  //   2. The render loop going silent for >8s while a screensaver was driving it
  //      — catches a GPU crash that never reports a lost context.
  useEffect(() => {
    if (!viewer) return;
    const canvas = viewer.canvas;
    let lastFrame = performance.now();
    let lastScreensaver = 0;
    let reloaded = false;
    const off = viewer.scene.postRender.addEventListener(() => {
      lastFrame = performance.now();
    });
    const reload = (why: string) => {
      if (reloaded) return; // navigation is in flight — don't fire twice
      if (!mayAutoReload()) {
        reloaded = true; // budget spent — stop polling, surface the manual overlay
        console.error(`[cesium] ${why}, but out of reload budget — manual reload required`);
        setContextLost(true);
        return;
      }
      reloaded = true;
      console.error(`[cesium] ${why} — reloading`);
      window.location.reload();
    };
    const contextIsLost = (): boolean => {
      try {
        const gl = (canvas.getContext('webgl2') || canvas.getContext('webgl')) as
          | WebGLRenderingContext
          | WebGL2RenderingContext
          | null;
        return gl ? gl.isContextLost() : false;
      } catch {
        return false;
      }
    };
    const id = window.setInterval(() => {
      // (1) Authoritative: a lost context never repaints on its own. Reload
      // regardless of screensaver/visibility.
      if (contextIsLost()) {
        reload('WebGL context reported lost');
        return;
      }
      // (2) Frame-stall during *continuous* rendering only. On weak GPUs the
      // screensaver keeps requestRenderMode = true, so dwell periods produce
      // no frames even with a healthy GPU — gating on recentlyDriven alone
      // would produce false positives during every dwell. Only watch when
      // requestRenderMode = false (the scene is actively rendering every frame).
      // Track when a screensaver last drove continuous mode and keep a brief
      // window afterward — a crash stops the screensaver before we can catch it
      // if we gate purely on "active right now".
      const ss = useScreensaverStore.getState();
      const continuousRender = !viewer.scene.requestRenderMode;
      if (ss.active && continuousRender) lastScreensaver = performance.now();
      const recentlyDriven = performance.now() - lastScreensaver < 12_000;
      if (document.visibilityState !== 'visible' || !recentlyDriven || !continuousRender) {
        lastFrame = performance.now();
        return;
      }
      if (performance.now() - lastFrame > 8_000) {
        reload('render loop stalled >8s during continuous screensaver rendering — GPU likely lost');
      }
    }, 2_000);
    return () => {
      off();
      window.clearInterval(id);
    };
  }, [viewer]);

  return (
    <div ref={containerRef} className="absolute inset-0">
      {children}
      {contextLost && (
        <div className="pointer-events-auto absolute inset-0 z-[5000] flex flex-col items-center justify-center gap-3 bg-ink-950/90 backdrop-blur-sm">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-white/20 border-t-white/70" />
          <div className="text-[13px] font-medium text-white/80">Restarting graphics…</div>
          <div className="max-w-xs text-center text-[11px] leading-snug text-white/40">
            The 3D view lost its GPU context and is rebuilding. If it can&apos;t
            recover in a few seconds it reloads the page automatically.
          </div>
          <div className="max-w-xs text-center text-[10px] leading-snug text-white/25">
            {describeGpu(getGpuInfo())}
            {getGpuInfo().software && ' — hardware acceleration appears to be off'}
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
