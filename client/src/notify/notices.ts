import type { RawAlert } from '../layers/alerts/alertsData';
import type { FlightEventWithModel, NpsAlert, ShipPortEvent, WarnAlert } from '../types';
import type { AlertChange } from './alertChanges';
import type { PinHit, PinRef } from './pinAlertMatch';

// ── What the alert popup can announce ────────────────────────────────────────
// One notice per thing that happened. Every kind carries a `key` (unique
// across kinds, the queue's identity), the colour its flash and card use, and
// a `rank` that orders the popups waiting to be seen and picks the flash
// colour when several arrive together. Some
// carry `aliases`: other keys that mean the same event (an NWS warning that
// also went out to phones as a WEA), so whichever source reports it first
// announces it once.

export type NoticeCategory = 'nws' | 'warn' | 'quake' | 'nps' | 'flight' | 'ship';

export const NOTICE_CATEGORIES: { id: NoticeCategory; label: string; detail: string }[] = [
  {
    id: 'nws',
    label: 'NWS alerts',
    detail: 'Weather alerts within 15 mi of a property: new ones, and changes — timing, upgrades, severity, cancellation',
  },
  { id: 'warn', label: 'Wireless Emergency Alerts', detail: 'PBS WARN alerts within 50 mi of a property, and their updates' },
  { id: 'quake', label: 'Earthquakes', detail: 'M4.5 or stronger within 50 mi of a property' },
  {
    id: 'nps',
    label: 'National Park alerts',
    detail: 'New or changed NPS alerts (danger, closures, cautions, info) at the six parks',
  },
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

/** How a later version of an alert differs from the one it replaces. */
interface AlertDelta {
  /** A later version of an alert already seen. */
  isUpdate: boolean;
  /** What changed from the version it replaces (empty when only its reach did). */
  changes: AlertChange[];
  /** Keys of the pins it reaches that the version it replaces didn't. */
  newPins: string[];
  /** Pins inside the area of the version it replaces that it no longer covers: it ended there. */
  endedAt: PinRef[];
}

export interface NwsNotice extends NoticeBase, AlertDelta {
  category: 'nws';
  /** The alert's own id (for a cancellation, the cancel message's). */
  id: string;
  alert: RawAlert;
  /** Pins within the radius, nearest first. */
  hits: PinHit[];
  /** NWS cancelled the alert outright: when, and what the cancellation said. */
  cancelled: { sent: string | null; text: string | null } | null;
  /** [west, south, east, north] around the alert's area and the pins it reaches. */
  bbox: [number, number, number, number];
}

export interface WarnNotice extends NoticeBase, AlertDelta {
  category: 'warn';
  alert: WarnAlert;
  hits: PinHit[];
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

export interface NpsNotice extends NoticeBase {
  category: 'nps';
  alert: NpsAlert;
  /** An alert already on the park's list whose category, title or text changed. */
  isUpdate: boolean;
}

export interface FlightNotice extends NoticeBase {
  category: 'flight';
  event: FlightEventWithModel;
}

export interface ShipNotice extends NoticeBase {
  category: 'ship';
  event: ShipPortEvent;
}

export type Notice = NwsNotice | WarnNotice | QuakeNotice | NpsNotice | FlightNotice | ShipNotice;

/** An alert that ended at a property (cancelled, or no longer covering it) reads as good news. */
export const ENDED_COLOR = '#34d399';
export const ENDED_RANK = 3;

/** The notice only says an alert ended somewhere: nothing new, nothing changed for the worse. */
export function isEndedNotice(n: NwsNotice | WarnNotice): boolean {
  if (n.category === 'nws' && n.cancelled) return true;
  return n.isUpdate && n.changes.length === 0 && n.newPins.length === 0 && n.endedAt.length > 0;
}

// Operational events read calmer than hazards.
export const FLIGHT_COLOR = '#38bdf8';
export const SHIP_COLOR = '#2dd4bf';

/** Quake colour by magnitude, matching the earthquake layer's tiers. */
export function quakeColor(mag: number): string {
  return mag >= 6 ? '#ff5d5d' : '#ffb84d';
}
