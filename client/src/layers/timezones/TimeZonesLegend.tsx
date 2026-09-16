import meta from './timezones.meta.json';

// What the clock labels mean. Store-free/static so it renders both as a
// floating map card (MapLegends) and under the share-link globe.
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
