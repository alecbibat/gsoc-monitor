import { useEffect } from 'react';
import { startVisiblePolling } from '../lib/poll';
import type { LocationGroup } from '../layers/locations/locations';
import { useProximityStore } from '../widgets/proximity/proximityStore';
import { HazardRows } from '../widgets/proximity/HazardRows';
import { timeAgo } from '../widgets/proximity/format';

// Read-only Property Watch card for the share page: the same live hazard scan
// the operator's Watch tab runs (NASA FIRMS fires, NWS alerts, USGS quakes),
// scoped to the property groups the incident team prescribed — nothing outside
// those groups is exposed to share viewers. Auto-refreshes on the widget's
// cadence.
const REFRESH_MS = 5 * 60_000;

export function ShareWatchCard({ groups }: { groups: LocationGroup[] }) {
  const result = useProximityStore((s) => s.result);
  const loading = useProximityStore((s) => s.loading);
  const radiusMi = useProximityStore((s) => s.radiusMi);
  const scan = useProximityStore((s) => s.scan);

  useEffect(() => {
    const stop = startVisiblePolling(() => void scan(), REFRESH_MS);
    return () => stop();
  }, [scan]);

  const groupIds = new Set(groups.map((g) => g.id));
  const monitoredCount = groups.reduce((n, g) => n + g.locations.length, 0);
  const affected = (result?.properties ?? []).filter((p) => groupIds.has(p.group.id));
  const downFeeds = result
    ? ([
        result.fireError ? 'fires' : null,
        result.alertError ? 'alerts' : null,
        result.quakeError ? 'earthquakes' : null,
      ].filter(Boolean) as string[])
    : [];
  const allDown = downFeeds.length === 3;

  return (
    <div className="space-y-3 rounded-lg border border-white/10 bg-ink-950/60 px-4 py-3.5">
      {/* Status line */}
      <div className="flex items-center justify-between text-[12px]">
        {loading && !result ? (
          <span className="text-white/45">Scanning properties…</span>
        ) : allDown ? (
          <span className="text-accent-danger">Hazard feeds unreachable</span>
        ) : (
          <span className="flex items-center gap-1.5 text-accent-ok">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent-ok" />
            FIRMS + NWS + USGS · live
          </span>
        )}
        {result && <span className="text-[11px] text-white/40">Updated {timeAgo(result.updated)}</span>}
      </div>

      {/* Summary banner */}
      {result && (
        <div
          className={`rounded-lg border px-3 py-2.5 text-[13px] ${
            affected.length === 0
              ? 'border-accent-ok/30 bg-accent-ok/10 text-accent-ok'
              : 'border-accent-warn/30 bg-accent-warn/10 text-accent-warn'
          }`}
        >
          {affected.length === 0 ? (
            <span className="flex items-center gap-2">
              <span aria-hidden>✓</span>
              All clear — {monitoredCount} propert{monitoredCount === 1 ? 'y' : 'ies'} monitored
              ({groups.map((g) => g.name).join(' · ')})
            </span>
          ) : (
            <span className="flex items-center gap-2">
              <span aria-hidden>⚠</span>
              <span>
                <strong className="font-bold">{affected.length}</strong> of {monitoredCount}{' '}
                monitored properties with active hazards
              </span>
            </span>
          )}
        </div>
      )}

      {/* Partial-failure note */}
      {result && !allDown && downFeeds.length > 0 && (
        <div className="text-[11px] text-white/40">
          {downFeeds.join(' + ')} feed{downFeeds.length > 1 ? 's' : ''} unavailable — partial
          results.
        </div>
      )}

      {/* Affected properties */}
      {affected.length > 0 && (
        <div className="space-y-1.5">
          {affected.map((p) => (
            <div key={p.key} className="rounded-lg border border-white/10 bg-white/5 px-3 py-2.5">
              <div className="flex items-center gap-2">
                <span aria-hidden className="text-[14px]">{p.group.icon}</span>
                <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-white/90">
                  {p.location.name}
                </span>
                <span className="shrink-0 text-[11px] text-white/40">{p.group.name}</span>
              </div>
              <HazardRows hazards={p} radiusMi={radiusMi} />
            </div>
          ))}
        </div>
      )}

      {/* Footnote */}
      <p className="border-t border-white/10 pt-2 text-[11px] leading-snug text-white/35">
        Cross-references the incident team&rsquo;s {monitoredCount} selected propert{monitoredCount === 1 ? 'y' : 'ies'}{' '}
        against NASA FIRMS active-fire detections (past 24 h), live NWS alerts, and USGS
        earthquakes (M2.5+, past 7 days) within {radiusMi} miles. Refreshes automatically.
      </p>
    </div>
  );
}
