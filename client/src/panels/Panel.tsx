import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Rnd } from 'react-rnd';
import { usePanelStore, type PanelData, type DockZone, ZONES, ZONE_LABELS, dockPos } from './panelStore';

interface PanelProps {
  panel: PanelData;
  children: React.ReactNode;
  accentClass?: string;
}

const SNAP_PX = 150;

function zoneCenter(zone: DockZone, w: number, h: number) {
  const p = dockPos(zone, w, h);
  return { x: p.x + w / 2, y: p.y + h / 2 };
}

function DockTargets({
  activeZone,
  width,
  height,
}: {
  activeZone: DockZone | null;
  width: number;
  height: number;
}) {
  return createPortal(
    <div className="pointer-events-none fixed inset-0" style={{ zIndex: 9990 }}>
      {ZONES.map((zone) => {
        const pos = dockPos(zone, width, height);
        const active = zone === activeZone;
        return (
          <div
            key={zone}
            style={{ position: 'absolute', left: pos.x, top: pos.y, width, height }}
            className={`flex items-center justify-center rounded-lg border-2 transition-colors duration-100 ${
              active ? 'border-accent bg-accent/15' : 'border-white/15 bg-white/[0.03]'
            }`}
          >
            <span
              className={`text-[11px] font-medium uppercase tracking-widest transition-colors duration-100 ${
                active ? 'text-accent' : 'text-white/25'
              }`}
            >
              {ZONE_LABELS[zone]}
            </span>
          </div>
        );
      })}
    </div>,
    document.body
  );
}

function PinIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
      <path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5v6l1 1 1-1v-6h5v-2l-2-2z" />
    </svg>
  );
}

export function Panel({ panel, children, accentClass = 'border-accent/40' }: PanelProps) {
  const close = usePanelStore((s) => s.close);
  const bringToFront = usePanelStore((s) => s.bringToFront);
  const updateRect = usePanelStore((s) => s.updateRect);
  const dock = usePanelStore((s) => s.dock);
  const undock = usePanelStore((s) => s.undock);

  const [isDragging, setIsDragging] = useState(false);
  const [hoverZone, setHoverZone] = useState<DockZone | null>(null);
  const hoverZoneRef = useRef<DockZone | null>(null);

  // Re-pin docked panels when the window is resized.
  useEffect(() => {
    if (!panel.dockedTo) return;
    function onResize() {
      const pos = dockPos(panel.dockedTo!, panel.width, panel.height);
      updateRect(panel.id, pos);
    }
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [panel.dockedTo, panel.id, panel.width, panel.height, updateRect]);

  return (
    <>
      {isDragging && (
        <DockTargets activeZone={hoverZone} width={panel.width} height={panel.height} />
      )}
      <Rnd
        size={{ width: panel.width, height: panel.height }}
        position={{ x: panel.x, y: panel.y }}
        minWidth={280}
        minHeight={160}
        bounds="window"
        dragHandleClassName="panel-drag-handle"
        style={{ zIndex: panel.z }}
        onDragStart={() => {
          bringToFront(panel.id);
          setIsDragging(true);
        }}
        onDrag={(_, d) => {
          const cx = d.x + panel.width / 2;
          const cy = d.y + panel.height / 2;
          let best: DockZone | null = null;
          let bestDist = SNAP_PX;
          for (const zone of ZONES) {
            const c = zoneCenter(zone, panel.width, panel.height);
            const dist = Math.hypot(cx - c.x, cy - c.y);
            if (dist < bestDist) {
              bestDist = dist;
              best = zone;
            }
          }
          if (best !== hoverZoneRef.current) {
            hoverZoneRef.current = best;
            setHoverZone(best);
          }
        }}
        onDragStop={(_, d) => {
          setIsDragging(false);
          const snapped = hoverZoneRef.current;
          hoverZoneRef.current = null;
          setHoverZone(null);
          if (snapped) {
            dock(panel.id, snapped);
          } else {
            undock(panel.id, d.x, d.y);
          }
        }}
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
            <div className="ml-2 flex shrink-0 items-center gap-1">
              {panel.dockedTo && (
                <button
                  onClick={() => undock(panel.id)}
                  title={`${ZONE_LABELS[panel.dockedTo]} — click to float`}
                  className="rounded p-1 text-accent/60 hover:bg-white/10 hover:text-accent"
                >
                  <PinIcon />
                </button>
              )}
              <button
                onClick={() => close(panel.id)}
                className="rounded p-1 text-white/50 hover:bg-white/10 hover:text-white"
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
          </div>
          <div className="hud-scroll min-h-0 flex-1 overflow-y-auto p-3 text-sm text-white/85">
            {children}
          </div>
        </div>
      </Rnd>
    </>
  );
}
