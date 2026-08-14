import { useEffect, useCallback, type ReactNode } from 'react';
import { useCesiumViewer } from '../../cesium/CesiumContext';
import { flyToLonLat } from '../../cesium/flyTo';
import { MILES_TO_M } from '../../lib/geo';
import { startVisiblePolling } from '../../lib/poll';
import { useProximityStore } from './proximityStore';
import { downFeedNames } from './proximityScan';
import { HazardRows } from './HazardRows';
import { expiresText, fmtMiles, quakeColor, timeAgo } from './format';
import { downloadPropertyReport } from './reportCanvas';

const REFRESH_MS = 5 * 60_000;

export interface PropertyDetailPayload {
  key: string;
  groupName: string;
  groupIcon: string;
  name: string;
  lat: number;
  lon: number;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-white/30">
        {title}
      </div>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

export function PropertyDetail({ payload }: { payload: PropertyDetailPayload }) {
  const viewer = useCesiumViewer();
  const radiusMi = useProximityStore((s) => s.radiusMi);
  const result = useProximityStore((s) => s.result);
  const loading = useProximityStore((s) => s.loading);
  const scan = useProximityStore((s) => s.scan);

  // Keep this pop-out live on its own interval — the shared store's throttle
  // dedupes against the main widget, so this is cheap even with both open.
  useEffect(() => {
    const stop = startVisiblePolling(() => void scan(), REFRESH_MS);
    return () => stop();
  }, [scan]);

  const hazards = result?.properties.find((p) => p.key === payload.key) ?? null;
  // A downed feed must never read as "no active hazards" — an absent entry
  // while blind is unknown status, not safety.
  const down = downFeedNames(result);
  const allDown = down.length === 3;

  const fly = () => {
    if (!viewer) return;
    flyToLonLat(viewer, payload.lon, payload.lat, Math.max(220_000, radiusMi * MILES_TO_M * 2.2));
  };

  const handleDownload = useCallback(() => {
    downloadPropertyReport(payload, hazards, radiusMi, result?.updated ?? null);
  }, [payload, hazards, radiusMi, result?.updated]);

  const lat =
    payload.lat >= 0 ? `${payload.lat.toFixed(3)}°N` : `${Math.abs(payload.lat).toFixed(3)}°S`;
  const lon =
    payload.lon >= 0 ? `${payload.lon.toFixed(3)}°E` : `${Math.abs(payload.lon).toFixed(3)}°W`;

  return (
    <div className="flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-start gap-2">
        <span aria-hidden className="text-[20px] leading-none">
          {payload.groupIcon}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-semibold text-white/90">{payload.name}</div>
          <div className="text-[11px] text-white/40">{payload.groupName}</div>
          <div className="mt-0.5 font-mono text-[10px] text-white/30">
            {lat} {lon}
          </div>
        </div>
        <div className="flex shrink-0 gap-1.5">
          <button
            onClick={fly}
            className="rounded-md border border-accent/40 bg-accent/10 px-2 py-1 text-[11px] font-semibold text-accent transition hover:bg-accent/20"
            title="Fly to property"
          >
            Fly to
          </button>
          <button
            onClick={handleDownload}
            className="rounded-md border border-white/15 bg-white/5 px-2 py-1 text-[11px] text-white/50 transition hover:border-white/25 hover:bg-white/10 hover:text-white/80"
            title="Download report as image"
          >
            ↓ Export
          </button>
        </div>
      </div>

      {/* Status */}
      <div className="flex items-center gap-1.5 text-[11px]">
        {loading && !result ? (
          <span className="text-white/40">Scanning…</span>
        ) : allDown ? (
          <span className="text-accent-danger">Hazard feeds unreachable</span>
        ) : (
          <span className="flex items-center gap-1.5 text-accent-ok">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent-ok" />
            Live · {radiusMi} mi watch
          </span>
        )}
        {result && <span className="text-white/25">· updated {timeAgo(result.updated)}</span>}
      </div>

      {/* Partial-failure note */}
      {result && !allDown && down.length > 0 && (
        <div className="text-[10px] text-white/30">
          {down.join(' + ')} feed{down.length > 1 ? 's' : ''} unavailable — partial results.
        </div>
      )}

      {!hazards ? (
        allDown ? (
          <div className="rounded-lg border border-accent-danger/30 bg-accent-danger/10 px-3 py-3 text-[12px] text-accent-danger">
            Hazard status unknown — live feeds unreachable.
          </div>
        ) : (
          <div className="rounded-lg border border-accent-ok/30 bg-accent-ok/10 px-3 py-3 text-[12px] text-accent-ok">
            <span aria-hidden>✓</span> No active hazards within {radiusMi} mi.
          </div>
        )
      ) : (
        <>
          {/* Compact summary */}
          <div className="rounded-lg border border-white/8 bg-white/5 px-3 py-2.5">
            <HazardRows hazards={hazards} radiusMi={radiusMi} />
          </div>

          {/* Alerts */}
          {hazards.alerts.length > 0 && (
            <Section title={`Active alerts (${hazards.alerts.length})`}>
              {hazards.alerts.map((a) => {
                const left = expiresText(a.expires);
                return (
                  <div
                    key={a.id}
                    className="rounded-md border-l-2 bg-white/5 px-2.5 py-1.5"
                    style={{ borderColor: a.colorHex }}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[12px] font-medium" style={{ color: a.colorHex }}>
                        {a.event}
                      </span>
                      {left && <span className="shrink-0 text-[10px] text-white/40">{left}</span>}
                    </div>
                    {a.headline && (
                      <div className="mt-0.5 text-[11px] leading-snug text-white/55">{a.headline}</div>
                    )}
                  </div>
                );
              })}
            </Section>
          )}

          {/* Fires */}
          {hazards.fires.length > 0 && (
            <Section title={`Nearby fires (${hazards.fires.length})`}>
              {hazards.fires.slice(0, 8).map((f, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between gap-2 px-0.5 text-[11px]"
                >
                  <span className="flex items-center gap-1.5">
                    <span aria-hidden>🔥</span>
                    <span className="text-white/55">{fmtMiles(f.distanceMi)} mi away</span>
                  </span>
                  <span className="text-white/35">
                    {f.frp != null ? `${f.frp.toFixed(0)} MW` : '—'}
                  </span>
                </div>
              ))}
              {hazards.fires.length > 8 && (
                <div className="text-[10px] text-white/25">+{hazards.fires.length - 8} more</div>
              )}
            </Section>
          )}

          {/* Earthquakes */}
          {hazards.quakes.length > 0 && (
            <Section title={`Recent earthquakes (${hazards.quakes.length})`}>
              {hazards.quakes.slice(0, 8).map((q) => (
                <div
                  key={q.id}
                  className="flex items-center justify-between gap-2 px-0.5 text-[11px]"
                >
                  <span className="font-semibold tabular-nums" style={{ color: quakeColor(q.mag) }}>
                    M{q.mag.toFixed(1)}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-white/55">
                    {q.place || 'unknown'}
                  </span>
                  <span className="shrink-0 text-white/35">
                    {fmtMiles(q.distanceMi)} mi · {timeAgo(q.time)}
                  </span>
                </div>
              ))}
              {hazards.quakes.length > 8 && (
                <div className="text-[10px] text-white/25">+{hazards.quakes.length - 8} more</div>
              )}
            </Section>
          )}
        </>
      )}
    </div>
  );
}
