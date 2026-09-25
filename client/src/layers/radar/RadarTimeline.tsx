import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
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
import { bufferRuns, timelineTicks } from './radarTimelineTicks';
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

export function playButtonLabel(p: { playing: boolean; ready: number; total: number }, busy: boolean): string {
  let label = p.playing ? 'Pause radar loop' : 'Play radar loop';
  if (p.total > 0 && p.ready < p.total) label += ` (loading ${p.ready} of ${p.total} frames)`;
  if (busy) label += ' · RainViewer busy';
  return label;
}

// Track layout, px from the top of the 47 px track box: bubble 0–16 with its
// tail to 19, knob 19–33 centred on the bar at 24–28, ticks from 30, labels
// from 37.
const BUBBLE_OVERHANG_PX = 10; // how far the bubble may hang past the track's ends
const GHOST_EDGE_PX = 28;

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
// shows the loop loading), a track with per-frame ticks, hour labels, a
// buffer bar of loaded frames and a gliding knob + time bubble, the current
// frame's time, a jump-to-latest button and the speed. A bare pill — the host
// positions it (App's bottom-center dock, or the share globe's frame).
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

function Scrubber({ timeline }: { timeline: TimelineFrame[] }) {
  const n = timeline.length;
  const head = useRadarPlayhead();
  const speed = useRadarStore((s) => s.speed);
  const setSpeed = useRadarStore((s) => s.setSpeed);
  const coolingDownMs = useRadarStore((s) => s.coolingDownMs);
  const nowSec = useNowSec(30_000);

  const trackRef = useRef<HTMLDivElement>(null);
  const knobRef = useRef<HTMLDivElement>(null);
  const fillRef = useRef<HTMLDivElement>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const tailRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; rect: DOMRect } | null>(null);
  const nIdx = nowIndex(timeline);
  // Shared with the paint loop, which runs outside React.
  const geo = useRef({ n, restPos: nIdx, trackW: 0, bubbleW: 0, repaint: () => {} });
  const [trackW, setTrackW] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [hover, setHover] = useState<number | null>(null);

  // The knob, the progress fill and the time bubble follow the continuous
  // playhead by writing transforms directly: no React render per frame.
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
      // The bubble and its tail snap to whole pixels so the text stays crisp.
      const bx = Math.round(Math.min(Math.max(x - bw / 2, -BUBBLE_OVERHANG_PX), w - bw + BUBBLE_OVERHANG_PX));
      if (knobRef.current) knobRef.current.style.transform = `translate3d(${x}px, 0, 0)`;
      if (fillRef.current) fillRef.current.style.transform = `scaleX(${frac})`;
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
      if (drag.current) radarControl.endScrub();
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

  const ticks = useMemo(() => timelineTicks(timeline.map((t) => t.time), trackW), [timeline, trackW]);
  const runs = useMemo(
    () => (head.readyMask.length === n ? bufferRuns(head.readyMask) : []),
    [head.readyMask, n]
  );

  const positionAt = (clientX: number, rect: DOMRect): number => {
    const total = radarPlayhead.get().total > 1 ? radarPlayhead.get().total : n;
    const frac = rect.width > 0 ? Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)) : 0;
    return frac * (total - 1);
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || drag.current) return;
    const el = e.currentTarget;
    const d = { id: e.pointerId, rect: el.getBoundingClientRect() };
    drag.current = d;
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      // The pointer is already gone; the drag ends on its own.
    }
    setDragging(true);
    setHover(null);
    radarControl.scrub(positionAt(e.clientX, d.rect));
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (d) {
      if (d.id === e.pointerId) radarControl.scrub(positionAt(e.clientX, d.rect));
      return;
    }
    if (e.pointerType !== 'mouse') return;
    const rect = e.currentTarget.getBoundingClientRect();
    const frac = rect.width > 0 ? Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)) : 0;
    const i = Math.round(frac * (n - 1));
    setHover((h) => (h === i ? h : i));
  };

  const endDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    setDragging(false);
    radarControl.endScrub();
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

  const ghost = hover !== null && hover < n && hover !== idx && !dragging ? hover : null;
  const ghostX = ghost !== null ? (at(ghost) / 100) * trackW : 0;
  const ghostAlign = ghostX < GHOST_EDGE_PX ? 'start' : ghostX > trackW - GHOST_EDGE_PX ? 'end' : 'center';

  const onNewest = caption.kind === 'now' || caption.kind === 'latest';
  const valueText = current.forecast
    ? `${formatClock(current.time)}, forecast ${caption.offset}`
    : onNewest
      ? `${formatClock(current.time)}, latest frame`
      : `${formatClock(current.time)}, ${caption.offset}`;
  const staleMin = Math.round((nowSec - newest.time) / 60);
  const playLabel = playButtonLabel(head, busy);

  return (
    <div className="pointer-events-auto flex w-full max-w-2xl items-center gap-2 rounded-2xl border border-white/10 bg-ink-900/85 px-3 py-2 shadow-panel backdrop-blur-md sm:gap-3">
      <PlayButton
        playing={head.playing}
        loading={loading}
        progress={head.total > 0 ? head.ready / head.total : 0}
        buffering={head.buffering}
        busy={busy}
        label={playLabel}
      />

      <div
        ref={trackRef}
        role="slider"
        tabIndex={0}
        aria-label="Radar frame"
        aria-valuemin={0}
        aria-valuemax={n - 1}
        aria-valuenow={idx}
        aria-valuetext={valueText}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onLostPointerCapture={endDrag}
        onPointerLeave={() => setHover(null)}
        onKeyDown={onKeyDown}
        className="group relative h-[47px] min-w-0 flex-1 cursor-pointer touch-pan-y select-none outline-none"
      >
        {/* Bar: base, loaded-frame buffer, forecast hatching, progress fill. */}
        <div className="pointer-events-none absolute inset-x-0 top-[24px] h-1 overflow-hidden rounded-full bg-white/10">
          {runs.map(([a, b]) => {
            const left = at(Math.max(0, a - 0.5));
            const right = at(Math.min(n - 1, b + 0.5));
            return (
              <div
                key={a}
                className="absolute inset-y-0 bg-white/15"
                style={{ left: `${left}%`, width: `${right - left}%` }}
              />
            );
          })}
          {hasForecast && (
            <div
              className="absolute inset-y-0 right-0"
              style={{ left: `${at(nIdx)}%`, backgroundImage: FORECAST_HATCH }}
            />
          )}
          <div
            ref={fillRef}
            className="absolute inset-0 origin-left bg-accent/80 will-change-transform"
            style={{ transform: 'scaleX(0)' }}
          />
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
                  timeline[t.index]?.forecast ? 'text-amber-300/60' : 'text-white/40'
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
            <div
              className="pointer-events-none absolute top-0 hidden [@media(hover:hover)]:block"
              style={{ left: `${at(ghost)}%`, transform: ALIGN_SHIFT[ghostAlign] }}
            >
              <div
                className={`flex h-4 items-center whitespace-nowrap rounded bg-ink-950/80 px-1.5 text-[10px] font-medium leading-none tabular-nums ring-1 ring-white/15 ${
                  timeline[ghost].forecast ? 'text-amber-300/90' : 'text-white/75'
                }`}
              >
                {formatClock(timeline[ghost].time)}
              </div>
            </div>
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

      {/* Readout: fixed minimum width and tabular digits, so it doesn't jitter
          as the time changes. */}
      <div className="min-w-[66px] shrink-0 text-right sm:min-w-[88px]">
        <div className="whitespace-nowrap font-mono text-[13px] font-semibold leading-none tabular-nums text-white sm:text-[15px]">
          {formatClock(current.time)}
        </div>
        <div className="mt-1 flex h-3.5 items-center justify-end gap-1 whitespace-nowrap text-[10px] leading-none">
          {busy ? (
            <span
              className="text-amber-300/80"
              title={`RainViewer is rate-limiting requests — loading resumes in about ${Math.ceil(coolingDownMs / 1000)} s`}
            >
              <span className="sm:hidden">Busy</span>
              <span className="hidden sm:inline">RainViewer busy</span>
            </span>
          ) : (
            <>
              <span
                className={`${current.forecast ? 'text-amber-300' : 'text-white/45'} ${stale ? 'hidden sm:inline' : ''}`}
              >
                {current.forecast && <span className="hidden sm:inline">Forecast </span>}
                {onNewest ? 'Latest' : caption.offset}
              </span>
              {stale && (
                <span
                  className="rounded bg-amber-400/15 px-1 py-px text-[9px] font-semibold text-amber-300"
                  title={`The newest radar frame is ${staleMin} min old — RainViewer's feed is running behind`}
                >
                  Delayed
                </span>
              )}
            </>
          )}
        </div>
      </div>

      {/* Jump to latest: kept in the layout while hidden so the track doesn't
          jump as it comes and goes. */}
      <button
        onClick={() => radarControl.latest()}
        aria-label="Jump to the latest radar frame"
        title="Jump to the latest radar frame"
        className={`flex h-7 shrink-0 items-center gap-1 rounded-full bg-accent/10 px-2 text-[11px] font-medium text-accent transition-[opacity,visibility,background-color] duration-200 hover:bg-accent/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent motion-reduce:transition-none sm:px-2.5 ${
          head.live ? 'invisible opacity-0' : 'visible opacity-100'
        }`}
      >
        <svg viewBox="0 0 16 16" className="h-3 w-3" fill="currentColor" aria-hidden="true">
          <path d="M3 3.2v9.6L10 8z" />
          <rect x="11" y="3" width="2" height="10" rx="0.6" />
        </svg>
        <span className="hidden sm:inline">Latest</span>
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

// Circumference of the play button's ring (r = 18.5 in a 40 × 40 box).
const RING_C = 2 * Math.PI * 18.5;

function PlayButton({
  playing,
  loading,
  progress,
  buffering,
  busy,
  label,
}: {
  playing: boolean;
  loading: boolean;
  progress: number;
  buffering: boolean;
  busy: boolean;
  label: string;
}) {
  return (
    <button
      onClick={() => radarControl.toggle()}
      aria-label={label}
      title={label}
      className="relative grid h-10 w-10 shrink-0 place-items-center rounded-full bg-accent/15 text-accent transition hover:bg-accent/25 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent active:scale-95"
    >
      {/* Loading: the loop's progress as an arc, fading out once complete. */}
      <svg
        viewBox="0 0 40 40"
        aria-hidden="true"
        className={`pointer-events-none absolute inset-0 transition-opacity duration-500 motion-reduce:transition-none ${
          loading ? 'opacity-100' : 'opacity-0'
        }`}
      >
        <circle cx="20" cy="20" r="18.5" fill="none" strokeWidth="2" className="stroke-white/10" />
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
          className={`transition-[stroke-dashoffset,stroke] duration-300 motion-reduce:transition-none ${
            busy ? 'stroke-amber-300' : 'stroke-accent'
          }`}
        />
      </svg>
      {/* Buffering with the loop loaded (waiting on a frame after panning).
          Mounted only while shown, so no animation idles in the background. */}
      {buffering && !loading && (
        <svg viewBox="0 0 40 40" aria-hidden="true" className="pointer-events-none absolute inset-0 animate-spin">
          <circle
            cx="20"
            cy="20"
            r="18.5"
            fill="none"
            strokeWidth="2"
            strokeLinecap="round"
            strokeDasharray={`${RING_C * 0.22} ${RING_C}`}
            className="stroke-accent/70"
          />
        </svg>
      )}
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
