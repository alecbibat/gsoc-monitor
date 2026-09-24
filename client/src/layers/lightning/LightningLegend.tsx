import { LEGEND_ITEMS, LEGEND_NOTE, xGlyphSvg } from './lightningPalette';

// Strike-age key for the lightning layer: one X per colour stage, the same
// table (lightningPalette.ts) the globe draws from, so the legend can't drift.
// Store-free: shown as a floating map card (see MapLegends) and under the
// share-link globe.
const SWATCHES = LEGEND_ITEMS.map((item) => ({ ...item, svg: xGlyphSvg(item.color, 12) }));

export function LightningLegend() {
  return (
    <div className="space-y-1.5 pt-1">
      <div className="text-[10px] font-medium uppercase tracking-wider text-white/30">Strike age</div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
        {SWATCHES.map((s) => (
          <div key={s.label} className="flex items-center gap-1.5 text-[10px] text-white/50">
            {/* Static markup from our own palette table — no user input. */}
            <span className="flex h-3 w-3 shrink-0" dangerouslySetInnerHTML={{ __html: s.svg }} />
            {s.label}
          </div>
        ))}
      </div>
      <p className="text-[9px] leading-snug text-white/35">{LEGEND_NOTE}</p>
    </div>
  );
}
