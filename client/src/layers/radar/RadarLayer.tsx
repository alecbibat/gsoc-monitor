import { useEffect, useMemo, useRef } from 'react';
import { useCesiumViewer } from '../../cesium/CesiumContext';
import { useLayersStore } from '../../store/layersStore';
import { api } from '../../api/client';
import { startVisiblePolling } from '../../lib/poll';
import { getGpuInfo } from '../../perf/gpuInfo';
import { prefersReducedMotion } from '../../lib/reducedMotion';
import { useRadarStore } from './radarStore';
import { buildTimeline } from './radarTimeline';
import { RadarEngine, type EngineSettings } from './radarEngine';
import { DEFAULT_TIMING, SNAP_TIMING, type PlaybackTiming } from './radarPlayback';
import { getRadarTileClient } from './radarTileClient';

// RainViewer publishes a frame every 10 minutes and lists it within about a
// minute; the server caches the manifest for 60 s, so polling at the same
// rate shows a new frame within ~2 minutes of capture.
const POLL_MS = 60_000;
// Data-space smoothing radius (source pixels): enough to round off the
// mosaic's pixel steps without softening storm structure.
const SMOOTH_SIGMA = 0.8;

// Render quality.
//   standard — the default: tiles one level coarser than the screen could use
//              (a quarter of the requests against RainViewer's rate limit, and
//              of the GPU memory with 13 frames resident); both settle on the
//              same z7 data when zoomed in, so only mid zooms are softer.
//   sharp    — screen-resolution tiles; four times the requests and memory.
//   lite     — tiles one more level coarser (fewer layer passes and textures)
//              and stepped frames instead of crossfades, for weak or
//              software-rendered GPUs.
// A `gsoc-radar-quality` localStorage value overrides the detection.
type RadarQuality = 'sharp' | 'standard' | 'lite';

function radarQuality(): RadarQuality {
  try {
    const forced = localStorage.getItem('gsoc-radar-quality');
    if (forced === 'sharp' || forced === 'standard' || forced === 'lite') return forced;
  } catch {
    // storage unavailable: fall through to detection
  }
  const gpu = getGpuInfo();
  return gpu.tier === 'low' || gpu.software ? 'lite' : 'standard';
}

function tileWidthFor(q: RadarQuality): 512 | 1024 | 2048 {
  return q === 'sharp' ? 512 : q === 'lite' ? 2048 : 1024;
}

function timingFor(q: RadarQuality): PlaybackTiming {
  return prefersReducedMotion() || q === 'lite' ? SNAP_TIMING : DEFAULT_TIMING;
}

// Animated precipitation radar. React only feeds settings and frames to the
// RadarEngine, which owns the imagery layers, playback and preloading.
export function RadarLayer() {
  const viewer = useCesiumViewer();
  const active = useLayersStore((s) => s.active.radar);
  const host = useRadarStore((s) => s.host);
  const past = useRadarStore((s) => s.past);
  const nowcast = useRadarStore((s) => s.nowcast);
  const windowMinutes = useRadarStore((s) => s.windowMinutes);
  const opacity = useRadarStore((s) => s.opacity);
  const palette = useRadarStore((s) => s.palette);
  const speed = useRadarStore((s) => s.speed);
  const snow = useRadarStore((s) => s.snow);
  const polledAt = useRadarStore((s) => s.polledAt);
  const engineRef = useRef<RadarEngine | null>(null);
  const refetchRef = useRef<() => void>(() => {});
  const activatedAtRef = useRef(0);

  const timeline = useMemo(() => buildTimeline(past, nowcast, windowMinutes), [past, nowcast, windowMinutes]);

  // Poll the manifest while the layer is on.
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const load = async () => {
      try {
        const manifest = await api.radarManifest();
        if (!cancelled) useRadarStore.getState().setManifest(manifest);
      } catch (err) {
        if (!cancelled) {
          useRadarStore.getState().setError(err instanceof Error ? err.message : String(err));
        }
      }
    };
    refetchRef.current = () => void load();
    const stop = startVisiblePolling(() => void load(), POLL_MS);
    return () => {
      cancelled = true;
      refetchRef.current = () => {};
      stop();
    };
  }, [active]);

  // One engine per viewer. A WebGL context loss rebuilds the viewer; the new
  // engine re-creates its layers from the tile worker's caches.
  useEffect(() => {
    if (!viewer || viewer.isDestroyed()) return;
    const s = useRadarStore.getState();
    const quality = radarQuality();
    const settings: EngineSettings = {
      palette: s.palette,
      opacity: s.opacity,
      speed: s.speed,
      snow: s.snow,
      sigma: SMOOTH_SIGMA,
      tileWidth: tileWidthFor(quality),
      timing: timingFor(quality),
      autoplay: !prefersReducedMotion(),
    };
    const engine = new RadarEngine(viewer, getRadarTileClient, settings);
    engineRef.current = engine;
    return () => {
      engine.destroy();
      if (engineRef.current === engine) engineRef.current = null;
    };
  }, [viewer]);

  // Surface RainViewer rate-limit back-off and failing tiles in the sidebar
  // status, re-request the tiles left blank once loading recovers, and
  // refresh the manifest early if a frame's tiles have expired upstream.
  useEffect(() => {
    if (!active) return;
    const client = getRadarTileClient();
    let refetchTimer: ReturnType<typeof setTimeout> | null = null;
    const offStatus = client.onStatus((st) => {
      const store = useRadarStore.getState();
      const recovered = store.tilesFailing && !st.failing;
      store.setCoolingDown(st.coolingDownMs);
      store.setTilesFailing(st.failing);
      if (recovered) engineRef.current?.refreshTiles();
    });
    const offGone = client.onGone(() => {
      if (refetchTimer) return;
      refetchTimer = setTimeout(() => {
        refetchTimer = null;
        refetchRef.current();
      }, 2000);
    });
    return () => {
      offStatus();
      offGone();
      if (refetchTimer) clearTimeout(refetchTimer);
    };
  }, [active]);

  // Stamp real (re)activations only, not a viewer rebuild after context loss.
  useEffect(() => {
    if (active) activatedAtRef.current = Date.now();
  }, [active]);

  useEffect(() => {
    if (!active) useRadarStore.getState().setTilesFailing(false);
    engineRef.current?.setActive(active);
  }, [viewer, active]);

  useEffect(() => {
    if (!active || !host) return;
    // Switched back on after a while off: wait for this activation's first
    // manifest fetch rather than asking for frames that may have expired
    // upstream. If that fetch fails, show the frames we have (expired ones
    // come back "gone" and prompt a refetch).
    const { manifestAt } = useRadarStore.getState();
    if (polledAt < activatedAtRef.current && Date.now() - manifestAt > POLL_MS) return;
    engineRef.current?.setTimeline(host, timeline);
  }, [viewer, active, host, timeline, polledAt]);

  useEffect(() => {
    engineRef.current?.updateSettings({ opacity, palette, speed, snow });
  }, [viewer, opacity, palette, speed, snow]);

  return null;
}
