import { useLightningStatus, LIGHTNING_WINDOWS } from './lightningStore';

// Live strike-age legend. Mirrors X_STAGES in LightningLayer: a fresh crosshair
// steps white → yellow → orange → red over its 10-minute lifetime.
const RAMP_CSS =
  'linear-gradient(to right, #ffffff 0% 30%, #ffe14d 30% 60%, #ff9d2e 60% 90%, #ff3b30 90% 100%)';

// History dot colours — must match AGE_COLORS in LightningHistoryLayer.
const HISTORY_LEGEND = [
  { color: '#ffd84d', label: '<1h' },
  { color: '#ff9d2e', label: '<6h' },
  { color: '#ff5a3c', label: '<12h' },
  { color: '#d8466e', label: '<24h' },
];

function fmtMinutes(min: number): string {
  if (min >= 60) {
    const h = min / 60;
    return `${Number.isInteger(h) ? h : h.toFixed(1)}h`;
  }
  return `${Math.max(0, Math.round(min))}m`;
}

export function LightningControls() {
  const windowMinutes = useLightningStatus((s) => s.windowMinutes);
  const setWindow = useLightningStatus((s) => s.setWindow);
  const history = useLightningStatus((s) => s.history);

  const label = LIGHTNING_WINDOWS.find((w) => w.value === windowMinutes)?.label ?? '1h';
  const building = !history.error && history.count > 0 && history.coverageMin < windowMinutes;

  return (
    <div className="space-y-2.5 pt-1">
      {/* History window selector */}
      <div>
        <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-white/30">
          Show strikes from the last
        </div>
        <div className="flex gap-1.5">
          {LIGHTNING_WINDOWS.map((w) => (
            <button
              key={w.value}
              onClick={() => setWindow(w.value)}
              className={`flex-1 rounded px-1.5 py-1 text-[11px] font-medium transition ${
                windowMinutes === w.value
                  ? 'bg-accent/20 text-accent'
                  : 'bg-white/5 text-white/50 hover:bg-white/10'
              }`}
            >
              {w.label}
            </button>
          ))}
        </div>
      </div>

      {/* History readout */}
      <div className="text-[10px] leading-relaxed text-white/45">
        {history.error ? (
          <span className="text-accent-danger">History feed unavailable</span>
        ) : history.loading && history.count === 0 ? (
          'Loading history…'
        ) : (
          <>
            <span className="font-semibold tabular-nums text-white/75">
              {history.count.toLocaleString()}
            </span>{' '}
            strikes in the last {label}
            {history.thinned && <span className="text-white/30"> · sampled to fit</span>}
          </>
        )}
        {building && (
          <div className="text-white/30">
            collector buffer covers ~{fmtMinutes(history.coverageMin)} so far
          </div>
        )}
      </div>

      {/* History dot legend */}
      <div>
        <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-white/30">
          History age (dots)
        </div>
        <div className="flex gap-2.5">
          {HISTORY_LEGEND.map((h) => (
            <div key={h.label} className="flex items-center gap-1 text-[9px] text-white/40">
              <span
                className="h-2 w-2 rounded-full ring-1 ring-white/10"
                style={{ backgroundColor: h.color }}
              />
              {h.label}
            </div>
          ))}
        </div>
      </div>

      {/* Live strike-age legend (the animated crosshairs, last ~10 min) */}
      <div>
        <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-white/30">
          Live strike age (crosshairs)
        </div>
        <div className="h-2 w-full rounded-full ring-1 ring-white/10" style={{ background: RAMP_CSS }} />
        <div className="mt-0.5 flex justify-between text-[9px] text-white/35">
          <span>just now</span>
          <span>~10 min</span>
        </div>
      </div>
    </div>
  );
}
