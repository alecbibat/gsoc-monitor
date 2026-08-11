// Live strike-age legend. Mirrors X_STAGES in LightningLayer: a fresh crosshair
// steps white → yellow → orange → red over its 10-minute lifetime.
const RAMP_CSS =
  'linear-gradient(to right, #ffffff 0% 30%, #ffe14d 30% 60%, #ff9d2e 60% 90%, #ff3b30 90% 100%)';

// History dot colours — must match AGE_COLORS in LightningHistoryLayer.
const HISTORY_LEGEND = [
  { color: '#ffd84d', label: '<1h' },
  { color: '#ff9d2e', label: '<6h' },
  { color: '#ff5a3c', label: '<12h' },
  { color: '#d8466e', label: '<24h' },
];

// Symbology key for both lightning renderings (history dots + live crosshairs).
// Shown as a floating map card (see MapLegends) and under the share-link globe.
export function LightningLegend() {
  return (
    <div className="space-y-2 pt-1">
      <div>
        <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-white/30">
          History age (dots)
        </div>
        <div className="flex gap-2.5">
          {HISTORY_LEGEND.map((h) => (
            <div key={h.label} className="flex items-center gap-1 text-[9px] text-white/40">
              <span
                className="h-2 w-2 rounded-full ring-1 ring-white/10"
                style={{ backgroundColor: h.color }}
              />
              {h.label}
            </div>
          ))}
        </div>
      </div>

      <div>
        <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-white/30">
          Live strike age (crosshairs)
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
