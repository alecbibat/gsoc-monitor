import React from 'react';
import { Rnd } from 'react-rnd';
import { usePanelStore, type PanelData } from './panelStore';

interface PanelProps {
  panel: PanelData;
  children: React.ReactNode;
  accentClass?: string;
}

export function Panel({ panel, children, accentClass = 'border-accent/40' }: PanelProps) {
  const close = usePanelStore((s) => s.close);
  const bringToFront = usePanelStore((s) => s.bringToFront);
  const updateRect = usePanelStore((s) => s.updateRect);

  return (
    <Rnd
      size={{ width: panel.width, height: panel.height }}
      position={{ x: panel.x, y: panel.y }}
      minWidth={280}
      minHeight={160}
      bounds="window"
      dragHandleClassName="panel-drag-handle"
      style={{ zIndex: panel.z }}
      onDragStart={() => bringToFront(panel.id)}
      onDragStop={(_e, d) => updateRect(panel.id, { x: d.x, y: d.y })}
      onResizeStart={() => bringToFront(panel.id)}
      onResizeStop={(_e, _dir, ref, _delta, pos) =>
        updateRect(panel.id, {
          width: ref.offsetWidth,
          height: ref.offsetHeight,
          x: pos.x,
          y: pos.y,
        })
      }
    >
      <div
        className={`flex h-full w-full flex-col overflow-hidden rounded-lg border ${accentClass} bg-ink-900/90 shadow-panel backdrop-blur-sm`}
        onMouseDown={() => bringToFront(panel.id)}
      >
        <div className="panel-drag-handle flex shrink-0 cursor-move items-center justify-between border-b border-white/10 bg-ink-800/80 px-3 py-2">
          <div className="min-w-0">
            <div className="truncate text-xs font-semibold uppercase tracking-wide text-accent">
              {panel.title}
            </div>
            {panel.subtitle && (
              <div className="truncate text-[11px] text-white/50">{panel.subtitle}</div>
            )}
          </div>
          <button
            onClick={() => close(panel.id)}
            className="ml-2 shrink-0 rounded p-1 text-white/50 hover:bg-white/10 hover:text-white"
            aria-label="Close panel"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <path
                d="M6 6L18 18M6 18L18 6"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
        <div className="hud-scroll min-h-0 flex-1 overflow-y-auto p-3 text-sm text-white/85">
          {children}
        </div>
      </div>
    </Rnd>
  );
}
