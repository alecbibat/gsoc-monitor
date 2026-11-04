import { useMemo } from 'react';
import { useRadarStore } from './radarStore';
import {
  buildTimeline,
  clampIndex,
  formatClock,
  formatOffset,
  nowIndex,
  type TimelineFrame,
} from './radarTimeline';

// The radar loop's playback control: one line under the Precipitation Radar
// key, wherever the layer's legend shows (the map legend panel, the share
// page's legend cards). Play/pause, a thin scrub track and the time of the
// frame on screen. Window and opacity stay in the sidebar (RadarControls).
export function RadarPlayer() {
  const past = useRadarStore((s) => s.past);
  const nowcast = useRadarStore((s) => s.nowcast);
  const windowMinutes = useRadarStore((s) => s.windowMinutes);
  const currentIndex = useRadarStore((s) => s.currentIndex);
  const playing = useRadarStore((s) => s.playing);
  const setCurrentIndex = useRadarStore((s) => s.setCurrentIndex);
  const setPlaying = useRadarStore((s) => s.setPlaying);

  const timeline = useMemo(
    () => buildTimeline(past, nowcast, windowMinutes),
    [past, nowcast, windowMinutes]
  );

  return (
    <RadarPlayerView
      timeline={timeline}
      index={currentIndex}
      playing={playing}
      onPlayingChange={setPlaying}
      onSeek={(i) => {
        // Scrubbing takes over from playback; the ticker's own steps never
        // come through here.
        setPlaying(false);
        setCurrentIndex(i);
      }}
    />
  );
}

interface RadarPlayerViewProps {
  timeline: readonly TimelineFrame[];
  index: number;
  playing: boolean;
  onPlayingChange: (playing: boolean) => void;
  onSeek: (index: number) => void;
}

// Store-free, so it renders (and tests) on its own. Nothing until there are
// two frames to step between: the sidebar line says the feed is loading.
export function RadarPlayerView({ timeline, index, playing, onPlayingChange, onSeek }: RadarPlayerViewProps) {
  if (timeline.length < 2) return null;

  const n = timeline.length;
  const idx = clampIndex(index, n);
  const nIdx = nowIndex(timeline);
  const current = timeline[idx];
  const offset = formatOffset(current.time - timeline[nIdx].time);
  const when = current.forecast ? `forecast ${offset}` : offset;
  const pct = (i: number) => `${(i / (n - 1)) * 100}%`;
  const hasForecast = nIdx < n - 1;

  return (
    <div className="mt-1.5 flex items-center gap-2">
      <button
        type="button"
        onClick={() => onPlayingChange(!playing)}
        aria-label={playing ? 'Pause radar loop' : 'Play radar loop'}
        title={playing ? 'Pause the loop' : 'Play the loop'}
        className="grid h-5 w-5 shrink-0 place-items-center rounded-full text-sky-300 ring-1 ring-sky-400/35 transition hover:bg-sky-500/20 hover:text-sky-200"
      >
        <svg width="8" height="8" viewBox="0 0 10 10" fill="currentColor" aria-hidden="true">
          {playing ? <path d="M1.5 1h2.5v8H1.5zM6 1h2.5v8H6z" /> : <path d="M2 1l7 4-7 4z" />}
        </svg>
      </button>

      {/* Track visuals under an invisible native range input, so clicking,
          dragging and the arrow keys all just work. */}
      <div className="relative h-4 min-w-0 flex-1">
        <div className="absolute inset-x-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-white/15">
          {hasForecast && (
            <div className="absolute inset-y-0 right-0 rounded-r-full bg-amber-300/35" style={{ left: pct(nIdx) }} />
          )}
          <div className="absolute inset-y-0 left-0 rounded-full bg-sky-400/70" style={{ width: pct(idx) }} />
          <div
            className="absolute top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-sky-200 shadow"
            style={{ left: pct(idx) }}
          />
        </div>
        <input
          type="range"
          min={0}
          max={n - 1}
          step={1}
          value={idx}
          aria-label="Radar frame"
          aria-valuetext={`${formatClock(current.time)}, ${when}`}
          onPointerDown={() => onPlayingChange(false)}
          onChange={(e) => onSeek(Number(e.target.value))}
          className="absolute inset-0 m-0 h-full w-full cursor-pointer opacity-0"
        />
      </div>

      <span
        title={when}
        className={`w-[52px] shrink-0 whitespace-nowrap text-right font-mono text-[10px] tabular-nums ${
          current.forecast ? 'text-amber-300' : 'text-white/70'
        }`}
      >
        {formatClock(current.time)}
      </span>
    </div>
  );
}
