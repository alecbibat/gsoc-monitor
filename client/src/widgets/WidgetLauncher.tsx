import { usePanelStore } from '../panels/panelStore';
import { WIDGET_META } from './widgetMeta';

export function WidgetLauncher() {
  const open = usePanelStore((s) => s.open);

  return (
    <div className="pointer-events-auto flex items-center gap-1 rounded-lg border border-white/10 bg-ink-900/80 px-1.5 py-1 shadow-panel backdrop-blur-sm">
      {WIDGET_META.map((w) => (
        <button
          key={w.id}
          // Widgets are tools the operator launched on purpose, not map popups:
          // they open locked so clicking around the globe doesn't dismiss them
          // (the header padlock unlocks one if that's wanted).
          onClick={() =>
            open({
              id: `widget-${w.id}`,
              kind: w.id,
              title: w.title,
              subtitle: w.subtitle,
              payload: {},
              locked: true,
            })
          }
          className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] text-white/70 transition hover:bg-white/10 hover:text-white"
          title={w.title}
        >
          <span aria-hidden>{w.glyph}</span>
          <span>{w.label}</span>
        </button>
      ))}
    </div>
  );
}
