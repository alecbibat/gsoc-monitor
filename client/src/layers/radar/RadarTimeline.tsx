import { useMemo, useRef } from 'react';
import { useLayersStore } from '../../store/layersStore';
import { useRadarStore, buildTimeline, nowIndex, LOOP_READY_THRESHOLD } from './radarStore';

// Local clock time, e.g. "2:40 PM".
function fmtClock(sec: number): string {
  return new Date(sec * 1000).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

// Offset from "now", e.g. "Now", "+20 min", "−1h 10m".
function fmtRel(deltaSec: number): string {
  const m = Math.round(deltaSec / 60);
  if (m === 0) return 'Now';
  const sign = m > 0 ? '+' : '−';
  const a = Math.abs(m);
  if (a < 60) return `${sign}${a} min`;
  return `${sign}${Math.floor(a / 60)}h ${a % 60}m`;
}

// A Zoom Earth-style precipitation timeline: a draggable scrubber spanning the
// observed window into the short-range forecast, with a play/pause control, a
// "now" divider, and the current frame's time. Mounts only while the radar
// layer is on.
export function RadarTimeline() {
  const active = useLayersStore((s) => s.active.radar);
  const mode = useRadarStore((s) => s.mode);
  const frames = useRadarStore((s) => s.frames);
  const nowcastFrames = useRadarStore((s) => s.nowcastFrames);
  const satelliteFrames = useRadarStore((s) => s.satelliteFrames);
  const windowMinutes = useRadarStore((s) => s.windowMinutes);
  const currentIndex = useRadarStore((s) => s.currentIndex);
  const playing = useRadarStore((s) => s.playing);
  const setCurrentIndex = useRadarStore((s) => s.setCurrentIndex);
  const setPlaying = useRadarStore((s) => s.setPlaying);
  const loopReady = useRadarStore((s) => s.loopReady);

  const timeline = useMemo(
    () => buildTimeline({ mode, frames, nowcastFrames, satelliteFrames, windowMinutes }),
    [mode, frames, nowcastFrames, satelliteFrames, windowMinutes]
  );
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  if (!active || timeline.length < 2) return null;

  const n = timeline.length;
  const idx = Math.min(Math.max(0, currentIndex), n - 1);
  const nIdx = nowIndex(timeline);
  // Engine v2 decodes the whole loop before playing it, so the controls say so
  // rather than looking stuck. v1 never reports progress, so this stays off.
  const warming = playing && loopReady > 0 && loopReady < LOOP_READY_THRESHOLD;
  const cur = timeline[idx];
  const nowTime = timeline[nIdx].time;

  const pct = (i: number) => (n > 1 ? (i / (n - 1)) * 100 : 100);
  const nowPct = pct(nIdx);
  const curPct = pct(idx);
  const hasForecast = nIdx < n - 1;

  const seek = (clientX: number) => {
    const el = trackRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
    setCurrentIndex(Math.round(frac * (n - 1)));
  };

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-5 z-30 flex justify-center px-4">
      <div className="pointer-events-auto flex w-full max-w-2xl items-center gap-3 rounded-2xl border border-white/10 bg-ink-900/85 px-3 py-2.5 shadow-panel backdrop-blur-md">
        {/* Play / pause, with a warming ring while the loop is still decoding */}
        <button
          onClick={() => setPlaying(!playing)}
          aria-label={playing ? 'Pause' : 'Play'}
          title={warming ? `Buffering loop — ${Math.round(loopReady * 100)}%` : undefined}
          className="relative grid h-9 w-9 shrink-0 place-items-center rounded-full bg-sky-500/20 text-sky-300 transition hover:bg-sky-500/30"
        >
          {warming && (
            <span
              aria-hidden
              className="absolute inset-0 rounded-full"
              style={{
                background: `conic-gradient(rgb(125 211 252 / 0.85) ${loopReady * 360}deg, rgb(125 211 252 / 0.12) 0deg)`,
                WebkitMask: 'radial-gradient(circle, transparent 62%, #000 64%)',
                mask: 'radial-gradient(circle, transparent 62%, #000 64%)',
              }}
            />
          )}
          <span className="text-[15px] leading-none">{playing ? '⏸' : '▶'}</span>
        </button>

        {/* Track */}
        <div className="relative flex-1 select-none py-3">
          <div
            ref={trackRef}
            onPointerDown={(e) => {
              dragging.current = true;
              (e.target as HTMLElement).setPointerCapture(e.pointerId);
              setPlaying(false);
              seek(e.clientX);
            }}
            onPointerMove={(e) => dragging.current && seek(e.clientX)}
            onPointerUp={(e) => {
              dragging.current = false;
              (e.target as HTMLElement).releasePointerCapture(e.pointerId);
            }}
            className="relative h-1.5 cursor-pointer rounded-full bg-white/15"
          >
            {/* Forecast zone (hatched) from "now" to the end */}
            {hasForecast && (
              <div
                className="absolute inset-y-0 rounded-r-full"
                style={{
                  left: `${nowPct}%`,
                  right: 0,
                  backgroundImage:
                    'repeating-linear-gradient(45deg, rgba(255,210,80,0.45) 0 4px, rgba(255,210,80,0.12) 4px 8px)',
                }}
              />
            )}
            {/* How much of the loop is decoded and ready to play */}
            {loopReady > 0 && loopReady < 1 && (
              <div
                className="absolute inset-y-0 left-0 rounded-full bg-white/20"
                style={{ width: `${loopReady * 100}%` }}
              />
            )}
            {/* Played progress */}
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-sky-400/70"
              style={{ width: `${curPct}%` }}
            />
            {/* "Now" divider */}
            {hasForecast && (
              <div className="absolute -inset-y-1 w-px bg-white/60" style={{ left: `${nowPct}%` }} />
            )}
            {/* Handle */}
            <div
              className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-sky-300 bg-ink-900 shadow"
              style={{ left: `${curPct}%` }}
            />
          </div>

          {/* End labels */}
          <div className="mt-1 flex justify-between text-[9px] text-white/35">
            <span>{fmtClock(timeline[0].time)}</span>
            {hasForecast && (
              <span className="text-amber-300/70" style={{ marginRight: `${100 - nowPct}%` }}>
                now
              </span>
            )}
            <span>{fmtClock(timeline[n - 1].time)}</span>
          </div>
        </div>

        {/* Current frame readout */}
        <div className="w-[72px] shrink-0 text-right">
          <div className="font-mono text-[15px] font-bold leading-none tabular-nums text-white">
            {fmtClock(cur.time)}
          </div>
          <div className={`mt-0.5 text-[10px] ${cur.forecast ? 'text-amber-300' : 'text-white/45'}`}>
            {cur.forecast ? `forecast ${fmtRel(cur.time - nowTime)}` : fmtRel(cur.time - nowTime)}
          </div>
        </div>
      </div>
    </div>
  );
}
