import { stormLegendGradient } from './palettes';
import { getUsAnchors } from './sources';
import { useRadarStore } from './radarStore';

// Agency style shows IEM's own N0Q ramp, so its legend is built from the
// exact anchor table (dBZ 5 → 75).
let agencyGradient: string | null = null;
function agencyLegendGradient(): string {
  if (agencyGradient) return agencyGradient;
  const anchors = getUsAnchors();
  const stops: string[] = [];
  for (let dbz = 5; dbz <= 75; dbz += 5) {
    const a = anchors[2 * dbz + 64]; // index = 2·dBZ + 65, anchors are idx-1
    stops.push(`rgb(${a.r},${a.g},${a.b}) ${(((dbz - 5) / 70) * 100).toFixed(0)}%`);
  }
  agencyGradient = `linear-gradient(90deg, ${stops.join(', ')})`;
  return agencyGradient;
}

// Intensity legend for the radar layer, matching the active style so it can
// never mislabel the imagery. Subscribing to the radar store is safe on the
// public share page too: the store is module-level, unpersisted, and the
// share page always runs its defaults. The credit line doubles as the
// on-screen source attribution (RainViewer's free terms require a credit,
// and the Cesium credit widget is hidden app-wide).
export function RadarLegend() {
  const style = useRadarStore((s) => s.style);
  return (
    <div className="pt-1">
      <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-white/30">
        Precipitation intensity
      </div>
      <div
        className="h-3 rounded-sm ring-1 ring-white/10"
        style={{ background: style === 'agency' ? agencyLegendGradient() : stormLegendGradient() }}
      />
      <div className="mt-0.5 flex justify-between text-[9px] text-white/40">
        <span>Light</span>
        <span>Moderate</span>
        <span>Heavy</span>
        <span>Extreme</span>
      </div>
      {style === 'agency' && (
        <div className="mt-0.5 text-[9px] text-white/30">NWS N0Q ramp (US) · Universal Blue (global)</div>
      )}
      <div className="mt-1 text-[9px] text-white/30">
        NEXRAD ·{' '}
        <a
          href="https://mesonet.agron.iastate.edu/docs/nexrad_mosaic/"
          target="_blank"
          rel="noreferrer"
          className="underline decoration-white/20 hover:text-white/60"
        >
          Iowa Environmental Mesonet
        </a>{' '}
        · global{' '}
        <a
          href="https://www.rainviewer.com/"
          target="_blank"
          rel="noreferrer"
          className="underline decoration-white/20 hover:text-white/60"
        >
          RainViewer
        </a>
      </div>
    </div>
  );
}
