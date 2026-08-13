import { useEffect, useMemo, useState } from 'react';
import { useHoverStore } from './hoverStore';
import { useProximityStore } from '../widgets/proximity/proximityStore';
import { downFeedNames } from '../widgets/proximity/proximityScan';
import { HazardRows } from '../widgets/proximity/HazardRows';
import { LOCATION_GROUPS, type Location, type LocationGroup } from '../layers/locations/locations';
import { haversineMeters, metersToMiles } from '../lib/geo';

type NearestPin = { group: LocationGroup; location: Location; meters: number };

// Single nearest tracked pin to an arbitrary lat/lon.
function nearestPin(lat: number, lon: number): NearestPin | null {
  let best: NearestPin | null = null;
  for (const group of LOCATION_GROUPS) {
    for (const location of group.locations) {
      const meters = haversineMeters(lat, lon, location.lat, location.lon);
      if (!best || meters < best.meters) best = { group, location, meters };
    }
  }
  return best;
}

// Card shown while hover-orbiting a custom point: the nearest tracked property
// and its live hazards — the same HazardRows the Property Watch feed shows,
// scoped to whichever pin is closest to the orbit centre.
export function HoverFocusCard() {
  const active = useHoverStore((s) => s.active);
  const point = useHoverStore((s) => s.point);
  const result = useProximityStore((s) => s.result);
  const radiusMi = useProximityStore((s) => s.radiusMi);
  const scan = useProximityStore((s) => s.scan);

  // Keep the proximity scan fresh while the orbit is running (same cadence the
  // pins screensaver uses); the throttled store dedupes concurrent consumers,
  // so the entry scan is a no-op when a fresh result already exists but
  // replaces one that predates the orbit starting.
  useEffect(() => {
    if (!active) return;
    void scan();
    const id = setInterval(() => scan(), 5 * 60_000);
    return () => clearInterval(id);
  }, [active, scan]);

  const nearest = useMemo(
    () => (point ? nearestPin(point.lat, point.lon) : null),
    [point?.lat, point?.lon],
  );

  // Retain the last nearest pin so the card can fade out with content intact
  // after the orbit stops (point/nearest go null together).
  const [shown, setShown] = useState<NearestPin | null>(null);
  useEffect(() => {
    if (nearest) setShown(nearest);
  }, [nearest]);

  const display = nearest ?? shown;
  const visible = active && nearest !== null;
  if (!display) return null;

  const { group, location, meters } = display;
  const match =
    result?.properties.find(
      (p) =>
        p.location.name === location.name &&
        Math.abs(p.location.lat - location.lat) < 1e-4 &&
        Math.abs(p.location.lon - location.lon) < 1e-4,
    ) ?? null;
  const scanned = result !== null;
  // A downed feed must never read as "All clear" — no match while blind is
  // unknown status, not safety.
  const down = downFeedNames(result);
  const color = group.color;
  const distMi = metersToMiles(meters);

  return (
    <div
      className={`pointer-events-none absolute bottom-10 left-1/2 z-30 w-[min(420px,calc(100vw-2rem))] -translate-x-1/2 transition-all duration-500 ${
        visible ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0'
      }`}
    >
      <div
        className="overflow-hidden rounded-xl border bg-ink-900/90 shadow-2xl backdrop-blur-md"
        style={{ borderColor: `${color}55` }}
      >
        {/* Title section — nearest property + its distance from the orbit centre */}
        <div className="px-5 pb-3 pt-4">
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <span className="truncate text-[10px] font-semibold uppercase tracking-[0.2em] text-white/30">
              {group.name}
            </span>
            <span className="shrink-0 text-[10px] font-medium text-white/40">
              Nearest · {distMi < 1 ? '<1' : distMi.toFixed(0)} mi from orbit
            </span>
          </div>
          <div className="flex items-start gap-3">
            <span aria-hidden className="mt-0.5 text-xl leading-none">
              {group.icon}
            </span>
            <div className="min-w-0">
              <div className="truncate text-[15px] font-bold leading-tight" style={{ color }}>
                {location.name}
              </div>
            </div>
          </div>
        </div>

        {/* Hazard section */}
        <div className="border-t px-5 py-2.5" style={{ borderColor: `${color}25` }}>
          {match ? (
            <HazardRows hazards={match} radiusMi={radiusMi} />
          ) : !scanned ? (
            <div className="text-[11px] text-white/40">Scanning nearby hazards…</div>
          ) : down.length === 3 ? (
            <div className="text-[11px] text-accent-danger/90">
              Hazard feeds unreachable — status unknown
            </div>
          ) : down.length > 0 ? (
            <div className="text-[11px] text-accent-warn/90">
              <span aria-hidden className="mr-1">⚠</span>
              Partial scan ({down.join(' + ')} down) — nothing found within {radiusMi} mi
            </div>
          ) : (
            <div className="flex items-center gap-1.5 text-[11px] text-accent-ok/90">
              <span aria-hidden>✓</span>
              <span>All clear — nothing within {radiusMi} mi</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
