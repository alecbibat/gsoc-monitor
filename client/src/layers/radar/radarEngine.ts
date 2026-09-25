import * as Cesium from 'cesium';
import { addImageryBelowLabels, stackBelowLabels } from '../../cesium/labelOverlay';
import { blendAlphas, PlaybackClock, type Blend, type PlaybackTiming } from './radarPlayback';
import { radarPlayhead, setRadarController, type RadarController } from './radarPlayhead';
import { RadarImageryProvider, type FrameSource } from './rainviewer';
import type { RadarPaletteId } from './radarPalettes';
import type { RadarTileClient } from './radarTileClient';
import type { TimelineFrame } from './radarTimeline';

// The radar loop's renderer: one Cesium imagery layer per frame, stacked in
// time order under the place labels, all kept loaded, and animated purely by
// layer alpha (show=false would free the textures). A PlaybackClock moves a
// continuous position through the frames and blendAlphas renders it as a
// coverage-preserving crossfade.
//
// The one rule that makes it feel seamless: nothing is ever shown before its
// tiles are loaded for the current view. The loop plays only the run of
// loaded frames ending at the newest one — it starts short and grows as
// older frames arrive — a newly published frame joins once it has loaded,
// and a palette change builds the new layers underneath before swapping.

export interface EngineSettings {
  palette: RadarPaletteId;
  opacity: number;
  speed: number;
  sigma: number;
  snow: boolean;
  tileWidth: 512 | 1024;
  timing: PlaybackTiming;
  autoplay: boolean; // start looping once enough of the loop has loaded
}

interface Frame {
  key: string; // frame time — survives RainViewer re-hashing a frame's path
  time: number;
  forecast: boolean;
  source: FrameSource;
  layer: Cesium.ImageryLayer;
  provider: RadarImageryProvider;
  ready: boolean;
}

const FADE_IN_MS = 450;
const FADE_OUT_MS = 250;
const FADE_IN_ANYWAY_MS = 2500; // show a partly loaded frame rather than nothing
const SETTLE_MS = 220; // pause / step / scrub-release glide
const ADVANCE_MS = 600; // "now" moving onto a newly published frame
const READY_CHECK_MS = 150;
const CAMERA_SETTLE_MS = 350;
const SWAP_TIMEOUT_MS = 5000;
const MAX_DT_MS = 100;
const AUTOPLAY_MIN_FRAMES = 4;
// Typical alpha of a visible echo pixel under our palettes (most echo area is
// light rain, faded in by the palette): with the layer opacity it sets the
// crossfade's coverage compensation (see blendAlphas).
const ECHO_ALPHA = 0.55;
// Keeps the next frame's texture in the draw so the first blend of a step
// doesn't switch shader variants mid-loop; invisible at this strength.
const PREWARM_ALPHA = 0.002;
const ALPHA_QUANTUM = 1 / 512;
// Cesium's ImageryState values: PLACEHOLDER never counts as loaded; FAILED
// and INVALID count as settled (nothing better is coming).
const IMAGERY_FAILED = 5;
const IMAGERY_INVALID = 6;
const MERCATOR_LIMIT = Cesium.Math.toRadians(85.05);

interface ImageryLike {
  imageryLayer: Cesium.ImageryLayer;
  state: number;
  x: number;
  y: number;
  level: number;
}
interface TileImageryLike {
  readyImagery?: ImageryLike;
  loadingImagery?: ImageryLike;
}
interface QuadtreeTileLike {
  rectangle?: Cesium.Rectangle;
  data?: { imagery?: TileImageryLike[] };
}
interface SurfaceLike {
  _tilesToRender?: QuadtreeTileLike[];
  _tileLoadQueueHigh?: QuadtreeTileLike[];
  _tileLoadQueueMedium?: QuadtreeTileLike[];
  _tileLoadQueueLow?: QuadtreeTileLike[];
}

export class RadarEngine implements RadarController {
  private frames: Frame[] = [];
  private incoming: { frames: Frame[]; since: number } | null = null; // double-buffered rebuild
  private host = '';
  private clock: PlaybackClock;
  private settings: EngineSettings;
  private client: RadarTileClient | null = null;

  private active = false;
  private activeSince = 0;
  private master = 0; // overall fade (layer on/off)
  private intent: 'play' | 'pause' = 'pause';
  private autoplayPending: boolean;
  private live = true; // resting on the newest loaded frame, following new ones
  private scrubbing = false;
  private settle: { from: number; to: number; start: number; ms: number } | null = null;
  private windowLo = 0;
  private windowHi = -1;
  private moving = false;
  private settledAt = 0; // when the camera last came to rest
  private dirty = true;
  private lastTick = 0;
  private lastReadyCheck = 0;
  private lastRankSig = '';
  private lastVisibleSig = '';
  private lastAlphas: number[] = [];
  private lastBlend: Blend = { from: -1, to: -1, t: 0 };
  private destroyed = false;
  private readonly unlisten: Array<() => void> = [];

  constructor(
    private viewer: Cesium.Viewer,
    private getClient: () => RadarTileClient,
    settings: EngineSettings
  ) {
    this.settings = settings;
    this.autoplayPending = settings.autoplay;
    this.clock = new PlaybackClock(settings.timing);
    const scene = viewer.scene;
    this.unlisten.push(scene.preUpdate.addEventListener(() => this.tick()));
    this.unlisten.push(scene.postRender.addEventListener(() => this.checkReady()));
    this.unlisten.push(
      scene.camera.moveStart.addEventListener(() => {
        this.moving = true;
      })
    );
    this.unlisten.push(
      scene.camera.moveEnd.addEventListener(() => {
        this.moving = false;
        this.settledAt = performance.now();
        this.kick();
      })
    );
    setRadarController(this);
    if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__radarEngine = this;
  }

  // ── inputs ──────────────────────────────────────────────────────────────

  setActive(active: boolean): void {
    if (this.active === active) return;
    this.active = active;
    if (active) {
      this.activeSince = performance.now();
      this.autoplayPending = this.settings.autoplay;
      this.intent = 'pause';
      this.live = true;
    }
    this.kick();
  }

  // Frames to show, oldest → newest. Layers are keyed by frame time, so a
  // manifest refresh only adds the new frame and drops the expired one.
  setTimeline(host: string, timeline: TimelineFrame[]): void {
    if (this.destroyed || this.viewer.isDestroyed()) return;
    this.discardIncoming();
    if (host !== this.host) {
      this.removeLayers(this.frames);
      this.frames = [];
      this.host = host;
    }
    const old = this.frames;
    const wanted = new Set(timeline.map((t) => String(t.time)));
    const keep: Frame[] = [];
    const drop: Frame[] = [];
    for (const f of old) (wanted.has(f.key) ? keep : drop).push(f);
    this.removeLayers(drop);

    const have = new Map(keep.map((f) => [f.key, f]));
    const next: Frame[] = [];
    for (const t of timeline) {
      const existing = have.get(String(t.time));
      // Re-hashed upstream: keep the loaded layer; new tiles come from the
      // new path (the old one expires).
      if (existing && existing.source.path !== t.frame.path) existing.source.path = t.frame.path;
      next.push(existing ?? this.makeFrame(String(t.time), t));
    }
    next.sort((a, b) => a.time - b.time);
    this.frames = next;
    if (next.length !== keep.length || drop.length > 0) {
      stackBelowLabels(
        this.viewer,
        next.map((f) => f.layer)
      );
    }

    // Keep the picture where it was in time.
    const anchor = keep[0];
    if (anchor && old.length > 0) {
      const delta = next.indexOf(anchor) - old.indexOf(anchor);
      this.clock.remap(next.length, delta);
      if (this.settle) {
        this.settle.from += delta;
        this.settle.to += delta;
      }
      this.windowLo = Math.max(0, this.windowLo + delta);
      this.windowHi = Math.min(next.length - 1, this.windowHi + delta);
    } else {
      this.clock.reset(next.length, Math.max(0, this.newestObserved()));
      this.windowLo = 0;
      this.windowHi = next.length - 1;
    }
    this.recomputeWindow();
    this.client?.retain(next.map((f) => f.key));
    this.lastAlphas = [];
    this.lastRankSig = '';
    this.dirty = true;
    this.kick();
  }

  updateSettings(next: Partial<EngineSettings>): void {
    const prev = this.settings;
    this.settings = { ...prev, ...next };
    if (next.timing && next.timing !== prev.timing) this.clock.setTiming(next.timing);
    const rebuild =
      (next.palette !== undefined && next.palette !== prev.palette) ||
      (next.sigma !== undefined && next.sigma !== prev.sigma) ||
      (next.snow !== undefined && next.snow !== prev.snow) ||
      (next.tileWidth !== undefined && next.tileWidth !== prev.tileWidth);
    if (rebuild && this.frames.length > 0) this.startRebuild();
    this.dirty = true;
    this.kick();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const off of this.unlisten) off();
    this.discardIncoming();
    this.removeLayers(this.frames);
    this.frames = [];
    setRadarController(null, this);
    radarPlayhead.reset();
  }

  // ── commands (timeline, hotkeys) ────────────────────────────────────────

  play(): void {
    if (this.frames.length < 2) return;
    this.intent = 'play';
    this.autoplayPending = false;
    this.scrubbing = false;
    this.settle = null;
    this.live = false;
    const at = this.clock.current().index;
    this.clock.seek(Math.min(Math.max(at, this.windowLo), Math.max(this.windowLo, this.windowHi)));
    this.clock.play();
    this.kick();
  }

  pause(): void {
    this.intent = 'pause';
    this.autoplayPending = false;
    if (this.clock.playing) {
      const cur = this.clock.current();
      this.clock.seek(cur.position);
      this.glideTo(cur.index, SETTLE_MS);
    }
    this.kick();
  }

  toggle(): void {
    if (this.intent === 'play') this.pause();
    else this.play();
  }

  scrub(position: number): void {
    if (this.frames.length === 0) return;
    this.intent = 'pause';
    this.autoplayPending = false;
    this.scrubbing = true;
    this.settle = null;
    this.live = false;
    this.clock.seek(position);
    this.kick();
  }

  endScrub(): void {
    if (!this.scrubbing) return;
    this.scrubbing = false;
    this.glideTo(Math.round(this.clock.current().position), SETTLE_MS);
    this.kick();
  }

  step(delta: number): void {
    const n = this.frames.length;
    if (n === 0) return;
    this.intent = 'pause';
    this.autoplayPending = false;
    const from = this.settle ? this.settle.to : this.clock.current().index;
    this.glideTo(Math.min(n - 1, Math.max(0, from + delta)), SETTLE_MS);
    this.kick();
  }

  latest(): void {
    if (this.frames.length === 0) return;
    this.intent = 'pause';
    this.autoplayPending = false;
    this.glideTo(this.liveIndex(), SETTLE_MS);
    this.live = true;
    this.kick();
  }

  oldest(): void {
    if (this.frames.length === 0) return;
    this.intent = 'pause';
    this.autoplayPending = false;
    this.glideTo(0, SETTLE_MS);
    this.kick();
  }

  // Reflectivity under a point on the frame mostly on screen.
  probe(lon: number, lat: number): Promise<{ dbz: number; snow: boolean } | null> {
    const f = this.frames[this.clock.current().index];
    if (!f || !this.client || !this.active || this.master === 0) return Promise.resolve(null);
    return this.client.probe(f.key, lon, lat);
  }

  // ── internals ───────────────────────────────────────────────────────────

  private makeFrame(key: string, t: TimelineFrame): Frame {
    if (!this.client) this.client = this.getClient();
    const s = this.settings;
    const source: FrameSource = { path: t.frame.path };
    const provider = new RadarImageryProvider({
      host: this.host,
      source,
      frameKey: key,
      palette: s.palette,
      sigma: s.sigma,
      snow: s.snow,
      tileWidth: s.tileWidth,
      client: this.client,
      defer: () => this.shouldDefer(key),
    });
    const layer = addImageryBelowLabels(this.viewer, provider);
    provider.layer = layer;
    layer.alpha = 0;
    return { key, time: t.time, forecast: t.forecast, source, layer, provider, ready: false };
  }

  private removeLayers(frames: Frame[]): void {
    if (this.viewer.isDestroyed()) return;
    for (const f of frames) this.viewer.imageryLayers.remove(f.layer, true);
  }

  // Palette / smoothing / snow / tile density changes: build a fresh stack
  // (the tile worker re-paints from its cache, no network) at alpha 0 and
  // swap once the frame on screen has loaded in it.
  private startRebuild(): void {
    this.discardIncoming();
    const frames = this.frames.map((f) =>
      this.makeFrame(f.key, { frame: { time: f.time, path: f.source.path }, time: f.time, forecast: f.forecast })
    );
    stackBelowLabels(this.viewer, [...this.frames.map((f) => f.layer), ...frames.map((f) => f.layer)]);
    this.incoming = { frames, since: performance.now() };
  }

  private discardIncoming(): void {
    if (!this.incoming) return;
    this.removeLayers(this.incoming.frames);
    this.incoming = null;
  }

  private maybeSwap(now: number): void {
    const inc = this.incoming;
    if (!inc) return;
    const shown = this.clock.current().index;
    if (!inc.frames[shown]?.ready && now - inc.since < SWAP_TIMEOUT_MS) return;
    const old = this.frames;
    this.frames = inc.frames;
    this.incoming = null;
    this.removeLayers(old);
    this.lastAlphas = [];
    this.lastRankSig = '';
    this.recomputeWindow();
    this.dirty = true;
  }

  private newestObserved(): number {
    for (let i = this.frames.length - 1; i >= 0; i--) if (!this.frames[i].forecast) return i;
    return this.frames.length - 1;
  }

  // Where "now" rests: the newest observed frame that has loaded, so a frame
  // RainViewer just published takes over only once it can be drawn.
  private liveIndex(): number {
    const newest = this.newestObserved();
    for (let i = newest; i >= 0; i--) if (this.frames[i].ready) return i;
    return Math.max(0, newest);
  }

  private glideTo(index: number, ms: number): void {
    const from = this.clock.current().position;
    this.settle = Math.abs(from - index) < 1e-6 ? null : { from, to: index, start: performance.now(), ms };
    if (!this.settle) this.clock.seek(index);
    this.live = index === this.liveIndex();
  }

  private shouldDefer(key: string): boolean {
    // While the camera moves, only the frame on screen loads: tiles for views
    // the camera is passing through would spend the rate budget on frames
    // nobody sees.
    if (!this.moving) return false;
    const shown = this.frames[this.clock.current().index];
    return !shown || shown.key !== key;
  }

  private kick(): void {
    if (!this.viewer.isDestroyed()) this.viewer.scene.requestRender();
  }

  // The playable window: the run of loaded frames ending at the newest loaded
  // one.
  private recomputeWindow(): void {
    const n = this.frames.length;
    let hi = -1;
    for (let i = n - 1; i >= 0; i--) {
      if (this.frames[i].ready) {
        hi = i;
        break;
      }
    }
    let lo = hi;
    while (lo > 0 && this.frames[lo - 1].ready) lo--;
    if (hi < 0) lo = 0;
    this.windowLo = lo;
    this.windowHi = hi;
    this.clock.setWindow(lo, hi);
  }

  // Per-frame readiness: every tile Cesium is drawing — and every tile it is
  // loading to replace them — has this layer's own imagery settled (loaded
  // or permanently failed): not a stretched ancestor, not a placeholder, and
  // not nothing. Read from the globe after each render, and only once the
  // camera has settled, so readiness doesn't flicker during refinement.
  private checkReady(): void {
    const now = performance.now();
    if (now - this.lastReadyCheck < READY_CHECK_MS) return;
    this.lastReadyCheck = now;
    const all = this.incoming ? [...this.frames, ...this.incoming.frames] : this.frames;
    if (all.length === 0) return;
    if (this.moving || now - this.settledAt < CAMERA_SETTLE_MS) return;

    const surface = (this.viewer.scene.globe as unknown as { _surface?: SurfaceLike })._surface;
    const rendered = surface?._tilesToRender;
    if (!Array.isArray(rendered)) {
      // Cesium internals changed shape: treat every frame as loaded rather
      // than stalling the loop forever.
      if (all.some((f) => !f.ready)) {
        for (const f of all) f.ready = true;
        this.recomputeWindow();
      }
      return;
    }
    const queued = [
      ...(surface?._tileLoadQueueHigh ?? []),
      ...(surface?._tileLoadQueueMedium ?? []),
      ...(surface?._tileLoadQueueLow ?? []),
    ];
    const index = new Map<Cesium.ImageryLayer, number>();
    all.forEach((f, i) => index.set(f.layer, i));
    const need = new Int32Array(all.length);
    const own = new Int32Array(all.length);
    const seen = new Uint8Array(all.length);
    const bad = new Uint8Array(all.length);
    const visible = new Set<string>();
    const shownLayer = this.frames[this.clock.current().index]?.layer;

    const scan = (tile: QuadtreeTileLike, drawn: boolean) => {
      const list = tile.data?.imagery;
      seen.fill(0);
      bad.fill(0);
      if (list) {
        for (const ti of list) {
          const img = ti.loadingImagery ?? ti.readyImagery;
          if (!img) continue;
          const i = index.get(img.imageryLayer);
          if (i === undefined) continue;
          seen[i] = 1;
          const li = ti.loadingImagery;
          if (li && li.state !== IMAGERY_FAILED && li.state !== IMAGERY_INVALID) bad[i] = 1;
          if (img.imageryLayer === shownLayer) visible.add(`${img.level}/${img.x}/${img.y}`);
        }
      }
      const r = tile.rectangle;
      const beyondMercator = !!r && (r.south >= MERCATOR_LIMIT || r.north <= -MERCATOR_LIMIT);
      for (let i = 0; i < all.length; i++) {
        if (!seen[i]) {
          // A drawn tile with no imagery for this layer yet isn't covered —
          // unless it lies beyond the Web Mercator tiles (the poles).
          if (drawn && !beyondMercator) need[i]++;
          continue;
        }
        need[i]++;
        if (!bad[i]) own[i]++;
      }
    };
    for (const t of rendered) scan(t, true);
    for (const t of queued) scan(t, false);

    let changed = false;
    all.forEach((f, i) => {
      const ready = rendered.length > 0 && need[i] > 0 && own[i] === need[i];
      if (ready !== f.ready) {
        f.ready = ready;
        changed = true;
      }
    });
    if (changed) {
      this.recomputeWindow();
      this.kick();
    }
    const vis = [...visible].sort();
    const visSig = vis.join(',');
    if (this.client && visSig !== this.lastVisibleSig) {
      this.lastVisibleSig = visSig;
      this.client.setVisible(vis);
    }
  }

  // Load order: the frame on screen, then newest → oldest, so the playable
  // loop grows back from the present.
  private updateRanks(index: number): void {
    if (!this.client) return;
    const n = this.frames.length;
    const order: Frame[] = [];
    if (this.frames[index]) order.push(this.frames[index]);
    for (let i = n - 1; i >= 0; i--) if (i !== index) order.push(this.frames[i]);
    const sig = order.map((f) => f.key).join(',');
    if (sig === this.lastRankSig) return;
    this.lastRankSig = sig;
    const ranks: Record<string, number> = {};
    order.forEach((f, k) => (ranks[f.key] = k));
    this.client.setRanks(ranks);
  }

  private tick(): void {
    if (this.destroyed || this.viewer.isDestroyed()) return;
    const now = performance.now();
    const dt = this.lastTick ? Math.min(MAX_DT_MS, now - this.lastTick) : 0;
    this.lastTick = now;
    const n = this.frames.length;

    // Layer on/off fade. Fading in waits for the picture to load so the
    // radar appears in one piece rather than tile by tile (up to a limit).
    const shownReady = this.frames[this.clock.current().index]?.ready ?? false;
    const canShow = this.active && n > 0 && (shownReady || now - this.activeSince > FADE_IN_ANYWAY_MS);
    const masterBefore = this.master;
    if (canShow) this.master = Math.min(1, this.master + dt / FADE_IN_MS);
    else if (!this.active) this.master = Math.max(0, this.master - dt / FADE_OUT_MS);
    if (!this.active && this.master === 0 && n > 0) {
      // Faded out: release the layers (and their GPU memory).
      this.discardIncoming();
      this.removeLayers(this.frames);
      this.frames = [];
      this.clock.reset(0, 0);
      this.windowLo = 0;
      this.windowHi = -1;
      this.lastAlphas = [];
      this.lastRankSig = '';
      radarPlayhead.reset();
      this.kick();
      return;
    }
    if (n === 0) return;
    this.maybeSwap(now);

    const windowSize = this.windowHi >= this.windowLo ? this.windowHi - this.windowLo + 1 : 0;
    // Autoplay once enough of the loop has loaded — opening on the newest
    // frame, then growing as older frames arrive.
    if (
      this.active &&
      this.autoplayPending &&
      !this.scrubbing &&
      !this.settle &&
      windowSize >= 2 &&
      windowSize >= Math.min(AUTOPLAY_MIN_FRAMES, n)
    ) {
      this.autoplayPending = false;
      this.intent = 'play';
      this.live = false;
      this.clock.seek(this.windowHi);
      this.clock.play({ fromHold: true });
    }
    // Playing, but the clock couldn't run yet (too few frames loaded): start
    // it once it can, from the newest frame.
    if (this.intent === 'play' && !this.clock.playing && windowSize >= 2 && !this.scrubbing) {
      this.clock.seek(this.windowHi);
      this.clock.play({ fromHold: true });
    }
    // Resting on "now": move onto a newly published frame once it has loaded.
    if (this.intent === 'pause' && this.live && !this.scrubbing && !this.settle) {
      const target = this.liveIndex();
      const at = this.clock.current().position;
      if (target !== at) this.settle = { from: at, to: target, start: now, ms: ADVANCE_MS };
    }

    if (this.settle) {
      const t = Math.min(1, (now - this.settle.start) / this.settle.ms);
      this.clock.seek(this.settle.from + (this.settle.to - this.settle.from) * t);
      if (t >= 1) {
        this.clock.seek(this.settle.to);
        this.settle = null;
      }
    }

    // The loop holds still while the camera moves (only the frame on screen
    // loads for the new view) and carries on once the camera settles.
    const frame =
      this.clock.playing && !this.moving ? this.clock.tick(dt, this.settings.speed) : this.clock.current();
    this.updateRanks(frame.index);

    const b = frame.blend;
    const blendChanged = b.from !== this.lastBlend.from || b.to !== this.lastBlend.to || b.t !== this.lastBlend.t;
    if (blendChanged || this.master !== masterBefore || this.dirty) {
      this.lastBlend = { ...b };
      this.dirty = false;
      const opacity = this.settings.opacity * this.master;
      const alphas = blendAlphas(n, b, opacity, this.settings.opacity * ECHO_ALPHA);
      if (this.clock.playing && this.master > 0 && b.t === 0) {
        const next = b.from >= this.windowHi ? this.windowLo : b.from + 1;
        if (next >= 0 && next < n && alphas[next] === 0 && this.frames[next].ready) alphas[next] = PREWARM_ALPHA;
      }
      let changed = this.lastAlphas.length !== n;
      for (let i = 0; i < n; i++) {
        const a = Math.round(alphas[i] / ALPHA_QUANTUM) * ALPHA_QUANTUM;
        if (a !== this.lastAlphas[i]) {
          changed = true;
          this.frames[i].layer.alpha = a;
        }
      }
      this.lastAlphas = this.frames.map((f) => f.layer.alpha);
      if (changed) this.viewer.scene.requestRender();
    }

    let ready = 0;
    let readyMask = '';
    for (const f of this.frames) {
      if (f.ready) ready++;
      readyMask += f.ready ? '1' : '0';
    }
    radarPlayhead.set({
      position: frame.position,
      index: frame.index,
      playing: this.intent === 'play',
      buffering: this.intent === 'play' ? !this.clock.playing : this.autoplayPending && this.active,
      ready,
      total: n,
      readyMask,
      live: this.intent === 'pause' && this.live && !this.settle,
    });
  }
}
