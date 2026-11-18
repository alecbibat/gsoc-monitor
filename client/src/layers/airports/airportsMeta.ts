import type { FaaAirportStatus, FaaClosure, FaaDelay } from '../../types';

// What the FAA reports at an airport, as the Airport Status layer, its legend,
// its detail panel and the alert popup all read it. Store-free and static.

/** One thing going on at an airport. */
export type AirportEventKind =
  | 'closure'
  | 'ground-stop'
  | 'ground-delay'
  | 'arrival-delay'
  | 'departure-delay'
  | 'deicing'
  | 'restriction';

/** How an airport is drawn: by the worst thing going on there. */
export type AirportTier = 'closure' | 'ground-stop' | 'ground-delay' | 'delay' | 'deicing' | 'notice';

export const AIRPORT_TIERS: Record<AirportTier, { label: string; short: string; color: string; note: string }> = {
  closure: {
    label: 'Closed',
    short: 'Closed',
    color: '#ff5d5d',
    note: 'The airport is closed to all traffic right now',
  },
  'ground-stop': {
    label: 'Ground stop',
    short: 'Stop',
    color: '#ff8a3d',
    note: 'Flights bound for the airport are held at their origin',
  },
  'ground-delay': {
    label: 'Ground delay program',
    short: 'GDP',
    color: '#ffb84d',
    note: 'Flights bound for the airport are given later departure times, to meter arrivals',
  },
  delay: {
    label: 'Arrival or departure delays',
    short: 'Delay',
    color: '#ffe14d',
    note: 'Delays of 15 minutes or more at the airport itself',
  },
  deicing: {
    label: 'Deicing',
    short: 'Deice',
    color: '#7dd3fc',
    note: 'Aircraft are being deiced before departure',
  },
  notice: {
    label: 'Restriction or scheduled closure',
    short: 'Other',
    color: '#94a3b8',
    note: 'Closed to some traffic only (usually transient general aviation), or closed at set hours and open now',
  },
};

/** Legend order, and which event leads at an airport: worst first. */
export const AIRPORT_TIER_ORDER: AirportTier[] = ['closure', 'ground-stop', 'ground-delay', 'delay', 'deicing', 'notice'];

export const FAA_ATTRIBUTION = 'FAA Air Traffic Control System Command Center';
export const FAA_SITE = 'https://nasstatus.faa.gov/';

/** The server caches 60 s; an answer older than this means it is serving its last good copy. */
export const FAA_FETCH_STALE_MS = 5 * 60_000;

export interface AirportEvent {
  kind: AirportEventKind;
  tier: AirportTier;
  /** "Ground stop". */
  title: string;
  /** "Wind · until 10:45 AM"; null when the FAA gives nothing more. */
  detail: string | null;
}

/** "1 h 32 min" for 92. */
export function fmtMinutes(min: number): string {
  const m = Math.max(0, Math.round(min));
  if (m < 60) return `${m} min`;
  return m % 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${Math.floor(m / 60)} h`;
}

const REASON_PREFIX: Record<string, string> = {
  WX: 'Weather',
  VOL: 'Volume',
  RWY: 'Runway',
  EQ: 'Equipment',
  STAFF: 'Staffing',
  TM: 'Traffic management',
  OTHER: 'Other',
};

/** The FAA's reason codes in words: "WX:Thunderstorms" → "Weather: thunderstorms"; "wind" → "Wind". */
export function reasonText(reason: string | null): string | null {
  if (!reason) return null;
  const [head, ...rest] = reason.split(':');
  const tail = rest.join(':').trim();
  const prefix = REASON_PREFIX[head.trim().toUpperCase()];
  if (!prefix) return reason.charAt(0).toUpperCase() + reason.slice(1);
  if (!tail || tail.toLowerCase() === prefix.toLowerCase()) return prefix;
  return `${prefix}: ${tail.toLowerCase()}`;
}

function clock(iso: string | null): string | null {
  const t = iso ? Date.parse(iso) : NaN;
  if (Number.isNaN(t)) return null;
  const d = new Date(t);
  const sameDay = d.toDateString() === new Date().toDateString();
  return d.toLocaleString([], {
    ...(sameDay ? {} : { month: 'short', day: 'numeric' }),
    hour: 'numeric',
    minute: '2-digit',
  });
}

const join = (parts: (string | null | false | undefined)[]) => parts.filter(Boolean).join(' · ') || null;

/** "07:30–14:15 UTC" for a closure that only applies at set hours. */
export function dailyWindowText(c: FaaClosure): string | null {
  if (!c.daily) return null;
  const hm = (s: string) => `${s.slice(0, 2)}:${s.slice(2)}`;
  return `${hm(c.daily.from)}–${hm(c.daily.to)} UTC`;
}

/**
 * Whether a closure applies at this moment: within its dates, and — for one
 * that only applies at set hours each day — within those hours.
 */
export function closureInEffect(c: FaaClosure, now: number): boolean {
  if (c.start && Date.parse(c.start) > now) return false;
  if (c.end && Date.parse(c.end) <= now) return false;
  if (!c.daily) return true;
  const d = new Date(now);
  const hhmm = d.getUTCHours() * 100 + d.getUTCMinutes();
  const from = Number(c.daily.from);
  const to = Number(c.daily.to);
  return from <= to ? hhmm >= from && hhmm < to : hhmm >= from || hhmm < to;
}

function delayDetail(d: FaaDelay): string | null {
  const range =
    d.min && d.max ? (d.min === d.max ? d.min : `${d.min} to ${d.max}`) : d.avgMin !== null ? `about ${fmtMinutes(d.avgMin)}` : null;
  return join([range, d.trend && d.trend !== 'unknown' ? d.trend : null, reasonText(d.reason)]);
}

/** Everything going on at an airport, worst first. */
export function airportEvents(a: FaaAirportStatus, now: number): AirportEvent[] {
  const out: AirportEvent[] = [];
  if (a.closure) {
    const live = closureInEffect(a.closure, now);
    const hours = dailyWindowText(a.closure);
    out.push({
      kind: 'closure',
      tier: live ? 'closure' : 'notice',
      title: live ? 'Airport closed' : hours ? 'Closed at set hours (open now)' : 'Closure scheduled',
      detail: join([
        hours && `daily ${hours}`,
        !live && !hours && clock(a.closure.start) && `from ${clock(a.closure.start)}`,
        clock(a.closure.end) && `until ${clock(a.closure.end)}`,
      ]),
    });
  }
  if (a.groundStop) {
    out.push({
      kind: 'ground-stop',
      tier: 'ground-stop',
      title: 'Ground stop',
      detail: join([reasonText(a.groundStop.reason), clock(a.groundStop.end) && `until ${clock(a.groundStop.end)}`]),
    });
  }
  if (a.groundDelay) {
    const g = a.groundDelay;
    out.push({
      kind: 'ground-delay',
      tier: 'ground-delay',
      title: 'Ground delay program',
      detail: join([
        g.avgMin !== null && `avg ${fmtMinutes(g.avgMin)}`,
        g.maxMin !== null && `max ${fmtMinutes(g.maxMin)}`,
        reasonText(g.reason),
      ]),
    });
  }
  if (a.arrivalDelay) {
    out.push({ kind: 'arrival-delay', tier: 'delay', title: 'Arrival delays', detail: delayDetail(a.arrivalDelay) });
  }
  if (a.departureDelay) {
    out.push({ kind: 'departure-delay', tier: 'delay', title: 'Departure delays', detail: delayDetail(a.departureDelay) });
  }
  if (a.deicing) {
    out.push({
      kind: 'deicing',
      tier: 'deicing',
      title: 'Deicing in progress',
      detail: clock(a.deicing.since) && `since ${clock(a.deicing.since)}`,
    });
  }
  if (a.restriction) {
    out.push({
      kind: 'restriction',
      tier: 'notice',
      title: 'Closed to some traffic',
      detail: join([a.restriction.text || null, clock(a.restriction.end) && `until ${clock(a.restriction.end)}`]),
    });
  }
  const order = (e: AirportEvent) => AIRPORT_TIER_ORDER.indexOf(e.tier);
  return out.sort((x, y) => order(x) - order(y));
}

/** The worst thing going on at an airport. */
export function airportTier(a: FaaAirportStatus, now: number): AirportTier {
  return airportEvents(a, now)[0]?.tier ?? 'notice';
}

const COUNT_WORDS: [AirportTier, string, string][] = [
  ['closure', 'closed', 'closed'],
  ['ground-stop', 'ground stop', 'ground stops'],
  ['ground-delay', 'delay program', 'delay programs'],
  ['delay', 'with delays', 'with delays'],
  ['deicing', 'deicing', 'deicing'],
];

/** "1 ground stop · 2 with delays · 8 airports reporting". */
export function airportsStatusText(tiers: Record<AirportTier, number>, total: number): string {
  if (total === 0) return 'No delays or closures reported · FAA';
  const parts = COUNT_WORDS.filter(([t]) => tiers[t] > 0).map(([t, one, many]) => `${tiers[t]} ${tiers[t] === 1 ? one : many}`);
  return [...parts, `${total} airport${total === 1 ? '' : 's'} reporting`].join(' · ');
}
