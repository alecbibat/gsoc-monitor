import { WARN_ATTRIBUTION, WEA_CLASSES, WEA_CLASS_ORDER } from './warnMeta';
import { KeySteps, Swatch } from '../legendKeys';

// Dashed outline over a light fill, as the layer draws an alert's area.
const swatchStyle = (color: string) => ({ borderColor: color, backgroundColor: `${color}38` });

// Class key for the PBS WARN layer. Store-free: the full key behind the map
// legend panel's row (MapLegends), and under the share-link globe.
export function WarnLegend() {
  return (
    <div className="space-y-1.5 pt-1">
      <div className="space-y-0.5">
        {WEA_CLASS_ORDER.map((id) => {
          const c = WEA_CLASSES[id];
          return (
            <div key={id} className="flex items-center gap-1.5 text-[10px] text-white/55" title={c.note}>
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-[2px] border border-dashed"
                style={swatchStyle(c.color)}
              />
              {c.label}
            </div>
          );
        })}
      </div>
      <p className="text-[9px] leading-snug text-white/35">
        Dashed outline = the area phones were alerted in. {WARN_ATTRIBUTION}.
      </p>
    </div>
  );
}

// One-line key for the map legend panel's collapsed row.
export function WarnLegendCompact() {
  return (
    <KeySteps
      steps={WEA_CLASS_ORDER.map((id) => {
        const c = WEA_CLASSES[id];
        return {
          id,
          symbol: <Swatch className="border border-dashed" style={swatchStyle(c.color)} />,
          label: c.short,
          title: `${c.label}: ${c.note}`,
        };
      })}
    />
  );
}
