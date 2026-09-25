import { useRadarStore } from './radarStore';
import {
  LEGEND_MAX_DBZ,
  LEGEND_MIN_DBZ,
  legendBands,
  legendGradient,
  snowSwatch,
  type RadarPaletteId,
} from './radarPalettes';

// The shared intensity scale (radarPalettes), so the words here are the ones
// the hover readout uses: ticks at the band breaks, names centred in bands.
const BANDS = legendBands();
const SCALE_LABEL =
  `Echo intensity scale, ${LEGEND_MIN_DBZ} to ${LEGEND_MAX_DBZ} dBZ: ` +
  BANDS.map((b) => `${b.name} ${b.range}`).join(', ');

function pct(dbz: number): string {
  return `${(((dbz - LEGEND_MIN_DBZ) / (LEGEND_MAX_DBZ - LEGEND_MIN_DBZ)) * 100).toFixed(1)}%`;
}

// Intensity ramp for the radar overlay in the palette it's painted in, the
// snow colour (when snow has its own ramp), and RainViewer's required
// attribution (the globe's own credit strip is hidden). Renders both as a
// floating map card (MapLegends) and under the share-link globe; both
// surfaces have the radar store.
export function RadarLegend() {
  const palette = useRadarStore((s) => s.palette);
  const snow = useRadarStore((s) => s.snow);
  return <RadarLegendView palette={palette} snow={snow} />;
}

export function RadarLegendView({ palette, snow }: { palette: RadarPaletteId; snow: boolean }) {
  return (
    <div className="pt-1">
      <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-white/30">Echo intensity</div>
      <div
        role="img"
        aria-label={SCALE_LABEL}
        className="h-2.5 rounded-sm ring-1 ring-white/10"
        style={{ background: legendGradient(palette) }}
        title={`${LEGEND_MIN_DBZ}–${LEGEND_MAX_DBZ} dBZ`}
      />
      <div aria-hidden="true" className="relative h-3.5 text-[9px] leading-none text-white/60">
        {BANDS.slice(1).map((b) => (
          <span key={b.name} className="absolute top-0 h-[3px] w-px bg-white/30" style={{ left: pct(b.from) }} />
        ))}
        {BANDS.map((b) => (
          <span
            key={b.name}
            className="absolute top-[5px] -translate-x-1/2 whitespace-nowrap"
            style={{ left: pct((b.from + b.to) / 2) }}
            title={`${b.name}: ${b.range}`}
          >
            {b.name}
          </span>
        ))}
      </div>
      <div className="mt-1 flex items-center gap-2 text-[9px]">
        {/* Snow painted as rain has nothing of its own to key. */}
        {snow && (
          <span className="flex items-center gap-1 text-white/60">
            <span className="h-2 w-3 rounded-sm ring-1 ring-white/10" style={{ background: snowSwatch(palette) }} />
            Snow
          </span>
        )}
        <span className="ml-auto truncate text-white/55">
          Weather data by{' '}
          <a
            href="https://www.rainviewer.com/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-white/70 underline decoration-white/25 underline-offset-2 transition hover:text-accent hover:decoration-accent/50"
          >
            RainViewer
          </a>
        </span>
      </div>
    </div>
  );
}
