import * as Cesium from 'cesium';
import { useEffect, useRef } from 'react';
import { useCesiumViewer } from '../../../cesium/CesiumContext';
import { getLabelOverlayInfo } from '../../../cesium/imageryOrder';
import { useLayersStore } from '../../../store/layersStore';
import { buildTimeline, useRadarStore } from '../radarStore';
import { estimateFlow, type FlowField } from './flow';
import { assembleLabelMosaic, assembleRadarMosaic, planExtent, type MosaicExtent } from './mosaic';
import { MorphSheet } from './MorphSheet';
import { useMorphStore } from './state';

// Radar data caps at level 9 (see RainViewerImagery); the mosaic budget keeps
// texture memory bounded (≈16 MB per frame at 2048²).
const MAX_LEVEL = 9;
// Wall-clock per frame interval during morph playback. Slower than the
// dissolve cadence — continuous motion reads best with room to breathe.
const MORPH_FRAME_MS = 1400;
// Camera settle debounce before (re)building mosaics.
const SETTLE_MS = 400;

interface MorphData {
  extentKey: string;
  mosaics: Array<HTMLCanvasElement | null>;
  flows: Array<FlowField | null>;
  frameCount: number;
}

function extentKey(e: MosaicExtent): string {
  return `${e.level}/${e.x0}-${e.x1}/${e.y0}-${e.y1}/${e.tilePx}`;
}

// Continuous, motion-compensated radar playback (zoom.earth-style morphing).
// Owns the playback clock while the camera is settled; the imagery-layer
// dissolve pipeline stays mounted underneath as the instant fallback during
// camera movement or when assembly isn't possible.
export function RadarMorph() {
  const viewer = useCesiumViewer();
  const active = useLayersStore((s) => s.active.radar);
  const host = useRadarStore((s) => s.host);
  const frames = useRadarStore((s) => s.frames);
  const nowcastFrames = useRadarStore((s) => s.nowcastFrames);
  const satelliteFrames = useRadarStore((s) => s.satelliteFrames);
  const mode = useRadarStore((s) => s.mode);
  const windowMinutes = useRadarStore((s) => s.windowMinutes);
  const palette = useRadarStore((s) => s.palette);

  const sheetRef = useRef<MorphSheet | null>(null);
  const dataRef = useRef<MorphData | null>(null);
  const buildSeqRef = useRef(0);
  // Playback position in timeline-frame units (2.25 = 25% between frames 2→3).
  const positionRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const lastTickRef = useRef<number | null>(null);
  const currentPairRef = useRef(-1);
  // Index writes we made ourselves (so the scrub-sync effect can tell user
  // seeks from our own progress updates).
  const selfIndexRef = useRef<number | null>(null);

  const setMorphActive = useMorphStore((s) => s.setActive);

  // Everything lives in one effect keyed by the inputs that force a rebuild;
  // the internal clock and camera watcher are managed imperatively.
  useEffect(() => {
    if (!viewer || viewer.isDestroyed()) return;
    if (!active || !host || mode === 'satellite') {
      setMorphActive(false);
      return;
    }
    const timeline = buildTimeline({ mode: 'radar', frames, nowcastFrames, satelliteFrames, windowMinutes });
    if (timeline.length < 2) {
      setMorphActive(false);
      return;
    }

    const scene = viewer.scene;
    const sheet = sheetRef.current ?? new MorphSheet(scene);
    sheetRef.current = sheet;

    let disposed = false;
    let settleTimer: ReturnType<typeof setTimeout> | null = null;

    const stopClock = () => {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      lastTickRef.current = null;
    };

    const deactivate = () => {
      stopClock();
      sheet.show(false);
      setMorphActive(false);
      scene.requestRender();
    };

    const applyPair = (pair: number) => {
      const d = dataRef.current;
      if (!d) return false;
      const a = d.mosaics[pair];
      const b = d.mosaics[pair + 1];
      const f = d.flows[pair];
      if (!a || !b || !f) return false;
      sheet.setPair(a, b, f.texture, f.maxDisp);
      currentPairRef.current = pair;
      return true;
    };

    const tick = (now: number) => {
      rafRef.current = null;
      if (disposed || viewer.isDestroyed()) return;
      const d = dataRef.current;
      if (!d) return;
      const s = useRadarStore.getState();
      const n = d.frameCount;
      if (s.playing) {
        const last = lastTickRef.current ?? now;
        lastTickRef.current = now;
        positionRef.current = (positionRef.current + (now - last) / MORPH_FRAME_MS) % (n - 1 + 0.999);
      } else {
        lastTickRef.current = now;
      }
      const pair = Math.min(n - 2, Math.floor(positionRef.current));
      if (pair !== currentPairRef.current && !applyPair(pair)) {
        // Pair not assembled (should not happen after full build) — hold.
        rafRef.current = requestAnimationFrame(tick);
        return;
      }
      sheet.setT(positionRef.current - pair);
      sheet.setOpacity(s.opacity);
      sheet.setLabelAlpha(labelAlpha());
      // Keep the timeline UI in sync with morph progress.
      const idx = Math.round(positionRef.current);
      if (idx !== s.currentIndex) {
        selfIndexRef.current = idx;
        s.setCurrentIndex(idx);
      }
      scene.requestRender();
      rafRef.current = requestAnimationFrame(tick);
    };

    const labelAlpha = () => {
      const info = getLabelOverlayInfo();
      return info ? info.alpha : 0;
    };

    const build = async () => {
      const seq = ++buildSeqRef.current;
      const rect = viewer.camera.computeViewRectangle();
      // No usable view rectangle (horizon views) or antimeridian span —
      // stay on the imagery fallback.
      if (!rect || rect.east <= rect.west) {
        deactivate();
        return;
      }
      const extent = planExtent(rect, MAX_LEVEL);
      const key = extentKey(extent);
      let data = dataRef.current;
      const reuse = data && data.extentKey === key && data.frameCount === timeline.length;
      if (!reuse) {
        data = { extentKey: key, mosaics: [], flows: [], frameCount: timeline.length };
        // Assemble every frame's mosaic (tiles come from the browser cache
        // after the first pass), then flows between neighbors.
        for (let i = 0; i < timeline.length; i++) {
          const m = await assembleRadarMosaic(host, timeline[i].frame.path, extent, palette);
          if (disposed || seq !== buildSeqRef.current) return;
          data.mosaics.push(m);
        }
        for (let i = 0; i < timeline.length - 1; i++) {
          const a = data.mosaics[i];
          const b = data.mosaics[i + 1];
          data.flows.push(a && b ? estimateFlow(a, b) : null);
          if (disposed || seq !== buildSeqRef.current) return;
          // Yield between flow computations to keep the main thread breathing.
          await new Promise((r) => setTimeout(r, 0));
        }
        if (disposed || seq !== buildSeqRef.current) return;
        dataRef.current = data;
        sheet.setExtent(extent);
        const info = getLabelOverlayInfo();
        if (info) {
          const labels = await assembleLabelMosaic(info.url, extent);
          if (disposed || seq !== buildSeqRef.current) return;
          sheet.setLabels(labels, info.alpha);
        } else {
          sheet.setLabels(null, 0);
        }
      }
      // Start from the store's current frame so morph resumes where the
      // dissolve left off.
      const s = useRadarStore.getState();
      positionRef.current = Math.min(Math.max(0, s.currentIndex), timeline.length - 1);
      currentPairRef.current = -1;
      const pair = Math.min(timeline.length - 2, Math.floor(positionRef.current));
      if (!applyPair(pair)) {
        deactivate();
        return;
      }
      sheet.setT(positionRef.current - pair);
      sheet.setOpacity(s.opacity);
      sheet.show(true);
      setMorphActive(true);
      stopClock();
      rafRef.current = requestAnimationFrame(tick);
    };

    const onMoveStart = () => {
      if (settleTimer) clearTimeout(settleTimer);
      settleTimer = null;
      deactivate();
    };
    const onMoveEnd = () => {
      if (settleTimer) clearTimeout(settleTimer);
      settleTimer = setTimeout(() => {
        settleTimer = null;
        void build();
      }, SETTLE_MS);
    };
    const removeMoveStart = viewer.camera.moveStart.addEventListener(onMoveStart);
    const removeMoveEnd = viewer.camera.moveEnd.addEventListener(onMoveEnd);

    // User seeks (scrub / timeline click) jump the morph position to the
    // exact frame; our own progress writes are ignored.
    const unsubIndex = useRadarStore.subscribe((s, prev) => {
      if (s.currentIndex === prev.currentIndex) return;
      if (selfIndexRef.current === s.currentIndex) {
        selfIndexRef.current = null;
        return;
      }
      positionRef.current = Math.min(Math.max(0, s.currentIndex), timeline.length - 1);
      const pair = Math.min(timeline.length - 2, Math.floor(positionRef.current));
      if (dataRef.current && applyPair(pair)) {
        sheet.setT(positionRef.current - pair);
        scene.requestRender();
      }
    });

    // Dev-only escape hatch so headless test drivers can pin the morph at an
    // exact position and inspect state.
    if (import.meta.env.DEV) {
      (window as unknown as Record<string, unknown>).__radarMorph = {
        setPosition: (p: number) => {
          const d = dataRef.current;
          if (!d) return false;
          positionRef.current = Math.min(Math.max(0, p), d.frameCount - 1);
          const pair = Math.min(d.frameCount - 2, Math.floor(positionRef.current));
          if (!applyPair(pair)) return false;
          sheet.setT(positionRef.current - pair);
          scene.requestRender();
          return true;
        },
        rebuild: () => void build(),
        state: () => ({
          morphActive: useMorphStore.getState().active,
          pair: currentPairRef.current,
          pos: positionRef.current,
          hasData: !!dataRef.current,
          mosaics: dataRef.current?.mosaics.map((m) => !!m),
          flows: dataRef.current?.flows.map((f) => {
            if (!f) return null;
            let sx = 0;
            let sy = 0;
            let n = 0;
            for (let i = 0; i < f.dx.length; i++) {
              if (f.dx[i] !== 0 || f.dy[i] !== 0) {
                sx += f.dx[i];
                sy += f.dy[i];
                n++;
              }
            }
            return { meanDx: n ? +(sx / n).toFixed(1) : 0, meanDy: n ? +(sy / n).toFixed(1) : 0, nonZero: n };
          }),
        }),
      };
    }

    void build();

    return () => {
      disposed = true;
      buildSeqRef.current++;
      if (settleTimer) clearTimeout(settleTimer);
      removeMoveStart();
      removeMoveEnd();
      unsubIndex();
      stopClock();
      setMorphActive(false);
      if (!viewer.isDestroyed()) {
        sheet.show(false);
        scene.requestRender();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewer, active, host, frames, nowcastFrames, satelliteFrames, mode, windowMinutes, palette]);

  // Full teardown when the component unmounts or the viewer is replaced.
  useEffect(() => {
    return () => {
      dataRef.current = null;
      if (sheetRef.current) {
        sheetRef.current.destroy();
        sheetRef.current = null;
      }
    };
  }, [viewer]);

  return null;
}
