import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useScreensaverStore } from './screensaverStore';
import { useProximityStore } from '../widgets/proximity/proximityStore';
import type { PropertyHazards } from '../widgets/proximity/proximityScan';
import { quakeColor } from '../widgets/proximity/format';

// Static hazard rail shown on the right during the pins screensaver. One line
// per affected property — icon, name, and compact hazard badges — so the whole
// watch list fits in a single 240px column without scrolling. The top-right
// search cluster hides while the screensaver runs (see TopBar), so the rail
// gets the full corner, from just under the top edge down to the context
// minimap (POI focused) or the news ticker (zoomed out). The scan ranks
// worst-first, so the most severe properties are always at the top; if the
// list somehow still overflows, the overflow collapses into a "+N more" pill.

const COL_W = 240;      // matches the context minimap width
const TOP_EDGE = 24;    // top inset, mirroring the rail's right-6
const RAIL_BOTTOM = 48; // matches the minimap's bottom-12 — clears the 36px news ticker
const CTX_H = 130;      // PinsContextBox MAP_H
const CTX_GAP = 12;
const ROW_GAP = 4;      // gap-1 between rows
const MORE_H = 24;      // room reserved for the "+N more" pill

// Single-line badge strip: worst-alert dot (its NWS color) with a count,
// fire count, and max quake magnitude. Details live in the focus card.
function HazardBadges({ p }: { p: PropertyHazards }) {
  const alertColor = p.alerts[0]?.colorHex; // scan sorts alerts worst-first
  const maxMag = p.maxQuakeMag ?? 0;
  return (
    <>
      {p.alerts.length > 0 && (
        <span
          className="flex shrink-0 items-center gap-1 text-[9px] font-bold"
          style={{ color: alertColor }}
          title={p.alerts[0].event}
        >
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: alertColor }} />
          {p.alerts.length > 1 && p.alerts.length}
        </span>
      )}
      {p.fires.length > 0 && (
        <span className="shrink-0 text-[9px] font-bold text-accent-warn">
          <span aria-hidden>🔥</span>
          {p.fires.length}
        </span>
      )}
      {p.quakes.length > 0 && (
        <span
          className="shrink-0 text-[9px] font-bold"
          style={{ color: quakeColor(maxMag) }}
        >
          <span aria-hidden>◎</span>
          {maxMag.toFixed(1)}
        </span>
      )}
    </>
  );
}

export function ScreensaverWatchCards() {
  const active = useScreensaverStore((s) => s.active);
  const mode = useScreensaverStore((s) => s.mode);
  const poi = useScreensaverStore((s) => s.currentPoi);
  const result = useProximityStore((s) => s.result);
  const scan = useProximityStore((s) => s.scan);

  const viewportRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // How many rows fully fit, and where the overflow pill sits (null = all fit).
  const [visible, setVisible] = useState(Infinity);
  const [moreTop, setMoreTop] = useState<number | null>(null);

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

  // Fit-to-column pass: every row renders (so heights are always measurable),
  // then any row that doesn't fully fit is hidden and replaced by the pill.
  // Runs before paint, so the cut never flashes; a ResizeObserver re-runs it
  // when the column height changes (minimap show/hide, window resize).
  useLayoutEffect(() => {
    if (!isPins) return;
    const vp = viewportRef.current;
    const list = listRef.current;
    if (!vp || !list) return;

    const measure = () => {
      const rows = Array.from(list.children) as HTMLElement[];
      const avail = vp.clientHeight;
      const last = rows[rows.length - 1];
      if (!last || last.offsetTop + last.offsetHeight <= avail) {
        setVisible(Infinity);
        setMoreTop(null);
        return;
      }
      let fit = 0;
      let bottom = 0;
      for (const row of rows) {
        const b = row.offsetTop + row.offsetHeight;
        if (b + ROW_GAP + MORE_H > avail) break;
        fit++;
        bottom = b;
      }
      // Always keep at least the worst property on screen, even if cramped.
      if (fit === 0) {
        fit = 1;
        bottom = rows[0].offsetTop + rows[0].offsetHeight;
      }
      setVisible(fit);
      // Keep the pill inside the clipped viewport — in the cramped one-row
      // clamp path it would otherwise land past the bottom edge and vanish.
      setMoreTop(Math.min(bottom + ROW_GAP, Math.max(0, avail - MORE_H)));
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(vp);
    // The list tracks row content height — catches reflows the viewport
    // can't see, like a late web-font swap re-wrapping the text.
    ro.observe(list);
    return () => ro.disconnect();
  }, [isPins, sig, result?.updated, poi]);

  if (!isPins) return null;

  // The context minimap is only shown while a POI is focused. When it's hidden
  // (zoomed out), reclaim its footprint so the rail reaches the news ticker.
  const ctxVisible = poi !== null;
  const bottom = ctxVisible ? RAIL_BOTTOM + CTX_H + CTX_GAP : RAIL_BOTTOM;

  const hiddenCount = Number.isFinite(visible) ? affected.length - visible : 0;

  return (
    // Hidden on mobile — the rail is 240 px wide and blocks most of a phone
    // screen. The focused property's hazards are already in the bottom card.
    <div
      className="pointer-events-none absolute right-6 z-30 hidden flex-col gap-2 md:flex"
      style={{ top: TOP_EDGE, bottom, width: COL_W, transition: 'bottom 0.5s ease' }}
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

      {/* One-line property rows — worst-first, clipped to the column */}
      <div ref={viewportRef} className="relative min-h-0 flex-1 overflow-hidden">
        {result === null ? (
          <div className="rounded-lg border border-white/10 bg-ink-900/85 px-3 py-2 text-[11px] text-white/40 shadow-lg backdrop-blur-sm">
            Scanning properties…
          </div>
        ) : affected.length === 0 ? (
          <div className="rounded-lg border border-accent-ok/30 bg-accent-ok/10 px-3 py-2 text-[11px] text-accent-ok shadow-lg backdrop-blur-sm">
            <span className="mr-1" aria-hidden>✓</span>
            All clear — {result.scannedCount} properties monitored
          </div>
        ) : (
          <>
            <div ref={listRef} className="flex flex-col gap-1">
              {affected.map((p, i) => (
                <div
                  key={p.key}
                  className={`flex items-center gap-1.5 rounded-md border border-white/10 bg-ink-900/85 px-2 py-[3px] shadow backdrop-blur-sm ${
                    i >= visible ? 'invisible' : ''
                  }`}
                >
                  <span aria-hidden className="text-[11px] leading-none">{p.group.icon}</span>
                  <span className="min-w-0 flex-1 truncate text-[10px] font-semibold text-white/85">
                    {p.location.name}
                  </span>
                  <HazardBadges p={p} />
                </div>
              ))}
            </div>

            {hiddenCount > 0 && moreTop !== null && (
              <div
                className="absolute inset-x-0 rounded-md border border-white/10 bg-ink-900/85 px-2 py-[3px] text-center text-[10px] text-white/45 shadow backdrop-blur-sm"
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
