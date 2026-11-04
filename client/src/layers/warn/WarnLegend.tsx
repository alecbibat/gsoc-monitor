import { WARN_ATTRIBUTION, WEA_CLASSES, WEA_CLASS_ORDER } from './warnMeta';

// Class key for the PBS WARN layer. Store-free: shown as a floating map card
// (MapLegends) and under the share-link globe.
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
                style={{ borderColor: c.color, backgroundColor: `${c.color}38` }}
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
