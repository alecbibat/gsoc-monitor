import { FUEL_GROUPS, rgbCss } from './fbfm40';
import { KeySteps, Swatch } from '../legendKeys';

// Compact legend for the FBFM40 raster, grouped by the seven coarse fuel groups
// (40 individual models would be far too many swatches). The full key behind
// the map legend panel's row (MapLegends), and under the share-link globe.
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

// One-line key for the map legend panel's collapsed row: each group by its
// FBFM40 code prefix (GR, GS … NB — the prefixes of the GR2 / TU5 codes the
// fuel-zone panel lists), with the group name and blurb as its title.
export function FuelLegendCompact() {
  return (
    <KeySteps
      steps={FUEL_GROUPS.map((g) => ({
        id: g.key,
        symbol: <Swatch style={{ backgroundColor: rgbCss(g.rgb) }} />,
        label: g.short,
        title: `${g.label}: ${g.blurb}`,
      }))}
    />
  );
}
