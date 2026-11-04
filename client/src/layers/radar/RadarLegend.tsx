import { RADAR_PALETTE } from './radarPalette';
import { KeyRamp, KeyTicks, type RampTick } from '../legendKeys';

const TICKS: RampTick[] = [
  { at: 0, label: 'Light' },
  { at: 1 / 3, label: 'Moderate' },
  { at: 2 / 3, label: 'Heavy' },
  { at: 1, label: 'Extreme' },
];

// Intensity ramp for the radar overlay, in the colors the tiles are served in.
// Static and store-free: the full key behind the map legend panel's row
// (MapLegends), and under the share-link globe.
export function RadarLegend() {
  return (
    <div className="pt-1">
      <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-white/30">
        Echo intensity
      </div>
      <div
        className="h-3 rounded-sm ring-1 ring-white/10"
        style={{ background: `linear-gradient(to right, ${RADAR_PALETTE.join(', ')})` }}
      />
      <div className="mt-0.5">
        <KeyTicks ticks={TICKS} />
      </div>
    </div>
  );
}

// One-line key for the map legend panel's collapsed row.
export function RadarLegendCompact() {
  return <KeyRamp colors={RADAR_PALETTE} smooth ticks={TICKS} />;
}
