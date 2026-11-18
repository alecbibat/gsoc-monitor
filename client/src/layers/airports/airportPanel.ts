import type { PanelOpenData } from '../../panels/panelStore';
import type { FaaAirportStatus } from '../../types';
import { airportEvents } from './airportsMeta';

/** The detail panel for an airport: opened from its marker, and from the alert popup. */
export function airportPanelData(a: FaaAirportStatus, now: number): PanelOpenData {
  return {
    id: `airport-${a.id}`,
    kind: 'airports',
    title: `${a.id} · ${a.name}`,
    subtitle: airportEvents(a, now)[0]?.title ?? 'FAA airport status',
    payload: a as unknown as Record<string, unknown>,
  };
}
