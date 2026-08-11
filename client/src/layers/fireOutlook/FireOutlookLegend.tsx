import { OUTLOOK_LEGEND } from './fireOutlookMeta';

// Color key for the NWCG significant-fire-potential polygons. Shown as a
// floating map card (see MapLegends) and under the share-link globe.
export function FireOutlookLegend() {
  return (
    <div className="space-y-0.5 pt-1">
      {OUTLOOK_LEGEND.map((l) => (
        <div key={l.label} className="flex items-center gap-1.5 text-[10px] text-white/45">
          <span
            className="h-2.5 w-2.5 shrink-0 rounded-[2px] ring-1 ring-white/10"
            style={{ backgroundColor: l.hex }}
          />
          {l.label}
        </div>
      ))}
    </div>
  );
}
