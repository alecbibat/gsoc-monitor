import { useHoverStore } from './hoverStore';

// Floating banner for hover mode: prompts the user to pick an orbit center,
// then shows the active orbit with a Stop button.
export function HoverOverlay() {
  const active = useHoverStore((s) => s.active);
  const picking = useHoverStore((s) => s.picking);
  const point = useHoverStore((s) => s.point);
  const stop = useHoverStore((s) => s.stop);

  if (!picking && !active) return null;

  return (
    <div className="pointer-events-none fixed left-1/2 top-20 z-[60] -translate-x-1/2">
      <div className="pointer-events-auto flex items-center gap-3 rounded-full border border-accent/30 bg-ink-900/90 px-4 py-2 text-[12px] text-white/80 shadow-panel backdrop-blur-md">
        {picking ? (
          <>
            <span className="flex h-2 w-2 shrink-0 animate-pulse rounded-full bg-accent" />
            <span>
              <span className="font-semibold text-white">Hover mode:</span> click any point on the
              globe to orbit it
            </span>
            <span className="hidden text-white/30 sm:inline">·</span>
            <span className="hidden text-white/40 sm:inline">Esc to cancel</span>
            <button
              onClick={stop}
              className="ml-1 rounded-full border border-white/15 px-2 py-0.5 text-[11px] font-medium text-white/60 transition hover:bg-white/10 hover:text-white/90"
            >
              Cancel
            </button>
          </>
        ) : (
          <>
            <span className="flex h-2 w-2 shrink-0 animate-pulse rounded-full bg-accent" />
            <span>
              <span className="font-semibold text-white">Orbiting</span>
              {point && (
                <span className="ml-1.5 font-mono text-white/55">
                  {point.lat.toFixed(4)}°, {point.lon.toFixed(4)}°
                </span>
              )}
            </span>
            <button
              onClick={stop}
              className="ml-1 rounded-full border border-white/15 px-2.5 py-0.5 text-[11px] font-medium text-white/70 transition hover:bg-white/10 hover:text-white/90"
            >
              ◼ Stop
            </button>
          </>
        )}
      </div>
    </div>
  );
}
