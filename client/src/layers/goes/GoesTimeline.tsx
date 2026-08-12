import { useMemo, useRef } from 'react';
import { useLayersStore } from '../../store/layersStore';
import { useRadarStore, buildTimeline } from '../radar/radarStore';
import { useGoesStore, goesFramesInWindow } from './goesStore';

// Local clock time, e.g. "2:40 PM".
function fmtClock(sec: number): string {
  return new Date(sec * 1000).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

// Offset from the newest scan, e.g. "Latest", "−50 min", "−2h 10m".
function fmtRel(deltaSec: number): string {
  const m = Math.round(deltaSec / 60);
  if (m === 0) return 'Latest';
  const a = Math.abs(m);
  if (a < 60) return `−${a} min`;
  return `−${Math.floor(a / 60)}h ${a % 60}m`;
}

// Floating scrubber for the live-satellite loop — the RadarTimeline pattern
// without a forecast zone (there is no GeoColor forecast). Mounts only while
// the layer is on; when the radar timeline is also up it steps one card height
// higher so the two never overlap.
export function GoesTimeline() {
  const active = useLayersStore((s) => s.active.goes);
  const radarActive = useLayersStore((s) => s.active.radar);
  // Mirror RadarTimeline's own render gate (active + ≥2 frames) so this card
  // only steps up when a radar card is actually on screen below it — the
  // radar toggle alone leaves a gap while the radar manifest is still loading.
  const radarHasTimeline = useRadarStore((s) => buildTimeline(s).length >= 2);
  const frames = useGoesStore((s) => s.frames);
  const windowMinutes = useGoesStore((s) => s.windowMinutes);
  const currentIndex = useGoesStore((s) => s.currentIndex);
  const playing = useGoesStore((s) => s.playing);
  const source = useGoesStore((s) => s.source);
  const setCurrentIndex = useGoesStore((s) => s.setCurrentIndex);
  const setPlaying = useGoesStore((s) => s.setPlaying);

  const timeline = useMemo(
    () => goesFramesInWindow(frames, windowMinutes),
    [frames, windowMinutes]
  );
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  if (!active || timeline.length < 2) return null;

  const n = timeline.length;
  const idx = Math.min(Math.max(0, currentIndex), n - 1);
  const cur = timeline[idx];
  const latest = timeline[n - 1];
  const curPct = n > 1 ? (idx / (n - 1)) * 100 : 100;

  const seek = (clientX: number) => {
    const el = trackRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
    setCurrentIndex(Math.round(frac * (n - 1)));
  };

  return (
    <div
      className={`pointer-events-none absolute inset-x-0 z-30 flex justify-center px-4 ${
        radarActive && radarHasTimeline ? 'bottom-[5.75rem]' : 'bottom-5'
      }`}
    >
      <div className="pointer-events-auto flex w-full max-w-2xl items-center gap-3 rounded-2xl border border-white/10 bg-ink-900/85 px-3 py-2.5 shadow-panel backdrop-blur-md">
        {/* Play / pause */}
        <button
          onClick={() => setPlaying(!playing)}
          aria-label={playing ? 'Pause' : 'Play'}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-emerald-500/20 text-emerald-300 transition hover:bg-emerald-500/30"
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
              className="absolute inset-y-0 left-0 rounded-full bg-emerald-400/70"
              style={{ width: `${curPct}%` }}
            />
            {/* Handle */}
            <div
              className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-emerald-300 bg-ink-900 shadow"
              style={{ left: `${curPct}%` }}
            />
          </div>

          {/* End labels */}
          <div className="mt-1 flex justify-between text-[9px] text-white/35">
            <span>{fmtClock(timeline[0])}</span>
            <span className="uppercase tracking-wider text-white/25">
              🛰 GeoColor{source === 'estimated' ? ' · est. times' : ''}
            </span>
            <span>{fmtClock(latest)}</span>
          </div>
        </div>

        {/* Current frame readout */}
        <div className="w-[72px] shrink-0 text-right">
          <div className="font-mono text-[15px] font-bold leading-none tabular-nums text-white">
            {fmtClock(cur)}
          </div>
          <div className="mt-0.5 text-[10px] text-white/45">{fmtRel(cur - latest)}</div>
        </div>
      </div>
    </div>
  );
}
