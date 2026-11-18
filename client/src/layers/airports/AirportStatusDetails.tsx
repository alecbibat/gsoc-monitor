import type { ReactNode } from 'react';
import type { FaaAirportStatus, FaaClosure, FaaDelay } from '../../types';
import {
  AIRPORT_TIERS, FAA_ATTRIBUTION, FAA_SITE, airportEvents, closureInEffect, dailyWindowText, fmtMinutes, reasonText,
  type AirportEvent,
} from './airportsMeta';

function fmt(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function Rows({ rows }: { rows: [string, ReactNode][] }) {
  const shown = rows.filter(([, v]) => v !== null && v !== undefined && v !== '' && v !== false);
  if (shown.length === 0) return null;
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[12.5px]">
      {shown.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-white/40">{label}</dt>
          <dd className="min-w-0 break-words text-white/85">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Advisory({ url }: { url: string | null }) {
  if (!url) return null;
  return (
    <a href={url} target="_blank" rel="noreferrer" className="mt-1.5 inline-block text-[11px] text-accent underline underline-offset-2 hover:text-accent/80">
      FAA advisory ↗
    </a>
  );
}

function delayRows(d: FaaDelay): [string, ReactNode][] {
  return [
    ['Delay', d.min && d.max ? (d.min === d.max ? d.min : `${d.min} to ${d.max}`) : null],
    ['Average', d.avgMin !== null ? fmtMinutes(d.avgMin) : null],
    ['Trend', d.trend && d.trend !== 'unknown' ? <span className="capitalize">{d.trend}</span> : null],
    ['Reason', reasonText(d.reason)],
    ['Updated', fmt(d.updated)],
  ];
}

function closureRows(c: FaaClosure, now: number, whole: boolean): [string, ReactNode][] {
  const hours = dailyWindowText(c);
  return [
    ['Applies', whole && hours ? `Daily, ${hours}${closureInEffect(c, now) ? ' (in effect now)' : ' (open now)'}` : null],
    ['Details', !hours && c.text ? c.text : null],
    ['From', fmt(c.start)],
    ['Until', fmt(c.end)],
    ['NOTAM', c.notam && <span className="font-mono text-[11px] text-white/60">{c.notam}</span>],
  ];
}

function EventCard({ event, children }: { event: AirportEvent; children: ReactNode }) {
  const tier = AIRPORT_TIERS[event.tier];
  return (
    <div className="rounded-lg border px-3 py-2" style={{ borderColor: `${tier.color}55`, background: `${tier.color}10` }}>
      <div className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.1em]" style={{ color: tier.color }}>
        {event.title}
      </div>
      {children}
    </div>
  );
}

export function AirportStatusDetails({ payload }: { payload: FaaAirportStatus }) {
  const a = payload;
  const now = Date.now();
  const events = airportEvents(a, now);
  const body = (e: AirportEvent): ReactNode => {
    switch (e.kind) {
      case 'closure':
        return a.closure && <Rows rows={closureRows(a.closure, now, true)} />;
      case 'restriction':
        return a.restriction && <Rows rows={closureRows(a.restriction, now, false)} />;
      case 'ground-stop':
        return a.groundStop && (
          <>
            <Rows
              rows={[
                ['Reason', reasonText(a.groundStop.reason)],
                ['Began', fmt(a.groundStop.start)],
                ['Until', fmt(a.groundStop.end)],
                ['Chance it is extended', a.groundStop.extension && <span className="capitalize">{a.groundStop.extension.toLowerCase()}</span>],
                ['Departures held from', a.groundStop.facilities.length > 0 ? a.groundStop.facilities.join(' ') : null],
              ]}
            />
            <Advisory url={a.groundStop.advisoryUrl} />
          </>
        );
      case 'ground-delay':
        return a.groundDelay && (
          <>
            <Rows
              rows={[
                ['Average delay', a.groundDelay.avgMin !== null ? fmtMinutes(a.groundDelay.avgMin) : null],
                ['Longest delay', a.groundDelay.maxMin !== null ? fmtMinutes(a.groundDelay.maxMin) : null],
                ['Reason', reasonText(a.groundDelay.reason)],
                ['From', fmt(a.groundDelay.start)],
                ['Until', fmt(a.groundDelay.end)],
              ]}
            />
            <Advisory url={a.groundDelay.advisoryUrl} />
          </>
        );
      case 'arrival-delay':
        return a.arrivalDelay && <Rows rows={delayRows(a.arrivalDelay)} />;
      case 'departure-delay':
        return a.departureDelay && <Rows rows={delayRows(a.departureDelay)} />;
      case 'deicing':
        return a.deicing && <Rows rows={[['Since', fmt(a.deicing.since)], ['Expected until', fmt(a.deicing.until)]]} />;
    }
  };

  return (
    <div className="space-y-3">
      {events.length === 0 && <p className="text-[13px] text-white/60">Nothing reported at this airport now.</p>}
      {events.map((e) => (
        <EventCard key={e.kind} event={e}>{body(e)}</EventCard>
      ))}

      {a.config && (a.config.arrival || a.config.departure || a.config.arrivalRate !== null) && (
        <div>
          <div className="mb-1 text-[11px] uppercase tracking-wide text-white/40">Runways in use</div>
          <Rows
            rows={[
              ['Arriving', a.config.arrival],
              ['Departing', a.config.departure],
              ['Arrival rate', a.config.arrivalRate !== null ? `${a.config.arrivalRate} per hour` : null],
            ]}
          />
        </div>
      )}

      <p className="border-t border-white/8 pt-2 text-[10px] text-white/35">
        {FAA_ATTRIBUTION} ·{' '}
        <a href={FAA_SITE} target="_blank" rel="noreferrer" className="text-white/50 underline-offset-2 hover:text-white/75 hover:underline">
          nasstatus.faa.gov ↗
        </a>
      </p>
    </div>
  );
}
