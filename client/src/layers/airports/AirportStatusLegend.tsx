import { KeySteps } from '../legendKeys';
import { AIRPORT_TIERS, AIRPORT_TIER_ORDER, FAA_ATTRIBUTION } from './airportsMeta';

// The ringed disc the layer draws each airport as, in a tier's colour.
function Dot({ color }: { color: string }) {
  return <span className="block h-2.5 w-2.5 shrink-0 rounded-full border-2 bg-ink-950" style={{ borderColor: color }} />;
}

// Key for the FAA airport status layer. Store-free: the full key behind the
// map legend panel's row (MapLegends).
export function AirportStatusLegend() {
  return (
    <div className="space-y-1.5 pt-1">
      <div className="space-y-0.5">
        {AIRPORT_TIER_ORDER.map((id) => {
          const t = AIRPORT_TIERS[id];
          return (
            <div key={id} className="flex items-center gap-1.5 text-[10px] text-white/55" title={t.note}>
              <Dot color={t.color} />
              {t.label}
            </div>
          );
        })}
      </div>
      <p className="text-[9px] leading-snug text-white/35">
        Coloured by the worst thing reported at the airport. Airports running normally are not drawn. {FAA_ATTRIBUTION}.
      </p>
    </div>
  );
}

// One-line key for the map legend panel's collapsed row.
export function AirportStatusLegendCompact() {
  return (
    <KeySteps
      steps={AIRPORT_TIER_ORDER.map((id) => {
        const t = AIRPORT_TIERS[id];
        return { id, symbol: <Dot color={t.color} />, label: t.short, title: `${t.label}: ${t.note}` };
      })}
    />
  );
}
