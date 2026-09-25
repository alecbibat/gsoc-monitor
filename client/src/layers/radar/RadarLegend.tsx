import { useRadarStore } from './radarStore';
import {
  LEGEND_MAX_DBZ,
  LEGEND_MIN_DBZ,
  legendGradient,
  snowSwatch,
  type RadarPaletteId,
} from './radarPalettes';

// Plain-language marks along the ramp, at the reflectivity they describe.
const MARKS: Array<{ dbz: number; label: string }> = [
  { dbz: 12, label: 'Light' },
  { dbz: 30, label: 'Moderate' },
  { dbz: 45, label: 'Heavy' },
  { dbz: 60, label: 'Extreme' },
];

function pct(dbz: number): number {
  return ((dbz - LEGEND_MIN_DBZ) / (LEGEND_MAX_DBZ - LEGEND_MIN_DBZ)) * 100;
}

// Intensity ramp for the radar overlay in the palette it's painted in, the
// snow colour, and RainViewer's required attribution (the globe's own credit
// strip is hidden). Renders both as a floating map card (MapLegends) and
// under the share-link globe; both surfaces have the radar store.
export function RadarLegend() {
  const palette = useRadarStore((s) => s.palette);
  return <RadarLegendView palette={palette} />;
}

export function RadarLegendView({ palette }: { palette: RadarPaletteId }) {
  return (
    <div className="pt-1">
      <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-white/30">Echo intensity</div>
      <div
        className="h-2.5 rounded-sm ring-1 ring-white/10"
        style={{ background: legendGradient(palette) }}
        title={`${LEGEND_MIN_DBZ}–${LEGEND_MAX_DBZ} dBZ`}
      />
      <div className="relative h-3.5 text-[9px] text-white/45">
        {MARKS.map(({ dbz, label }) => (
          <span
            key={label}
            className="absolute top-0 flex -translate-x-1/2 flex-col items-center whitespace-nowrap leading-none"
            style={{ left: `${pct(dbz).toFixed(1)}%` }}
          >
            <span className="h-[3px] w-px bg-white/30" />
            <span className="mt-0.5">{label}</span>
          </span>
        ))}
      </div>
      <div className="mt-1 flex items-center justify-between gap-2 text-[9px]">
        <span className="flex items-center gap-1 text-white/45">
          <span className="h-2 w-3 rounded-sm ring-1 ring-white/10" style={{ background: snowSwatch(palette) }} />
          Snow
        </span>
        <span className="truncate text-white/30">
          Weather data by{' '}
          <a
            href="https://www.rainviewer.com/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-white/50 underline decoration-white/20 underline-offset-2 transition hover:text-accent hover:decoration-accent/50"
          >
            RainViewer
          </a>
        </span>
      </div>
    </div>
  );
}
