import { lazy, Suspense } from 'react';
import { useLayersStore } from '../../store/layersStore';
import type { FlightGroupId } from '../../types';

const GROUP_LABELS: Array<{ id: FlightGroupId; label: string }> = [
  { id: 'company', label: 'Company' },
  { id: 'hurricane-hunters', label: 'Hurricane Hunters' },
  { id: 'fire-tankers', label: 'Fire Tankers' },
];

// City table (~42 KB gzip) stays out of the entry chunk; see FlightActivity.
export const loadFlightActivity = () => import('./FlightActivity');
// A stale tab across a deploy gets a 404 for the old chunk hash. Render
// nothing rather than let the rejection unmount the whole app (the main app
// has no error boundary).
const FlightActivity = lazy(() =>
  loadFlightActivity().catch(() => ({ default: () => null }))
);

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
      <Suspense fallback={null}>
        <FlightActivity groups={groups} />
      </Suspense>
    </div>
  );
}
