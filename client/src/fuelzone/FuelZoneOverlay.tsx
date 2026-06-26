import { useFuelZoneStore, formatRadius } from './fuelZoneStore';

// Floating instruction / status bar for the fuel-zone draw tool. Only mounts
// while the tool is active. Mirrors MeasureOverlay's bottom-center card.
export function FuelZoneOverlay() {
  const active = useFuelZoneStore((s) => s.active);
  const mode = useFuelZoneStore((s) => s.mode);
  const hasCenter = useFuelZoneStore((s) => s.hasCenter);
  const radiusM = useFuelZoneStore((s) => s.radiusM);
  const vertices = useFuelZoneStore((s) => s.vertices);
  const busy = useFuelZoneStore((s) => s.busy);
  const error = useFuelZoneStore((s) => s.error);
  const reset = useFuelZoneStore((s) => s.reset);
  const exit = useFuelZoneStore((s) => s.exit);
  const undoVertex = useFuelZoneStore((s) => s.undoVertex);
  const requestFinish = useFuelZoneStore((s) => s.requestFinish);

  if (!active) return null;

  const vcount = vertices.length;

  let hint: React.ReactNode;
  if (error) {
    hint = <span className="text-accent-danger">Couldn’t read fuels here · {error}</span>;
  } else if (busy) {
    hint = (
      <span className="flex items-center gap-2 text-amber-300">
        <span className="h-3 w-3 animate-spin rounded-full border-2 border-amber-300/30 border-t-amber-300" />
        Reading LANDFIRE fuels…
      </span>
    );
  } else if (mode === 'circle') {
    hint = !hasCenter ? (
      <span className="text-white/60">Click the center of the area to analyze</span>
    ) : (
      <span className="text-white/60">
        Move out, then click to set the radius
        {radiusM > 0 && (
          <span className="ml-1 font-mono font-bold text-amber-300">· {formatRadius(radiusM)}</span>
        )}
      </span>
    );
  } else {
    // Polygon mode
    if (vcount === 0) {
      hint = <span className="text-white/60">Click to drop the first boundary point</span>;
    } else if (vcount < 3) {
      hint = (
        <span className="text-white/60">
          Keep clicking the boundary — at least 3 points
          <span className="ml-1 font-mono font-bold text-amber-300">· {vcount}</span>
        </span>
      );
    } else {
      hint = (
        <span className="text-white/60">
          Click the first point or double-click to finish
          <span className="ml-1 font-mono font-bold text-amber-300">· {vcount} pts</span>
        </span>
      );
    }
  }

  const hasGeometry = mode === 'circle' ? hasCenter : vcount > 0;
  const polyReady = mode === 'polygon' && vcount >= 3 && !busy && !error;

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-6 z-30 flex justify-center px-3">
      <div className="pointer-events-auto flex items-center gap-3 rounded-xl border border-white/10 bg-ink-900/90 px-3.5 py-2.5 shadow-panel backdrop-blur-md">
        <span className="text-base">{mode === 'polygon' ? '⬠' : '🌾'}</span>
        <div className="min-w-[230px] text-[12px]">{hint}</div>
        <div className="flex items-center gap-1.5">
          {mode === 'polygon' && vcount > 0 && !busy && !error && (
            <button
              onClick={undoVertex}
              className="rounded border border-white/10 bg-ink-900/80 px-2.5 py-1 text-[11px] font-semibold text-white/60 transition hover:text-white"
            >
              Undo
            </button>
          )}
          {(hasGeometry || error) && !busy && (
            <button
              onClick={reset}
              className="rounded border border-white/10 bg-ink-900/80 px-2.5 py-1 text-[11px] font-semibold text-white/60 transition hover:text-white"
            >
              {error ? 'Try again' : 'Restart'}
            </button>
          )}
          {polyReady && (
            <button
              onClick={requestFinish}
              className="rounded border border-emerald-400/40 bg-emerald-400/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-300 transition hover:bg-emerald-400/20"
            >
              Finish
            </button>
          )}
          <button
            onClick={exit}
            disabled={busy}
            className="rounded border border-amber-400/30 bg-amber-400/10 px-2.5 py-1 text-[11px] font-semibold text-amber-300 transition hover:bg-amber-400/20 disabled:opacity-40"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
