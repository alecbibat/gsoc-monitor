import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { usePanelStore } from '../panels/panelStore';
import { useScreensaverStore } from './screensaverStore';
import { useProximityStore } from '../widgets/proximity/proximityStore';
import { HazardRows } from '../widgets/proximity/HazardRows';

// A slow, credits-roll column of Property Watch cards shown in the bottom-right
// during the screensaver, directly above the pins "CONTEXT" minimap. It mirrors
// the open Property Watch panel so the live hazard picture stays readable while
// the panel chrome itself is out of focus during the tour.

const COL_W = 240; // matches the context minimap width for a tidy stacked column
const EDGE = 24; // bottom-6 / right-6
const CTX_H = 130; // context minimap height (PinsContextBox MAP_H)
const GAP = 12;
const SCROLL_PX_PER_SEC = 24; // gentle, screensaver-paced roll
const VIEW_MAX_H = 'min(320px, 42vh)';

export function ScreensaverWatchCards() {
  const active = useScreensaverStore((s) => s.active);
  const mode = useScreensaverStore((s) => s.mode);
  const watchPanelOpen = usePanelStore((s) => s.panels.some((p) => p.kind === 'proximity'));
  const result = useProximityStore((s) => s.result);
  const radiusMi = useProximityStore((s) => s.radiusMi);
  const scan = useProximityStore((s) => s.scan);

  const viewportRef = useRef<HTMLDivElement>(null);
  const blockRef = useRef<HTMLDivElement>(null);
  const [scroll, setScroll] = useState(false);
  const [blockH, setBlockH] = useState(0);

  const affected = result?.properties ?? [];
  const show = active && watchPanelOpen && result !== null;
  const sig = affected.map((p) => p.key).join(',');

  // The panel's own widget normally keeps the shared store fresh, but kick a
  // (throttled, de-duped) scan defensively if we're shown with no data yet.
  useEffect(() => {
    if (active && watchPanelOpen && !result) void scan();
  }, [active, watchPanelOpen, result, scan]);

  // Only roll when the cards actually overflow the viewport — otherwise they sit
  // still at the top.
  useLayoutEffect(() => {
    if (!show) return;
    const vp = viewportRef.current;
    const block = blockRef.current;
    if (!vp || !block) return;
    const h = block.offsetHeight; // one copy, including its trailing pb-2 gap
    setBlockH(h);
    setScroll(h > vp.clientHeight + 2);
  }, [show, sig, radiusMi]);

  if (!show) return null;

  const isPins = mode === 'pins';
  // Sit above the context minimap in pins mode; otherwise hug the corner.
  const bottom = isPins ? EDGE + CTX_H + GAP : EDGE;
  const durationS = Math.max(12, blockH / SCROLL_PX_PER_SEC);

  const cards =
    affected.length === 0 ? (
      <div className="rounded-lg border border-accent-ok/30 bg-accent-ok/10 px-3 py-2 text-[11px] text-accent-ok shadow-lg backdrop-blur-sm">
        <span className="mr-1" aria-hidden>
          ✓
        </span>
        All clear — {result?.scannedCount ?? 0} properties monitored
      </div>
    ) : (
      affected.map((p) => (
        <div
          key={p.key}
          className="rounded-lg border border-white/10 bg-ink-900/85 px-3 py-2 shadow-lg backdrop-blur-sm"
        >
          <div className="flex items-center gap-2">
            <span aria-hidden className="text-[13px]">
              {p.group.icon}
            </span>
            <span className="min-w-0 flex-1 truncate text-[11px] font-semibold text-white/85">
              {p.location.name}
            </span>
            <span className="shrink-0 text-[9px] uppercase tracking-wide text-white/30">
              {p.group.name}
            </span>
          </div>
          <HazardRows hazards={p} radiusMi={radiusMi} />
        </div>
      ))
    );

  return (
    <div
      className="pointer-events-none absolute right-6 z-30"
      style={{ bottom, width: COL_W }}
    >
      {/* Header — mirrors the "CONTEXT" minimap label */}
      <div className="mb-1.5 flex items-center gap-1.5 px-0.5">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent-ok" />
        <span className="text-[9px] font-semibold uppercase tracking-wider text-white/40">
          Property Watch
        </span>
        {affected.length > 0 && (
          <span className="ml-auto text-[9px] font-semibold text-accent-warn/80">
            {affected.length} active
          </span>
        )}
      </div>

      <div ref={viewportRef} className="relative overflow-hidden" style={{ maxHeight: VIEW_MAX_H }}>
        <div
          className={scroll ? 'animate-marquee-vertical' : undefined}
          style={scroll ? { animationDuration: `${durationS}s` } : undefined}
        >
          <div ref={blockRef} className="space-y-2 pb-2">
            {cards}
          </div>
          {scroll && (
            <div aria-hidden className="space-y-2 pb-2">
              {cards}
            </div>
          )}
        </div>

        {/* Soft fades so cards emerge/recede instead of clipping hard. */}
        {scroll && (
          <>
            <div className="pointer-events-none absolute inset-x-0 top-0 h-5 bg-gradient-to-b from-[#05070a] to-transparent" />
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-5 bg-gradient-to-t from-[#05070a] to-transparent" />
          </>
        )}
      </div>
    </div>
  );
}
