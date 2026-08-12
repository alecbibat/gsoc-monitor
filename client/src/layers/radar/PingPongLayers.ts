// Two imagery layers serving a whole radar timeline.
//
// Engine v1 created one Cesium imagery layer per timeline frame — 15–30 layers,
// every one of them fetching, decoding and GPU-uploading tiles whether or not it
// was ever shown, and the whole stack torn down and rebuilt whenever the
// manifest rotated or the palette changed. This owns exactly TWO layers and
// moves them through the timeline:
//
//   front  the layer currently on screen, at the target alpha
//   back   the layer above it, held at alpha 0, loading whatever comes next
//
// Advancing a frame points `back` at it, reloads in place, waits for it to
// settle, ramps its alpha up over the top of `front`, then swaps the roles. The
// incoming layer is always ABOVE the outgoing one, so fading it in never dips
// combined coverage — the same rolling dissolve v1 relied on, minus the stack.

import * as Cesium from 'cesium';
import type { RadarFrame } from '../../types';
import { addImageryBelowLabels } from '../../cesium/imageryOrder';
import type { RadarPaletteId } from './palettes';
import { RadarFrameProvider } from './RainViewerImagery';

// Cesium exposes no "layer ready" event, so readiness is inferred: the
// provider's own in-flight tile count reaching zero AND the globe reporting its
// visible tiles loaded. Both have to hold across consecutive frames, after a
// few frames have passed, because immediately after a reload neither has caught
// up yet — the counter is still zero and `tilesLoaded` still reads true from
// before the reload.
const SETTLE_MIN_TICKS = 3;
const SETTLE_STABLE_TICKS = 2;
// Never block a transition forever. A partially-loaded incoming frame is a far
// better outcome than a timeline that stops advancing, and the tiles that are
// still missing keep their previous content until they arrive.
const SETTLE_TIMEOUT_MS = 4000;

interface Pending {
  frame: RadarFrame;
  fade: boolean;
}

export class PingPongLayers {
  private readonly viewer: Cesium.Viewer;
  private front: Cesium.ImageryLayer;
  private back: Cesium.ImageryLayer;
  private frontProvider: RadarFrameProvider;
  private backProvider: RadarFrameProvider;

  private targetAlpha: number;
  private fadeMs: number;
  private destroyed = false;
  private raf: number | null = null;
  private settleRaf: number | null = null;
  // Latest requested frame. A request arriving mid-transition replaces this
  // rather than queueing, so scrubbing across many frames only ever loads the
  // one the handle actually lands on.
  private wanted: Pending | null = null;
  private running = false;
  // Resolvers for the rAF-driven waits below. Tearing down cancels the frames
  // that would have resolved them, so `destroy` drains this instead — otherwise
  // an in-flight transition's promise never settles and `pump` stays parked on
  // it forever, holding the viewer and both layers alive. StrictMode's
  // double-mount would leak one of these on every mount in dev.
  private readonly waiters = new Set<() => void>();

  constructor(
    viewer: Cesium.Viewer,
    host: string,
    frame: RadarFrame,
    palette: RadarPaletteId,
    alpha: number,
    fadeMs: number
  ) {
    this.viewer = viewer;
    this.targetAlpha = alpha;
    this.fadeMs = fadeMs;

    this.frontProvider = new RadarFrameProvider(host, frame, palette);
    this.backProvider = new RadarFrameProvider(host, frame, palette);
    // Added consecutively, so the two land adjacent in the stack with `back`
    // directly above `front`. Both must be added with show:true — Cesium only
    // wires up `_reload` for layers that were visible when added, and toggling
    // `show` later is a full teardown and refetch. Alpha is the only safe knob.
    this.front = addImageryBelowLabels(viewer, this.frontProvider);
    this.back = addImageryBelowLabels(viewer, this.backProvider);
    this.front.alpha = alpha;
    this.back.alpha = 0;
    viewer.scene.requestRender();
  }

  get currentFramePath(): string {
    return this.frontProvider.framePath;
  }

  destroy(): void {
    this.destroyed = true;
    this.cancelRaf();
    if (!this.viewer.isDestroyed()) {
      this.viewer.imageryLayers.remove(this.front, true);
      this.viewer.imageryLayers.remove(this.back, true);
      this.viewer.scene.requestRender();
    }
  }

  private cancelRaf(): void {
    if (this.raf != null) cancelAnimationFrame(this.raf);
    if (this.settleRaf != null) cancelAnimationFrame(this.settleRaf);
    this.raf = null;
    this.settleRaf = null;
    const waiting = [...this.waiters];
    this.waiters.clear();
    for (const resolve of waiting) resolve();
  }

  // Wrap an rAF-driven wait so it is guaranteed to settle even if teardown
  // cancels the frame that would have finished it.
  private tracked(run: (done: () => void) => void): Promise<void> {
    return new Promise((resolve) => {
      const done = () => {
        this.waiters.delete(done);
        resolve();
      };
      this.waiters.add(done);
      run(done);
    });
  }

  private alive(): boolean {
    return !this.destroyed && !this.viewer.isDestroyed();
  }

  setOpacity(alpha: number): void {
    this.targetAlpha = alpha;
    if (!this.alive()) return;
    // Mid-transition the tween reads targetAlpha itself; only a settled stack
    // needs nudging.
    if (this.raf == null) {
      this.front.alpha = alpha;
      this.back.alpha = 0;
      this.viewer.scene.requestRender();
    }
  }

  setFadeMs(ms: number): void {
    this.fadeMs = ms;
  }

  // Repaint both layers through a new palette. Tiles come back from the
  // worker's field cache, so this costs no network and no decode — and because
  // a reload keeps the old tiles until the new ones are ready, it never blanks.
  setPalette(palette: RadarPaletteId): void {
    if (!this.alive()) return;
    if (this.frontProvider.setPalette(palette)) this.frontProvider.reload();
    if (this.backProvider.setPalette(palette)) this.backProvider.reload();
    this.viewer.scene.requestRender();
  }

  // Show `frame`, dissolving into it when `fade` is set (playback) or snapping
  // when it is not (scrubbing, where the handle must always match the picture).
  showFrame(frame: RadarFrame, fade: boolean): void {
    if (!this.alive()) return;
    this.wanted = { frame, fade };
    void this.pump();
  }

  private async pump(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while (this.alive() && this.wanted && this.wanted.frame.path !== this.currentFramePath) {
        const next = this.wanted;
        await this.transition(next);
        // Anything requested during the transition is picked up on the next
        // pass; if it was superseded again, only the newest target loads.
        if (this.wanted === next) this.wanted = null;
      }
    } finally {
      this.running = false;
    }
  }

  private async transition({ frame, fade }: Pending): Promise<void> {
    // The hidden layer may already hold this frame — scrubbing back and forth
    // across two frames lands here every other move — in which case there is
    // nothing to load and nothing to wait for.
    if (this.backProvider.setFrame(frame)) {
      this.backProvider.reload();
      this.viewer.scene.requestRender();
      await this.waitForSettled(this.backProvider);
      if (!this.alive()) return;
    }

    // If the target moved on while this one was loading, drop the fade and let
    // the next pass take over — dissolving into a frame nobody wants any more
    // just delays the one they do.
    const superseded = this.wanted != null && this.wanted.frame.path !== frame.path;
    if (fade && !superseded) await this.fadeInBack();
    if (!this.alive()) return;

    this.back.alpha = this.targetAlpha;
    this.front.alpha = 0;
    this.swapRoles();
    this.viewer.scene.requestRender();
  }

  // Ramp the incoming layer up over the held one. The outgoing layer stays at
  // full alpha underneath throughout, so coverage never dips mid-dissolve.
  private fadeInBack(): Promise<void> {
    return this.tracked((done) => {
      const t0 = performance.now();
      const tick = () => {
        if (!this.alive()) {
          this.raf = null;
          done();
          return;
        }
        const t = Math.min(1, (performance.now() - t0) / this.fadeMs);
        this.back.alpha = this.targetAlpha * t;
        this.front.alpha = this.targetAlpha;
        this.viewer.scene.requestRender();
        if (t < 1) {
          this.raf = requestAnimationFrame(tick);
        } else {
          this.raf = null;
          done();
        }
      };
      this.raf = requestAnimationFrame(tick);
    });
  }

  // `back` becomes the visible layer; the old `front` becomes the hidden one
  // and must move above it to be ready for the next dissolve. Reordering an
  // imagery layer never refetches its tiles — Cesium only re-sorts the draw
  // order — so this is free.
  private swapRoles(): void {
    const layers = this.viewer.imageryLayers;
    [this.front, this.back] = [this.back, this.front];
    [this.frontProvider, this.backProvider] = [this.backProvider, this.frontProvider];
    // Guarded loop rather than a single raise: another overlay mounting between
    // the pair would otherwise leave them permanently mis-ordered.
    for (let i = 0; i < 4; i++) {
      if (layers.indexOf(this.back) > layers.indexOf(this.front)) break;
      layers.raise(this.back);
    }
  }

  // Resolve once the provider has no tiles outstanding and the globe reports
  // its visible tiles loaded — or once the timeout expires.
  private waitForSettled(provider: RadarFrameProvider): Promise<void> {
    return this.tracked((done) => {
      const t0 = performance.now();
      let ticks = 0;
      let stable = 0;
      const tick = () => {
        if (!this.alive()) {
          this.settleRaf = null;
          done();
          return;
        }
        ticks++;
        // The globe only advances tile loading while it renders, and
        // requestRenderMode means it will not render on its own — so drive it.
        this.viewer.scene.requestRender();
        const quiet = provider.pendingTiles === 0 && this.viewer.scene.globe.tilesLoaded;
        stable = quiet ? stable + 1 : 0;
        const settled = ticks >= SETTLE_MIN_TICKS && stable >= SETTLE_STABLE_TICKS;
        if (settled || performance.now() - t0 > SETTLE_TIMEOUT_MS) {
          this.settleRaf = null;
          done();
          return;
        }
        this.settleRaf = requestAnimationFrame(tick);
      };
      this.settleRaf = requestAnimationFrame(tick);
    });
  }
}
