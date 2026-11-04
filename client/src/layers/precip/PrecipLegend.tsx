import { QPF_LEGEND } from './precipStore';
import { KeyRamp, KeyTicks, stepTick } from '../legendKeys';

const COLORS = QPF_LEGEND.map((s) => `rgb(${s.rgb[0]}, ${s.rgb[1]}, ${s.rgb[2]})`);
const STEP_TITLES = QPF_LEGEND.map((s) => `${s.inches}"`);

// The thresholds worth a label, each placed under its own step of the ramp —
// the steps are equal-width but the thresholds are not evenly spaced, so
// spreading the labels evenly would put "1" under the 1.5" colour.
const LABELLED_INCHES = [0.01, 0.5, 1, 2, 5, 20];
export const PRECIP_TICKS = QPF_LEGEND.flatMap((s, i) =>
  LABELLED_INCHES.includes(s.inches)
    ? [stepTick(i, QPF_LEGEND.length, i === QPF_LEGEND.length - 1 ? `${s.inches}+` : String(s.inches))]
    : []
);

// Color-ramp legend built from the exact WPC QPF symbology (inches). The full
// key behind the map legend panel's row (MapLegends), and under the share-link
// globe.
export function PrecipLegend() {
  return (
    <div className="pt-1">
      <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-white/30">
        Forecast accumulation (inches)
      </div>
      <div className="flex h-3 overflow-hidden rounded-sm ring-1 ring-white/10">
        {QPF_LEGEND.map((s, i) => (
          <div key={s.inches} className="flex-1" style={{ backgroundColor: COLORS[i] }} title={STEP_TITLES[i]} />
        ))}
      </div>
      <div className="mt-0.5">
        <KeyTicks ticks={PRECIP_TICKS} />
      </div>
    </div>
  );
}

// One-line key for the map legend panel's collapsed row (unit in its hint).
export function PrecipLegendCompact() {
  return <KeyRamp colors={COLORS} stepTitles={STEP_TITLES} ticks={PRECIP_TICKS} />;
}
