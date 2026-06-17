import { useEffect, useRef, useState } from 'react';
import { usePanelStore } from './panelStore';
import { PanelErrorBoundary } from './PanelErrorBoundary';
import { PanelContent, panelAccent } from './PanelContent';

// Mobile replacement for the floating/dockable panels. Open panels become a
// full-width bottom-sheet card; when more than one is open they're laid out as
// horizontal pages you swipe between, with dots to jump directly. There are no
// drag/resize/dock affordances here — those don't belong on a touch screen.
export function MobilePanelDeck() {
  const panels = usePanelStore((s) => s.panels);
  const close = usePanelStore((s) => s.close);
  const closeAll = usePanelStore((s) => s.closeAll);

  const scrollerRef = useRef<HTMLDivElement>(null);
  const prevIdsRef = useRef<string[]>([]);
  const activeIdRef = useRef<string | null>(null);
  // Set when focus moves programmatically (new panel, dot tap, close) so the
  // paging effect scrolls — manual swipes never trigger it, avoiding a fight.
  const pendingScrollRef = useRef(false);
  const rafRef = useRef(0);
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);

  // Focus a newly-opened panel; when the active one closes, fall back to the
  // last remaining panel. Re-snap whenever the open set changes.
  useEffect(() => {
    const ids = panels.map((p) => p.id);
    const prev = prevIdsRef.current;
    prevIdsRef.current = ids;
    const added = ids.find((id) => !prev.includes(id));
    if (added || ids.length !== prev.length) pendingScrollRef.current = true;

    const cur = activeIdRef.current;
    setActiveId(added ?? (cur && ids.includes(cur) ? cur : ids[ids.length - 1] ?? null));
  }, [panels]);

  const activeIndex = Math.max(
    0,
    panels.findIndex((p) => p.id === activeId)
  );

  // Page programmatically only when focus moved deliberately.
  useEffect(() => {
    if (!pendingScrollRef.current) return;
    pendingScrollRef.current = false;
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTo({ left: activeIndex * el.clientWidth, behavior: 'smooth' });
  }, [activeIndex, panels.length]);

  if (panels.length === 0) return null;

  const active = panels[activeIndex];

  const goTo = (id: string) => {
    if (id === activeIdRef.current) return;
    pendingScrollRef.current = true;
    setActiveId(id);
  };

  // Track the active page as the user swipes (rAF-throttled). Never scrolls.
  const onScroll = () => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      const el = scrollerRef.current;
      if (!el || el.clientWidth === 0) return;
      const idx = Math.round(el.scrollLeft / el.clientWidth);
      const p = panels[idx];
      if (p && p.id !== activeIdRef.current) setActiveId(p.id);
    });
  };

  return (
    <div
      className={`fixed inset-x-0 bottom-0 z-40 flex h-[74vh] flex-col overflow-hidden rounded-t-2xl border-t-2 ${panelAccent(
        active.kind
      )} bg-ink-900/95 shadow-2xl backdrop-blur-md`}
    >
      {/* Grabber */}
      <div className="flex shrink-0 justify-center pt-2">
        <div className="h-1 w-10 rounded-full bg-white/20" />
      </div>

      {/* Header — title of the active page + controls */}
      <div className="flex shrink-0 items-center justify-between gap-2 px-4 py-2">
        <div className="min-w-0">
          <div className="truncate text-xs font-semibold uppercase tracking-wide text-accent">
            {active.title}
          </div>
          {active.subtitle && (
            <div className="truncate text-[11px] text-white/50">{active.subtitle}</div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {panels.length > 1 && (
            <button
              onClick={closeAll}
              className="rounded px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-white/40 hover:bg-white/10 hover:text-white/70"
            >
              Close all
            </button>
          )}
          <button
            onClick={() => close(active.id)}
            className="rounded p-1 text-white/50 hover:bg-white/10 hover:text-white"
            aria-label="Close panel"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
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

      {/* Swipeable pages */}
      <div
        ref={scrollerRef}
        onScroll={onScroll}
        className="flex flex-1 snap-x snap-mandatory overflow-x-auto overflow-y-hidden"
        style={{ scrollbarWidth: 'none' }}
      >
        {panels.map((panel) => (
          <div
            key={panel.id}
            className="hud-scroll h-full w-full shrink-0 snap-start overflow-y-auto px-4 pb-4 text-sm text-white/85"
          >
            <PanelErrorBoundary>
              <PanelContent panel={panel} />
            </PanelErrorBoundary>
          </div>
        ))}
      </div>

      {/* Page dots */}
      {panels.length > 1 && (
        <div className="flex shrink-0 items-center justify-center gap-1.5 py-2.5">
          {panels.map((p, i) => (
            <button
              key={p.id}
              onClick={() => goTo(p.id)}
              aria-label={`Go to ${p.title}`}
              className={`h-1.5 rounded-full transition-all ${
                i === activeIndex ? 'w-5 bg-accent' : 'w-1.5 bg-white/25'
              }`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
