import { useMemo } from 'react';
import { useFlightsStatus } from './flightsStore';
import { nearestMajorCity } from '../ships/majorCities';
import type { FlightEvent, FlightGroupId } from '../../types';

// The recent takeoff/landing feed under the Flights toggle. Split out of
// FlightGroupControls and lazy-loaded so the city table it labels events with
// stays out of the entry chunk (Flights is off by default).

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

export default function FlightActivity({ groups }: { groups: Record<FlightGroupId, boolean> }) {
  const events = useFlightsStatus((s) => s.events);

  const lines = useMemo(
    () =>
      events
        .filter((e) => groups[e.group ?? 'company'] !== false)
        .slice(0, EVENTS_SHOWN)
        .map((e) => ({ id: e.id, line: eventLine(e) })),
    [events, groups]
  );

  if (lines.length === 0) return null;
  return (
    <div className="pt-1">
      <div className="text-[10px] uppercase tracking-wide text-white/30">Flight activity</div>
      {lines.map(({ id, line }) => (
        <div key={id} className="truncate text-[11px] text-white/50" title={line}>
          {line}
        </div>
      ))}
    </div>
  );
}
