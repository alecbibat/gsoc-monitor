import { KeySteps } from '../legendKeys';
import { ROAD_IMPACT, ROAD_IMPACT_ORDER, ROADS_ATTRIBUTION, roadIcon } from './roadsMeta';
import type { RoadImpact } from '../../types';

// Key for the road-closures layer. Store-free: the full key behind the map
// legend panel's row (MapLegends), and under the share-link globe.

/** A short stretch of road as the layer draws it: solid when closed, dashed when restricted. */
function LineSwatch({ impact }: { impact: RoadImpact }) {
  const color = ROAD_IMPACT[impact].color;
  return (
    <span className="relative block h-[5px] w-5 shrink-0 rounded-full bg-black/60">
      <span
        className="absolute inset-x-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full"
        style={
          impact === 'closed'
            ? { background: color }
            : { backgroundImage: `repeating-linear-gradient(to right, ${color} 0 5px, transparent 5px 8px)` }
        }
      />
    </span>
  );
}

export function RoadClosuresLegend() {
  return (
    <div className="space-y-1.5 pt-1">
      <div className="space-y-1">
        {ROAD_IMPACT_ORDER.map((id) => {
          const m = ROAD_IMPACT[id];
          return (
            <div key={id} className="flex items-center gap-1.5 text-[10px] text-white/55" title={m.note}>
              <img src={roadIcon(id)} alt="" className="h-3 w-3 shrink-0" />
              <LineSwatch impact={id} />
              <span>
                {m.label} <span className="text-white/35">— {m.note.toLowerCase()}</span>
              </span>
            </div>
          );
        })}
      </div>
      <p className="text-[9px] leading-snug text-white/35">
        In force now around the six followed national parks and their access highways. {ROADS_ATTRIBUTION}.
      </p>
    </div>
  );
}

export function RoadClosuresLegendCompact() {
  return (
    <KeySteps
      steps={ROAD_IMPACT_ORDER.map((id) => ({
        id,
        symbol: <LineSwatch impact={id} />,
        label: ROAD_IMPACT[id].short,
        title: `${ROAD_IMPACT[id].label}: ${ROAD_IMPACT[id].note}`,
      }))}
    />
  );
}
