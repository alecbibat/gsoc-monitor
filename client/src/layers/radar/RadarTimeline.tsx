import { useMemo } from 'react';
import { useLayersStore } from '../../store/layersStore';
import { useScreensaverStore } from '../../screensaver/screensaverStore';
import { useHoverStore } from '../../screensaver/hoverStore';
import { useRadarStore } from './radarStore';
import { buildTimeline, clampIndex, formatClock, formatOffset, nowIndex } from './radarTimeline';

// Playback scrubber for the radar loop: play/pause, a draggable track spanning
// the observed window (and any forecast frames past the "now" divider), and
// the current frame's time. Rendered as a bare pill — the host positions it
// (App's bottom-center dock, or the share globe's frame). Hidden while the
// layer is off or a tour has collapsed the chrome.
export function RadarTimeline() {
  const active = useLayersStore((s) => s.active.radar);
  const past = useRadarStore((s) => s.past);
  const nowcast = useRadarStore((s) => s.nowcast);
  const windowMinutes = useRadarStore((s) => s.windowMinutes);
  const currentIndex = useRadarStore((s) => s.currentIndex);
  const playing = useRadarStore((s) => s.playing);
  const setCurrentIndex = useRadarStore((s) => s.setCurrentIndex);
  const setPlaying = useRadarStore((s) => s.setPlaying);
  const screensaverActive = useScreensaverStore((s) => s.active);
  const hoverEngaged = useHoverStore((s) => s.active || s.picking);

  const timeline = useMemo(
    () => buildTimeline(past, nowcast, windowMinutes),
    [past, nowcast, windowMinutes]
  );

  if (!active || screensaverActive || hoverEngaged || timeline.length < 2) return null;

  const n = timeline.length;
  const idx = clampIndex(currentIndex, n);
  const nIdx = nowIndex(timeline);
  const current = timeline[idx];
  const nowTime = timeline[nIdx].time;
  const pct = (i: number) => (i / (n - 1)) * 100;
  const hasForecast = nIdx < n - 1;

  return (
    <div className="pointer-events-auto flex w-full max-w-2xl items-center gap-3 rounded-2xl border border-white/10 bg-ink-900/85 px-3 py-2.5 shadow-panel backdrop-blur-md">
      <button
        onClick={() => setPlaying(!playing)}
        aria-label={playing ? 'Pause radar loop' : 'Play radar loop'}
        className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-sky-500/20 text-sky-300 transition hover:bg-sky-500/30"
      >
        <span className="text-[15px] leading-none">{playing ? '⏸' : '▶'}</span>
      </button>

      <div className="min-w-0 flex-1 select-none py-2">
        {/* Track visuals, with an invisible native range input stretched over
            them so clicking, dragging and the arrow keys all just work. */}
        <div className="relative h-1.5 rounded-full bg-white/15">
          {hasForecast && (
            <div
              className="absolute inset-y-0 right-0 rounded-r-full"
              style={{
                left: `${pct(nIdx)}%`,
                backgroundImage:
                  'repeating-linear-gradient(45deg, rgba(255,210,80,0.45) 0 4px, rgba(255,210,80,0.12) 4px 8px)',
              }}
            />
          )}
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-sky-400/70"
            style={{ width: `${pct(idx)}%` }}
          />
          {hasForecast && (
            <div className="absolute -inset-y-1 w-px bg-white/60" style={{ left: `${pct(nIdx)}%` }} />
          )}
          <div
            className="pointer-events-none absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-sky-300 bg-ink-900 shadow"
            style={{ left: `${pct(idx)}%` }}
          />
          <input
            type="range"
            min={0}
            max={n - 1}
            step={1}
            value={idx}
            aria-label="Radar frame"
            aria-valuetext={formatClock(current.time)}
            onPointerDown={() => setPlaying(false)}
            onChange={(e) => {
              // Any user-driven change (drag, click, arrow keys) takes over
              // from playback; the ticker's own updates never fire onChange.
              setPlaying(false);
              setCurrentIndex(Number(e.target.value));
            }}
            className="absolute inset-x-0 -inset-y-2 m-0 h-auto w-full cursor-pointer opacity-0"
          />
        </div>
        <div className="mt-1.5 flex justify-between text-[9px] text-white/35">
          <span>{formatClock(timeline[0].time)}</span>
          {hasForecast && <span className="hidden text-amber-300/70 sm:inline">forecast →</span>}
          <span>{formatClock(timeline[n - 1].time)}</span>
        </div>
      </div>

      <div className="w-[92px] shrink-0 whitespace-nowrap text-right">
        <div className="font-mono text-[15px] font-bold leading-none tabular-nums text-white">
          {formatClock(current.time)}
        </div>
        <div className={`mt-0.5 text-[10px] ${current.forecast ? 'text-amber-300' : 'text-white/45'}`}>
          {current.forecast
            ? `forecast ${formatOffset(current.time - nowTime)}`
            : formatOffset(current.time - nowTime)}
        </div>
      </div>
    </div>
  );
}
