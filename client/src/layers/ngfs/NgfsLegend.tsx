import { NGFS_AGE_CLASSES, NGFS_LEGEND_NOTE, NGFS_OTHER } from './ngfsMeta';

const swatch = (color: string, fill: number) => ({
  backgroundColor: `${color}${Math.round(fill * 255).toString(16).padStart(2, '0')}`,
  boxShadow: `inset 0 0 0 1px ${color}`,
});

// Detection-age key for the NGFS layer, from the same table the globe draws
// with (ngfsMeta.ts). Store-free: shown as a floating map card (MapLegends)
// and under the share-link globe.
export function NgfsLegend() {
  return (
    <div className="space-y-1.5 pt-1">
      <div className="text-[10px] font-medium uppercase tracking-wider text-white/30">Last detected</div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
        {NGFS_AGE_CLASSES.map((c) => (
          <div key={c.label} className="flex items-center gap-1.5 text-[10px] text-white/50">
            <span className="h-2.5 w-2.5 shrink-0 rounded-[2px]" style={swatch(c.color, c.fill)} />
            {c.label}
          </div>
        ))}
      </div>
      {/* Static, so it reads the same on the share page (which never shows these). */}
      <div className="flex items-center gap-1.5 text-[10px] text-white/50">
        <span className="h-2.5 w-2.5 shrink-0 rounded-[2px]" style={swatch(NGFS_OTHER.color, NGFS_OTHER.fill)} />
        {NGFS_OTHER.label} (industry, flares, volcanoes; when shown)
      </div>
      <p className="text-[9px] leading-snug text-white/35">{NGFS_LEGEND_NOTE}</p>
    </div>
  );
}
