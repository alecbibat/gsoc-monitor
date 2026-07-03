import { useXweatherStore, XW_TIMES, type XwMode, type XwWindow } from './xweatherStore';

const MODES: Array<{ value: XwMode; label: string }> = [
  { value: 'strikes', label: 'CG strikes' },
  { value: 'all', label: 'All pulses' },
  { value: 'density', label: 'Density' },
];
const WINDOWS: Array<{ value: XwWindow; label: string }> = [
  { value: '5m', label: '5 min' },
  { value: '15m', label: '15 min' },
];

// Sidebar controls for the Xweather lightning raster: what to draw (CG-only /
// all pulses / NOAA density heat map), the per-frame aggregation window, and
// the time — now or a past offset (the tiles keep 7 days of history).
export function XweatherControls() {
  const configured = useXweatherStore((s) => s.configured);
  const mode = useXweatherStore((s) => s.mode);
  const window = useXweatherStore((s) => s.window);
  const time = useXweatherStore((s) => s.time);
  const setMode = useXweatherStore((s) => s.setMode);
  const setWindow = useXweatherStore((s) => s.setWindow);
  const setTime = useXweatherStore((s) => s.setTime);

  if (configured === false) {
    return (
      <p className="pt-1 text-[10px] leading-relaxed text-white/30">
        Requires an Xweather (Vaisala) account — paid API with a free developer
        tier for testing. Add the keys as server config vars and this layer
        lights up with NLDN-quality strikes.
      </p>
    );
  }

  const chip = (selected: boolean) =>
    `rounded px-1.5 py-1 text-[11px] font-medium transition ${
      selected ? 'bg-accent/20 text-accent' : 'bg-white/5 text-white/50 hover:bg-white/10'
    }`;

  return (
    <>
      <div className="flex flex-wrap gap-1.5 pt-1">
        {MODES.map((m) => (
          <button key={m.value} onClick={() => setMode(m.value)} className={chip(mode === m.value)}>
            {m.label}
          </button>
        ))}
        {mode !== 'density' &&
          WINDOWS.map((w) => (
            <button key={w.value} onClick={() => setWindow(w.value)} className={chip(window === w.value)}>
              {w.label}
            </button>
          ))}
      </div>
      <div className="pt-1.5">
        <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-white/30">
          Time
        </div>
        <div className="flex flex-wrap gap-1">
          {XW_TIMES.map((t) => (
            <button key={t.value} onClick={() => setTime(t.value)} className={chip(time === t.value)}>
              {t.label}
            </button>
          ))}
        </div>
      </div>
      {mode === 'density' && (
        <p className="pt-1.5 text-[10px] leading-relaxed text-white/30">
          Density heat map covers the US / Central America / East Pacific (NOAA, 8 km).
        </p>
      )}
    </>
  );
}
