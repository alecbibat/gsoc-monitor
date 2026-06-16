import { useRadarStore } from './radarStore';

const WINDOWS: Array<30 | 60 | 120> = [30, 60, 120];

export function RadarControls() {
  const windowMinutes = useRadarStore((s) => s.windowMinutes);
  const setWindowMinutes = useRadarStore((s) => s.setWindowMinutes);
  const playing = useRadarStore((s) => s.playing);
  const setPlaying = useRadarStore((s) => s.setPlaying);
  const opacity = useRadarStore((s) => s.opacity);
  const setOpacity = useRadarStore((s) => s.setOpacity);

  return (
    <div className="mt-2 space-y-2 rounded-md bg-black/20 p-2">
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
