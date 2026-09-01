import * as Cesium from 'cesium';
import { useEffect, useRef } from 'react';
import { useCesiumViewer } from '../../cesium/CesiumContext';
import { addImageryBelowLabels } from '../../cesium/imageryOrder';
import { useLayersStore } from '../../store/layersStore';
import { api } from '../../api/client';
import { startVisiblePolling } from '../../lib/poll';
import { useRadarStore, buildTimeline, type TimelineSlot } from './radarStore';
import { makeGlobalProvider, makeUsProvider, styleAlphaCeiling } from './providers';
import { SIM } from './sources';

// Playback cadence and the crossfade between frames.
const FRAME_MS = 900;
const FADE_MS = 500;

// One animated source ("channel"): US HD or global. Frame layers are created
// lazily the first time a frame is shown or preloaded, then RETAINED, and
// playback animates ONLY layer alphas. This is load-bearing, not a cache
// nicety: every ImageryLayer add/remove makes Cesium's surface re-attach
// imagery across all rendered globe tiles, and doing that per playback tick
// keeps the quadtree from ever settling (verified empirically — the globe
// stops refining and the radar never draws). After one playback loop the
// stack is stable and ticks touch nothing but alphas. Stack mutations happen
// only when the frame list itself changes (a new frame every 5–10 minutes,
// or a settings change), via syncFrames' diff.
class ChannelRenderer {
  private layers = new Map<string, Cesium.ImageryLayer>();
  private shownKey: string | null = null;
  private fadeRaf: number | null = null;
  private fadeFromKey: string | null = null;
  private fadeToKey: string | null = null;
  private alphaTarget = 1;
  private validKeys: Set<string> | null = null;

  // `insertBelow` pins this channel's layers UNDER another channel's stack:
  // the global channel passes the HD channel's lowest layer so the coarse
  // composite always composites beneath the ~1 km product where their
  // coverage fringes overlap. Without it every new layer lands at the
  // below-labels anchor, i.e. above all earlier radar layers regardless of
  // channel.
  constructor(
    private viewer: Cesium.Viewer,
    private insertBelow?: () => Cesium.ImageryLayer | null
  ) {}

  // The channel's lowest layer in the imagery stack (for insertBelow peers).
  lowestLayer(): Cesium.ImageryLayer | null {
    let lowest: Cesium.ImageryLayer | null = null;
    let lowestIdx = Infinity;
    const stack = this.viewer.imageryLayers;
    for (const l of this.layers.values()) {
      const idx = stack.indexOf(l);
      if (idx >= 0 && idx < lowestIdx) {
        lowestIdx = idx;
        lowest = l;
      }
    }
    return lowest;
  }

  private ensure(key: string, make: () => Cesium.ImageryProvider): Cesium.ImageryLayer {
    let layer = this.layers.get(key);
    if (!layer) {
      const anchor = this.insertBelow?.();
      if (anchor) {
        const idx = this.viewer.imageryLayers.indexOf(anchor);
        layer =
          idx >= 0
            ? this.viewer.imageryLayers.addImageryProvider(make(), idx)
            : addImageryBelowLabels(this.viewer, make());
      } else {
        layer = addImageryBelowLabels(this.viewer, make());
      }
      layer.alpha = 0;
      this.layers.set(key, layer);
    }
    return layer;
  }

  // Frames can leave the timeline while their layer is on screen (the window
  // slides under a paused view); syncFrames must spare those layers, so reap
  // them here as soon as the display moves off them.
  private reapInvalid() {
    if (!this.validKeys || this.viewer.isDestroyed()) return;
    for (const [k, l] of this.layers) {
      if (this.validKeys.has(k)) continue;
      if (k === this.shownKey || k === this.fadeFromKey || k === this.fadeToKey) continue;
      this.viewer.imageryLayers.remove(l, true);
      this.layers.delete(k);
    }
  }

  private cancelFade(finalize: boolean) {
    if (this.fadeRaf != null) {
      cancelAnimationFrame(this.fadeRaf);
      this.fadeRaf = null;
    }
    if (finalize && this.fadeToKey) this.applyInstant(this.fadeToKey);
    this.fadeFromKey = null;
    this.fadeToKey = null;
  }

  private applyInstant(key: string | null) {
    for (const [k, l] of this.layers) l.alpha = k === key ? this.alphaTarget : 0;
    this.shownKey = key;
    this.reapInvalid();
  }

  setAlphaTarget(alpha: number) {
    this.alphaTarget = alpha;
    if (this.fadeRaf == null && this.shownKey) {
      const l = this.layers.get(this.shownKey);
      if (l) l.alpha = alpha;
    }
  }

  show(key: string, make: () => Cesium.ImageryProvider, fade: boolean) {
    if (this.viewer.isDestroyed()) return;
    if (this.fadeToKey === key) return; // already fading to it
    this.cancelFade(true);
    if (this.shownKey === key) {
      const l = this.layers.get(key);
      if (l) l.alpha = this.alphaTarget;
      return;
    }
    const to = this.ensure(key, make);
    const fromKey = this.shownKey;
    const from = fromKey ? this.layers.get(fromKey) : undefined;
    if (!fade || !from) {
      this.applyInstant(key);
      return;
    }
    // Which of the two sits higher in the imagery stack decides the dip-free
    // direction: an incoming layer ABOVE fades in over the held one; an
    // incoming layer BELOW is held at target while the outgoing fades away to
    // reveal it (the loop-wrap case).
    const stack = this.viewer.imageryLayers;
    const incomingAbove = stack.indexOf(to) > stack.indexOf(from);
    if (!incomingAbove) to.alpha = this.alphaTarget;
    this.fadeFromKey = fromKey;
    this.fadeToKey = key;
    this.shownKey = key;
    const t0 = performance.now();
    const tick = () => {
      this.fadeRaf = null;
      if (this.viewer.isDestroyed()) return;
      if (this.fadeToKey !== key) return; // superseded
      const t = Math.min(1, (performance.now() - t0) / FADE_MS);
      if (incomingAbove) to.alpha = this.alphaTarget * t;
      else from.alpha = this.alphaTarget * (1 - t);
      this.viewer.scene.requestRender();
      if (t < 1) {
        this.fadeRaf = requestAnimationFrame(tick);
      } else {
        this.fadeFromKey = null;
        this.fadeToKey = null;
        this.applyInstant(key);
        this.viewer.scene.requestRender();
      }
    };
    this.fadeRaf = requestAnimationFrame(tick);
  }

  // Nothing to display for the current slot (e.g. source has no frame).
  clear() {
    this.cancelFade(false);
    this.applyInstant(null);
  }

  // Warm the next frame's layer (created at alpha 0 so its tiles load early).
  ensurePreload(key: string, make: () => Cesium.ImageryProvider) {
    if (this.viewer.isDestroyed()) return;
    this.ensure(key, make);
  }

  // Reconcile the layer set against the current timeline: drop frames that
  // left it and batch-create the ones it gained (at alpha 0, so their tiles
  // load while playback is elsewhere). One batch mutation per manifest change
  // lets the globe surface re-settle once, instead of once per playback tick
  // as frames appear.
  // Layers currently shown or mid-fade are spared here and reaped by
  // reapInvalid the moment the display moves off them.
  syncFrames(frames: Array<{ key: string; make: () => Cesium.ImageryProvider }>) {
    if (this.viewer.isDestroyed()) return;
    this.validKeys = new Set(frames.map((f) => f.key));
    this.reapInvalid();
    for (const f of frames) this.ensure(f.key, f.make);
  }

  destroy() {
    this.cancelFade(false);
    if (!this.viewer.isDestroyed()) {
      for (const l of this.layers.values()) this.viewer.imageryLayers.remove(l, true);
    }
    this.layers.clear();
    this.shownKey = null;
  }
}

export function RadarLayer() {
  const viewer = useCesiumViewer();
  const active = useLayersStore((s) => s.active.radar);
  const globalHost = useRadarStore((s) => s.globalHost);
  const globalFrames = useRadarStore((s) => s.globalFrames);
  const usFrames = useRadarStore((s) => s.usFrames);
  const coverage = useRadarStore((s) => s.coverage);
  const style = useRadarStore((s) => s.style);
  const windowMinutes = useRadarStore((s) => s.windowMinutes);
  const currentIndex = useRadarStore((s) => s.currentIndex);
  const opacity = useRadarStore((s) => s.opacity);
  const playing = useRadarStore((s) => s.playing);
  const usAvailable = useRadarStore((s) => s.usAvailable);

  const usChannel = useRef<ChannelRenderer | null>(null);
  const globalChannel = useRef<ChannelRenderer | null>(null);

  // Fetch the merged manifest periodically while the layer is on.
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const load = async () => {
      try {
        const manifest = await api.radarManifest(SIM);
        if (!cancelled) useRadarStore.getState().setManifest(manifest);
      } catch (err) {
        console.error('Failed to load radar manifest', err);
      }
    };
    const stopPolling = startVisiblePolling(() => void load(), 2 * 60_000);
    return () => {
      cancelled = true;
      stopPolling();
    };
  }, [active]);

  // (Re)create the channel renderers when the layer/coverage/style flips.
  // A WebGL context loss destroys the viewer before the context value swaps
  // to the rebuilt one, so both the body and the cleanup guard isDestroyed —
  // touching a destroyed viewer's imageryLayers throws and would blank the
  // whole app during the recovery path.
  useEffect(() => {
    if (!viewer || viewer.isDestroyed()) return;
    if (!active) return;
    if (coverage !== 'global') usChannel.current = new ChannelRenderer(viewer);
    // The global channel anchors its layers below the HD channel's, so the
    // coarse composite always draws under the ~1 km product.
    if (coverage !== 'us') {
      globalChannel.current = new ChannelRenderer(
        viewer,
        () => usChannel.current?.lowestLayer() ?? null
      );
    }
    viewer.scene.requestRender();
    return () => {
      usChannel.current?.destroy();
      globalChannel.current?.destroy();
      usChannel.current = null;
      globalChannel.current = null;
      if (!viewer.isDestroyed()) viewer.scene.requestRender();
    };
  }, [viewer, active, coverage, style, globalHost]);

  // Reconcile frame layers with the timeline — only when the frame lists /
  // window actually change, never per playback tick.
  useEffect(() => {
    if (!viewer || viewer.isDestroyed() || !active) return;
    const s = useRadarStore.getState();
    const timeline = buildTimeline(s);
    const maskUs = coverage === 'auto' && s.usAvailable;
    const usSeen = new Set<number>();
    const globalSeen = new Set<string>();
    const usEntries: Array<{ key: string; make: () => Cesium.ImageryProvider }> = [];
    const globalEntries: Array<{ key: string; make: () => Cesium.ImageryProvider }> = [];
    for (const slot of timeline) {
      if (slot.us != null && !usSeen.has(slot.us)) {
        usSeen.add(slot.us);
        const t = slot.us;
        usEntries.push({ key: `us|${style}|${t}`, make: () => makeUsProvider(t, style) });
      }
      if (slot.global != null && s.globalAvailable && !globalSeen.has(slot.global.path)) {
        globalSeen.add(slot.global.path);
        const f = slot.global;
        globalEntries.push({
          key: `rv|${style}|${maskUs ? 'm' : 'f'}|${f.path}`,
          make: () => makeGlobalProvider(s.globalHost, f, style, maskUs),
        });
      }
    }
    usChannel.current?.syncFrames(usEntries);
    globalChannel.current?.syncFrames(globalEntries);
    viewer.scene.requestRender();
  }, [viewer, active, usFrames, globalFrames, globalHost, windowMinutes, coverage, style, usAvailable]);

  // Show the current slot (and preload the next) whenever anything moves.
  // Pure alpha work in the steady state.
  useEffect(() => {
    if (!viewer || viewer.isDestroyed() || !active) return;
    const s = useRadarStore.getState();
    const timeline = buildTimeline(s);
    if (timeline.length === 0) {
      usChannel.current?.clear();
      globalChannel.current?.clear();
      viewer.scene.requestRender();
      return;
    }
    const idx = Math.min(Math.max(0, currentIndex), timeline.length - 1);
    const slot = timeline[idx];
    const next = timeline[(idx + 1) % timeline.length];
    const maskUs = coverage === 'auto' && s.usAvailable;
    // Dissolve only during playback; scrubbing moves faster than any fade, so
    // snap so the frame under the handle is always the one displayed.
    const fade = s.playing;

    const applyChannel = (
      channel: ChannelRenderer | null,
      cur: { key: string; make: () => Cesium.ImageryProvider } | null,
      pre: { key: string; make: () => Cesium.ImageryProvider } | null,
      alpha: number
    ) => {
      if (!channel) return;
      channel.setAlphaTarget(alpha);
      if (cur) channel.show(cur.key, cur.make, fade);
      else channel.clear();
      if (pre && pre.key !== cur?.key) channel.ensurePreload(pre.key, pre.make);
    };

    const alpha = opacity * styleAlphaCeiling(style);
    const usFor = (sl: TimelineSlot) =>
      sl.us != null
        ? { key: `us|${style}|${sl.us}`, make: () => makeUsProvider(sl.us!, style) }
        : null;
    const globalFor = (sl: TimelineSlot) =>
      sl.global != null && s.globalAvailable
        ? {
            key: `rv|${style}|${maskUs ? 'm' : 'f'}|${sl.global.path}`,
            make: () => makeGlobalProvider(s.globalHost, sl.global!, style, maskUs),
          }
        : null;

    applyChannel(usChannel.current, usFor(slot), next !== slot ? usFor(next) : null, alpha);
    applyChannel(
      globalChannel.current,
      globalFor(slot),
      next !== slot ? globalFor(next) : null,
      alpha
    );
    viewer.scene.requestRender();
  }, [
    viewer,
    active,
    currentIndex,
    usFrames,
    globalFrames,
    globalHost,
    coverage,
    style,
    windowMinutes,
    opacity,
    usAvailable,
  ]);

  // Playback ticker.
  useEffect(() => {
    if (!viewer || !active || !playing) return;
    const interval = setInterval(() => {
      const s = useRadarStore.getState();
      const len = buildTimeline(s).length;
      if (len < 2) return;
      s.setCurrentIndex((Math.min(s.currentIndex, len - 1) + 1) % len);
    }, FRAME_MS);
    return () => clearInterval(interval);
  }, [viewer, active, playing]);

  return null;
}
