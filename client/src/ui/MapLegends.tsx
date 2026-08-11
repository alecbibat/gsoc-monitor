import { useLayersStore } from '../store/layersStore';
import { useScreensaverStore } from '../screensaver/screensaverStore';
import { useHoverStore } from '../screensaver/hoverStore';
import { LAYER_LEGENDS } from '../layers/layerLegends';

// Floating legend cards for whichever active layers have a symbology key.
// Rendered inside the bottom-right HUD stack in App, directly above the wind
// probe readout. The stack's max-height caps them, so several legends scroll
// instead of covering the globe (min-h-0 lets this flex child shrink).
export function MapLegends() {
  const active = useLayersStore((s) => s.active);
  // Screensaver / hover modes collapse the chrome (and draw their own context
  // minimap in this corner) — hide the legends with it, like the Sidebar does.
  const screensaverActive = useScreensaverStore((s) => s.active);
  const hoverEngaged = useHoverStore((s) => s.active || s.picking);
  const visible = LAYER_LEGENDS.filter((l) => active[l.id]);
  if (visible.length === 0 || screensaverActive || hoverEngaged) return null;
  return (
    <div className="hud-scroll pointer-events-auto flex min-h-0 flex-col gap-2 overflow-y-auto">
      {visible.map(({ id, title, Legend }) => (
        <div
          key={id}
          className="shrink-0 rounded-xl border border-white/10 bg-ink-900/90 px-3 pb-2.5 pt-2 shadow-panel backdrop-blur-md"
        >
          <div className="text-[10px] font-semibold uppercase tracking-wider text-white/40">
            {title}
          </div>
          <Legend />
        </div>
      ))}
    </div>
  );
}
