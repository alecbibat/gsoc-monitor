import * as Cesium from 'cesium';
import { addImageryBelowLabels } from '../../cesium/labelOverlay';
import { blendAlphas, PlaybackClock, type Blend, type PlaybackTiming } from './radarPlayback';
import { radarPlayhead, setRadarController, type RadarController } from './radarPlayhead';
import { RadarImageryProvider, type FrameSource, type RequestStamp } from './rainviewer';
import type { RadarPaletteId } from './radarPalettes';
import type { RadarTileClient } from './radarTileClient';
import type { TimelineFrame } from './radarTimeline';

// The radar loop's renderer: one Cesium imagery layer per frame, stacked in
// time order under the place labels, all kept loaded, and animated purely by
// layer alpha (show=false would free the textures). A PlaybackClock moves a
// continuous position through the frames and blendAlphas renders it as a
// coverage-preserving crossfade.
//
// What makes it feel seamless: the loop only plays through frames whose
// tiles are loaded for the current view. It plays the run of loaded frames
// ending at the newest one — starting short and growing as older frames
// arrive — holds still while the camera moves and until the new view has
// been checked, a newly published frame joins once it has loaded, and a
// palette change builds the new layers underneath before swapping. (Only an
// explicit step or scrub by the user can show a frame that is still loading.)

export interface EngineSettings {
  palette: RadarPaletteId;
  opacity: number;
  speed: number;
  sigma: number;
  snow: boolean;
  tileWidth: 512 | 1024 | 2048;
  timing: PlaybackTiming;
  autoplay: boolean; // start looping once enough of the loop has loaded
}

interface Frame {
  key: string; // frame identity: time, path and kind (observed / forecast)
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
// Motion longer than this (a screensaver orbit, a long flight) is treated as
// the new normal: the loop keeps playing over whatever is loaded.
const MAX_MOTION_HOLD_MS = 1500;
const SWAP_TIMEOUT_MS = 5000;
const MAX_DT_MS = 100;
const AUTOPLAY_MIN_FRAMES = 4;
// Alpha changes redraw the whole globe; a crossfade reads just as smooth at
// 30 updates a second as at the display's 60-144. Kept clear of whole frame
// counts (2 frames at 60 Hz, 4 at 120 are 33.3 ms; 5 at 144 is 34.7 ms) so
// jitter between frames doesn't push some updates out a frame.
const MIN_BLEND_REDRAW_MS = 31;
// A request is cancelled once it has been missing from this many readiness
// scans (and is at least this old): the tile has left the view.
const UNWANTED_SCANS = 3;
const UNWANTED_MIN_AGE_MS = 1000;
// Typical alpha of a visible echo pixel under our palettes (most echo area is
// light rain, faded in by the palette): with the layer opacity it sets the
// crossfade's coverage compensation (see blendAlphas).
const ECHO_ALPHA = 0.55;
// Keeps the next frame's texture in the draw so the first blend of a step
// doesn't switch shader variants mid-loop; invisible at this strength.
const PREWARM_ALPHA = 0.002;
const ALPHA_QUANTUM = 1 / 512;
// Cesium's ImageryState values: FAILED and INVALID count as settled (nothing
// better is coming); PLACEHOLDER and anything still loading do not.
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

function frameKeyOf(t: TimelineFrame): string {
  return `${t.forecast ? 'f' : 'o'}:${t.time}:${t.frame.path}`;
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
  private moving = false;
  private movingSince = 0;
  private settledAt = 0; // when the camera last came to rest
  private readinessStale = false; // camera moved; the loop waits for a fresh scan
  private dirty = true;
  private lastTick = 0;
  private lastReadyCheck = 0;
  private lastRankSig = '';
  private lastVisibleSig = '';
  private lastAlphas: number[] = [];
  private lastBlend: Blend = { from: -1, to: -1, t: 0 };
  private lastRedraw = 0;
  private scanCount = 0;
  private wantedNow = new Set<string>();
  private wantedPrev = new Set<string>();
  private wantedOlder = new Set<string>();
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
    const camera = viewer.scene.camera;
    this.unlisten.push(viewer.scene.preUpdate.addEventListener(() => this.tick()));
    this.unlisten.push(
      camera.moveStart.addEventListener(() => {
        this.moving = true;
        this.movingSince = performance.now();
        this.readinessStale = true;
      })
    );
    this.unlisten.push(
      camera.moveEnd.addEventListener(() => {
        this.moving = false;
        this.settledAt = performance.now();
        this.kick();
      })
    );
    setRadarController(this);
    if (import.meta.env.DEV && typeof window !== 'undefined') {
      (window as unknown as Record<string, unknown>).__radarEngine = this;
    }
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

  // Frames to show, oldest → newest. Layers are keyed by frame, so a
  // manifest refresh only adds the new frame and drops the expired one.
  setTimeline(host: string, timeline: TimelineFrame[]): void {
    if (this.destroyed || this.viewer.isDestroyed()) return;
    if (
      host === this.host &&
      timeline.length === this.frames.length &&
      timeline.every((t, i) => frameKeyOf(t) === this.frames[i].key)
    ) {
      return; // unchanged (a manifest poll with nothing new)
    }
    const rebuilding = this.incoming !== null;
    this.discardIncoming();
    const shownTime = this.frames[this.clock.current().index]?.time ?? null;
    const settleTime =
      this.settle && this.frames[Math.round(this.settle.to)] ? this.frames[Math.round(this.settle.to)].time : null;
    const old = this.frames;
    if (host !== this.host) {
      this.removeLayers(old);
      this.frames = [];
      this.host = host;
    }

    const wanted = new Map(timeline.map((t) => [frameKeyOf(t), t]));
    const keep: Frame[] = [];
    const drop: Frame[] = [];
    for (const f of this.frames) (wanted.has(f.key) ? keep : drop).push(f);
    this.removeLayers(drop);
    const have = new Map(keep.map((f) => [f.key, f]));
    const next: Frame[] = [];
    for (const t of timeline) {
      const key = frameKeyOf(t);
      next.push(have.get(key) ?? this.addFrame(key, t, next, keep));
    }
    this.frames = next;

    if (keep.length === 0) {
      // Nothing carried over (first load, host change, a long-asleep tab):
      // start over on "now", fading in once it has loaded.
      this.clock.reset(next.length, Math.max(0, this.newestObserved()));
      this.master = 0;
      this.activeSince = performance.now();
      this.settle = null;
      this.live = true;
    } else {
      // Keep the picture where it was in time. If the frame on screen has
      // expired, shift with the frames that stayed (the clock then carries
      // on from the oldest rather than jumping a frame ahead).
      const at = shownTime === null ? -1 : next.findIndex((f) => f.time === shownTime);
      const delta = at >= 0 ? at - this.clock.current().index : next.indexOf(keep[0]) - old.indexOf(keep[0]);
      this.clock.remap(next.length, delta);
      if (this.settle) {
        const to = settleTime === null ? this.settle.to + delta : this.indexNear(settleTime);
        this.settle = { ...this.settle, from: this.settle.from + delta, to };
      }
    }
    this.recomputeWindow();
    this.client?.retain(next.map((f) => f.key));
    // A rebuild in progress restarts over the new frame set — unless nothing
    // was carried over, in which case every layer is already new.
    if (rebuilding && keep.length > 0 && next.length > 0) this.startRebuild();
    this.lastAlphas = [];
    this.lastRankSig = '';
    this.dirty = true;
    this.kick();
  }

  updateSettings(next: Partial<EngineSettings>): void {
    const prev = this.settings;
    this.settings = { ...prev, ...next };
    const rebuild =
      (next.palette !== undefined && next.palette !== prev.palette) ||
      (next.snow !== undefined && next.snow !== prev.snow);
    if (rebuild && this.frames.length > 0) this.startRebuild();
    this.dirty = true;
    this.kick();
  }

  // Re-request every tile (e.g. after the tile host came back from an
  // outage, so tiles that failed are fetched again).
  refreshTiles(): void {
    if (this.frames.length > 0) this.startRebuild();
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
    if (import.meta.env.DEV && typeof window !== 'undefined') {
      const w = window as unknown as Record<string, unknown>;
      if (w.__radarEngine === this) delete w.__radarEngine;
    }
  }

  // ── commands (timeline, hotkeys) ────────────────────────────────────────

  play(): void {
    if (this.frames.length < 2) return;
    this.intent = 'play';
    this.autoplayPending = false;
    this.scrubbing = false;
    this.settle = null;
    this.live = false;
    const [lo, hi] = this.clock.window;
    if (hi > lo) {
      const at = this.clock.current().index;
      this.clock.seek(Math.min(Math.max(at, lo), hi));
      this.clock.play();
    }
    // Otherwise tick starts the clock once two frames have loaded.
    this.kick();
  }

  pause(): void {
    this.intent = 'pause';
    this.autoplayPending = false;
    if (this.clock.playing) {
      const index = this.clock.current().index;
      this.glideTo(index, SETTLE_MS);
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

  // Whether Cesium still wants a tile a request was made for: seen in one of
  // the recent readiness scans, or too recent to judge.
  private tileWanted(frameKey: string, level: number, x: number, y: number, since: RequestStamp): boolean {
    if (this.scanCount < since.scan + UNWANTED_SCANS || performance.now() - since.at < UNWANTED_MIN_AGE_MS) return true;
    const k = `${frameKey}|${level}/${x}/${y}`;
    return this.wantedNow.has(k) || this.wantedPrev.has(k) || this.wantedOlder.has(k);
  }

  // Add a frame's layer next to its neighbours in time — just below the next
  // newer radar layer, or just above the newest — so the stack stays in time
  // order without moving anything past other layers (labels, precipitation).
  private addFrame(key: string, t: TimelineFrame, placed: Frame[], existing: Frame[]): Frame {
    const layers = this.viewer.imageryLayers;
    const newer = existing.filter((f) => f.time > t.time).sort((a, b) => a.time - b.time)[0];
    const older = [...placed, ...existing].filter((f) => f.time <= t.time).sort((a, b) => b.time - a.time)[0];
    let index: number | undefined;
    if (newer && layers.contains(newer.layer)) index = layers.indexOf(newer.layer);
    else if (older && layers.contains(older.layer)) index = layers.indexOf(older.layer) + 1;
    return this.makeFrame(key, t, index);
  }

  private makeFrame(key: string, t: TimelineFrame, index?: number): Frame {
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
      wanted: (level, x, y, since) => this.tileWanted(key, level, x, y, since),
      stamp: () => ({ scan: this.scanCount, at: performance.now() }),
    });
    const layer =
      index === undefined
        ? addImageryBelowLabels(this.viewer, provider)
        : this.viewer.imageryLayers.addImageryProvider(provider, index);
    provider.layer = layer;
    layer.alpha = 0;
    return { key, time: t.time, forecast: t.forecast, source, layer, provider, ready: false };
  }

  private removeLayers(frames: Frame[]): void {
    if (this.viewer.isDestroyed()) return;
    for (const f of frames) this.viewer.imageryLayers.remove(f.layer, true);
  }

  // Palette / snow changes: build a fresh stack (the tile worker re-paints
  // from its cache, no network) at alpha 0, just above the current one, and
  // swap once the frames the loop plays have loaded in it.
  private startRebuild(): void {
    this.discardIncoming();
    const layers = this.viewer.imageryLayers;
    const top = this.frames[this.frames.length - 1];
    let index = top && layers.contains(top.layer) ? layers.indexOf(top.layer) + 1 : undefined;
    const frames = this.frames.map((f) => {
      const t: TimelineFrame = { frame: { time: f.time, path: f.source.path }, time: f.time, forecast: f.forecast };
      const made = this.makeFrame(f.key, t, index);
      if (index !== undefined) index++;
      return made;
    });
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
    const [lo, hi] = this.clock.window;
    const shown = this.clock.current().index;
    let ready = inc.frames[shown]?.ready ?? false;
    for (let i = Math.max(0, lo); ready && i <= hi; i++) ready = inc.frames[i]?.ready ?? false;
    if (!ready && now - inc.since < SWAP_TIMEOUT_MS) return;
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

  private indexNear(time: number): number {
    let best = -1;
    for (let i = 0; i < this.frames.length; i++) {
      if (best < 0 || Math.abs(this.frames[i].time - time) < Math.abs(this.frames[best].time - time)) best = i;
    }
    return best;
  }

  // Glide from what is on screen to a frame. Mid-blend between neighbours
  // the glide starts from the blend; mid-wrap (newest dissolving into the
  // oldest) there is no in-between frame to glide through, so it cuts.
  private glideTo(index: number, ms: number): void {
    const cur = this.clock.current();
    const b = cur.blend;
    let from: number;
    if (b.from === b.to || b.t === 0) from = b.from;
    else if (Math.abs(b.to - b.from) === 1) from = b.from + (b.to - b.from) * b.t;
    else from = index;
    if (!this.clock.playing && b.from !== b.to && Math.abs(b.to - b.from) !== 1) from = cur.position;
    this.clock.seek(from);
    this.settle = Math.abs(from - index) < 1e-6 ? null : { from, to: index, start: performance.now(), ms };
    if (!this.settle) this.clock.seek(index);
    this.live = index === this.liveIndex();
  }

  private isMoving(now: number): boolean {
    return this.moving && now - this.movingSince < MAX_MOTION_HOLD_MS;
  }

  private shouldDefer(key: string): boolean {
    // While the camera moves, only the frames on screen load: tiles for views
    // the camera is passing through would spend the rate budget on frames
    // nobody sees.
    if (!this.isMoving(performance.now())) return false;
    // (Resting on the newest frame reads as a finished blend into it, t = 1.)
    const b = this.clock.current().blend;
    return !(b.t < 1 && this.frames[b.from]?.key === key) && !(b.t > 0 && this.frames[b.to]?.key === key);
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
    this.clock.setWindow(hi < 0 ? 0 : lo, hi);
  }

  // Per-frame readiness: every tile Cesium is drawing — and every tile it is
  // loading to replace them — has this layer's own imagery settled (loaded
  // or permanently failed): not a stretched ancestor, not a placeholder, and
  // not nothing. Read from the globe's last render, and only once the camera
  // has settled (or has been moving for a long time), so readiness doesn't
  // flicker during refinement. The same scan records which tiles Cesium
  // still wants, for cancelling the rest.
  private checkReady(now: number): void {
    if (now - this.lastReadyCheck < READY_CHECK_MS) return;
    const all = this.incoming ? [...this.frames, ...this.incoming.frames] : this.frames;
    if (all.length === 0) return;
    if (this.isMoving(now) || (!this.moving && now - this.settledAt < CAMERA_SETTLE_MS)) return;
    this.lastReadyCheck = now;

    const surface = (this.viewer.scene.globe as unknown as { _surface?: SurfaceLike })._surface;
    const rendered = surface?._tilesToRender;
    if (!Array.isArray(rendered)) {
      // Cesium internals changed shape (radarEngine.test.ts guards this in
      // CI): treat every frame as loaded rather than stalling the loop.
      if (all.some((f) => !f.ready)) {
        for (const f of all) f.ready = true;
        this.recomputeWindow();
      }
      this.readinessStale = false;
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
    const wanted = new Set<string>();
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
          if (li && li.state !== IMAGERY_FAILED && li.state !== IMAGERY_INVALID) {
            bad[i] = 1;
            wanted.add(`${all[i].key}|${li.level}/${li.x}/${li.y}`);
          }
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

    this.scanCount++;
    this.wantedOlder = this.wantedPrev;
    this.wantedPrev = this.wantedNow;
    this.wantedNow = wanted;

    let changed = false;
    all.forEach((f, i) => {
      const ready = rendered.length > 0 && need[i] > 0 && own[i] === need[i];
      if (ready !== f.ready) {
        f.ready = ready;
        changed = true;
      }
    });
    this.readinessStale = false;
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
    // The rebuild stack loads in the same order as the one it replaces.
    this.incoming?.frames.forEach((f, i) => (ranks[f.key] = ranks[this.frames[i]?.key] ?? n + i));
    this.client.setRanks(ranks);
  }

  private tick(): void {
    if (this.destroyed || this.viewer.isDestroyed()) return;
    const now = performance.now();
    const dt = this.lastTick ? Math.min(MAX_DT_MS, now - this.lastTick) : 0;
    this.lastTick = now;
    this.checkReady(now);
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
      this.clock.setWindow(0, -1);
      this.settle = null;
      this.lastAlphas = [];
      this.lastRankSig = '';
      radarPlayhead.reset();
      this.kick();
      return;
    }
    if (n === 0) return;
    this.maybeSwap(now);

    const [lo, hi] = this.clock.window;
    const windowSize = hi >= lo ? hi - lo + 1 : 0;
    // The loop holds while the camera moves and until the new view has been
    // checked (only the frame on screen loads meanwhile).
    const holding = this.isMoving(now) || (this.readinessStale && !this.moving);
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
      this.clock.seek(hi);
      this.clock.play({ fromHold: true });
    }
    // Playing, but the clock couldn't run yet (too few frames loaded): start
    // it once it can, from the newest frame.
    if (this.intent === 'play' && !this.clock.playing && windowSize >= 2 && !this.scrubbing) {
      this.clock.seek(hi);
      this.clock.play({ fromHold: true });
    }
    // Resting on "now": move forward onto a newly published frame once it
    // has loaded.
    if (this.intent === 'pause' && this.live && !this.scrubbing && !this.settle) {
      const target = this.liveIndex();
      const at = this.clock.current().position;
      if (target > at) this.settle = { from: at, to: target, start: now, ms: ADVANCE_MS };
    }

    if (this.settle) {
      const t = Math.min(1, (now - this.settle.start) / this.settle.ms);
      this.clock.seek(this.settle.from + (this.settle.to - this.settle.from) * t);
      if (t >= 1) {
        this.clock.seek(this.settle.to);
        this.settle = null;
      }
    }

    const frame = this.clock.playing && !holding ? this.clock.tick(dt, this.settings.speed) : this.clock.current();
    this.updateRanks(frame.index);

    const b = frame.blend;
    const discrete = b.from !== this.lastBlend.from || b.to !== this.lastBlend.to;
    const blendMoved = discrete || b.t !== this.lastBlend.t;
    const due = discrete || now - this.lastRedraw >= MIN_BLEND_REDRAW_MS || b.t === 0 || b.t === 1;
    if ((blendMoved && due) || this.master !== masterBefore || this.dirty) {
      this.lastBlend = { ...b };
      this.dirty = false;
      const opacity = this.settings.opacity * this.master;
      const alphas = blendAlphas(n, b, opacity, this.settings.opacity * ECHO_ALPHA);
      if (this.clock.playing && this.master > 0 && b.t === 0) {
        const nextIdx = b.from >= hi ? lo : b.from + 1;
        if (nextIdx >= 0 && nextIdx < n && alphas[nextIdx] === 0 && this.frames[nextIdx].ready) {
          alphas[nextIdx] = PREWARM_ALPHA;
        }
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
      if (changed) {
        this.lastRedraw = now;
        this.viewer.scene.requestRender();
      }
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
      buffering:
        this.intent === 'play'
          ? !this.clock.playing || windowSize < 2
          : this.autoplayPending && this.active && windowSize < Math.min(AUTOPLAY_MIN_FRAMES, n),
      ready,
      total: n,
      readyMask,
      live: this.intent === 'pause' && this.live,
    });
  }
}
