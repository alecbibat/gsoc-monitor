import { useEffect, useState } from 'react';
import { useScreensaverStore, type Poi } from './screensaverStore';
import { useProximityStore } from '../widgets/proximity/proximityStore';
import { downFeedNames } from '../widgets/proximity/proximityScan';
import { HazardRows } from '../widgets/proximity/HazardRows';
import { LOCATION_GROUPS, type Location, type LocationGroup } from '../layers/locations/locations';

// Resolve a focused pin back to its group (for the colour/icon/name) regardless
// of whether it has any active hazards.
function findGroup(poi: Poi): { group: LocationGroup; location: Location } | null {
  for (const g of LOCATION_GROUPS) {
    for (const loc of g.locations) {
      if (
        loc.name === poi.title &&
        Math.abs(loc.lat - poi.lat) < 1e-4 &&
        Math.abs(loc.lon - poi.lon) < 1e-4
      ) {
        return { group: g, location: loc };
      }
    }
  }
  return null;
}

// Bottom-centre card shown while orbiting a pin in the pins screensaver: the
// same hazards the Property Watch cluster and overview sitrep summarize per
// group, scoped to the single property currently in focus.
export function PinsFocusCard() {
  const active = useScreensaverStore((s) => s.active);
  const mode = useScreensaverStore((s) => s.mode);
  const poi = useScreensaverStore((s) => s.currentPoi);
  const result = useProximityStore((s) => s.result);
  const radiusMi = useProximityStore((s) => s.radiusMi);

  const isPins = active && mode === 'pins';

  // Keep the last focused pin so the card can fade out with its content intact
  // during the brief gap between pins.
  const [shown, setShown] = useState<Poi | null>(null);
  useEffect(() => {
    if (poi && poi.category !== 'ship') setShown(poi);
  }, [poi]);

  if (!isPins || !shown || shown.category === 'ship') return null;
  const visible = poi !== null && poi.category !== 'ship';

  const info = findGroup(shown);
  const match =
    result?.properties.find(
      (p) =>
        p.location.name === shown.title &&
        Math.abs(p.location.lat - shown.lat) < 1e-4 &&
        Math.abs(p.location.lon - shown.lon) < 1e-4
    ) ?? null;
  const scanned = result !== null;
  // A downed feed must never read as "All clear" — no match while blind is
  // unknown status, not safety.
  const down = downFeedNames(result);
  const color = info?.group.color ?? '#a78bfa';

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
        {/* Title section — absorbs what ScreensaverToast showed for pins mode */}
        <div className="px-5 pt-4 pb-3">
          <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-white/30">
            {info?.group.name ?? 'Property'}
          </div>
          <div className="flex items-start gap-3">
            <span aria-hidden className="mt-0.5 text-xl leading-none">
              {info?.group.icon ?? '📍'}
            </span>
            <div className="min-w-0">
              <div
                className="text-[15px] font-bold leading-tight truncate"
                style={{ color }}
              >
                {shown.title}
              </div>
              {shown.description && (
                <div className="mt-0.5 text-[11px] text-white/50">{shown.description}</div>
              )}
            </div>
          </div>
        </div>

        {/* Hazard section */}
        <div
          className="border-t px-5 py-2.5"
          style={{ borderColor: `${color}25` }}
        >
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
