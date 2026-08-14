import { useEffect, useRef, useState } from 'react';
import { useProximityStore } from '../widgets/proximity/proximityStore';
import { downFeedNames } from '../widgets/proximity/proximityScan';
import { quakeColor } from '../widgets/proximity/format';
import {
  summarize,
  groupHazardColor,
  isExtreme,
  WATCH_GROUP_ORDER,
  type GroupSummary,
} from './watchSummary';

const LEDGER_ROTATE_MS = 6_000;
const INTERRUPT_DEBOUNCE_MS = 10_000;

// Property Watch instrument cluster inside the pins screensaver's clock card:
// a fixed 13-segment severity meter (one segment per group, west→east, lit in
// the group's worst-hazard color) plus one ledger line that names a group at a
// time, rotating worst-first. The footprint is constant no matter how many
// groups are affected — busy days grow into color and rotation, never pixels.
// The zoomed-out counterpart (PinsOverviewSitrep) draws the same summaries on
// the globe between pin visits.
export function PinsWatchCluster() {
  const result = useProximityStore((s) => s.result);
  const scan = useProximityStore((s) => s.scan);

  // Keep the scan fresh while the pins tour runs (this component only mounts
  // during it). The store throttles repeat calls, so kicking one on entry
  // never double-fetches — it only refreshes a stale result.
  useEffect(() => {
    void scan();
    const id = setInterval(() => scan(), 5 * 60_000);
    return () => clearInterval(id);
  }, [scan]);

  const groups = summarize(result?.properties ?? []);

  const [idx, setIdx] = useState(0);
  useEffect(() => {
    if (groups.length < 2) return;
    const id = setInterval(() => setIdx((i) => i + 1), LEDGER_ROTATE_MS);
    return () => clearInterval(id);
  }, [groups.length]);

  // A brand-new alert (or one on a newly affected group) jumps the ledger to
  // that group so it's named immediately instead of waiting out the rotation.
  // Debounced so stormy NWS refresh cycles don't make the line thrash.
  const seenRef = useRef<Set<string> | null>(null);
  const lastJumpRef = useRef(0);
  useEffect(() => {
    if (!result) return;
    const summaries = summarize(result.properties);
    const keys = new Set<string>();
    for (const g of summaries)
      for (const a of g.alerts) keys.add(`${g.group.id}|${a.event}`);
    const prev = seenRef.current;
    seenRef.current = keys;
    if (!prev) return; // first population — nothing is "new" yet
    if (Date.now() - lastJumpRef.current < INTERRUPT_DEBOUNCE_MS) return;
    const gi = summaries.findIndex((g) =>
      g.alerts.some((a) => !prev.has(`${g.group.id}|${a.event}`))
    );
    if (gi >= 0) {
      lastJumpRef.current = Date.now();
      setIdx(gi);
    }
  }, [result]);

  const shown: GroupSummary | null =
    groups.length > 0 ? groups[((idx % groups.length) + groups.length) % groups.length] : null;
  const byId = new Map(groups.map((g) => [g.group.id, g]));

  // A downed feed must never read as "All clear" — an empty result while blind
  // is unknown status, not safety. (All three feeds down with hazards shown
  // can't happen: hazards only come from feed data.)
  const down = downFeedNames(result);
  const allDown = down.length === 3;

  return (
    <div className="mt-1.5 w-[248px]">
      <div className="text-left font-mono text-[8px] font-semibold uppercase tracking-[0.22em] text-white/30">
        Property Watch
      </div>

      {/* Severity meter — 13 fixed segments, west→east. Unlit = clear. */}
      <div className="mt-1 flex w-full gap-[2px]">
        {WATCH_GROUP_ORDER.map((g) => {
          const s = byId.get(g.id);
          const activeSeg = s !== undefined && shown !== null && g.id === shown.group.id;
          return (
            <span
              key={g.id}
              title={g.name}
              className={`h-[7px] flex-1 rounded-[1px] ${s && isExtreme(s) ? 'watch-pulse' : ''} ${
                activeSeg ? 'outline outline-1 outline-offset-1 outline-white/70' : ''
              }`}
              style={{ background: s ? groupHazardColor(s) : 'rgba(255,255,255,0.08)' }}
            />
          );
        })}
      </div>

      {/* Ledger — one group at a time, worst-first. Every distinct NWS alert
          gets its own chip; the clock tile grows rather than truncating to a
          "+N", so the full picture for the named group is always readable. */}
      <div className="mt-1.5 flex min-h-[22px] flex-col items-end justify-center">
        {shown ? (
          <div key={`${shown.group.id}-${idx}`} className="watch-ledger-in">
            <div className="flex items-center justify-end gap-1.5 whitespace-nowrap">
              <span aria-hidden className="text-[12px] leading-none">{shown.group.icon}</span>
              <span className="text-[11px] font-semibold text-white/85">{shown.group.name}</span>
              <span className="text-[9px] tabular-nums text-white/35">
                {shown.affectedCount}/{shown.group.locations.length}
              </span>
              {shown.fireCount > 0 && (
                <span className="text-[10px] font-bold text-accent-warn">
                  <span aria-hidden>🔥</span>
                  {shown.fireCount}
                </span>
              )}
              {shown.quakeCount > 0 && (
                <span
                  className="text-[10px] font-bold"
                  style={{ color: quakeColor(shown.maxQuakeMag) }}
                >
                  <span aria-hidden>◎</span>M{shown.maxQuakeMag.toFixed(1)}
                </span>
              )}
            </div>
            {shown.alerts.length > 0 && (
              <div className="mt-1 flex flex-wrap justify-end gap-1">
                {shown.alerts.map((a) => (
                  <span
                    key={a.event}
                    className="flex items-center gap-1 rounded border px-1.5 py-0.5 text-[9px] font-medium"
                    style={{
                      color: a.colorHex,
                      borderColor: `${a.colorHex}55`,
                      background: `${a.colorHex}14`,
                    }}
                  >
                    <span
                      className="h-1.5 w-1.5 shrink-0 rounded-full"
                      style={{ background: a.colorHex }}
                    />
                    {a.event}
                    {a.count > 1 && <span className="text-white/40">×{a.count}</span>}
                  </span>
                ))}
              </div>
            )}
          </div>
        ) : result === null ? (
          <span className="text-[10px] text-white/40">Scanning properties…</span>
        ) : allDown ? (
          <span className="text-[10px] text-accent-danger/80">Hazard feeds unreachable</span>
        ) : down.length > 0 ? (
          <span className="text-[10px] text-accent-warn/80">
            <span aria-hidden className="mr-1">⚠</span>
            {down.join(' + ')} feed{down.length > 1 ? 's' : ''} down — partial coverage
          </span>
        ) : (
          <span className="text-[10px] text-accent-ok/80">
            <span aria-hidden className="mr-1">✓</span>
            All clear — {result.scannedCount} properties monitored
          </span>
        )}
      </div>

      {/* Feed trouble while hazards are showing — flag the gap under the ledger
          so the visible hazards aren't mistaken for the whole picture. */}
      {shown !== null && down.length > 0 && (
        <div className="mt-1 text-right text-[9px] text-accent-warn/70">
          <span aria-hidden>⚠</span> {down.join(' + ')} feed{down.length > 1 ? 's' : ''} down —
          partial
        </div>
      )}
    </div>
  );
}
