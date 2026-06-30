import { useEffect, useState } from 'react';
import { useScreensaverStore } from './screensaverStore';
import { ContextMiniMap } from './ContextMiniMap';
import { reverseGeocode } from './reverseGeocode';

// AIS navigational-status codes → short labels. Statuses 1/5/6 mean the vessel
// is sitting still (anchored / moored / aground) — i.e. effectively "in port".
const NAV_STATUS: Record<number, string> = {
  0: 'Under way',
  1: 'At anchor',
  2: 'Not under command',
  3: 'Restricted',
  4: 'Deep draught',
  5: 'Moored',
  6: 'Aground',
  7: 'Fishing',
  8: 'Under sail',
};
const DOCKED_STATUSES = new Set([1, 5, 6]);

// AIS destination strings are free-text and usually SHOUTED IN ALL CAPS, often
// with a leading ">" or underscores. Tidy into something readable.
function cleanDestination(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let s = raw.replace(/[>_]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s || s === '0') return null;
  if (s === s.toUpperCase()) {
    // Title-case all-caps destinations: "CIVITAVECCHIA" → "Civitavecchia".
    s = s.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase());
  }
  return s;
}

export function PinsContextBox() {
  const [geoLabel, setGeoLabel] = useState<string | null>(null);

  const active = useScreensaverStore((s) => s.active);
  const mode = useScreensaverStore((s) => s.mode);
  const poi = useScreensaverStore((s) => s.currentPoi);

  const isPins = active && mode === 'pins';
  const visible = isPins && poi !== null;

  // Ship voyage context — surface the berth city / heading port from AIS so the
  // box never dead-ends at "International Waters" when we know where the vessel
  // is docked or bound. Docked vessels show their berth; under-way vessels show
  // current waters plus the port they're steaming toward.
  const isShip = poi?.category === 'ship';
  const navStatus = isShip ? (poi?.meta?.navStatus as number | null | undefined) : undefined;
  const destination = isShip ? cleanDestination(poi?.meta?.destination as string | null | undefined) : null;
  const docked = navStatus != null && DOCKED_STATUSES.has(navStatus);
  const statusLabel = navStatus != null ? NAV_STATUS[navStatus] : undefined;

  let berthIcon = '';
  let berthText: string | null = null;
  let destText: string | null = null;
  if (isShip) {
    if (docked) {
      berthIcon = '⚓';
      const place = geoLabel ?? destination;
      berthText = (statusLabel ?? 'Berthed') + (place ? ` · ${place}` : '');
      // Note the next port too if it differs from where she's currently berthed.
      if (geoLabel && destination && destination.toLowerCase() !== geoLabel.toLowerCase()) {
        destText = `→ ${destination}`;
      }
    } else {
      berthIcon = '🌐';
      berthText = geoLabel ?? 'International Waters';
      if (destination) destText = `→ ${destination}`;
    }
  }

  useEffect(() => {
    if (!poi) {
      setGeoLabel(null);
      return;
    }
    const ctrl = new AbortController();
    reverseGeocode(poi.lat, poi.lon, ctrl.signal).then((label) => {
      // Keep the raw reverse-geocode result (null over open ocean); the ship
      // branch above decides how to phrase "International Waters" vs a port.
      if (!ctrl.signal.aborted) setGeoLabel(label);
    });
    return () => ctrl.abort();
  }, [poi?.lat, poi?.lon, poi?.category]);

  return (
    <div
      className={`pointer-events-none absolute bottom-12 right-6 z-30 transition-all duration-500 ${
        visible ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0'
      }`}
    >
      {poi && (
        <ContextMiniMap lat={poi.lat} lon={poi.lon}>
          <div className="truncate text-[10px] font-medium text-white/80">{poi.title}</div>
          {isShip ? (
            <>
              {berthText && (
                <div className="truncate text-[9px] text-white/60">
                  {berthIcon && <span className="mr-0.5">{berthIcon}</span>}
                  {berthText}
                </div>
              )}
              {destText && <div className="truncate text-[9px] text-accent/75">{destText}</div>}
            </>
          ) : (
            geoLabel && <div className="truncate text-[9px] text-white/55">{geoLabel}</div>
          )}
        </ContextMiniMap>
      )}
    </div>
  );
}
