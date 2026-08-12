// Stage B spike: the GPU render path, behind `?radargl=1`.
//
// This never replaces the imagery path — it draws ON TOP of it below the
// handover altitude and dims the imagery layers to match, so switching the flag
// off leaves Stage A exactly as it was. Its purpose is to produce the four
// go/no-go measurements the plan asks for, on real hardware.

import * as Cesium from 'cesium';
import { useEffect, useRef } from 'react';
import { useCesiumViewer } from '../../../cesium/CesiumContext';
import { useLayersStore } from '../../../store/layersStore';
import { RADAR_MAX_LEVEL } from '../RainViewerImagery';
import { buildTimeline, useRadarStore } from '../radarStore';
import { handoverAt } from './handover';
import { glStats, installGlStatsHook } from './glStats';
import { WeatherPrimitive } from './WeatherPrimitive';

// How often to reconsider the composited region. Recompositing is the
// expensive operation here (two 4096-square stitches), so it is deliberately
// not on the camera-move path.
const REGION_POLL_MS = 700;

export function radarGlEnabled(): boolean {
  try {
    return new URLSearchParams(window.location.search).get('radargl') === '1';
  } catch {
    return false;
  }
}

export function RadarGlSpike() {
  const viewer = useCesiumViewer();
  const active = useLayersStore((s) => s.active.radar);
  const host = useRadarStore((s) => s.host);
  const palette = useRadarStore((s) => s.palette);
  const currentIndex = useRadarStore((s) => s.currentIndex);
  const primitiveRef = useRef<WeatherPrimitive | null>(null);

  useEffect(() => {
    if (!viewer || viewer.isDestroyed() || !active || !host) return;
    installGlStatsHook();
    glStats.enabled = true;
    glStats.reset();
    glStats.gpu = describeContext(viewer);
    glStats.note(
      'Primitive owns the view BELOW 55 km only — labels are hidden close in ' +
        'and visible zoomed out, so the GPU path cannot serve the regional view.'
    );

    const primitive = new WeatherPrimitive(viewer, useRadarStore.getState().palette);
    primitiveRef.current = primitive;

    // Frame rate, sampled from the render loop itself rather than rAF, so it
    // reflects what Cesium actually drew.
    const stopTick = viewer.scene.postRender.addEventListener(() => {
      glStats.tick(performance.now());
    });

    // A context loss destroys and rebuilds the viewer; this effect is torn down
    // and re-run by that path, so reaching here a second time IS the survival
    // signal for criterion 2.
    if (sessionStorage.getItem(LOSS_KEY) === '1') {
      glStats.contextLossSurvived = true;
      sessionStorage.removeItem(LOSS_KEY);
    }
    const onLost = () => sessionStorage.setItem(LOSS_KEY, '1');
    viewer.canvas.addEventListener('webglcontextlost', onLost, false);

    let disposed = false;
    const poll = window.setInterval(() => {
      if (disposed || viewer.isDestroyed()) return;
      const height = viewer.camera.positionCartographic.height;
      const mix = handoverAt(height);
      glStats.cameraHeightM = height;
      glStats.primitive = primitive.snapshot;

      // Only stand in for the imagery path once the primitive genuinely has
      // something to draw. Dimming the tiles behind an empty composite is how
      // the radar disappears entirely.
      const usable = primitive.hasContent;
      const showing = !mix.glIdle && usable;
      primitive.setShow(showing);
      useRadarStore.getState().setGlTileDim(usable ? mix.tiles : 1);
      // Report what was APPLIED, not what the handover asked for — the two
      // differ whenever the composite is too sparse to stand in, and a report
      // that hides that is worse than no report.
      glStats.primitiveVisible = showing;
      glStats.handoverGlAlpha = showing ? mix.gl : 0;
      glStats.handoverTileAlpha = usable ? mix.tiles : 1;
      if (mix.glIdle) return;
      primitive.setAlpha(mix.gl * useRadarStore.getState().opacity);

      const s = useRadarStore.getState();
      const timeline = buildTimeline(s);
      if (timeline.length === 0) return;
      const i = Math.min(Math.max(0, s.currentIndex), timeline.length - 1);
      const next = timeline[Math.min(timeline.length - 1, i + 1)];
      void primitive.update(timeline[i].frame.path, next.frame.path, RADAR_MAX_LEVEL);
    }, REGION_POLL_MS);

    return () => {
      disposed = true;
      window.clearInterval(poll);
      stopTick();
      if (!viewer.isDestroyed()) {
        viewer.canvas.removeEventListener('webglcontextlost', onLost);
      }
      primitive.destroy();
      primitiveRef.current = null;
      // Hand the imagery path back at full strength — otherwise unmounting the
      // spike below the handover would leave the radar permanently dimmed.
      useRadarStore.getState().setGlTileDim(1);
      glStats.enabled = false;
      glStats.primitive = null;
    };
  }, [viewer, active, host]);

  useEffect(() => {
    void primitiveRef.current?.setPalette(palette);
  }, [palette]);

  // With no flow field yet, the blend is the plain dissolve — identical to
  // Stage A, which is exactly the fallback Stage C degrades to.
  useEffect(() => {
    primitiveRef.current?.setBlend(0);
  }, [currentIndex]);

  return null;
}

const LOSS_KEY = 'radar-gl-context-lost';

function describeContext(viewer: Cesium.Viewer): string {
  try {
    // The canvas already carries the live context; asking it avoids reaching
    // into Cesium's private `scene.context`.
    const canvas = viewer.canvas;
    const ctx = (canvas.getContext('webgl2') ??
      canvas.getContext('webgl')) as WebGL2RenderingContext | null;
    if (!ctx) return 'unknown';
    const ext = ctx.getExtension('WEBGL_debug_renderer_info');
    return ext ? String(ctx.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : 'masked';
  } catch {
    return 'unknown';
  }
}
