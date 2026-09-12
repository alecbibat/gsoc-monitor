import { useRadarStore } from './radarStore';
import { RADAR_WINDOWS, windowLabel } from './radarTimeline';

// Sidebar controls under the radar toggle: history window and opacity.
// Playback and scrubbing live on the map itself (RadarTimeline).
export function RadarControls() {
  const windowMinutes = useRadarStore((s) => s.windowMinutes);
  const setWindowMinutes = useRadarStore((s) => s.setWindowMinutes);
  const opacity = useRadarStore((s) => s.opacity);
  const setOpacity = useRadarStore((s) => s.setOpacity);

  return (
    <div className="mt-2 space-y-2 rounded-md bg-black/20 p-2">
      <div className="flex items-center gap-1">
        {RADAR_WINDOWS.map((w) => (
          <button
            key={w}
            onClick={() => setWindowMinutes(w)}
            className={`flex-1 rounded px-1 py-1 text-[11px] font-medium transition ${
              windowMinutes === w
                ? 'bg-sky-500/30 text-sky-300'
                : 'bg-white/5 text-white/40 hover:bg-white/10 hover:text-white/70'
            }`}
          >
            {windowLabel(w)}
          </button>
        ))}
      </div>

      <label className="flex items-center gap-2 text-[11px] text-white/50">
        Opacity
        <input
          type="range"
          min={0.2}
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
