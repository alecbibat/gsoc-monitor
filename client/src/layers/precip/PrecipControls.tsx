import { usePrecipStore, QPF_PERIODS, QPF_PERIOD_SHORT } from './precipStore';

// Period selector + opacity slider, shown under the precip toggle. The color
// ramp lives on the map itself (PrecipLegend via MapLegends).
export function PrecipControls() {
  const period = usePrecipStore((s) => s.period);
  const setPeriod = usePrecipStore((s) => s.setPeriod);
  const opacity = usePrecipStore((s) => s.opacity);
  const setOpacity = usePrecipStore((s) => s.setOpacity);

  return (
    <div className="mt-2 space-y-2 rounded-md bg-black/20 p-2">
      <div className="grid grid-cols-4 gap-1">
        {QPF_PERIODS.map((p) => (
          <button
            key={p}
            onClick={() => setPeriod(p)}
            className={`rounded px-1 py-1 text-[11px] font-medium transition ${
              period === p
                ? 'bg-sky-500/30 text-sky-300'
                : 'bg-white/5 text-white/40 hover:bg-white/10 hover:text-white/70'
            }`}
          >
            {QPF_PERIOD_SHORT[p]}
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
