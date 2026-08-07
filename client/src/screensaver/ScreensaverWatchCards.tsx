import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useScreensaverStore } from './screensaverStore';
import { useUiStore } from '../ui/uiStore';
import { useProximityStore } from '../widgets/proximity/proximityStore';
import type { PropertyHazards } from '../widgets/proximity/proximityScan';
import { fmtMiles, quakeColor } from '../widgets/proximity/format';

// Static hazard rail shown on the right during the pins screensaver. Every
// affected property gets a compact card, and every card stays on screen: when
// one column can't hold them all, the rail grows extra columns leftward, using
// only as much width as the card count needs. Cards read top-to-bottom,
// worst-first, starting in the rightmost column. The context minimap keeps its
// bottom-right corner — only the rightmost column shortens to clear it, so the
// overflow columns get the full height.

const COL_W = 240;      // matches the context minimap width
const RAIL_BOTTOM = 48; // matches the minimap's bottom-12 — clears the 36px news ticker
const CTX_H = 130;      // PinsContextBox MAP_H
const CTX_GAP = 12;
const TOPBAR_H = 88;    // fallback floor before the right cluster is measured
const TOP_GAP = 12;     // breathing room below the search bar / info button
const CARD_GAP = 6;     // gap-1.5 between cards in a column
const COL_GAP = 8;      // gap-2 between columns
const MORE_H = 26;      // room reserved for the "+N more" pill
const LEFT_RESERVE = 300; // screen width the rail must never grow into

// Split the card heights into sequential columns. The first (rightmost) column
// has its own capacity because the minimap may shorten it. If the cards can't
// fit even at maxCols, refit with room for the "+N more" pill at the end of
// the last column — the only case where a card is allowed off screen.
function partition(
  heights: number[],
  firstCap: number,
  restCap: number,
  maxCols: number,
): number[] {
  const attempt = (reservePill: boolean) => {
    const counts: number[] = [];
    let i = 0;
    for (let col = 0; col < maxCols && i < heights.length; col++) {
      let cap = col === 0 ? firstCap : restCap;
      if (reservePill && col === maxCols - 1) cap -= CARD_GAP + MORE_H;
      let used = 0;
      let n = 0;
      while (i < heights.length) {
        const add = n === 0 ? heights[i] : CARD_GAP + heights[i];
        // Never leave a column empty — an oversized lone card just clips.
        if (used + add > cap && n > 0) break;
        used += add;
        n++;
        i++;
      }
      counts.push(n);
    }
    return { counts, placed: i };
  };
  const plain = attempt(false);
  if (plain.placed >= heights.length) return plain.counts;
  return attempt(true).counts;
}

// One-line chip summary of a property's hazards. Denser than the shared
// HazardRows: alerts collapse to two chips + a count, fires and quakes each
// collapse to a single count/nearest-distance chip.
function CompactHazardChips({ p }: { p: PropertyHazards }) {
  const maxMag = p.maxQuakeMag ?? 0;
  const qColor = quakeColor(maxMag);
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1">
      {p.alerts.slice(0, 2).map((a) => (
        <span
          key={a.id}
          className="flex min-w-0 items-center gap-1 rounded border px-1.5 py-px text-[9px] font-medium"
          style={{
            color: a.colorHex,
            borderColor: `${a.colorHex}55`,
            background: `${a.colorHex}14`,
          }}
          title={a.headline ?? a.areaDesc}
        >
          <span className="h-1 w-1 shrink-0 rounded-full" style={{ background: a.colorHex }} />
          <span className="truncate">{a.event}</span>
        </span>
      ))}
      {p.alerts.length > 2 && (
        <span className="text-[9px] font-medium text-white/35">+{p.alerts.length - 2} alerts</span>
      )}
      {p.fires.length > 0 && (
        <span className="flex items-center gap-1 rounded border border-accent-warn/40 bg-accent-warn/10 px-1.5 py-px text-[9px] font-medium text-accent-warn">
          <span aria-hidden>🔥</span>
          {p.fires.length}
          {p.nearestFireMi != null && (
            <span className="text-white/40">· {fmtMiles(p.nearestFireMi)} mi</span>
          )}
        </span>
      )}
      {p.quakes.length > 0 && (
        <span
          className="flex items-center gap-1 rounded border px-1.5 py-px text-[9px] font-medium"
          style={{ color: qColor, borderColor: `${qColor}55`, background: `${qColor}14` }}
          title={`${p.quakes.length} earthquake${p.quakes.length > 1 ? 's' : ''}`}
        >
          <span aria-hidden>◎</span>
          M{maxMag.toFixed(1)}
          {p.quakes.length > 1 && <span>×{p.quakes.length}</span>}
          {p.nearestQuakeMi != null && (
            <span className="text-white/40">· {fmtMiles(p.nearestQuakeMi)} mi</span>
          )}
        </span>
      )}
    </div>
  );
}

function WatchCard({ p }: { p: PropertyHazards }) {
  return (
    <div className="rounded-lg border border-white/10 bg-ink-900/85 px-2.5 py-1.5 shadow-lg backdrop-blur-sm">
      <div className="flex items-center gap-1.5">
        <span aria-hidden className="text-[12px]">{p.group.icon}</span>
        <span className="min-w-0 flex-1 truncate text-[11px] font-semibold text-white/85">
          {p.location.name}
        </span>
        <span className="shrink-0 text-[8px] uppercase tracking-wide text-white/30">
          {p.group.name}
        </span>
      </div>
      <CompactHazardChips p={p} />
    </div>
  );
}

export function ScreensaverWatchCards() {
  const active = useScreensaverStore((s) => s.active);
  const mode = useScreensaverStore((s) => s.mode);
  const poi = useScreensaverStore((s) => s.currentPoi);
  const result = useProximityStore((s) => s.result);
  const scan = useProximityStore((s) => s.scan);
  const topRightBottom = useUiStore((s) => s.topRightBottom);

  const areaRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  // Cards per column, rightmost first. Empty until the first measurement.
  const [counts, setCounts] = useState<number[]>([]);

  const isPins = active && mode === 'pins';
  const affected = result?.properties ?? [];
  const sig = affected.map((p) => p.key).join(',');

  // Keep scan fresh while we're the active consumer. The store throttles
  // repeat calls, so kicking one on entry never double-fetches — it only
  // refreshes a result that predates the screensaver starting.
  useEffect(() => {
    if (!isPins) return;
    void scan();
    const id = setInterval(() => scan(), 5 * 60_000);
    return () => clearInterval(id);
  }, [isPins, scan]);

  // Fit pass: an invisible single-column stack of every card provides stable
  // heights, and the visible columns are derived from them — so re-partitioning
  // never disturbs what's being measured. Runs before paint (no visible
  // reflow); a ResizeObserver re-runs it when the rail height or the card
  // content changes, and a window listener re-runs it when the width cap moves.
  useLayoutEffect(() => {
    if (!isPins) return;
    const stack = measureRef.current;
    const area = areaRef.current;
    if (!stack || !area) return;

    const measure = () => {
      const heights = Array.from(stack.children).map((c) => (c as HTMLElement).offsetHeight);
      if (heights.length === 0) return;
      const availH = area.clientHeight;
      const maxCols = Math.max(
        1,
        Math.floor((window.innerWidth - LEFT_RESERVE) / (COL_W + COL_GAP)),
      );
      const firstCap = availH - (poi !== null ? CTX_H + CTX_GAP : 0);
      const next = partition(heights, firstCap, availH, maxCols);
      setCounts((prev) =>
        prev.length === next.length && prev.every((v, i) => v === next[i]) ? prev : next,
      );
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(area);  // rail height: top-bar cluster, window height
    ro.observe(stack); // card content height: new hazards, late font swap
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [isPins, sig, result?.updated, poi, topRightBottom]);

  if (!isPins) return null;

  // Start below the measured search/info cluster so the rail never overlaps
  // them; fall back to the fixed floor until the first measurement lands.
  const top = Math.max(TOPBAR_H, topRightBottom + TOP_GAP);

  const activeCounts = counts.length > 0 ? counts : [affected.length];
  const columns: PropertyHazards[][] = [];
  let placed = 0;
  for (const n of activeCounts) {
    if (placed >= affected.length) break;
    columns.push(affected.slice(placed, placed + n));
    placed += n;
  }
  const hiddenCount = Math.max(0, affected.length - placed);

  return (
    // Hidden on mobile — each column is 240 px wide and blocks most of a phone
    // screen. The focused property's hazards are already in the bottom card.
    <div
      className="pointer-events-none absolute right-6 z-30 hidden flex-col items-end gap-2 md:flex"
      style={{ top, bottom: RAIL_BOTTOM }}
    >
      {/* Section label — pinned above the rightmost column */}
      <div className="flex shrink-0 items-center gap-1.5 px-0.5" style={{ width: COL_W }}>
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

      {/* Card columns — worst-first from the rightmost column down */}
      <div ref={areaRef} className="relative min-h-0 flex-1 overflow-hidden">
        {result === null ? (
          <div
            className="rounded-lg border border-white/10 bg-ink-900/85 px-3 py-2 text-[11px] text-white/40 shadow-lg backdrop-blur-sm"
            style={{ width: COL_W }}
          >
            Scanning properties…
          </div>
        ) : affected.length === 0 ? (
          <div
            className="rounded-lg border border-accent-ok/30 bg-accent-ok/10 px-3 py-2 text-[11px] text-accent-ok shadow-lg backdrop-blur-sm"
            style={{ width: COL_W }}
          >
            <span className="mr-1" aria-hidden>✓</span>
            All clear — {result.scannedCount} properties monitored
          </div>
        ) : (
          <>
            {/* Invisible measuring stack — every card, one column, stable */}
            <div
              ref={measureRef}
              aria-hidden
              className="invisible absolute right-0 top-0 flex flex-col gap-1.5"
              style={{ width: COL_W }}
            >
              {affected.map((p) => (
                <WatchCard key={p.key} p={p} />
              ))}
            </div>

            <div className="flex flex-row-reverse items-start gap-2">
              {columns.map((colCards, ci) => (
                <div
                  key={ci}
                  className="flex shrink-0 flex-col gap-1.5"
                  style={{ width: COL_W }}
                >
                  {colCards.map((p) => (
                    <WatchCard key={p.key} p={p} />
                  ))}
                  {ci === columns.length - 1 && hiddenCount > 0 && (
                    <div className="rounded-md border border-white/10 bg-ink-900/85 px-2.5 py-1 text-center text-[10px] text-white/45 shadow-lg backdrop-blur-sm">
                      +{hiddenCount} more propert{hiddenCount > 1 ? 'ies' : 'y'} affected
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
