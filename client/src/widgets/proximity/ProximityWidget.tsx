import { useEffect } from 'react';
import { useCesiumViewer } from '../../cesium/CesiumContext';
import { flyToLonLat } from '../../cesium/flyTo';
import { MILES_TO_M } from '../../lib/geo';
import { startVisiblePolling } from '../../lib/poll';
import { usePanelStore } from '../../panels/panelStore';
import { downFeedNames, type PropertyHazards } from './proximityScan';
import { useProximityStore } from './proximityStore';
import { LightningTicker } from './LightningTicker';
import { HazardRows } from './HazardRows';
import { timeAgo } from './format';

const RADII = [25, 50, 100] as const;
const REFRESH_MS = 5 * 60_000;

export function ProximityWidget() {
  const viewer = useCesiumViewer();
  const radiusMi = useProximityStore((s) => s.radiusMi);
  const setRadius = useProximityStore((s) => s.setRadius);
  const result = useProximityStore((s) => s.result);
  const loading = useProximityStore((s) => s.loading);
  const scan = useProximityStore((s) => s.scan);
  const openPanel = usePanelStore((s) => s.open);

  useEffect(() => {
    const stop = startVisiblePolling(() => void scan(), REFRESH_MS);
    return () => stop();
  }, [scan]);

  const affected = result?.properties ?? [];
  const downFeeds = downFeedNames(result);
  const allDown = downFeeds.length === 3;

  const focus = (p: PropertyHazards) => {
    if (!viewer) return;
    // Frame the property plus a margin of its surrounding hazard radius.
    const height = Math.max(220_000, radiusMi * MILES_TO_M * 2.2);
    flyToLonLat(viewer, p.location.lon, p.location.lat, height);
  };

  const popOut = (p: PropertyHazards) => {
    openPanel({
      id: `property-${p.key}`,
      kind: 'property-watch',
      title: p.location.name,
      subtitle: p.group.name,
      payload: {
        key: p.key,
        groupName: p.group.name,
        groupIcon: p.group.icon,
        name: p.location.name,
        lat: p.location.lat,
        lon: p.location.lon,
      },
    });
  };

  return (
    <div className="flex flex-col gap-3">
      {/* Status line */}
      <div className="flex items-center justify-between text-[11px]">
        {loading && !result ? (
          <span className="text-white/40">Scanning…</span>
        ) : allDown ? (
          <span className="text-accent-danger">Hazard feeds unreachable</span>
        ) : (
          <span className="flex items-center gap-1.5 text-accent-ok">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent-ok" />
            FIRMS + NWS + USGS · live
          </span>
        )}
        <button
          onClick={() => scan(true)}
          className="flex items-center gap-1 text-white/30 transition hover:text-white/60"
          title="Refresh now"
        >
          {result && <span>Updated {timeAgo(result.updated)}</span>}
          <span aria-hidden>↻</span>
        </button>
      </div>

      {/* Radius selector */}
      <div>
        <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-white/30">
          Search radius
        </div>
        <div className="flex gap-1.5">
          {RADII.map((r) => (
            <button
              key={r}
              onClick={() => setRadius(r)}
              className={`flex-1 rounded-md border px-2 py-1 text-[11px] font-semibold transition ${
                radiusMi === r
                  ? 'border-accent/50 bg-accent/15 text-accent'
                  : 'border-white/10 bg-white/5 text-white/40 hover:bg-white/10'
              }`}
            >
              {r} mi
            </button>
          ))}
        </div>
      </div>

      {/* Live global lightning activity */}
      <LightningTicker />

      {/* Summary banner — suppressed when every feed is down: an empty result
          from three failed fetches is blindness, not an all-clear. */}
      {result && !allDown && (
        <div
          className={`rounded-lg border px-3 py-2.5 text-[12px] ${
            affected.length === 0
              ? 'border-accent-ok/30 bg-accent-ok/10 text-accent-ok'
              : 'border-accent-warn/30 bg-accent-warn/10 text-accent-warn'
          }`}
        >
          {affected.length === 0 ? (
            <span className="flex items-center gap-2">
              <span aria-hidden>✓</span>
              All clear — {result.scannedCount} properties monitored
            </span>
          ) : (
            <span className="flex items-center gap-2">
              <span aria-hidden>⚠</span>
              <span>
                <strong className="font-bold">{affected.length}</strong> of {result.scannedCount}{' '}
                properties with active hazards
              </span>
            </span>
          )}
        </div>
      )}

      {/* Partial-failure note */}
      {result && !allDown && downFeeds.length > 0 && (
        <div className="text-[10px] text-white/30">
          {downFeeds.join(' + ')} feed{downFeeds.length > 1 ? 's' : ''} unavailable — partial
          results.
        </div>
      )}

      {/* Affected properties */}
      <div className="space-y-1.5 pr-1">
        {affected.map((p) => (
          <div
            key={p.key}
            className="group relative rounded-lg border border-white/5 bg-white/5 transition hover:border-white/15 hover:bg-white/10"
          >
            <button onClick={() => focus(p)} className="block w-full px-3 py-2.5 pr-9 text-left">
              {/* Property header */}
              <div className="flex items-center gap-2">
                <span aria-hidden className="text-[14px]">
                  {p.group.icon}
                </span>
                <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-white/85 group-hover:text-white">
                  {p.location.name}
                </span>
                <span className="shrink-0 text-[10px] text-white/30">{p.group.name}</span>
              </div>

              <HazardRows hazards={p} radiusMi={radiusMi} />
            </button>

            {/* Pop out into its own dockable window */}
            <button
              onClick={() => popOut(p)}
              title="Pop out to window"
              aria-label="Pop out to window"
              className="absolute right-1.5 top-1.5 rounded p-1 text-white/30 transition hover:bg-white/10 hover:text-white/70"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
                <path
                  d="M14 4h6m0 0v6m0-6L10 14M18 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </div>
        ))}

        {result && affected.length === 0 && !loading && !allDown && (
          <div className="py-6 text-center text-[12px] text-white/30">
            No fires or weather alerts near any property.
          </div>
        )}
      </div>

      {/* Footnote */}
      <p className="border-t border-white/8 pt-2 text-[10px] leading-snug text-white/25">
        Cross-references your {result?.scannedCount ?? ''} properties against NASA FIRMS active-fire
        detections (past 24 h), live NWS alerts, and USGS earthquakes (M2.5+, past 7 days). Click a
        property to fly there, or pop it out into its own window.
      </p>
    </div>
  );
}
