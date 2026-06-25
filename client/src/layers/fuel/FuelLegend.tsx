import { FUEL_GROUPS, rgbCss } from './fbfm40';

// Compact legend for the FBFM40 raster, grouped by the seven coarse fuel groups
// (40 individual models would be far too many swatches). Rendered inside the
// sidebar fuel toggle while the layer is active.
export function FuelLegend() {
  return (
    <div className="pt-1.5">
      <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-white/30">
        Fuel groups
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1">
        {FUEL_GROUPS.map((g) => (
          <div key={g.key} className="flex items-center gap-1.5" title={g.blurb}>
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-[2px]"
              style={{ backgroundColor: rgbCss(g.rgb) }}
            />
            <span className="truncate text-[11px] text-white/55">{g.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
