import {
  usePrecipStore,
  QPF_PERIODS,
  QPF_PERIOD_SHORT,
  QPF_LEGEND,
} from './precipStore';

// Compact color-ramp legend built from the exact WPC QPF symbology (inches).
function PrecipLegend() {
  return (
    <div className="pt-1">
      <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-white/30">
        Forecast accumulation (inches)
      </div>
      <div className="flex h-3 overflow-hidden rounded-sm ring-1 ring-white/10">
        {QPF_LEGEND.map((s) => (
          <div
            key={s.inches}
            className="flex-1"
            style={{ backgroundColor: `rgb(${s.rgb[0]}, ${s.rgb[1]}, ${s.rgb[2]})` }}
            title={`${s.inches}"`}
          />
        ))}
      </div>
      <div className="mt-0.5 flex justify-between text-[9px] tabular-nums text-white/40">
        <span>0.01</span>
        <span>0.5</span>
        <span>1</span>
        <span>2</span>
        <span>5</span>
        <span>20+</span>
      </div>
    </div>
  );
}

// Period selector + opacity slider + legend, shown under the precip toggle.
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

      <PrecipLegend />
    </div>
  );
}
