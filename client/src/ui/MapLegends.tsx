import { useLayersStore } from '../store/layersStore';
import { useScreensaverStore } from '../screensaver/screensaverStore';
import { useHoverStore } from '../screensaver/hoverStore';
import { LAYER_LEGENDS, type LayerLegend } from '../layers/layerLegends';
import type { LayerId } from '../types';
import { useMapLegendStore } from './uiStore';

// The map legend: one panel in the bottom-right HUD stack in App, directly
// above the wind probe readout, with a row for each active layer that has a
// symbology key. A row is the layer's name over its compact one-line key;
// clicking it swaps in the full legend (notes, full wording), and the header
// tucks the whole panel down to a "Legend" pill. Both are persisted. The
// stack's max-height caps the panel, so its rows scroll under the header
// instead of covering the globe (min-h-0 lets it shrink).
export function MapLegends() {
  const active = useLayersStore((s) => s.active);
  // Screensaver / hover modes collapse the chrome (and draw their own context
  // minimap in this corner) — hide the legend with it, like the Sidebar does.
  const screensaverActive = useScreensaverStore((s) => s.active);
  const hoverEngaged = useHoverStore((s) => s.active || s.picking);
  const minimized = useMapLegendStore((s) => s.minimized);
  const expanded = useMapLegendStore((s) => s.expanded);
  const setMinimized = useMapLegendStore((s) => s.setMinimized);
  const toggleExpanded = useMapLegendStore((s) => s.toggleExpanded);
  const legends = LAYER_LEGENDS.filter((l) => active[l.id]);
  if (legends.length === 0 || screensaverActive || hoverEngaged) return null;
  return (
    <MapLegendPanel
      legends={legends}
      minimized={minimized}
      expanded={expanded}
      onMinimizedChange={setMinimized}
      onToggleRow={toggleExpanded}
    />
  );
}

interface MapLegendPanelProps {
  legends: readonly LayerLegend[];
  minimized: boolean;
  expanded: Partial<Record<LayerId, boolean>>;
  onMinimizedChange: (minimized: boolean) => void;
  onToggleRow: (id: LayerId) => void;
}

// Store-free, so each state renders (and tests) on its own. The header is the
// same <button> in both states, so keyboard focus survives minimizing.
export function MapLegendPanel({
  legends,
  minimized,
  expanded,
  onMinimizedChange,
  onToggleRow,
}: MapLegendPanelProps) {
  return (
    <section
      aria-label="Map legend"
      className={`pointer-events-auto flex min-h-0 flex-col overflow-hidden border border-white/10 bg-ink-900/90 shadow-panel backdrop-blur-md ${
        minimized ? 'self-end rounded-full' : 'rounded-xl'
      }`}
    >
      <button
        type="button"
        onClick={() => onMinimizedChange(!minimized)}
        aria-expanded={!minimized}
        title={minimized ? `Show the legend: ${legends.map((l) => l.title).join(', ')}` : 'Minimize the legend'}
        className={`flex shrink-0 items-center gap-1.5 px-3 text-[10px] font-semibold uppercase tracking-wider text-white/40 transition hover:text-white/75 ${
          minimized ? 'py-1.5' : 'pb-1.5 pt-2'
        }`}
      >
        Legend
        {minimized && (
          <span className="rounded-full bg-white/10 px-1.5 text-[9px] tabular-nums tracking-normal text-white/60">
            {legends.length}
          </span>
        )}
        <span
          aria-hidden="true"
          className={`ml-auto inline-block pl-1 transition-transform ${minimized ? 'rotate-180' : ''}`}
        >
          ▾
        </span>
      </button>
      {!minimized && (
        <div className="hud-scroll min-h-0 overflow-y-auto overscroll-contain">
          {legends.map(({ id, title, hint, Legend, Compact }) => {
            const open = !!expanded[id];
            return (
              <div key={id} className="border-t border-white/6 px-3 py-1.5">
                <button
                  type="button"
                  onClick={() => onToggleRow(id)}
                  aria-expanded={open}
                  title={open ? 'Back to the one-line key' : 'Show the full legend'}
                  className="group flex w-full items-baseline gap-2 text-left"
                >
                  <span className="min-w-0 truncate text-[11px] font-medium leading-4 text-white/75 transition group-hover:text-white">
                    {title}
                  </span>
                  <span className="ml-auto flex shrink-0 items-baseline gap-1.5 text-[9px] text-white/35">
                    {hint && !open && <span>{hint}</span>}
                    <span aria-hidden="true" className={`inline-block transition-transform ${open ? '' : '-rotate-90'}`}>
                      ▾
                    </span>
                  </span>
                </button>
                {open ? (
                  <Legend />
                ) : (
                  // A click on the key opens the full legend too; the row's
                  // button above is the keyboard path.
                  <div className="mt-1 cursor-pointer" onClick={() => onToggleRow(id)}>
                    <Compact />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
