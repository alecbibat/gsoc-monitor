import { useRadarStore } from './radarStore';
import type { RadarPaletteId } from './palettes';

const WINDOWS: Array<30 | 60 | 120> = [30, 60, 120];
// Client-side palettes (see palettes.ts) — applied to raw dBZ tiles.
const PALETTES: Array<{ value: RadarPaletteId; label: string }> = [
  { value: 'storm', label: 'Storm' },     // zoom.earth-class default
  { value: 'classic', label: 'Classic' }, // familiar meteorology greens
  { value: 'blue', label: 'Blue' },       // subdued single-hue
  { value: 'mono', label: 'Mono' },       // grayscale
];

export function RadarControls() {
  const windowMinutes = useRadarStore((s) => s.windowMinutes);
  const setWindowMinutes = useRadarStore((s) => s.setWindowMinutes);
  const playing = useRadarStore((s) => s.playing);
  const setPlaying = useRadarStore((s) => s.setPlaying);
  const opacity = useRadarStore((s) => s.opacity);
  const setOpacity = useRadarStore((s) => s.setOpacity);
  const palette = useRadarStore((s) => s.palette);
  const setPalette = useRadarStore((s) => s.setPalette);

  return (
    <div className="mt-2 space-y-2 rounded-md bg-black/20 p-2">
      {/* Time window + play/pause */}
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
      <div className="flex items-center gap-1">
        {PALETTES.map(({ value, label }) => (
          <button
            key={value}
            onClick={() => setPalette(value)}
            className={`flex-1 rounded px-1 py-1 text-[11px] font-medium transition ${
              palette === value
                ? 'bg-sky-500/30 text-sky-300'
                : 'bg-white/5 text-white/40 hover:bg-white/10 hover:text-white/70'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

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
