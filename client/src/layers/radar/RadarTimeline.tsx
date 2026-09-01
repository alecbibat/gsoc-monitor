import { useMemo, useRef } from 'react';
import { useLayersStore } from '../../store/layersStore';
import { useRadarStore, buildTimeline } from './radarStore';

// Local clock time, e.g. "2:40 PM".
function fmtClock(sec: number): string {
  return new Date(sec * 1000).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

// Offset from the newest frame, e.g. "−35 min", "−1h 10m".
function fmtRel(deltaSec: number): string {
  const m = Math.round(Math.abs(deltaSec) / 60);
  if (m === 0) return 'now';
  if (m < 60) return `−${m} min`;
  return `−${Math.floor(m / 60)}h ${m % 60}m`;
}

// The zoom.earth-style playback pill: play/pause, a draggable scrubber over
// the observed window with a tick per frame, and a live readout that pins to
// the newest frame as new data arrives. Mounts only while the radar layer is
// on. (Height is load-bearing: EarthTimeBar offsets itself 5.75rem up to
// stack above this bar — change one, change both.)
export function RadarTimeline() {
  const active = useLayersStore((s) => s.active.radar);
  const coverage = useRadarStore((s) => s.coverage);
  const windowMinutes = useRadarStore((s) => s.windowMinutes);
  const usFrames = useRadarStore((s) => s.usFrames);
  const globalFrames = useRadarStore((s) => s.globalFrames);
  const currentIndex = useRadarStore((s) => s.currentIndex);
  const playing = useRadarStore((s) => s.playing);
  const setCurrentIndex = useRadarStore((s) => s.setCurrentIndex);
  const setPlaying = useRadarStore((s) => s.setPlaying);

  const timeline = useMemo(
    () => buildTimeline({ coverage, windowMinutes, usFrames, globalFrames }),
    [coverage, windowMinutes, usFrames, globalFrames]
  );
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  if (!active || timeline.length < 2) return null;

  const n = timeline.length;
  const idx = Math.min(Math.max(0, currentIndex), n - 1);
  const cur = timeline[idx];
  const latest = timeline[n - 1].time;
  const isLive = idx === n - 1;

  const pct = (i: number) => (n > 1 ? (i / (n - 1)) * 100 : 100);
  const curPct = pct(idx);

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
        {/* Play / pause */}
        <button
          onClick={() => setPlaying(!playing)}
          aria-label={playing ? 'Pause' : 'Play'}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-sky-500/20 text-sky-300 transition hover:bg-sky-500/30"
        >
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
            {/* Played progress */}
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-sky-400/70"
              style={{ width: `${curPct}%` }}
            />
            {/* One tick per frame */}
            {timeline.map((slot, i) => (
              <div
                key={slot.time}
                className="absolute top-1/2 h-2.5 w-px -translate-y-1/2 bg-white/20"
                style={{ left: `${pct(i)}%` }}
              />
            ))}
            {/* Handle */}
            <div
              className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-sky-300 bg-ink-900 shadow"
              style={{ left: `${curPct}%` }}
            />
          </div>

          {/* End labels */}
          <div className="mt-1 flex justify-between text-[9px] text-white/35">
            <span>{fmtClock(timeline[0].time)}</span>
            <span>{fmtClock(latest)}</span>
          </div>
        </div>

        {/* Current frame readout */}
        <div className="w-[76px] shrink-0 text-right">
          <div className="font-mono text-[15px] font-bold leading-none tabular-nums text-white">
            {fmtClock(cur.time)}
          </div>
          <div className="mt-0.5 text-[10px]">
            {isLive ? (
              <span className="inline-flex items-center gap-1 font-semibold text-accent-ok">
                <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-accent-ok" />
                LIVE
              </span>
            ) : (
              <span className="text-white/45">{fmtRel(cur.time - latest)}</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
