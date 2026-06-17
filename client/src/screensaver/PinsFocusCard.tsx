import { useEffect, useState } from 'react';
import { useScreensaverStore, type Poi } from './screensaverStore';
import { useProximityStore } from '../widgets/proximity/proximityStore';
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
// same hazard summary the Property Watch feed scrolls on the right, but scoped
// to the single property currently in focus.
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
    if (poi) setShown(poi);
  }, [poi]);

  if (!isPins || !shown) return null;
  const visible = poi !== null;

  const info = findGroup(shown);
  const match =
    result?.properties.find(
      (p) =>
        p.location.name === shown.title &&
        Math.abs(p.location.lat - shown.lat) < 1e-4 &&
        Math.abs(p.location.lon - shown.lon) < 1e-4
    ) ?? null;
  const scanned = result !== null;
  const color = info?.group.color ?? '#a78bfa';

  return (
    <div
      className={`pointer-events-none absolute bottom-14 left-1/2 z-30 w-[min(360px,calc(100vw-2rem))] -translate-x-1/2 transition-all duration-500 ${
        visible ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0'
      }`}
    >
      <div
        className="overflow-hidden rounded-xl border bg-ink-900/90 px-3.5 py-2.5 shadow-2xl backdrop-blur-md"
        style={{ borderColor: `${color}55` }}
      >
        <div className="flex items-center gap-2">
          <span aria-hidden className="text-[15px]">
            {info?.group.icon ?? '📍'}
          </span>
          <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-white/90">
            {shown.title}
          </span>
          <span className="shrink-0 text-[9px] font-medium uppercase tracking-wider text-white/35">
            {info?.group.name ?? ''}
          </span>
        </div>

        {match ? (
          <HazardRows hazards={match} radiusMi={radiusMi} />
        ) : scanned ? (
          <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-accent-ok/90">
            <span aria-hidden>✓</span>
            <span>
              All clear — nothing within {radiusMi} mi
            </span>
          </div>
        ) : (
          <div className="mt-1.5 text-[11px] text-white/40">Scanning nearby hazards…</div>
        )}
      </div>
    </div>
  );
}
