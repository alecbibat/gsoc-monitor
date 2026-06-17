import { useEffect } from 'react';
import { usePickChooserStore } from './pickChooserStore';
import { usePanelStore } from './panelStore';
import type { PanelKind } from '../types';

const KIND_LABEL: Partial<Record<PanelKind, string>> = {
  alerts: 'ALERT',
  earthquakes: 'QUAKE',
  flights: 'FLIGHT',
  ships: 'SHIP',
  hurricanes: 'STORM',
  fires: 'FIRE',
  satellites: 'SAT',
  locations: 'PIN',
};

const ITEM_H = 52;
const CARD_W = 264;

// Popup shown when a single click lands on several overlapping features (e.g.
// stacked NWS alerts). Lists each so the user picks which one to dock.
export function PickChooser() {
  const open = usePickChooserStore((s) => s.open);
  const x = usePickChooserStore((s) => s.x);
  const y = usePickChooserStore((s) => s.y);
  const items = usePickChooserStore((s) => s.items);
  const hide = usePickChooserStore((s) => s.hide);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') hide();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, hide]);

  if (!open) return null;

  const W = typeof window !== 'undefined' ? window.innerWidth : 1200;
  const H = typeof window !== 'undefined' ? window.innerHeight : 800;
  const cardH = 40 + Math.min(items.length, 6) * ITEM_H;
  const left = Math.max(12, Math.min(x + 8, W - CARD_W - 12));
  const top = Math.max(12, Math.min(y + 8, H - cardH - 12));

  return (
    <>
      {/* Outside-click catcher. */}
      <div className="fixed inset-0 z-[1000]" onClick={hide} aria-hidden />
      <div
        className="fixed z-[1001] overflow-hidden rounded-xl border border-white/10 bg-ink-900/95 shadow-panel backdrop-blur-md"
        style={{ left, top, width: CARD_W }}
      >
        <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-white/50">
            {items.length} features here
          </span>
          <button
            onClick={hide}
            className="rounded p-0.5 text-white/40 transition hover:text-white"
            aria-label="Dismiss"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <path d="M6 6L18 18M6 18L18 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="max-h-[312px] overflow-y-auto hud-scroll">
          {items.map((item) => (
            <button
              key={item.id}
              onClick={() => {
                usePanelStore.getState().open(item);
                hide();
              }}
              className="flex w-full items-start gap-2.5 border-b border-white/5 px-3 py-2.5 text-left transition last:border-b-0 hover:bg-white/8"
            >
              <span className="mt-0.5 shrink-0 rounded bg-accent/15 px-1.5 py-0.5 text-[9px] font-bold tracking-wider text-accent">
                {KIND_LABEL[item.kind] ?? item.kind.toUpperCase()}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium text-white/90">
                  {item.title}
                </span>
                {item.subtitle ? (
                  <span className="block truncate text-[11px] text-white/45">{item.subtitle}</span>
                ) : null}
              </span>
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
