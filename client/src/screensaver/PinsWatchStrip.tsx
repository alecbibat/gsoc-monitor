import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useScreensaverStore } from './screensaverStore';
import { useProximityStore } from '../widgets/proximity/proximityStore';
import type { PropertyHazards } from '../widgets/proximity/proximityScan';
import { quakeColor } from '../widgets/proximity/format';

// Property Watch strip pinned to the top edge during the pins screensaver.
// One chip per affected property — icon, name, and compact hazard badges,
// worst-first. When the chips overflow the width they scroll as a seamless
// marquee (the same pattern as the bottom news ticker, which keeps running in
// its own slot); when they fit, the row just sits still. All-clear and
// scanning states collapse to a single line.

const MARQUEE_PX_PER_S = 40; // scroll speed when the chips overflow

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

// Leading margin (not parent gap) spaces the chips so a duplicated marquee
// copy loops seamlessly at the -50% translate point.
function WatchChip({ p }: { p: PropertyHazards }) {
  return (
    <div className="ml-2 flex shrink-0 items-center gap-1.5 rounded border border-white/10 bg-white/5 px-2 py-1">
      <span aria-hidden className="text-[11px] leading-none">{p.group.icon}</span>
      <span className="whitespace-nowrap text-[10px] font-semibold text-white/85">
        {p.location.name}
      </span>
      <HazardBadges p={p} />
    </div>
  );
}

export function PinsWatchStrip() {
  const active = useScreensaverStore((s) => s.active);
  const mode = useScreensaverStore((s) => s.mode);
  const result = useProximityStore((s) => s.result);
  const scan = useProximityStore((s) => s.scan);

  const areaRef = useRef<HTMLDivElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const [rowW, setRowW] = useState(0);
  const [marquee, setMarquee] = useState(false);

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

  // Overflow check: an invisible copy of the chip row provides its natural
  // width. Only an overflowing row animates — a fitting row stays static.
  useLayoutEffect(() => {
    if (!isPins) return;
    const row = rowRef.current;
    const area = areaRef.current;
    if (!row || !area) return;

    const measure = () => {
      const w = row.offsetWidth;
      setRowW(w);
      setMarquee(w > area.clientWidth);
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(area); // strip width: window resize
    ro.observe(row);  // chip content: new hazards, late font swap
    return () => ro.disconnect();
  }, [isPins, sig, result?.updated]);

  if (!isPins) return null;

  const durationS = Math.max(20, rowW / MARQUEE_PX_PER_S);
  const chips = affected.map((p) => <WatchChip key={p.key} p={p} />);

  return (
    <div className="fixed left-0 right-0 top-0 z-10">
      <div className="flex min-h-[2.25rem] items-center border-b border-white/10 bg-ink-900/85 pt-safe backdrop-blur-sm">
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

        {/* Chip row — marquee only when it overflows */}
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
              {/* Invisible measuring row — one copy at natural width */}
              <div
                ref={rowRef}
                aria-hidden
                className="invisible absolute left-0 top-0 flex w-max items-center"
              >
                {affected.map((p) => (
                  <WatchChip key={p.key} p={p} />
                ))}
              </div>
              {marquee ? (
                <div
                  className="animate-marquee flex h-full w-max items-center"
                  style={{ animationDuration: `${durationS}s` }}
                >
                  {chips}
                  <div aria-hidden className="contents">
                    {affected.map((p) => (
                      <WatchChip key={`dup-${p.key}`} p={p} />
                    ))}
                  </div>
                </div>
              ) : (
                <div className="flex h-full items-center pr-3">{chips}</div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
