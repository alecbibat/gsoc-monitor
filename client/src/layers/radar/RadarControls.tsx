import { useRadarStore } from './radarStore';
import type { RadarMode } from './radarStore';

const WINDOWS: Array<30 | 60 | 120> = [30, 60, 120];
const MODES: Array<{ value: RadarMode; label: string }> = [
  { value: 'radar', label: 'Radar' },
  { value: 'satellite', label: 'Satellite' },
  { value: 'combined', label: 'Combined' },
];
// RainViewer color scheme ids — curated to a few clean palettes.
const PALETTES: Array<{ value: number; label: string }> = [
  { value: 4, label: 'Classic' },  // The Weather Channel (zoom.earth-like)
  { value: 2, label: 'Blue' },     // Universal Blue
  { value: 7, label: 'Vivid' },    // Rainbow @ SELEX-SI
  { value: 8, label: 'Mono' },     // Dark Sky
];

export function RadarControls() {
  const mode = useRadarStore((s) => s.mode);
  const setMode = useRadarStore((s) => s.setMode);
  const windowMinutes = useRadarStore((s) => s.windowMinutes);
  const setWindowMinutes = useRadarStore((s) => s.setWindowMinutes);
  const playing = useRadarStore((s) => s.playing);
  const setPlaying = useRadarStore((s) => s.setPlaying);
  const opacity = useRadarStore((s) => s.opacity);
  const setOpacity = useRadarStore((s) => s.setOpacity);
  const colorScheme = useRadarStore((s) => s.colorScheme);
  const setColorScheme = useRadarStore((s) => s.setColorScheme);

  // The palette only affects the precipitation overlay, not the IR satellite.
  const showPalette = mode !== 'satellite';

  return (
    <div className="mt-2 space-y-2 rounded-md bg-black/20 p-2">
      {/* Mode selector */}
      <div className="flex items-center gap-1">
        {MODES.map(({ value, label }) => (
          <button
            key={value}
            onClick={() => setMode(value)}
            className={`flex-1 rounded px-1 py-1 text-[11px] font-medium transition ${
              mode === value
                ? 'bg-sky-500/30 text-sky-300'
                : 'bg-white/5 text-white/40 hover:bg-white/10 hover:text-white/70'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Time window + play/pause (hidden in satellite-only with no window concept) */}
      <div className="flex items-center gap-1.5">
        {WINDOWS.map((w) => (
          <button
            key={w}
            onClick={() => setWindowMinutes(w)}
            className={`flex-1 rounded px-1.5 py-1 text-[11px] font-medium transition ${
              windowMinutes === w
                ? 'bg-accent/20 text-accent'
                : 'bg-white/5 text-white/50 hover:bg-white/10'
            }`}
          >
            {w}m
          </button>
        ))}
        <button
          onClick={() => setPlaying(!playing)}
          className="rounded bg-white/5 px-2 py-1 text-[11px] font-medium text-white/70 hover:bg-white/10"
        >
          {playing ? '⏸' : '▶'}
        </button>
      </div>

      {/* Precipitation palette */}
      {showPalette && (
        <div className="flex items-center gap-1">
          {PALETTES.map(({ value, label }) => (
            <button
              key={value}
              onClick={() => setColorScheme(value)}
              className={`flex-1 rounded px-1 py-1 text-[11px] font-medium transition ${
                colorScheme === value
                  ? 'bg-sky-500/30 text-sky-300'
                  : 'bg-white/5 text-white/40 hover:bg-white/10 hover:text-white/70'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      <label className="flex items-center gap-2 text-[11px] text-white/50">
        Opacity
        <input
          type="range"
          min={0.1}
          max={1}
          step={0.05}
          value={opacity}
          onChange={(e) => setOpacity(Number(e.target.value))}
          className="flex-1 accent-accent"
        />
      </label>
    </div>
  );
}
