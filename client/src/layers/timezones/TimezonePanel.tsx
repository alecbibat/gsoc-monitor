import { useEffect, useMemo, useState } from 'react';
import {
  formatZoneDate,
  readZone,
  resolveZoneClock,
  zoneLongName,
  type ZoneClock,
  type ZoneReading,
} from './zoneClock';
import meta from './timezones.meta.json';

interface Payload {
  /** tz database name of the clicked zone polygon. */
  tzid?: string;
  // Panels persisted by the earlier band-based layer carried these instead.
  iana?: string | null;
  tzName?: string;
}

function clockFromPayload(p: Payload): ZoneClock | null {
  return resolveZoneClock(p.tzid ?? p.iana ?? p.tzName);
}

interface Readings {
  reading: ZoneReading;
  date: string;
  /** "Eastern Daylight Time" when ICU knows one. */
  longName: string | null;
  /** Minutes ahead (+) of the viewer's own clock and of UTC. */
  vsLocalMin: number;
  vsUtcMin: number;
}

// "+9 h", "-2.5 h", "+5.75 h", "±0 h"
function signedHours(min: number): string {
  const h = min / 60;
  const sign = h > 0 ? '+' : h < 0 ? '-' : '±';
  const abs = Math.abs(h);
  return `${sign}${Number.isInteger(abs) ? abs : abs.toFixed(2).replace(/0+$/, '')} h`;
}

function readAll(clock: ZoneClock, now: number): Readings {
  const reading = readZone(clock, now);
  return {
    reading,
    date: formatZoneDate(clock, now),
    longName: zoneLongName(clock.iana, now, reading.offsetMin),
    vsLocalMin: reading.offsetMin + new Date(now).getTimezoneOffset(),
    vsUtcMin: reading.offsetMin,
  };
}

export function TimezonePanel({ payload }: { payload: Record<string, unknown> }) {
  const p = payload as Payload;
  const clock = useMemo(() => clockFromPayload(p), [p.tzid, p.iana, p.tzName]);
  if (!clock) {
    return (
      <div className="px-4 py-6 text-[12px] leading-relaxed text-white/50">
        This browser's time-zone database doesn't include{' '}
        <span className="font-mono text-white/70">{p.tzid ?? p.iana ?? p.tzName ?? 'this zone'}</span>,
        so its clock can't be shown. Updating the browser usually fixes it.
      </div>
    );
  }
  return <ZoneClockPanel clock={clock} />;
}

function ZoneClockPanel({ clock }: { clock: ZoneClock }) {
  const [r, setR] = useState<Readings>(() => readAll(clock, Date.now()));

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      const now = Date.now();
      setR(readAll(clock, now));
      timer = setTimeout(tick, 1000 - (now % 1000) + 5);
    };
    tick();
    return () => clearTimeout(timer);
  }, [clock]);

  const label = 'text-white/30';

  return (
    <div className="flex flex-col items-center gap-4 px-4 py-5">
      <div className="flex flex-wrap items-center justify-center gap-x-2 text-[11px] font-semibold uppercase tracking-[0.25em] text-white/35">
        <span className="text-white/60">{r.reading.offsetLabel}</span>
        {r.reading.abbr && <span className="text-white/50">{r.reading.abbr}</span>}
        {r.reading.isDst && (
          <span className="rounded border border-amber-300/30 px-1.5 py-0.5 text-[9px] tracking-[0.15em] text-amber-200/80">
            DST
          </span>
        )}
      </div>

      <div className="font-mono text-[52px] font-bold leading-none tabular-nums tracking-tight text-white/92">
        {r.reading.hhmmss}
      </div>

      <div className="text-[12px] text-white/40">{r.date}</div>
      {r.longName && <div className="-mt-2 text-[11px] text-white/30">{r.longName}</div>}

      <div className="flex gap-4 text-[11px] tabular-nums text-white/45">
        <span>
          <span className={label}>vs you</span> {signedHours(r.vsLocalMin)}
        </span>
        <span>
          <span className={label}>vs UTC</span> {signedHours(r.vsUtcMin)}
        </span>
      </div>

      <div className="mt-1 w-full space-y-2 border-t border-white/10 pt-3 text-[11px] leading-relaxed text-white/45">
        <div>
          <span className={label}>tz database zone</span>{' '}
          <span className="font-mono text-white/60">{clock.iana}</span>
        </div>
        <div className="text-[10px] text-white/25">
          Places whose clocks agree from today on are drawn as one shape and named for one of
          them, so this zone may cover several countries. Boundaries: timezone-boundary-builder{' '}
          {meta.release} · © OpenStreetMap contributors (ODbL).
        </div>
      </div>
    </div>
  );
}
