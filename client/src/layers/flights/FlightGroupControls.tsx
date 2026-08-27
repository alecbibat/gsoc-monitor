import { useMemo } from 'react';
import { useLayersStore } from '../../store/layersStore';
import { useFlightsStatus } from './flightsStore';
import { nearestMajorCity } from '../ships/majorCities';
import type { FlightEvent, FlightGroupId } from '../../types';

const GROUP_LABELS: Array<{ id: FlightGroupId; label: string }> = [
  { id: 'company', label: 'Company' },
  { id: 'hurricane-hunters', label: 'Hurricane Hunters' },
  { id: 'fire-tankers', label: 'Fire Tankers' },
];

const EVENTS_SHOWN = 4;

// Each line runs a nearest-city scan over a few thousand rows, and events are
// immutable once emitted — cache the rendered text by event id (the events
// array itself is replaced wholesale every poll).
const lineCache = new Map<string, string>();

function eventLine(e: FlightEvent): string {
  let line = lineCache.get(e.id);
  if (line === undefined) {
    const verb = e.kind === 'takeoff' ? '↑ departed' : '↓ landed';
    const near = nearestMajorCity(e.lat, e.lon);
    const place = near ? ` near ${near.city.name}, ${near.city.region}` : '';
    const time = new Date(e.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    line = `${e.reg} ${verb}${place} · ${time}`;
    if (lineCache.size > 400) lineCache.clear();
    lineCache.set(e.id, line);
  }
  return line;
}

/**
 * Sub-controls under the Flights toggle: one checkbox per tracked roster, and
 * the recent takeoff/landing feed the tracker has witnessed — filtered by the
 * same roster checkboxes as the map markers.
 */
export function FlightGroupControls() {
  const groups = useLayersStore((s) => s.flightGroups);
  const toggleGroup = useLayersStore((s) => s.toggleFlightGroup);
  const events = useFlightsStatus((s) => s.events);

  const lines = useMemo(
    () =>
      events
        .filter((e) => groups[e.group ?? 'company'] !== false)
        .slice(0, EVENTS_SHOWN)
        .map((e) => ({ id: e.id, line: eventLine(e) })),
    [events, groups]
  );

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
      {lines.length > 0 && (
        <div className="pt-1">
          <div className="text-[10px] uppercase tracking-wide text-white/30">Flight activity</div>
          {lines.map(({ id, line }) => (
            <div key={id} className="truncate text-[11px] text-white/50" title={line}>
              {line}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
