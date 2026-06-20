import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useScreensaverStore } from './screensaverStore';
import { useUiStore } from '../ui/uiStore';
import { useProximityStore } from '../widgets/proximity/proximityStore';
import { HazardRows } from '../widgets/proximity/HazardRows';

// Credits-roll column shown in the right rail during the pins screensaver.
// Lists each watched property and its hazards in a vertical marquee. When the
// context minimap is hidden (zoomed out, no POI) the column extends all the way
// to the bottom edge so there's no dead gap.

const COL_W = 240;     // matches the context minimap width
const EDGE = 24;       // right-6 / bottom-6
const CTX_H = 130;     // PinsContextBox MAP_H
const CTX_GAP = 12;
const TOPBAR_H = 88;   // fallback floor before the right cluster is measured
const TOP_GAP = 12;    // breathing room below the search bar / info button
const SCROLL_PX_PER_SEC = 24;

export function ScreensaverWatchCards() {
  const active = useScreensaverStore((s) => s.active);
  const mode = useScreensaverStore((s) => s.mode);
  const poi = useScreensaverStore((s) => s.currentPoi);
  const result = useProximityStore((s) => s.result);
  const radiusMi = useProximityStore((s) => s.radiusMi);
  const scan = useProximityStore((s) => s.scan);
  const topRightBottom = useUiStore((s) => s.topRightBottom);

  const viewportRef = useRef<HTMLDivElement>(null);
  const blockRef = useRef<HTMLDivElement>(null);
  const [scroll, setScroll] = useState(false);
  const [blockH, setBlockH] = useState(0);

  const isPins = active && mode === 'pins';
  const affected = result?.properties ?? [];
  const sig = affected.map((p) => p.key).join(',');

  // Keep scan fresh while we're the active consumer.
  useEffect(() => {
    if (!isPins) return;
    if (!result) void scan();
    const id = setInterval(() => scan(), 5 * 60_000);
    return () => clearInterval(id);
  }, [isPins, result, scan]);

  // Enable auto-scroll only when the card list overflows the flex viewport.
  useLayoutEffect(() => {
    if (!isPins) return;
    const vp = viewportRef.current;
    const block = blockRef.current;
    if (!vp || !block) return;
    const h = block.offsetHeight;
    setBlockH(h);
    setScroll(h > vp.clientHeight + 2);
  }, [isPins, sig, radiusMi, poi]);

  if (!isPins) return null;

  const durationS = Math.max(14, blockH / SCROLL_PX_PER_SEC);
  // The context minimap is only shown while a POI is focused. When it's hidden
  // (zoomed out), reclaim its footprint so the column reaches the bottom edge.
  const ctxVisible = poi !== null;
  const bottom = ctxVisible ? EDGE + CTX_H + CTX_GAP : EDGE;
  // Start below the measured search/info cluster so the column never overlaps
  // them; fall back to the fixed floor until the first measurement lands.
  const top = Math.max(TOPBAR_H, topRightBottom + TOP_GAP);

  const cards =
    affected.length === 0 ? (
      <div className="rounded-lg border border-accent-ok/30 bg-accent-ok/10 px-3 py-2 text-[11px] text-accent-ok shadow-lg backdrop-blur-sm">
        <span className="mr-1" aria-hidden>✓</span>
        All clear — {result?.scannedCount ?? 0} properties monitored
      </div>
    ) : (
      affected.map((p) => (
        <div
          key={p.key}
          className="rounded-lg border border-white/10 bg-ink-900/85 px-3 py-2 shadow-lg backdrop-blur-sm"
        >
          <div className="flex items-center gap-2">
            <span aria-hidden className="text-[13px]">{p.group.icon}</span>
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
    // Hidden on mobile — the column is 240 px wide and blocks most of a phone
    // screen. The focused property's hazards are already in the bottom card.
    <div
      className="pointer-events-none absolute right-6 z-30 hidden flex-col gap-2 md:flex"
      style={{ top, bottom, width: COL_W, transition: 'bottom 0.5s ease' }}
    >
      {/* Section label */}
      <div className="flex shrink-0 items-center gap-1.5 px-0.5">
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

      {/* Scrolling property cards — fills remaining height */}
      <div ref={viewportRef} className="relative min-h-0 flex-1 overflow-hidden">
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

        {scroll && (
          <>
            <div className="pointer-events-none absolute inset-x-0 top-0 h-6 bg-gradient-to-b from-[#05070a] to-transparent" />
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-6 bg-gradient-to-t from-[#05070a] to-transparent" />
          </>
        )}
      </div>
    </div>
  );
}
