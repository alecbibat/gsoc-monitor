import { stormLegendGradient } from './palettes';

// Intensity legend for the radar layer, zoom.earth style: a continuous ramp
// with plain-language intensity labels. Built from the exact storm palette so
// it can never drift from the imagery. Store-free/static per the
// LAYER_LEGENDS contract (renders on the operator HUD and the share page).
export function RadarLegend() {
  return (
    <div className="pt-1">
      <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-white/30">
        Precipitation intensity
      </div>
      <div
        className="h-3 rounded-sm ring-1 ring-white/10"
        style={{ background: stormLegendGradient() }}
      />
      <div className="mt-0.5 flex justify-between text-[9px] text-white/40">
        <span>Light</span>
        <span>Moderate</span>
        <span>Heavy</span>
        <span>Extreme</span>
      </div>
    </div>
  );
}
