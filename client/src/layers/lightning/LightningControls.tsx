// Strike-age legend. Mirrors X_STAGES in LightningLayer: a strike steps through
// distinct colours at fixed ages — white (brand new) → yellow → orange → red —
// so a crosshair's colour encodes roughly how recently it hit. Hard colour
// stops (not a smooth gradient) reflect that the change is now stepped, and the
// band widths match the real age thresholds over the 10-minute lifetime.
const RAMP_CSS =
  'linear-gradient(to right, #ffffff 0% 30%, #ffe14d 30% 60%, #ff9d2e 60% 90%, #ff3b30 90% 100%)';

export function LightningControls() {
  return (
    <div className="space-y-2 pt-1">
      {/* Colour legend — only meaningful while the layer is on, which is the
          only time LayerToggle renders these children. */}
      <div className="pt-1">
        <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-white/30">
          Strike age
        </div>
        <div className="h-2 w-full rounded-full ring-1 ring-white/10" style={{ background: RAMP_CSS }} />
        <div className="mt-0.5 flex justify-between text-[9px] text-white/35">
          <span>just now</span>
          <span>~10 min</span>
        </div>
      </div>
    </div>
  );
}
