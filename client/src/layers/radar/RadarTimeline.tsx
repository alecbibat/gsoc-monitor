import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { useLayersStore } from '../../store/layersStore';
import { useScreensaverStore } from '../../screensaver/screensaverStore';
import { useHoverStore } from '../../screensaver/hoverStore';
import { useMeasureStore } from '../../measure/measureStore';
import { useFuelZoneStore } from '../../fuelzone/fuelZoneStore';
import { RADAR_SPEEDS, STALE_AFTER_SEC, useRadarStore, type RadarSpeed } from './radarStore';
import { radarControl, radarPlayhead, type PlayheadState } from './radarPlayhead';
import {
  buildTimeline,
  clampIndex,
  formatClock,
  formatOffset,
  nowIndex,
  type TimelineFrame,
} from './radarTimeline';
import { bufferSegments, timelineTicks } from './radarTimelineTicks';
import { radarKeyFor, runRadarKeyAction, type RadarKeyAction } from './radarKeys';
import { useRadarPlayhead } from './useRadarPlayhead';

export function speedLabel(speed: RadarSpeed): string {
  return speed === 0.5 ? '½×' : `${speed}×`;
}

// What the time bubble over the knob says about the frame on screen.
export interface FrameCaption {
  kind: 'now' | 'latest' | 'past' | 'forecast';
  lead: string | null; // "Now" / "Latest", ahead of the clock time
  text: string;
  offset: string; // from the newest observed frame: "Latest", "−30 min", "+10 min"
}

// The newest observed frame reads "Now 7:40 PM" — or "Latest 7:40 PM" when
// the feed has stalled and it isn't really now; forecast frames read "+10 min".
export function frameCaption(current: TimelineFrame, newest: TimelineFrame, stale: boolean): FrameCaption {
  const offset = formatOffset(current.time - newest.time);
  if (current.forecast) return { kind: 'forecast', lead: null, text: offset, offset };
  const text = formatClock(current.time);
  if (current.time >= newest.time) {
    return stale ? { kind: 'latest', lead: 'Latest', text, offset } : { kind: 'now', lead: 'Now', text, offset };
  }
  return { kind: 'past', lead: null, text, offset };
}

// The play button's name. Frame counts only go in the tooltip (`detail`): a
// screen reader re-reads a focused button's name each time it changes, and
// the count changes with every frame that loads.
export function playButtonLabel(
  p: { playing: boolean; ready: number; total: number },
  busy: boolean,
  detail = false
): string {
  let label = p.playing ? 'Pause radar loop' : 'Play radar loop';
  if (p.total > 0 && p.ready < p.total) label += detail ? ` (loading ${p.ready} of ${p.total} frames)` : ' (loading)';
  if (busy) label += ' · RainViewer busy';
  return label;
}

// The slider's spoken value: "8:30 PM, −20 min", "8:50 PM, latest frame",
// "9:10 PM, forecast +20 min".
export function frameValueText(current: TimelineFrame, newest: TimelineFrame, stale: boolean): string {
  const caption = frameCaption(current, newest, stale);
  const clock = formatClock(current.time);
  if (caption.kind === 'forecast') return `${clock}, forecast ${caption.offset}`;
  if (caption.kind === 'now' || caption.kind === 'latest') return `${clock}, latest frame`;
  return `${clock}, ${caption.offset}`;
}

// Screen readers speak every change of a focused slider's value, which during
// playback is every frame. So while the loop plays, the announced frame moves
// at most every ANNOUNCE_EVERY_MS; paused (stepping, scrubbing) it follows
// every frame.
export const ANNOUNCE_EVERY_MS = 10_000;
export interface Announced {
  index: number;
  at: number; // ms, when it was last moved
}
export function nextAnnounced(prev: Announced | null, index: number, playing: boolean, nowMs: number): Announced {
  if (prev && prev.index === index) return prev;
  if (prev && playing && nowMs - prev.at < ANNOUNCE_EVERY_MS) return prev;
  return { index, at: nowMs };
}

// Track layout, px from the top of the 47 px track box: bubble 0–16 with its
// tail to 19, knob 19–33 centred on the bar at 24–28, ticks from 30, labels
// from 37.
const BUBBLE_OVERHANG_PX = 10; // how far the bubble may hang past the track's ends
const GHOST_EDGE_PX = 28;
const GHOST_CHAR_PX = 6; // rough advance of the ghost label's 10 px digits
const GHOST_PAD_PX = 12;
const TOUCH_SLOP_PX = 6; // a finger must move this far sideways before it scrubs

// Left edge of the time bubble for a knob at x: centred over it, hanging at
// most BUBBLE_OVERHANG_PX past either end of the track. Whole pixels, so the
// text stays crisp.
export function bubbleLeft(x: number, bubbleW: number, trackW: number): number {
  return Math.round(Math.min(Math.max(x - bubbleW / 2, -BUBBLE_OVERHANG_PX), trackW - bubbleW + BUBBLE_OVERHANG_PX));
}

// The hover ghost's label shares the bubble's row, so it's left out (its tick
// stays) when the two would overlap: over or beside the knob the bubble
// already says when that is.
export function ghostLabelClear(ghostL: number, ghostW: number, bubbleL: number, bubbleW: number): boolean {
  const gap = 4;
  return ghostL + ghostW + gap <= bubbleL || bubbleL + bubbleW + gap <= ghostL;
}

const BUBBLE_STYLE: Record<FrameCaption['kind'], string> = {
  now: 'bg-accent text-ink-950',
  latest: 'bg-white text-ink-950',
  past: 'bg-white/90 text-ink-950',
  forecast: 'bg-amber-300 text-ink-950',
};
const TAIL_STYLE: Record<FrameCaption['kind'], string> = {
  now: 'border-t-accent',
  latest: 'border-t-white',
  past: 'border-t-white/90',
  forecast: 'border-t-amber-300',
};
const FORECAST_HATCH =
  'repeating-linear-gradient(45deg, rgba(255,210,80,0.45) 0 4px, rgba(255,210,80,0.12) 4px 8px)';
const ALIGN_SHIFT = { start: 'none', center: 'translateX(-50%)', end: 'translateX(-100%)' } as const;

// Wall clock for the "feed delayed" check, which goes stale without any
// manifest change.
function useNowSec(everyMs: number): number {
  const [now, setNow] = useState(() => Date.now() / 1000);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now() / 1000), everyMs);
    return () => clearInterval(id);
  }, [everyMs]);
  return now;
}

// Playback scrubber for the radar loop, zoom.earth style: play/pause (its ring
// shows the loop loading), a track with per-frame ticks, time labels, a
// buffer bar of loaded frames and a gliding knob + time bubble, a jump-to-
// latest button and, from sm up, the current frame's time and the speed. A
// bare pill — the host positions it (App's bottom-center dock, or the share
// globe's frame).
export function RadarTimeline() {
  const active = useLayersStore((s) => s.active.radar);
  const past = useRadarStore((s) => s.past);
  const nowcast = useRadarStore((s) => s.nowcast);
  const windowMinutes = useRadarStore((s) => s.windowMinutes);
  const screensaverActive = useScreensaverStore((s) => s.active);
  const hoverEngaged = useHoverStore((s) => s.active || s.picking);
  // The measure and fuel-zone tools put their own bars in this spot.
  const measuring = useMeasureStore((s) => s.active);
  const zoning = useFuelZoneStore((s) => s.active);

  const timeline = useMemo(() => buildTimeline(past, nowcast, windowMinutes), [past, nowcast, windowMinutes]);

  if (!active || screensaverActive || hoverEngaged || measuring || zoning || timeline.length < 2) return null;
  return <Scrubber timeline={timeline} />;
}

// The pill itself, for a timeline of at least two frames (exported for tests).
export function Scrubber({ timeline }: { timeline: TimelineFrame[] }) {
  const n = timeline.length;
  const head = useRadarPlayhead();
  const speed = useRadarStore((s) => s.speed);
  const setSpeed = useRadarStore((s) => s.setSpeed);
  const coolingDownMs = useRadarStore((s) => s.coolingDownMs);
  const nowSec = useNowSec(30_000);

  const trackRef = useRef<HTMLDivElement>(null);
  const knobRef = useRef<HTMLDivElement>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const tailRef = useRef<HTMLDivElement>(null);
  // The pointer pressed on the track. A touch starts out undecided — it may be
  // a scroll or a tap — and only scrubs once it has moved sideways.
  const press = useRef<{ id: number; rect: DOMRect; x0: number; y0: number; scrubbing: boolean } | null>(null);
  const nIdx = nowIndex(timeline);
  // Shared with the paint loop, which runs outside React.
  const geo = useRef({ n, restPos: nIdx, trackW: 0, bubbleW: 0, repaint: () => {} });
  const [trackW, setTrackW] = useState(0);
  const [bubbleW, setBubbleW] = useState(0);
  const [dragging, setDragging] = useState(false);
  // Whether the phone layout showed the jump button when the drag began: held
  // for the drag, so the track doesn't resize under the finger.
  const [dragJump, setDragJump] = useState<boolean | null>(null);
  const [hover, setHover] = useState<number | null>(null);

  // The knob and the time bubble follow the continuous playhead by writing
  // transforms directly: no React render per frame.
  useLayoutEffect(() => {
    const g = geo.current;
    let last = { frac: -1, w: -1, bw: -1 };
    const paint = (s: PlayheadState) => {
      // No engine frames yet (the layer just came on): rest on "now", where
      // playback will open, rather than flashing the oldest frame.
      const total = s.total > 1 ? s.total : g.n;
      const pos = s.total > 0 ? s.position : g.restPos;
      const frac = total > 1 ? Math.min(1, Math.max(0, pos / (total - 1))) : 0;
      const w = g.trackW;
      const bw = g.bubbleW;
      if (frac === last.frac && w === last.w && bw === last.bw) return;
      last = { frac, w, bw };
      const x = frac * w;
      const bx = bubbleLeft(x, bw, w);
      if (knobRef.current) knobRef.current.style.transform = `translate3d(${x}px, 0, 0)`;
      if (bubbleRef.current) bubbleRef.current.style.transform = `translate3d(${bx}px, 0, 0)`;
      if (tailRef.current) tailRef.current.style.transform = `translate3d(${Math.round(x)}px, 0, 0)`;
    };
    g.repaint = () => {
      last = { frac: -1, w: -1, bw: -1 };
      paint(radarPlayhead.get());
    };
    g.repaint();
    const unsubscribe = radarPlayhead.subscribe(paint);
    return () => {
      unsubscribe();
      g.repaint = () => {};
    };
  }, []);

  // Track and bubble sizes: the tick layout and the bubble's clamp at the
  // track ends depend on them.
  useLayoutEffect(() => {
    const track = trackRef.current;
    const bubble = bubbleRef.current;
    if (!track) return;
    const g = geo.current;
    const measure = () => {
      g.trackW = track.clientWidth;
      g.bubbleW = bubble?.offsetWidth ?? 0;
      setTrackW(g.trackW);
      setBubbleW(g.bubbleW);
      g.repaint();
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(track);
    if (bubble) ro.observe(bubble);
    return () => ro.disconnect();
  }, []);

  useLayoutEffect(() => {
    geo.current.n = n;
    geo.current.restPos = nIdx;
    geo.current.repaint();
  }, [n, nIdx]);

  // Unmounted mid-drag (the layer switched off, a tour started): let the
  // engine settle on a frame rather than stay in scrub mode.
  useEffect(
    () => () => {
      if (press.current?.scrubbing) radarControl.endScrub();
    },
    []
  );

  const idx = head.total > 0 ? clampIndex(head.index, n) : nIdx;
  const current = timeline[idx];
  const newest = timeline[nIdx];
  const stale = nowSec - newest.time > STALE_AFTER_SEC;
  const caption = frameCaption(current, newest, stale);
  const hasForecast = nIdx < n - 1;
  const busy = coolingDownMs > 0;
  const loading = head.total > 0 && head.ready < head.total;
  const at = (i: number) => (n > 1 ? (i / (n - 1)) * 100 : 0);
  // Forecast hatching for a strip starting at frame position i, its stripes
  // lined up with the track's so neighbouring strips continue them.
  const hatchFrom = (i: number) => ({
    backgroundImage: FORECAST_HATCH,
    backgroundPosition: `${-(at(i) / 100) * trackW}px 0`,
  });

  const ticks = useMemo(() => timelineTicks(timeline.map((t) => t.time), trackW), [timeline, trackW]);
  const segments = useMemo(
    () => (head.readyMask.length === n ? bufferSegments(head.readyMask, nIdx) : []),
    [head.readyMask, n, nIdx]
  );

  // What the slider tells a screen reader (see nextAnnounced).
  const [announced, setAnnounced] = useState<Announced | null>(null);
  useEffect(() => {
    setAnnounced((prev) => nextAnnounced(prev, idx, head.playing, Date.now()));
  }, [idx, head.playing]);
  const spoken = announced ? clampIndex(announced.index, n) : idx;

  // On a phone the jump button only takes track room while paused away from
  // the newest frame, and never changes mid-drag; from sm up its slot is kept
  // so the track never jumps.
  const jumpShown = !head.live;
  const jumpOnPhone = dragJump ?? (jumpShown && !head.playing);

  const positionAt = (clientX: number, rect: DOMRect): number => {
    const total = radarPlayhead.get().total > 1 ? radarPlayhead.get().total : n;
    const frac = rect.width > 0 ? Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)) : 0;
    return frac * (total - 1);
  };

  const startScrub = (el: HTMLDivElement, clientX: number) => {
    const p = press.current;
    if (!p) return;
    p.scrubbing = true;
    try {
      el.setPointerCapture(p.id);
    } catch {
      // The pointer is already gone; the drag ends on its own.
    }
    setDragging(true);
    setDragJump(jumpOnPhone);
    setHover(null);
    radarControl.scrub(positionAt(clientX, p.rect));
  };

  const endScrub = () => {
    setDragging(false);
    setDragJump(null);
    radarControl.endScrub();
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || press.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    press.current = { id: e.pointerId, rect, x0: e.clientX, y0: e.clientY, scrubbing: false };
    // A mouse or pen scrubs from the press; a finger might be starting a
    // scroll (the track lets vertical pans through), so it waits.
    if (e.pointerType !== 'touch') startScrub(e.currentTarget, e.clientX);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const p = press.current;
    if (p) {
      if (p.id !== e.pointerId) return;
      if (p.scrubbing) {
        radarControl.scrub(positionAt(e.clientX, p.rect));
        return;
      }
      const dx = Math.abs(e.clientX - p.x0);
      const dy = Math.abs(e.clientY - p.y0);
      if (dx >= TOUCH_SLOP_PX && dx > dy) startScrub(e.currentTarget, e.clientX);
      else if (dy >= TOUCH_SLOP_PX) press.current = null; // a vertical swipe: not ours
      return;
    }
    if (e.pointerType !== 'mouse') return;
    const rect = e.currentTarget.getBoundingClientRect();
    const frac = rect.width > 0 ? Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)) : 0;
    const i = Math.round(frac * (n - 1));
    setHover((h) => (h === i ? h : i));
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const p = press.current;
    if (!p || p.id !== e.pointerId) return;
    press.current = null;
    if (p.scrubbing) {
      endScrub();
      return;
    }
    // A tap that never moved: seek to the frame under it.
    radarControl.scrub(positionAt(e.clientX, p.rect));
    radarControl.endScrub();
  };

  const cancelPress = (e: ReactPointerEvent<HTMLDivElement>) => {
    const p = press.current;
    if (!p || p.id !== e.pointerId) return;
    press.current = null;
    if (p.scrubbing) endScrub();
  };

  // Standard slider keys on the focused track (the page-wide hotkeys skip a
  // focused slider, so nothing runs twice).
  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    let action: RadarKeyAction | null = radarKeyFor(e);
    if (!action && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (e.key === 'ArrowDown') action = e.shiftKey ? 'prev3' : 'prev';
      else if (e.key === 'ArrowUp') action = e.shiftKey ? 'next3' : 'next';
      else if (e.key === 'PageDown') action = 'prev3';
      else if (e.key === 'PageUp') action = 'next3';
    }
    if (!action) {
      // A held Space would otherwise scroll the share page under the track.
      if (e.key === ' ') e.preventDefault();
      return;
    }
    e.preventDefault();
    runRadarKeyAction(action);
  };

  const cycleSpeed = () => setSpeed(RADAR_SPEEDS[(RADAR_SPEEDS.indexOf(speed) + 1) % RADAR_SPEEDS.length]);

  // The jump button hides once it lands on the newest frame; hand keyboard
  // focus to the slider first so it isn't dropped onto the page.
  const jumpToLatest = (e: ReactMouseEvent<HTMLButtonElement>) => {
    if (document.activeElement === e.currentTarget) trackRef.current?.focus({ preventScroll: true });
    radarControl.latest();
  };

  const ghost = hover !== null && hover < n && hover !== idx && !dragging ? hover : null;
  const ghostX = ghost !== null ? (at(ghost) / 100) * trackW : 0;
  const ghostAlign = ghostX < GHOST_EDGE_PX ? 'start' : ghostX > trackW - GHOST_EDGE_PX ? 'end' : 'center';
  const ghostText = ghost !== null ? formatClock(timeline[ghost].time) : '';
  const ghostW = ghostText.length * GHOST_CHAR_PX + GHOST_PAD_PX;
  const ghostL = ghostAlign === 'start' ? ghostX : ghostAlign === 'end' ? ghostX - ghostW : ghostX - ghostW / 2;
  const showGhostLabel =
    ghost !== null && ghostLabelClear(ghostL, ghostW, bubbleLeft((at(idx) / 100) * trackW, bubbleW, trackW), bubbleW);

  const onNewest = caption.kind === 'now' || caption.kind === 'latest';
  const staleMin = Math.round((nowSec - newest.time) / 60);

  return (
    <div className="pointer-events-auto flex w-full max-w-2xl items-center gap-3 rounded-2xl border border-white/10 bg-ink-900/85 px-3 py-2 shadow-panel backdrop-blur-md">
      <PlayButton
        playing={head.playing}
        loading={loading}
        progress={head.total > 0 ? head.ready / head.total : 0}
        busy={busy}
        label={playButtonLabel(head, busy)}
        title={playButtonLabel(head, busy, true)}
      />

      <div
        ref={trackRef}
        role="slider"
        tabIndex={0}
        aria-label="Radar frame"
        aria-valuemin={0}
        aria-valuemax={n - 1}
        aria-valuenow={spoken}
        aria-valuetext={frameValueText(timeline[spoken], newest, stale)}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={cancelPress}
        onLostPointerCapture={cancelPress}
        onPointerLeave={() => setHover(null)}
        onKeyDown={onKeyDown}
        className="group relative h-[47px] min-w-0 flex-1 cursor-pointer touch-pan-y select-none outline-none"
      >
        {/* Bar: loaded frames lit (the buffer, filling in from the newest
            frame as the loop loads), the rest dim; forecast frames hatched. */}
        <div className="pointer-events-none absolute inset-x-0 top-[24px] h-1 overflow-hidden rounded-full bg-white/10">
          {hasForecast && (
            <div className="absolute inset-y-0 right-0 opacity-40" style={{ left: `${at(nIdx)}%`, ...hatchFrom(nIdx) }} />
          )}
          {segments.map((s) => (
            <div
              key={s.from}
              className={`absolute inset-y-0 ${s.forecast ? '' : 'bg-accent/60'}`}
              style={{
                left: `${at(s.from)}%`,
                width: `${at(s.to) - at(s.from)}%`,
                ...(s.forecast ? hatchFrom(s.from) : null),
              }}
            />
          ))}
        </div>

        {/* Ticks: every frame, taller on the hour; sparse labels below. */}
        {ticks.map((t) => (
          <div key={t.index}>
            <div
              className={`pointer-events-none absolute top-[30px] w-px -translate-x-1/2 ${
                t.major ? 'h-[5px] bg-white/40' : 'h-[3px] bg-white/20'
              }`}
              style={{ left: `${t.at * 100}%` }}
            />
            {t.label && (
              <div
                className={`pointer-events-none absolute top-[37px] whitespace-nowrap text-[9px] leading-none tabular-nums ${
                  timeline[t.index]?.forecast ? 'text-amber-300/75' : 'text-white/60'
                }`}
                style={{ left: `${t.at * 100}%`, transform: ALIGN_SHIFT[t.align] }}
              >
                {t.label}
              </div>
            )}
          </div>
        ))}

        {hasForecast && (
          <div
            className="pointer-events-none absolute top-[20px] h-[15px] w-px -translate-x-1/2 bg-white/50"
            style={{ left: `${at(nIdx)}%` }}
          />
        )}

        {/* Hover ghost (mouse only): the frame a click would land on. */}
        {ghost !== null && (
          <>
            <div
              className="pointer-events-none absolute top-[19px] hidden h-3.5 w-px -translate-x-1/2 bg-white/45 [@media(hover:hover)]:block"
              style={{ left: `${at(ghost)}%` }}
            />
            {showGhostLabel && (
              <div
                className="pointer-events-none absolute top-0 hidden [@media(hover:hover)]:block"
                style={{ left: `${at(ghost)}%`, transform: ALIGN_SHIFT[ghostAlign] }}
              >
                <div
                  className={`flex h-4 items-center whitespace-nowrap rounded bg-ink-950/80 px-1.5 text-[10px] font-medium leading-none tabular-nums ring-1 ring-white/15 ${
                    timeline[ghost].forecast ? 'text-amber-300/90' : 'text-white/75'
                  }`}
                >
                  {ghostText}
                </div>
              </div>
            )}
          </>
        )}

        {/* Time bubble + tail, glided by the paint loop. */}
        <div ref={bubbleRef} className="pointer-events-none absolute left-0 top-0 will-change-transform">
          <div
            className={`flex h-4 items-center gap-1 whitespace-nowrap rounded px-1.5 text-[10px] font-semibold leading-none tabular-nums shadow-[0_1px_4px_rgba(0,0,0,0.45)] transition-colors duration-150 ${
              BUBBLE_STYLE[caption.kind]
            }`}
          >
            {caption.lead && (
              <span className={caption.kind === 'now' ? 'font-bold' : 'font-medium opacity-70'}>
                {caption.lead}
              </span>
            )}
            <span>{caption.text}</span>
          </div>
        </div>
        <div ref={tailRef} className="pointer-events-none absolute left-0 top-4 -ml-[3px] will-change-transform">
          <div className={`h-0 w-0 border-x-[3px] border-t-[3px] border-x-transparent ${TAIL_STYLE[caption.kind]}`} />
        </div>

        {/* Knob. Keyboard focus rings the knob rather than the whole track. */}
        <div ref={knobRef} className="pointer-events-none absolute left-0 top-[19px] -ml-[7px] h-3.5 w-3.5 will-change-transform">
          <div
            className={`h-full w-full rounded-full bg-white shadow-[0_0_0_3px_rgba(61,220,255,0.3),0_1px_4px_rgba(0,0,0,0.6)] transition-transform duration-150 motion-reduce:transition-none group-focus-visible:outline group-focus-visible:outline-2 group-focus-visible:outline-offset-2 group-focus-visible:outline-accent ${
              dragging ? 'scale-125' : '[@media(hover:hover)]:group-hover:scale-110'
            }`}
          />
        </div>
      </div>

      {/* Phones: the bubble carries the time, so there's no readout; only a
          delayed feed needs saying. */}
      {stale && !busy && (
        <div className="shrink-0 sm:hidden">
          <DelayedChip minutes={staleMin} />
        </div>
      )}

      {/* Readout: fixed width and tabular digits, so neither the time nor the
          status line nudges the track as they change. */}
      <div className="hidden w-[100px] shrink-0 text-right sm:block">
        <div className="truncate font-mono text-[15px] font-semibold leading-none tabular-nums text-white">
          {formatClock(current.time)}
        </div>
        <div className="mt-1 flex h-3.5 items-center justify-end gap-1 whitespace-nowrap text-[10px] leading-none">
          {busy ? (
            <span className="truncate text-amber-300/90">RainViewer busy</span>
          ) : (
            <>
              <span className={`min-w-0 truncate ${current.forecast ? 'text-amber-300' : 'text-white/60'}`}>
                {current.forecast && !stale && 'Forecast '}
                {onNewest ? caption.lead : caption.offset}
              </span>
              {stale && <DelayedChip minutes={staleMin} />}
            </>
          )}
        </div>
      </div>

      {/* Jump to the newest frame. An icon, not a word: the bubble and the
          readout already name that frame. */}
      <button
        onClick={jumpToLatest}
        aria-label="Jump to the latest radar frame"
        title="Jump to the latest radar frame"
        className={`${jumpOnPhone ? 'grid' : 'hidden'} h-7 w-7 shrink-0 place-items-center rounded-full bg-accent/10 text-accent transition-[opacity,visibility,background-color] duration-200 hover:bg-accent/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent motion-reduce:transition-none sm:grid ${
          jumpShown ? 'visible opacity-100' : 'invisible opacity-0'
        }`}
      >
        <svg viewBox="0 0 16 16" className="h-3 w-3" fill="currentColor" aria-hidden="true">
          <path d="M3 3.2v9.6L10 8z" />
          <rect x="11" y="3" width="2" height="10" rx="0.6" />
        </svg>
      </button>

      <button
        onClick={cycleSpeed}
        aria-label={`Playback speed ${speedLabel(speed)} — change`}
        title="Playback speed"
        className="hidden h-7 w-9 shrink-0 place-items-center rounded-full bg-white/5 font-mono text-[11px] text-white/60 transition hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent sm:grid"
      >
        {speedLabel(speed)}
      </button>
    </div>
  );
}

// "Delayed" chip for a stalled feed. Its explanation is in its accessible name,
// shows on hover, and toggles on a tap or click (touch has no hover).
function DelayedChip({ minutes }: { minutes: number }) {
  const [open, setOpen] = useState(false);
  const why = `The newest radar frame is ${minutes} min old — RainViewer's feed is running behind.`;
  return (
    <span className="group/delay relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setOpen(false);
        }}
        className="rounded bg-amber-400/15 px-1 py-px text-[9px] font-semibold leading-none text-amber-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300"
      >
        Delayed<span className="sr-only">: {why}</span>
      </button>
      <span
        aria-hidden="true"
        className={`pointer-events-none absolute bottom-full right-0 z-10 mb-2 w-52 whitespace-normal rounded-md bg-ink-950/95 px-2 py-1.5 text-left text-[11px] font-normal leading-snug text-white/85 shadow-panel ring-1 ring-white/10 ${
          open ? 'block' : 'hidden [@media(hover:hover)]:group-hover/delay:block'
        }`}
      >
        {why}
      </span>
    </span>
  );
}

// Circumference of the play button's ring (r = 18.5 in a 40 × 40 box).
const RING_C = 2 * Math.PI * 18.5;

function PlayButton({
  playing,
  loading,
  progress,
  busy,
  label,
  title,
}: {
  playing: boolean;
  loading: boolean;
  progress: number;
  busy: boolean;
  label: string;
  title: string;
}) {
  return (
    <button
      onClick={() => radarControl.toggle()}
      aria-label={label}
      title={title}
      className="relative grid h-10 w-10 shrink-0 place-items-center rounded-full bg-accent/15 text-accent transition hover:bg-accent/25 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent active:scale-95"
    >
      {/* Loading: the loop's progress as an arc, fading out once complete.
          Rate-limited: the whole ring dashed amber, whatever has loaded. */}
      <svg
        viewBox="0 0 40 40"
        aria-hidden="true"
        className={`pointer-events-none absolute inset-0 transition-opacity duration-500 motion-reduce:transition-none ${
          loading || busy ? 'opacity-100' : 'opacity-0'
        }`}
      >
        <circle
          cx="20"
          cy="20"
          r="18.5"
          fill="none"
          strokeWidth="2"
          strokeDasharray={busy ? '2.5 3.3' : undefined}
          className={busy ? 'stroke-amber-300/70' : 'stroke-white/10'}
        />
        <circle
          cx="20"
          cy="20"
          r="18.5"
          fill="none"
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray={RING_C}
          strokeDashoffset={RING_C * (1 - Math.min(1, Math.max(0, progress)))}
          transform="rotate(-90 20 20)"
          className={`transition-[stroke-dashoffset,stroke,opacity] duration-300 motion-reduce:transition-none ${
            busy ? 'stroke-amber-300' : 'stroke-accent'
          } ${loading && progress > 0 ? 'opacity-100' : 'opacity-0'}`}
        />
      </svg>
      {playing ? (
        <svg viewBox="0 0 16 16" className="h-4 w-4" fill="currentColor" aria-hidden="true">
          <rect x="3.5" y="2.5" width="3" height="11" rx="0.8" />
          <rect x="9.5" y="2.5" width="3" height="11" rx="0.8" />
        </svg>
      ) : (
        <svg viewBox="0 0 16 16" className="ml-0.5 h-4 w-4" fill="currentColor" aria-hidden="true">
          <path d="M4 2.6v10.8c0 .5.5.8.9.5l8.3-5.4a.6.6 0 0 0 0-1L4.9 2.1c-.4-.3-.9 0-.9.5z" />
        </svg>
      )}
    </button>
  );
}
