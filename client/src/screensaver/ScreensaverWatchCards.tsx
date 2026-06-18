import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useScreensaverStore } from './screensaverStore';
import { useUiStore } from '../ui/uiStore';
import { useProximityStore } from '../widgets/proximity/proximityStore';
import { useLightningStatus } from '../layers/lightning/lightningStore';
import { LightningTicker } from '../widgets/proximity/LightningTicker';
import { expiresText, fmtMiles, quakeColor, timeAgo } from '../widgets/proximity/format';
import { haversineMeters, metersToMiles } from '../lib/geo';

// Credits-roll column shown in the right rail during the pins screensaver.
// Shows aggregated regional hazards (NWS alerts, fire hotspots, earthquakes,
// nearest lightning strike) for the area being toured — no per-property labels.

const COL_W = 240;    // matches the context minimap width
const EDGE = 24;      // right-6 / bottom-6
const CTX_H = 130;    // PinsContextBox MAP_H
const CTX_GAP = 12;
const TOPBAR_H = 88;  // fallback floor before the right cluster is measured
const TOP_GAP = 12;   // breathing room below the search bar / info button

export function ScreensaverWatchCards() {
  const active = useScreensaverStore((s) => s.active);
  const mode   = useScreensaverStore((s) => s.mode);
  const poi    = useScreensaverStore((s) => s.currentPoi);
  const result = useProximityStore((s) => s.result);
  const scan   = useProximityStore((s) => s.scan);
  const topRightBottom = useUiStore((s) => s.topRightBottom);

  const viewportRef = useRef<HTMLDivElement>(null);
  const [scroll, setScroll] = useState(false);

  const isPins = active && mode === 'pins';
  const affected = result?.properties ?? [];

  // Keep scan fresh while we're the active consumer.
  useEffect(() => {
    if (!isPins) return;
    if (!result) void scan();
    const id = setInterval(() => scan(), 5 * 60_000);
    return () => clearInterval(id);
  }, [isPins, result, scan]);

  // ── Aggregate hazards across all scanned properties into one regional view ──
  // Dedupe alerts by id, pick the nearest fire + worst quake from any property.
  const allAlerts = Array.from(
    new Map(affected.flatMap((p) => p.alerts).map((a) => [a.id, a])).values()
  ).sort((a, b) => {
    const rank = (s: string) =>
      s === 'Extreme' ? 4 : s === 'Severe' ? 3 : s === 'Moderate' ? 2 : s === 'Minor' ? 1 : 0;
    return rank(b.severity) - rank(a.severity);
  });

  const nearestFire = affected.reduce(
    (best, p) => {
      const f = p.fires[0];
      return f && (!best || f.distanceMi < best.distanceMi) ? f : best;
    },
    null as (typeof affected[0]['fires'][0]) | null
  );

  const worstQuake = affected.reduce(
    (best, p) => {
      const q = p.quakes[0];
      return q && (!best || q.mag > best.mag) ? q : best;
    },
    null as (typeof affected[0]['quakes'][0]) | null
  );

  // ── Nearest lightning strike to the current POI ───────────────────────────
  const strikesRef = useRef(useLightningStatus.getState().strikes);
  useEffect(() => useLightningStatus.subscribe((s) => { strikesRef.current = s.strikes; }), []);

  const [nearestStrike, setNearestStrike] = useState<{ distMi: number; t: number } | null>(null);
  useEffect(() => {
    const compute = () => {
      const strikes = strikesRef.current;
      if (!poi || strikes.length === 0) { setNearestStrike(null); return; }
      let bestDist = Infinity, bestT = 0;
      for (const s of strikes) {
        const d = metersToMiles(haversineMeters(poi.lat, poi.lon, s.lat, s.lon));
        if (d < bestDist) { bestDist = d; bestT = s.t; }
      }
      setNearestStrike({ distMi: bestDist, t: bestT });
    };
    compute();
    const id = setInterval(compute, 15_000);
    return () => clearInterval(id);
  }, [poi?.lat, poi?.lon]);

  // Enable auto-scroll only when content overflows the viewport.
  useLayoutEffect(() => {
    if (!isPins) return;
    const vp = viewportRef.current;
    if (!vp) return;
    setScroll(vp.scrollHeight > vp.clientHeight + 2);
  }, [isPins, affected.length, allAlerts.length]);

  if (!isPins) return null;

  const ctxVisible = poi !== null;
  const bottom = ctxVisible ? EDGE + CTX_H + CTX_GAP : EDGE;
  const top = Math.max(TOPBAR_H, topRightBottom + TOP_GAP);

  const hasHazards = allAlerts.length > 0 || nearestFire || worstQuake;
  const lightningConnected = useLightningStatus.getState().connected;

  return (
    <div
      className="pointer-events-none absolute right-6 z-30 flex flex-col gap-2"
      style={{ top, bottom, width: COL_W, transition: 'bottom 0.5s ease' }}
    >
      {/* Section label */}
      <div className="flex shrink-0 items-center gap-1.5 px-0.5">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent-ok" />
        <span className="text-[9px] font-semibold uppercase tracking-wider text-white/40">
          Area Monitor
        </span>
      </div>

      {/* Lightning rate ticker */}
      <div className="shrink-0">
        <LightningTicker />
      </div>

      {/* Nearest lightning strike to current POI */}
      {nearestStrike && poi && (
        <div className="shrink-0 rounded-lg border border-white/8 bg-white/5 px-3 py-2 text-[11px]">
          <div className="flex items-center gap-1.5">
            <span aria-hidden style={{ color: '#ffd60a' }}>⚡</span>
            <span className="text-white/60">Nearest strike</span>
          </div>
          <div className="mt-0.5 font-mono text-white/80">
            {fmtMiles(nearestStrike.distMi)} mi
            <span className="ml-2 text-white/35">{timeAgo(nearestStrike.t)}</span>
          </div>
        </div>
      )}
      {!nearestStrike && !lightningConnected && (
        <div className="shrink-0 rounded-lg border border-white/6 bg-white/3 px-3 py-2 text-[10px] text-white/25">
          Enable <span className="text-white/45">Lightning</span> layer for nearby strikes
        </div>
      )}

      {/* Scrollable regional hazard summary */}
      <div ref={viewportRef} className="relative min-h-0 flex-1 overflow-hidden">
        <div>
          {/* NWS active alerts */}
          {allAlerts.length > 0 && (
            <div className="mb-2 space-y-1">
              {allAlerts.slice(0, 5).map((a) => {
                const left = expiresText(a.expires);
                return (
                  <div
                    key={a.id}
                    className="flex items-start gap-1.5 rounded border px-2 py-1.5 text-[10px]"
                    style={{ borderColor: `${a.colorHex}40`, background: `${a.colorHex}10` }}
                    title={a.headline ?? a.areaDesc}
                  >
                    <span
                      className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full"
                      style={{ background: a.colorHex }}
                    />
                    <span className="min-w-0 flex-1 font-medium" style={{ color: a.colorHex }}>
                      {a.event}
                      {left && (
                        <span className="ml-1 text-white/30">· {left}</span>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {/* Nearest fire hotspot */}
          {nearestFire && (
            <div className="mb-2 flex items-center gap-1.5 rounded-lg border border-white/8 bg-white/5 px-2.5 py-2 text-[11px]">
              <span aria-hidden>🔥</span>
              <span className="text-accent-warn/90">
                Fire hotspot · {fmtMiles(nearestFire.distanceMi)} mi
              </span>
            </div>
          )}

          {/* Worst nearby earthquake */}
          {worstQuake && (
            <div
              className="mb-2 flex items-center gap-1.5 rounded-lg border border-white/8 bg-white/5 px-2.5 py-2 text-[11px]"
              style={{ color: quakeColor(worstQuake.mag) }}
            >
              <span aria-hidden>◎</span>
              <span>
                M{worstQuake.mag.toFixed(1)} · {fmtMiles(worstQuake.distanceMi)} mi
                <span className="ml-1.5 text-white/30">{timeAgo(worstQuake.time)}</span>
              </span>
            </div>
          )}

          {/* All-clear */}
          {!hasHazards && result && (
            <div className="rounded-lg border border-accent-ok/30 bg-accent-ok/8 px-3 py-2 text-[10px] text-accent-ok">
              <span className="mr-1" aria-hidden>✓</span>
              No active alerts · {result.scannedCount} properties monitored
            </div>
          )}
        </div>

        {scroll && (
          <>
            <div className="pointer-events-none absolute inset-x-0 top-0 h-6 bg-gradient-to-b from-[#05070a] to-transparent" />
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-6 bg-gradient-to-t from-[#05070a] to-transparent" />
          </>
        )}
      </div>
    </div>
  );
}
