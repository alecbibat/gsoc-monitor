import { useLayersStore } from '../../store/layersStore';

// Mirrors the AGE_RAMP heat ramp in LightningLayer: strikes cool from a hot
// white flash through gold/yellow/orange to a dying red over their 10-minute
// lifetime, so a strike's colour encodes how recently it hit.
const RAMP_CSS =
  'linear-gradient(to right, #ffffff 0%, #fff7b0 10%, #ffe14d 28%, #ff9d2e 55%, #ff3b30 100%)';

export function LightningControls() {
  const detectorLines = useLayersStore((s) => s.lightningDetectorLines);
  const setDetectorLines = useLayersStore((s) => s.setLightningDetectorLines);

  return (
    <div className="space-y-2 pt-1">
      {/* Detector lines toggle */}
      <label className="flex items-center gap-2 text-[11px] text-white/60">
        <input
          type="checkbox"
          checked={detectorLines}
          onChange={(e) => setDetectorLines(e.target.checked)}
          className="accent-accent"
        />
        Show detector lines
      </label>
      <div className="text-[10px] leading-snug text-white/30">
        Faint lines from each contributing sensor to the strike (lightningmaps-style).
      </div>

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
