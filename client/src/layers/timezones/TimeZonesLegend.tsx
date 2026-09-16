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
        <span className="text-white/70">New York · UTC-4</span>{' '}
        <span className="text-white/30">whose clock, and its offset now</span>
      </div>
      <div>
        <span className="text-white/70">+1d / -1d</span>{' '}
        <span className="text-white/30">a day ahead of / behind your date</span>
      </div>
      <div className="text-white/30">
        Bands are Natural Earth's nominal UTC-offset zones; the clock follows the named place.
      </div>
    </div>
  );
}
