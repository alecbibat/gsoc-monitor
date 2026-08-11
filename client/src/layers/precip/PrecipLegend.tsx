import { QPF_LEGEND } from './precipStore';

// Compact color-ramp legend built from the exact WPC QPF symbology (inches).
// Shown as a floating map card (see MapLegends) and under the share-link globe.
export function PrecipLegend() {
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
