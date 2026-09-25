import * as Cesium from 'cesium';
import { fetchLightningField } from '../../api/lightningApi';
import type { LightningFieldResponse } from '../../types/lightning';
import { startVisiblePolling } from '../../lib/poll';
import { useLightningStatus } from './lightningStore';
import { LIVE_HOLD_S, checkServerStageEnds, stageIndexForAge } from './lightningPalette';
import { decodeMarks, type DecodedMark } from './strikeKey';
import { LivePool, type LiveEntry, type LivePoolCaps } from './livePool';
import { MARK_EXPIRED, MARK_HIDDEN, diffField, fieldMarkState } from './fieldModel';
import { viewBoxFor, type ViewBox } from './viewBox';
import { createServerClock } from './clock';
import { RateWindow, decideLiveSource } from './liveFeed';
import { createBoltAnimator } from './boltAnimation';
import { startBlitzortungSocket } from './blitzortungSocket';
import { XBillboardPool, styleX } from './xBillboards';

// The lightning layer's imperative core, one instance per "layer on". Every
// strike is an X in the shared palette (lightningPalette.ts), drawn from two
// sources merged by strike key:
//
//   LIVE  — strikes younger than LIVE_HOLD_S (2 min), as many as the pool's
//           caps hold (the oldest go first in a busy view): the browser's own
//           Blitzortung socket (with the bolt animation when in view) plus
//           each /field response's `fresh` list, which fills the first two
//           minutes on load and stands in for the socket when it's down.
//           Always white; retired at 2 min.
//   FIELD — the server's stable sample of the view box's last 24 h. Marks
//           don't reshuffle between polls, so each refresh is a small diff.
//           A mark whose strike is also live stays hidden (its "twin") and
//           takes over, now yellow, when the live X retires — so the seam
//           reads as ageing, never as a gap or a double.
//
// Both are pooled BillboardCollections restaged by a 1 s tick that only
// touches a billboard when its stage or visibility changes, so a settled
// 16k-mark field costs a loop of comparisons and lets requestRenderMode idle.

export type LightningVariant = 'app' | 'share';

interface VariantConfig {
  /** /field sample size (the server rounds it down to one of its buckets). */
  fieldBudget: number;
  /** Newest strikes of the last 2 min in the box. */
  freshBudget: number;
  liveCaps: LivePoolCaps;
}

// The share page's globe is smaller and often on weaker machines.
export const LIGHTNING_VARIANTS: Record<LightningVariant, VariantConfig> = {
  app: { fieldBudget: 16_000, freshBudget: 4_000, liveCaps: { near: 4_000, far: 800 } },
  share: { fieldBudget: 10_000, freshBudget: 2_500, liveCaps: { near: 2_500, far: 500 } },
};

const TICK_MS = 1_000; // stage-step / cleanup cadence (colours change over minutes, not frames)
const POLL_MS = 30_000; // the server's memo bucket; the field changes slowly
const POLL_FAST_MS = 10_000; // while the fresh list is the live feed
const MOVE_DEBOUNCE_MS = 750;
const RENDER_COALESCE_MS = 250;
const LIVE_HOLD_MS = LIVE_HOLD_S * 1000;
// The bolt is a "just happened" cue; a strike the relay delivered late (or one
// the fresh list backfills) only gets its X.
const BOLT_MAX_AGE_S = 20;
// A poll that finds a request for the same box in flight lets it finish rather
// than aborting it (a slow server would otherwise never complete one) — unless
// it looks hung.
const INFLIGHT_STALE_MS = 25_000;
// The fresh list only counts as a live feed while polls keep succeeding.
const SERVER_LIVE_MAX_AGE_MS = 45_000;

interface FieldMark {
  key: string;
  tMs: number;
  lon: number;
  lat: number;
  /** Applied state: a stage index (drawn) or MARK_HIDDEN. */
  state: number;
  /** Stage the billboard is currently styled as — un-hiding at the same stage is just a show flip. */
  styled: number;
  /** The same strike is in the live pool (drawn there). */
  twin: boolean;
  bb: Cesium.Billboard;
}

/** Start everything for one viewer; returns the teardown. */
export function startLightning(viewer: Cesium.Viewer, variant: LightningVariant): () => void {
  const cfg = LIGHTNING_VARIANTS[variant];
  const store = () => useLightningStatus.getState();
  const clock = createServerClock();
  const startedMs = Date.now();
  let cancelled = false;

  const bolts = createBoltAnimator(viewer);
  // Created on turn-on, destroyed on turn-off. Two collections so the busy
  // live one (a billboard change every few ms in a storm) never dirties the
  // big, mostly idle field. Default depth test on both: the far side of the
  // globe stays hidden.
  const fieldBbs = new Cesium.BillboardCollection({ scene: viewer.scene });
  const liveBbs = new Cesium.BillboardCollection({ scene: viewer.scene });
  viewer.scene.primitives.add(fieldBbs);
  viewer.scene.primitives.add(liveBbs);
  const fieldPool = new XBillboardPool(fieldBbs);
  const livePool = new XBillboardPool(liveBbs);
  const live = new LivePool<Cesium.Billboard>(cfg.liveCaps);
  const field = new Map<string, FieldMark>();
  let windowS = store().windowMinutes * 60;

  // Billboard-only changes don't need a render per strike — coalesce to one
  // render per ~250 ms (bolt animations drive their own frames via RAF).
  let renderTimer: ReturnType<typeof setTimeout> | null = null;
  const requestRenderSoon = () => {
    if (renderTimer) return;
    renderTimer = setTimeout(() => {
      renderTimer = null;
      if (!viewer.isDestroyed()) viewer.scene.requestRender();
    }, RENDER_COALESCE_MS);
  };
  const requestRenderNow = () => {
    if (!viewer.isDestroyed()) viewer.scene.requestRender();
  };

  // --- Field marks ---------------------------------------------------------
  const applyMark = (m: FieldMark, state: number) => {
    m.state = state;
    if (state === MARK_HIDDEN) {
      m.bb.show = false;
      return;
    }
    if (m.styled !== state) {
      styleX(m.bb, m.lon, m.lat, state);
      m.styled = state;
    }
    m.bb.show = true;
  };

  const removeMark = (m: FieldMark) => {
    field.delete(m.key);
    fieldPool.release(m.bb);
  };

  /** Bring one mark up to date; true when what's drawn changed. */
  const restageMark = (m: FieldMark, nowMs: number): boolean => {
    const st = fieldMarkState((nowMs - m.tMs) / 1000, windowS, m.twin);
    if (st === m.state) return false; // settled — the common case
    const wasShown = m.state !== MARK_HIDDEN;
    if (st === MARK_EXPIRED) removeMark(m);
    else applyMark(m, st);
    return wasShown || st !== MARK_EXPIRED;
  };

  // Deleting the current entry while iterating a Map is safe.
  const restageField = (nowMs: number): boolean => {
    let changed = false;
    for (const m of field.values()) if (restageMark(m, nowMs)) changed = true;
    return changed;
  };

  /** Diff a response's field into the held marks. True when anything drawn changed. */
  const applyField = (marks: DecodedMark[], nowMs: number): boolean => {
    const d = diffField(field, marks);
    let changed = false;
    // Recycle first so the adds reuse those billboards.
    for (const k of d.remove) {
      const m = field.get(k)!;
      if (m.state !== MARK_HIDDEN) changed = true;
      removeMark(m);
    }
    for (const mk of d.add) {
      const ageS = (nowMs - mk.tMs) / 1000;
      const twin = live.has(mk.key);
      const st = fieldMarkState(ageS, windowS, twin);
      if (st === MARK_EXPIRED) continue;
      // Style a hidden mark for its age anyway, so showing it later is a flip.
      const stage = st === MARK_HIDDEN ? stageIndexForAge(ageS) : st;
      const bb = fieldPool.acquire(mk.lon, mk.lat, stage, st !== MARK_HIDDEN);
      field.set(mk.key, {
        key: mk.key,
        tMs: mk.tMs,
        lon: mk.lon,
        lat: mk.lat,
        state: st,
        styled: stage,
        twin,
        bb,
      });
      if (st !== MARK_HIDDEN) changed = true;
    }
    return changed;
  };

  // --- Live strikes --------------------------------------------------------
  /**
   * A live entry left (retired or evicted): recycle it and let its field twin
   * take over. True when that twin appeared.
   */
  const dropLive = (e: LiveEntry<Cesium.Billboard>, nowMs: number): boolean => {
    if (e.handle) livePool.release(e.handle);
    const twin = field.get(e.key);
    if (!twin) return false;
    twin.twin = false;
    return restageMark(twin, nowMs);
  };

  /** Draw a live strike; false when it was already held or the caps turned it away. */
  const addLive = (key: string, tMs: number, lon: number, lat: number, near: boolean): boolean => {
    const r = live.add(key, tMs, near);
    if (r.evicted.length) {
      const nowMs = clock.now();
      for (const e of r.evicted) dropLive(e, nowMs);
    }
    if (!r.entry) return false;
    r.entry.handle = livePool.acquire(lon, lat, 0);
    const twin = field.get(key);
    if (twin) {
      twin.twin = true;
      if (twin.state !== MARK_HIDDEN) applyMark(twin, MARK_HIDDEN);
    }
    return true;
  };

  const mergeFresh = (marks: DecodedMark[], nowMs: number): boolean => {
    let changed = false;
    for (const mk of marks) {
      if (live.has(mk.key) || nowMs - mk.tMs >= LIVE_HOLD_MS) continue;
      const near = bolts.inView(mk.lon, mk.lat);
      if (addLive(mk.key, mk.tMs, mk.lon, mk.lat, near) && near) changed = true;
    }
    return changed;
  };

  // --- Browser socket ------------------------------------------------------
  let socketLastStrikeMs: number | null = null;
  const rate = new RateWindow();
  const stopSocket = startBlitzortungSocket({
    now: clock.now,
    onConnected: (connected) => {
      if (cancelled) return;
      if (store().connected !== connected) store().setStatus({ connected });
    },
    onStrike: (s) => {
      if (cancelled) return;
      const local = Date.now();
      socketLastStrikeMs = local;
      rate.add(local);
      const ageS = (clock.now() - s.tMs) / 1000;
      if (ageS >= LIVE_HOLD_S || live.has(s.key)) return;
      const near = bolts.inView(s.lon, s.lat);
      // Off-screen arrivals request no render: nobody can see them change, and
      // the next frame anything else asks for draws them.
      if (!addLive(s.key, s.tMs, s.lon, s.lat, near) || !near) return;
      // The dramatic descending bolt + red impact flash — only where the
      // camera can actually see it, and only while it's news.
      if (ageS < BOLT_MAX_AGE_S) bolts.spawn(s.lon, s.lat);
      requestRenderSoon();
    },
  });

  // --- /field polling ------------------------------------------------------
  const scratchRect = new Cesium.Rectangle();
  const currentView = (): ViewBox => {
    const cam = viewer.camera;
    const ellipsoid = viewer.scene.globe?.ellipsoid ?? Cesium.Ellipsoid.WGS84;
    const r = cam.computeViewRectangle(ellipsoid, scratchRect);
    const c = cam.positionCartographic;
    const deg = Cesium.Math.toDegrees;
    return viewBoxFor(
      r ? { west: deg(r.west), south: deg(r.south), east: deg(r.east), north: deg(r.north) } : null,
      { lat: deg(c.latitude), lon: deg(c.longitude) }
    );
  };

  let view = currentView();
  let reqSeq = 0;
  let appliedSeq = 0;
  let inflight: { ctrl: AbortController; key: string; startedAt: number } | null = null;
  let lastFieldOkAt: number | null = null;
  let lastFieldFailed = false;
  let serverCollectorUp = false;

  const applyResponse = (resp: LightningFieldResponse, fetchStart: number, fetchEnd: number) => {
    clock.observe(resp.now, fetchStart, fetchEnd);
    checkServerStageEnds(resp.stageEndsS);
    const nowMs = clock.now();
    let changed = applyField(decodeMarks(resp.field), nowMs);
    if (mergeFresh(decodeMarks(resp.fresh), nowMs)) changed = true;

    lastFieldOkAt = Date.now();
    lastFieldFailed = false;
    const collector = resp.status?.collector;
    serverCollectorUp = !!collector && collector.connected && collector.downSince === null;
    const st = store();
    st.setServer(resp.status ?? null);
    st.setField({
      marks: field.size,
      liveShown: live.size,
      loading: false,
      error: null,
      lastOkAt: lastFieldOkAt,
      degraded: resp.view?.degraded ?? null,
    });
    if (changed) requestRenderNow();
  };

  // force: the view box changed — supersede whatever is in flight.
  const load = (force: boolean) => {
    if (cancelled) return;
    const box = view;
    if (inflight) {
      const sameBox = inflight.key === box.key;
      if (!force && sameBox && Date.now() - inflight.startedAt < INFLIGHT_STALE_MS) return;
      inflight.ctrl.abort();
    }
    const seq = ++reqSeq;
    const req = { ctrl: new AbortController(), key: box.key, startedAt: Date.now() };
    inflight = req;
    store().setField({ loading: true });
    const fetchStart = Date.now();
    fetchLightningField({
      bbox: box.bbox,
      budget: cfg.fieldBudget,
      fresh: cfg.freshBudget,
      signal: req.ctrl.signal,
    })
      .then((resp) => {
        // Superseded (aborted) or overtaken by a newer request: drop it.
        if (cancelled || req.ctrl.signal.aborted || seq < appliedSeq) return;
        appliedSeq = seq;
        applyResponse(resp, fetchStart, Date.now());
      })
      .catch((err: unknown) => {
        // Before the error branch: an aborted, superseded request isn't a feed error.
        if (cancelled || req.ctrl.signal.aborted) return;
        console.error('Lightning field fetch failed', err);
        lastFieldFailed = true;
        // Keep what's drawn: it keeps ageing and expiring on its own.
        store().setField({ loading: false, error: err instanceof Error ? err.message : String(err) });
      })
      .finally(() => {
        if (inflight === req) inflight = null;
      });
  };

  const poll = () => {
    if (cancelled) return;
    view = currentView();
    load(false);
  };
  // Hidden tabs skip polls (and catch up on return); the socket and the tick
  // carry on, so the live Xs and their expiry stay right meanwhile.
  let fastPoll = false;
  let stopPolling = startVisiblePolling(poll, POLL_MS);

  // A new box refetches right away; a move within the same snapped box waits
  // for the poll. moveEnd is the fast path; the tick below catches a camera
  // that never comes to rest (the screensaver's rotation).
  let moveTimer: ReturnType<typeof setTimeout> | null = null;
  const onMoveEnd = () => {
    if (moveTimer) clearTimeout(moveTimer);
    moveTimer = setTimeout(() => {
      moveTimer = null;
      if (cancelled || viewer.isDestroyed()) return;
      const next = currentView();
      if (next.key === view.key) return;
      view = next;
      load(true);
    }, MOVE_DEBOUNCE_MS);
  };
  const offMoveEnd = viewer.camera.moveEnd.addEventListener(onMoveEnd);

  // Switching windows only hides/shows held marks; the server always sends 24 h.
  const unsubWindow = useLightningStatus.subscribe((s, prev) => {
    if (cancelled || s.windowMinutes === prev.windowMinutes) return;
    windowS = s.windowMinutes * 60;
    if (restageField(clock.now())) requestRenderNow();
  });

  // Cesium raises moveEnd only after the camera has held still, so a camera
  // that keeps turning would keep the last box it settled on (say a close-up
  // before the fly-back) until the next poll. The tick re-checks it and takes
  // a new box once it has held for two ticks, so a flight doesn't abort a
  // request every second on its way.
  let pendingViewKey: string | null = null;
  const checkView = () => {
    const next = currentView();
    if (next.key === view.key) {
      pendingViewKey = null;
    } else if (next.key !== pendingViewKey) {
      pendingViewKey = next.key;
    } else {
      pendingViewKey = null;
      view = next;
      load(true);
    }
  };

  // --- 1 s tick ------------------------------------------------------------
  const tick = () => {
    if (cancelled || viewer.isDestroyed()) return;
    checkView();
    const nowMs = clock.now();
    let changed = false;
    // Live strikes retire at the hold; their field twins (if sampled) take over.
    for (const e of live.retire(nowMs, LIVE_HOLD_MS)) {
      if (dropLive(e, nowMs) || e.near) changed = true;
    }
    if (restageField(nowMs)) changed = true;

    // Readouts — each only written when it changed, so subscribers aren't
    // notified once a second for nothing.
    const local = Date.now();
    const st = store();
    const perMin = rate.perMinute(local);
    if (st.ratePerMin !== perMin) st.setStatus({ ratePerMin: perMin });
    const serverLive =
      serverCollectorUp &&
      !lastFieldFailed &&
      lastFieldOkAt !== null &&
      local - lastFieldOkAt < SERVER_LIVE_MAX_AGE_MS;
    const d = decideLiveSource({ nowMs: local, startedMs, socketLastStrikeMs, serverLive });
    const error =
      d.source === 'offline' && d.fastPoll ? 'Live lightning feeds unreachable — retrying' : null;
    if (st.liveSource !== d.source || st.error !== error) st.setStatus({ liveSource: d.source, error });
    if (d.fastPoll !== fastPoll) {
      // Restarting also polls at once — what we want on entering the fallback.
      fastPoll = d.fastPoll;
      stopPolling();
      stopPolling = startVisiblePolling(poll, fastPoll ? POLL_FAST_MS : POLL_MS);
    }
    if (st.field.marks !== field.size || st.field.liveShown !== live.size) {
      st.setField({ marks: field.size, liveShown: live.size });
    }

    if (changed) viewer.scene.requestRender();
  };
  const ticker = setInterval(tick, TICK_MS);

  return () => {
    cancelled = true;
    stopSocket();
    stopPolling();
    inflight?.ctrl.abort();
    inflight = null;
    clearInterval(ticker);
    if (moveTimer) clearTimeout(moveTimer);
    if (renderTimer) clearTimeout(renderTimer);
    offMoveEnd();
    unsubWindow();
    bolts.destroy();
    live.clear();
    field.clear();
    if (!viewer.isDestroyed()) {
      // remove() destroys each collection and its GPU buffers.
      viewer.scene.primitives.remove(fieldBbs);
      viewer.scene.primitives.remove(liveBbs);
      viewer.scene.requestRender();
    }
    store().resetRuntime();
  };
}
