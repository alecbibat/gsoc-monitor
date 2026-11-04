import type { RawAlert } from '../layers/alerts/alertsData';
import type { FlightEventWithModel, ShipPortEvent, WarnAlert } from '../types';
import type { PinHit } from './pinAlertMatch';

// ── What the alert popup can announce ────────────────────────────────────────
// One notice per thing that happened. Every kind carries a `key` (unique
// across kinds, the queue's identity), the colour its flash and card use, and
// a `rank` that orders the popups waiting to be seen and picks the flash
// colour when several arrive together. Some
// carry `aliases`: other keys that mean the same event (an NWS warning that
// also went out to phones as a WEA), so whichever source reports it first
// announces it once.

export type NoticeCategory = 'nws' | 'warn' | 'quake' | 'flight' | 'ship';

export const NOTICE_CATEGORIES: { id: NoticeCategory; label: string; detail: string }[] = [
  { id: 'nws', label: 'NWS alerts', detail: 'New weather alerts within 15 mi of a property' },
  { id: 'warn', label: 'Wireless Emergency Alerts', detail: 'PBS WARN alerts within 50 mi of a property' },
  { id: 'quake', label: 'Earthquakes', detail: 'M4.5 or stronger within 50 mi of a property' },
  { id: 'flight', label: 'Company aircraft', detail: 'Takeoffs and landings, with the airport' },
  { id: 'ship', label: 'Windstar fleet', detail: 'Port arrivals and departures' },
];

interface NoticeBase {
  key: string;
  color: string;
  /** Higher = more urgent: shown sooner, and the batch's most urgent colours the flash. */
  rank: number;
  aliases?: string[];
}

export interface NwsNotice extends NoticeBase {
  category: 'nws';
  /** The alert's own id. */
  id: string;
  alert: RawAlert;
  /** Pins within the radius, nearest first. */
  hits: PinHit[];
  /** An update of an alert already on the map that now reaches a pin it didn't. */
  isUpdate: boolean;
  /** [west, south, east, north] around the alert's area and the pins it reaches. */
  bbox: [number, number, number, number];
}

export interface WarnNotice extends NoticeBase {
  category: 'warn';
  alert: WarnAlert;
  hits: PinHit[];
  isUpdate: boolean;
  bbox: [number, number, number, number];
}

export interface QuakeInfo {
  id: string;
  mag: number;
  place: string;
  /** Origin time, epoch ms. */
  time: number;
  lat: number;
  lon: number;
  depthKm: number | null;
  url: string;
  felt: number | null;
  tsunami: number;
  status: string;
}

export interface QuakeNotice extends NoticeBase {
  category: 'quake';
  quake: QuakeInfo;
  hits: PinHit[];
}

export interface FlightNotice extends NoticeBase {
  category: 'flight';
  event: FlightEventWithModel;
}

export interface ShipNotice extends NoticeBase {
  category: 'ship';
  event: ShipPortEvent;
}

export type Notice = NwsNotice | WarnNotice | QuakeNotice | FlightNotice | ShipNotice;

// Operational events read calmer than hazards.
export const FLIGHT_COLOR = '#38bdf8';
export const SHIP_COLOR = '#2dd4bf';

/** Quake colour by magnitude, matching the earthquake layer's tiers. */
export function quakeColor(mag: number): string {
  return mag >= 6 ? '#ff5d5d' : '#ffb84d';
}
