import { useRadarStore } from './radarStore';
import type { RadarCoverage } from './sources';
import type { RadarStyle } from './palettes';

const COVERAGES: Array<{ value: RadarCoverage; label: string; title: string }> = [
  { value: 'auto', label: 'Auto', title: 'HD NEXRAD over the US, global composite elsewhere' },
  { value: 'us', label: 'US HD', title: 'NEXRAD only (CONUS · AK · HI · PR), 5-min frames' },
  { value: 'global', label: 'Global', title: 'RainViewer worldwide composite, 10-min frames' },
];

const STYLES: Array<{ value: RadarStyle; label: string; title: string }> = [
  { value: 'storm', label: 'Storm', title: 'Unified zoom.earth-style palette across both sources' },
  { value: 'agency', label: 'Agency', title: 'Each source’s own colors (NWS ramp / Universal Blue)' },
];

const WINDOWS: Array<60 | 120> = [60, 120];

function ago(sec: number | undefined, now: number): string | null {
  if (!sec) return null;
  const m = Math.max(0, Math.round((now - sec) / 60));
  return `${m} min ago`;
}

export function RadarControls() {
  const coverage = useRadarStore((s) => s.coverage);
  const setCoverage = useRadarStore((s) => s.setCoverage);
  const style = useRadarStore((s) => s.style);
  const setStyle = useRadarStore((s) => s.setStyle);
  const windowMinutes = useRadarStore((s) => s.windowMinutes);
  const setWindowMinutes = useRadarStore((s) => s.setWindowMinutes);
  const opacity = useRadarStore((s) => s.opacity);
  const setOpacity = useRadarStore((s) => s.setOpacity);
  const usFrames = useRadarStore((s) => s.usFrames);
  const globalFrames = useRadarStore((s) => s.globalFrames);
  const globalAvailable = useRadarStore((s) => s.globalAvailable);
  const usAvailable = useRadarStore((s) => s.usAvailable);

  const now = Date.now() / 1000;
  const usAge = ago(usFrames[usFrames.length - 1], now);
  const globalAge = ago(globalFrames[globalFrames.length - 1]?.time, now);

  return (
    <div className="mt-2 space-y-2 rounded-md bg-black/20 p-2">
      {/* Coverage */}
      <div className="flex items-center gap-1">
        {COVERAGES.map(({ value, label, title }) => (
          <button
            key={value}
            onClick={() => setCoverage(value)}
            title={title}
            className={`flex-1 rounded px-1 py-1 text-[11px] font-medium transition ${
              coverage === value
                ? 'bg-sky-500/30 text-sky-300'
                : 'bg-white/5 text-white/40 hover:bg-white/10 hover:text-white/70'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Style + window */}
      <div className="flex items-center gap-1">
        {STYLES.map(({ value, label, title }) => (
          <button
            key={value}
            onClick={() => setStyle(value)}
            title={title}
            className={`flex-1 rounded px-1 py-1 text-[11px] font-medium transition ${
              style === value
                ? 'bg-sky-500/30 text-sky-300'
                : 'bg-white/5 text-white/40 hover:bg-white/10 hover:text-white/70'
            }`}
          >
            {label}
          </button>
        ))}
        {WINDOWS.map((w) => (
          <button
            key={w}
            onClick={() => setWindowMinutes(w)}
            className={`flex-1 rounded px-1 py-1 text-[11px] font-medium transition ${
              windowMinutes === w
                ? 'bg-accent/20 text-accent'
                : 'bg-white/5 text-white/50 hover:bg-white/10'
            }`}
          >
            {w / 60}h
          </button>
        ))}
      </div>

      <label className="flex items-center gap-2 text-[11px] text-white/50">
        Opacity
        <input
          type="range"
          min={0.2}
          max={1}
          step={0.05}
          value={opacity}
          onChange={(e) => setOpacity(Number(e.target.value))}
          className="flex-1 accent-accent"
        />
      </label>

      {/* Source freshness */}
      <div className="text-[10px] leading-4 text-white/35">
        {coverage !== 'global' &&
          (usAvailable ? (
            <div>NEXRAD HD {usAge ? `· ${usAge}` : '· loading'}</div>
          ) : (
            <div className="text-accent-warn">
              NEXRAD HD unavailable{coverage === 'auto' ? ' — showing global' : ''}
            </div>
          ))}
        {coverage !== 'us' &&
          (globalAvailable ? (
            <div>Global {globalAge ? `· ${globalAge}` : '· loading'}</div>
          ) : (
            <div className="text-accent-warn">Global source unavailable</div>
          ))}
      </div>
    </div>
  );
}
