import { useEffect, useRef, useState } from 'react';
import { useCesiumViewer } from '../../cesium/CesiumContext';
import { flyToLonLat } from '../../cesium/flyTo';
import { MILES_TO_M } from '../../lib/geo';
import { scanProximity, type PropertyHazards, type ScanResult } from './proximityScan';
import { LightningTicker } from './LightningTicker';

const RADII = [50, 100, 200] as const;
const REFRESH_MS = 5 * 60_000;

function timeAgo(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function expiresText(iso: string): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const diff = t - Date.now();
  if (diff <= 0) return 'expiring';
  if (diff < 3_600_000) return `${Math.max(1, Math.round(diff / 60_000))}m left`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h left`;
  return `${Math.round(diff / 86_400_000)}d left`;
}

function fmtMiles(mi: number): string {
  return mi < 10 ? mi.toFixed(1) : Math.round(mi).toString();
}

// Matches the earthquake layer's magnitude-tier palette.
function quakeColor(mag: number): string {
  if (mag >= 6) return '#ff5d5d';
  if (mag >= 4.5) return '#ffb84d';
  if (mag >= 2.5) return '#ffe14d';
  return '#52e3a4';
}

export function ProximityWidget() {
  const viewer = useCesiumViewer();
  const [radiusMi, setRadiusMi] = useState<number>(100);
  const [refreshKey, setRefreshKey] = useState(0);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [loading, setLoading] = useState(true);
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;
    setLoading(true);
    const run = async () => {
      try {
        const r = await scanProximity(radiusMi);
        if (cancelledRef.current) return;
        setResult(r);
      } finally {
        if (!cancelledRef.current) setLoading(false);
      }
    };
    run();
    const id = setInterval(run, REFRESH_MS);
    return () => {
      cancelledRef.current = true;
      clearInterval(id);
    };
  }, [radiusMi, refreshKey]);

  const affected = result?.properties ?? [];
  const downFeeds = result
    ? ([
        result.fireError ? 'fires' : null,
        result.alertError ? 'alerts' : null,
        result.quakeError ? 'earthquakes' : null,
      ].filter(Boolean) as string[])
    : [];
  const allDown = downFeeds.length === 3;

  const focus = (p: PropertyHazards) => {
    if (!viewer) return;
    // Frame the property plus a margin of its surrounding hazard radius.
    const height = Math.max(220_000, radiusMi * MILES_TO_M * 2.2);
    flyToLonLat(viewer, p.location.lon, p.location.lat, height);
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
          onClick={() => setRefreshKey((k) => k + 1)}
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
              onClick={() => setRadiusMi(r)}
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

      {/* Summary banner */}
      {result && (
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
      <div className="hud-scroll max-h-[440px] space-y-1.5 overflow-y-auto pr-1">
        {affected.map((p) => (
          <button
            key={p.key}
            onClick={() => focus(p)}
            className="group block w-full rounded-lg border border-white/5 bg-white/5 px-3 py-2.5 text-left transition hover:border-white/15 hover:bg-white/10"
          >
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

            {/* Alert chips */}
            {p.alerts.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {p.alerts.map((a) => {
                  const left = expiresText(a.expires);
                  return (
                    <span
                      key={a.id}
                      className="flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium"
                      style={{
                        color: a.colorHex,
                        borderColor: `${a.colorHex}55`,
                        background: `${a.colorHex}14`,
                      }}
                      title={a.headline ?? a.areaDesc}
                    >
                      <span
                        className="h-1.5 w-1.5 shrink-0 rounded-full"
                        style={{ background: a.colorHex }}
                      />
                      {a.event}
                      {left && <span className="text-white/35">· {left}</span>}
                    </span>
                  );
                })}
              </div>
            )}

            {/* Fire summary */}
            {p.fires.length > 0 && (
              <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-accent-warn/90">
                <span aria-hidden>🔥</span>
                <span>
                  {p.fires.length} hotspot{p.fires.length > 1 ? 's' : ''} within {radiusMi} mi
                  {p.nearestFireMi != null && (
                    <span className="text-white/40"> · nearest {fmtMiles(p.nearestFireMi)} mi</span>
                  )}
                </span>
              </div>
            )}

            {/* Earthquake summary */}
            {p.quakes.length > 0 && (
              <div
                className="mt-1.5 flex items-center gap-1.5 text-[11px]"
                style={{ color: quakeColor(p.maxQuakeMag ?? 0) }}
                title={p.quakes
                  .slice(0, 5)
                  .map((q) => `M${q.mag.toFixed(1)} · ${q.place || 'unknown'} · ${timeAgo(q.time)}`)
                  .join('\n')}
              >
                <span aria-hidden>◎</span>
                <span>
                  {p.quakes.length === 1
                    ? `M${p.quakes[0].mag.toFixed(1)} earthquake`
                    : `${p.quakes.length} earthquakes · max M${(p.maxQuakeMag ?? 0).toFixed(1)}`}
                  {p.nearestQuakeMi != null && (
                    <span className="text-white/40"> · nearest {fmtMiles(p.nearestQuakeMi)} mi</span>
                  )}
                </span>
              </div>
            )}
          </button>
        ))}

        {result && affected.length === 0 && !loading && (
          <div className="py-6 text-center text-[12px] text-white/30">
            No fires or weather alerts near any property.
          </div>
        )}
      </div>

      {/* Footnote */}
      <p className="border-t border-white/8 pt-2 text-[10px] leading-snug text-white/25">
        Cross-references your {result?.scannedCount ?? ''} properties against NASA FIRMS active-fire
        detections (past 24 h), live NWS alerts, and USGS earthquakes (M2.5+, past 7 days). Click a
        property to fly there.
      </p>
    </div>
  );
}
