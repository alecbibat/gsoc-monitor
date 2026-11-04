import { LEGEND_ITEMS, LEGEND_NOTE, LIGHTNING_STAGES, xGlyphSvg } from './lightningPalette';
import { KeySteps, ageLabel, type KeyStep } from '../legendKeys';

// Strike-age key for the lightning layer: one X per colour stage, the same
// table (lightningPalette.ts) the globe draws from, so the legend can't drift.
// Store-free: the full key behind the map legend panel's row (MapLegends), and
// under the share-link globe.
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

// Compact key: each stage's X over the age it lasts until ("<10m" for the
// 2–10 min stage), from the same stage ends; the exact range is its title.
const STEPS: KeyStep[] = SWATCHES.map((s, i) => ({
  id: s.label,
  symbol: <span className="flex h-3 w-3" dangerouslySetInnerHTML={{ __html: s.svg }} />,
  label: `<${ageLabel(LIGHTNING_STAGES[i].endS / 60)}`,
  title: s.label,
}));

// One-line key for the map legend panel's collapsed row.
export function LightningLegendCompact() {
  return <KeySteps steps={STEPS} />;
}
