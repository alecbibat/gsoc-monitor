import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useScreensaverStore } from './screensaverStore';
import { useUiStore } from '../ui/uiStore';
import { useProximityStore } from '../widgets/proximity/proximityStore';
import type { PropertyHazards } from '../widgets/proximity/proximityScan';
import { fmtMiles, quakeColor } from '../widgets/proximity/format';

// Static hazard column shown in the right rail during the pins screensaver.
// Lists each watched property and its hazards as compact fixed cards — no
// scrolling, so the text is readable at a glance. The list is ranked
// worst-first by the scan; when there are more cards than fit the column,
// the overflow collapses into a "+N more" pill under the last full card.
// When the context minimap is hidden (zoomed out, no POI) the column extends
// all the way to the bottom edge so there's no dead gap.

const COL_W = 240;     // matches the context minimap width
const EDGE = 24;       // right-6 / bottom-6
const CTX_H = 130;     // PinsContextBox MAP_H
const CTX_GAP = 12;
const TOPBAR_H = 88;   // fallback floor before the right cluster is measured
const TOP_GAP = 12;    // breathing room below the search bar / info button
const CARD_GAP = 6;    // gap-1.5 between cards
const MORE_H = 26;     // room reserved for the "+N more" pill

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

export function ScreensaverWatchCards() {
  const active = useScreensaverStore((s) => s.active);
  const mode = useScreensaverStore((s) => s.mode);
  const poi = useScreensaverStore((s) => s.currentPoi);
  const result = useProximityStore((s) => s.result);
  const scan = useProximityStore((s) => s.scan);
  const topRightBottom = useUiStore((s) => s.topRightBottom);

  const viewportRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // How many cards fully fit, and where the overflow pill sits (null = all fit).
  const [visible, setVisible] = useState(Infinity);
  const [moreTop, setMoreTop] = useState<number | null>(null);

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

  // Fit-to-column pass: every card renders (so heights are always measurable),
  // then any card that doesn't fully fit is hidden and replaced by the pill.
  // Runs before paint, so the cut never flashes; a ResizeObserver re-runs it
  // when the column height changes (minimap show/hide, window resize).
  useLayoutEffect(() => {
    if (!isPins) return;
    const vp = viewportRef.current;
    const list = listRef.current;
    if (!vp || !list) return;

    const measure = () => {
      const cards = Array.from(list.children) as HTMLElement[];
      const avail = vp.clientHeight;
      const last = cards[cards.length - 1];
      if (!last || last.offsetTop + last.offsetHeight <= avail) {
        setVisible(Infinity);
        setMoreTop(null);
        return;
      }
      let fit = 0;
      let bottom = 0;
      for (const card of cards) {
        const b = card.offsetTop + card.offsetHeight;
        if (b + CARD_GAP + MORE_H > avail) break;
        fit++;
        bottom = b;
      }
      // Always keep at least the worst property on screen, even if cramped.
      if (fit === 0) {
        fit = 1;
        bottom = cards[0].offsetTop + cards[0].offsetHeight;
      }
      setVisible(fit);
      setMoreTop(bottom + CARD_GAP);
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(vp);
    return () => ro.disconnect();
  }, [isPins, sig, result?.updated, poi, topRightBottom]);

  if (!isPins) return null;

  // The context minimap is only shown while a POI is focused. When it's hidden
  // (zoomed out), reclaim its footprint so the column reaches the bottom edge.
  const ctxVisible = poi !== null;
  const bottom = ctxVisible ? EDGE + CTX_H + CTX_GAP : EDGE;
  // Start below the measured search/info cluster so the column never overlaps
  // them; fall back to the fixed floor until the first measurement lands.
  const top = Math.max(TOPBAR_H, topRightBottom + TOP_GAP);

  const hiddenCount = Number.isFinite(visible) ? affected.length - visible : 0;

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

      {/* Static property cards — worst-first, clipped to the column */}
      <div ref={viewportRef} className="relative min-h-0 flex-1 overflow-hidden">
        {affected.length === 0 ? (
          <div className="rounded-lg border border-accent-ok/30 bg-accent-ok/10 px-3 py-2 text-[11px] text-accent-ok shadow-lg backdrop-blur-sm">
            <span className="mr-1" aria-hidden>✓</span>
            All clear — {result?.scannedCount ?? 0} properties monitored
          </div>
        ) : (
          <>
            <div ref={listRef} className="flex flex-col gap-1.5">
              {affected.map((p, i) => (
                <div
                  key={p.key}
                  className={`rounded-lg border border-white/10 bg-ink-900/85 px-2.5 py-1.5 shadow-lg backdrop-blur-sm ${
                    i >= visible ? 'invisible' : ''
                  }`}
                >
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
              ))}
            </div>

            {hiddenCount > 0 && moreTop !== null && (
              <div
                className="absolute inset-x-0 rounded-md border border-white/10 bg-ink-900/85 px-2.5 py-1 text-center text-[10px] text-white/45 shadow-lg backdrop-blur-sm"
                style={{ top: moreTop }}
              >
                +{hiddenCount} more propert{hiddenCount > 1 ? 'ies' : 'y'} affected
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
