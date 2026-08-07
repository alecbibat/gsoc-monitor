import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useScreensaverStore } from './screensaverStore';
import { useProximityStore } from '../widgets/proximity/proximityStore';
import type { PropertyHazards } from '../widgets/proximity/proximityScan';
import { quakeColor } from '../widgets/proximity/format';

// Slim Property Watch strip pinned to the bottom edge during the pins
// screensaver, in the slot the news ticker vacates (NewsTicker hides while a
// screensaver runs). One chip per affected property — icon, name, and compact
// hazard badges — laid out statically so the text is readable at a glance.
// When the chips don't all fit across the screen they split into pages that
// crossfade every few seconds, worst-first on page one; nothing ever scrolls.

const CHIP_GAP = 8;     // gap-2 between chips
const PAD_X = 24;       // px-3 on each side of the chip row
const PAGE_MS = 10_000; // dwell per page when the chips don't all fit
const INDICATOR_W = 44; // reserved for the "2/3" page counter

// Compact badge strip: worst-alert dot (its NWS color) with a count, fire
// count, and max quake magnitude. Details live in the bottom focus card.
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
        <span className="shrink-0 text-[9px] font-bold" style={{ color: quakeColor(maxMag) }}>
          <span aria-hidden>◎</span>
          {maxMag.toFixed(1)}
        </span>
      )}
    </>
  );
}

function WatchChip({ p }: { p: PropertyHazards }) {
  return (
    <div className="flex shrink-0 items-center gap-1.5 rounded border border-white/10 bg-white/5 px-2 py-1">
      <span aria-hidden className="text-[11px] leading-none">{p.group.icon}</span>
      <span className="whitespace-nowrap text-[10px] font-semibold text-white/85">
        {p.location.name}
      </span>
      <HazardBadges p={p} />
    </div>
  );
}

// Greedy left-to-right fill: how many chips fit per page at the given width.
function paginate(widths: number[], avail: number): number[] {
  const pages: number[] = [];
  let used = 0;
  let n = 0;
  for (const w of widths) {
    // Never leave a page empty — an oversized lone chip just clips.
    if (n > 0 && used + CHIP_GAP + w > avail) {
      pages.push(n);
      n = 0;
      used = 0;
    }
    used += n === 0 ? w : CHIP_GAP + w;
    n++;
  }
  if (n > 0) pages.push(n);
  return pages;
}

export function PinsWatchTicker() {
  const active = useScreensaverStore((s) => s.active);
  const mode = useScreensaverStore((s) => s.mode);
  const result = useProximityStore((s) => s.result);
  const scan = useProximityStore((s) => s.scan);

  const areaRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  // Chips per page, worst-first. Empty until the first measurement.
  const [counts, setCounts] = useState<number[]>([]);
  const [page, setPage] = useState(0);

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

  // Fit pass: an invisible copy of the full chip row provides widths, and the
  // visible page is derived from them — so re-paginating never disturbs the
  // measurement. Runs before paint; a ResizeObserver re-runs it when the strip
  // width or the chip content changes.
  useLayoutEffect(() => {
    if (!isPins) return;
    const row = measureRef.current;
    const area = areaRef.current;
    if (!row || !area) return;

    const measure = () => {
      const widths = Array.from(row.children).map((c) => (c as HTMLElement).offsetWidth);
      if (widths.length === 0) return;
      const full = area.clientWidth - PAD_X;
      let next = paginate(widths, full);
      // Multiple pages need the page counter's slice of the width too.
      if (next.length > 1) next = paginate(widths, full - INDICATOR_W);
      setCounts((prev) =>
        prev.length === next.length && prev.every((v, i) => v === next[i]) ? prev : next,
      );
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(area); // strip width: window resize
    ro.observe(row);  // chip content: new hazards, late font swap
    return () => ro.disconnect();
  }, [isPins, sig, result?.updated]);

  // Restart from the worst-first page whenever the affected set changes.
  useEffect(() => {
    setPage(0);
  }, [sig]);

  const pageCount = Math.max(1, counts.length);

  // Rotate pages on a fixed dwell when there's more than one.
  useEffect(() => {
    if (!isPins || pageCount <= 1) return;
    const id = setInterval(() => setPage((p) => p + 1), PAGE_MS);
    return () => clearInterval(id);
  }, [isPins, pageCount]);

  if (!isPins) return null;

  const pi = page % pageCount;
  let start = 0;
  for (let i = 0; i < pi; i++) start += counts[i] ?? 0;
  const pageChips = counts.length
    ? affected.slice(start, start + (counts[pi] ?? 0))
    : affected;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-10">
      <div className="flex min-h-[2.25rem] items-center border-t border-white/10 bg-ink-900/85 pb-safe backdrop-blur-sm">
        {/* Label — amber while anything is affected, green when all clear */}
        <div
          className={`flex shrink-0 items-center gap-1.5 self-stretch border-r border-white/10 px-3 text-[10px] font-bold uppercase tracking-widest ${
            affected.length > 0
              ? 'bg-accent-warn/10 text-accent-warn'
              : 'bg-accent-ok/10 text-accent-ok'
          }`}
        >
          <span
            className={`h-1.5 w-1.5 animate-pulse rounded-full ${
              affected.length > 0 ? 'bg-accent-warn' : 'bg-accent-ok'
            }`}
          />
          Property Watch
          {affected.length > 0 && <span className="tabular-nums">· {affected.length}</span>}
        </div>

        {/* Chip row */}
        <div ref={areaRef} className="relative min-w-0 flex-1 self-stretch overflow-hidden">
          {result === null ? (
            <div className="flex h-full items-center px-3 text-[10px] text-white/40">
              Scanning properties…
            </div>
          ) : affected.length === 0 ? (
            <div className="flex h-full items-center px-3 text-[10px] text-accent-ok">
              <span className="mr-1.5" aria-hidden>✓</span>
              All clear — {result.scannedCount} properties monitored
            </div>
          ) : (
            <>
              {/* Invisible measuring row — every chip, never paginated */}
              <div
                ref={measureRef}
                aria-hidden
                className="invisible absolute left-0 top-0 flex items-center gap-2"
              >
                {affected.map((p) => (
                  <WatchChip key={p.key} p={p} />
                ))}
              </div>
              <div key={pi} className="animate-watch-page flex h-full items-center gap-2 px-3">
                {pageChips.map((p) => (
                  <WatchChip key={p.key} p={p} />
                ))}
              </div>
            </>
          )}
        </div>

        {/* Page counter */}
        {pageCount > 1 && (
          <div className="shrink-0 px-2.5 text-[9px] font-semibold tabular-nums text-white/35">
            {pi + 1}/{pageCount}
          </div>
        )}
      </div>
    </div>
  );
}
