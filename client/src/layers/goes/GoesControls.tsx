import { useGoesStore, type GoesWindow } from './goesStore';

const WINDOWS: Array<{ value: GoesWindow; label: string }> = [
  { value: 60, label: '1h' },
  { value: 120, label: '2h' },
  { value: 180, label: '3h' },
];

export function GoesControls() {
  const windowMinutes = useGoesStore((s) => s.windowMinutes);
  const setWindowMinutes = useGoesStore((s) => s.setWindowMinutes);
  const playing = useGoesStore((s) => s.playing);
  const setPlaying = useGoesStore((s) => s.setPlaying);
  const opacity = useGoesStore((s) => s.opacity);
  const setOpacity = useGoesStore((s) => s.setOpacity);

  return (
    <div className="mt-2 space-y-2 rounded-md bg-black/20 p-2">
      {/* Loop window + play/pause */}
      <div className="flex items-center gap-1.5">
        {WINDOWS.map(({ value, label }) => (
          <button
            key={value}
            onClick={() => setWindowMinutes(value)}
            className={`flex-1 rounded px-1.5 py-1 text-[11px] font-medium transition ${
              windowMinutes === value
                ? 'bg-accent/20 text-accent'
                : 'bg-white/5 text-white/50 hover:bg-white/10'
            }`}
          >
            {label}
          </button>
        ))}
        <button
          onClick={() => setPlaying(!playing)}
          className="rounded bg-white/5 px-2 py-1 text-[11px] font-medium text-white/70 hover:bg-white/10"
        >
          {playing ? '⏸' : '▶'}
        </button>
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

      <p className="text-[10px] leading-relaxed text-white/30">
        GOES-East + GOES-West + Himawari · new scan every 10 min. No coverage
        over Europe/Africa (no Meteosat feed in NASA GIBS).
      </p>
    </div>
  );
}
