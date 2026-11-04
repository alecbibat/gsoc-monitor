import meta from './timezones.meta.json';

// What the clock labels mean. Store-free/static: the full key behind the map
// legend panel's row (MapLegends), and under the share-link globe.
export function TimeZonesLegend() {
  return (
    <div className="space-y-0.5 pt-1 text-[10px] leading-snug text-white/45">
      <div>
        <span className="font-mono text-white/70">14:04:22</span>{' '}
        <span className="text-white/30">live, to the second</span>
      </div>
      <div>
        <span className="text-white/70">UTC-4 · EDT</span>{' '}
        <span className="text-white/30">offset and zone abbreviation now (EDT in summer, EST in winter)</span>
      </div>
      <div>
        <span className="text-white/70">+1d / -1d</span>{' '}
        <span className="text-white/30">a day ahead of / behind your date</span>
      </div>
      <div className="text-white/30">
        One shape per set of places whose clocks agree from today on. Boundaries ©
        OpenStreetMap contributors (ODbL), via timezone-boundary-builder {meta.release}.
      </div>
    </div>
  );
}

// One-line key for the map legend panel's collapsed row: a specimen of the
// two-line clock label as the globe draws it (time over caption, in its
// fonts), each line annotated. The ODbL credit stays up in TimeZonesCredit.
export function TimeZonesLegendCompact() {
  return (
    <div className="grid grid-cols-[auto_1fr] items-baseline gap-x-2.5 text-[9px] leading-[13px]">
      <span className="text-center font-mono text-[10px] font-semibold text-white/85">14:04:22</span>
      <span className="truncate text-white/40">local time, live</span>
      <span className="text-center font-semibold text-white/65">UTC-4 · EDT · +1d</span>
      <span className="truncate text-white/40">offset · zone · ±day</span>
    </div>
  );
}
