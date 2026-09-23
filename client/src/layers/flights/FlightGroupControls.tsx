import { useEffect, useState } from 'react';
import { useLayersStore } from '../../store/layersStore';
import { useFlightsStatus } from './flightsStore';
import type { FlightGroupId } from '../../types';

const GROUP_LABELS: Array<{ id: FlightGroupId; label: string }> = [
  { id: 'company', label: 'Company' },
  { id: 'hurricane-hunters', label: 'Hurricane Hunters' },
  { id: 'fire-tankers', label: 'Fire Tankers' },
];

// City table (~42 KB gzip) stays out of the entry chunk; see FlightActivity.
export const loadFlightActivity = () => import('./FlightActivity');
type FlightActivityComponent = typeof import('./FlightActivity').default;
// Kept once loaded so a remount renders it straight away, as React.lazy did.
let loadedFlightActivity: FlightActivityComponent | null = null;

// Loads the feed on demand. A failed import (a stale tab across a deploy gets a
// 404 for the old chunk hash, or a network blip) renders nothing rather than
// unmounting the whole app (the main app has no error boundary), and is retried
// on the next flight poll instead of being remembered for the session the way
// React.lazy would.
function FlightActivitySlot({ groups }: { groups: Record<FlightGroupId, boolean> }) {
  const [Comp, setComp] = useState<FlightActivityComponent | null>(() => loadedFlightActivity);
  const events = useFlightsStatus((s) => s.events);
  useEffect(() => {
    if (Comp) return;
    let alive = true;
    loadFlightActivity().then(
      (m) => {
        loadedFlightActivity = m.default;
        if (alive) setComp(() => m.default);
      },
      () => {}
    );
    return () => { alive = false; };
  }, [Comp, events]);
  return Comp ? <Comp groups={groups} /> : null;
}

/**
 * Sub-controls under the Flights toggle: one checkbox per tracked roster, and
 * the recent takeoff/landing feed the tracker has witnessed — filtered by the
 * same roster checkboxes as the map markers.
 */
export function FlightGroupControls() {
  const groups = useLayersStore((s) => s.flightGroups);
  const toggleGroup = useLayersStore((s) => s.toggleFlightGroup);

  return (
    <div className="space-y-1 pt-1">
      {GROUP_LABELS.map(({ id, label }) => (
        <label key={id} className="flex items-center gap-2 text-[11px] text-white/60">
          <input
            type="checkbox"
            checked={groups[id] !== false}
            onChange={() => toggleGroup(id)}
            className="accent-accent"
          />
          {label}
        </label>
      ))}
      <FlightActivitySlot groups={groups} />
    </div>
  );
}
