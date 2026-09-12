import { RADAR_PALETTE } from './radarPalette';

// Intensity ramp for the radar overlay, in the colors the tiles are served in.
// Static and store-free so it renders both as a floating map card (MapLegends)
// and under the share-link globe.
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
      <div className="mt-0.5 flex justify-between text-[9px] text-white/40">
        <span>Light</span>
        <span>Moderate</span>
        <span>Heavy</span>
        <span>Extreme</span>
      </div>
    </div>
  );
}
