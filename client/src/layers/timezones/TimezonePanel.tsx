import { useEffect, useMemo, useState } from 'react';
import {
  formatOffsetLabel,
  formatZoneDate,
  readZone,
  resolveZoneClock,
  zoneCityName,
  zoneLongName,
  type ZoneClock,
  type ZoneReading,
} from './zoneClock';

interface Payload {
  /** Nominal band offset in hours (Natural Earth's `zone`). */
  offset: number;
  /** Nominal band label, e.g. "UTC-5". */
  label: string;
  /** Representative IANA zone, or the label when the band has none. */
  tzName: string;
  // Added with the live labels; older persisted panels may lack them.
  iana?: string | null;
  place?: string | null;
  places?: string | null;
  dstPlaces?: string | null;
}

function clockFromPayload(p: Payload): ZoneClock {
  // `iana` is authoritative when present; a pre-existing payload only has
  // tzName, which resolveZoneClock validates the same way the layer does.
  const name = p.iana !== undefined ? p.iana : p.tzName;
  return resolveZoneClock(p.offset, name);
}

function splitPlaces(s: string | null | undefined): string[] {
  if (!s) return [];
  return s
    .split(/,\s*(?![^()]*\))/) // commas outside parentheses
    .map((x) => x.trim())
    .filter(Boolean);
}

interface Readings {
  primary: ZoneReading;
  date: string;
  /** "Eastern Daylight Time" when ICU knows one. */
  longName: string | null;
  /** The band's fixed nominal clock, only when it differs from the primary. */
  nominal: ZoneReading | null;
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

function readAll(clock: ZoneClock, nominalClock: ZoneClock, now: number): Readings {
  const primary = readZone(clock, now);
  const nominal = clock.iana && primary.offsetMin !== nominalClock.fixedOffsetMin
    ? readZone(nominalClock, now)
    : null;
  const localOffsetMin = -new Date(now).getTimezoneOffset();
  return {
    primary,
    date: formatZoneDate(clock, now),
    longName: clock.iana ? zoneLongName(clock.iana, now, primary.offsetMin) : null,
    nominal,
    vsLocalMin: primary.offsetMin - localOffsetMin,
    vsUtcMin: primary.offsetMin,
  };
}

export function TimezonePanel({ payload }: { payload: Record<string, unknown> }) {
  const p = payload as unknown as Payload;
  const clock = useMemo(() => clockFromPayload(p), [p.offset, p.iana, p.tzName]);
  const nominalClock = useMemo(() => resolveZoneClock(p.offset, null), [p.offset]);
  const place = p.place ?? (clock.iana ? zoneCityName(clock.iana) : null);

  const [r, setR] = useState<Readings>(() => readAll(clock, nominalClock, Date.now()));

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      const now = Date.now();
      setR(readAll(clock, nominalClock, now));
      timer = setTimeout(tick, 1000 - (now % 1000) + 5);
    };
    tick();
    return () => clearTimeout(timer);
  }, [clock, nominalClock]);

  const places = splitPlaces(p.places);
  const dstPlaces = splitPlaces(p.dstPlaces);
  const label = 'text-white/30';

  return (
    <div className="flex flex-col items-center gap-4 px-4 py-5">
      <div className="flex flex-wrap items-center justify-center gap-x-2 text-[11px] font-semibold uppercase tracking-[0.25em] text-white/35">
        {place && <span className="text-white/60">{place}</span>}
        <span>{r.primary.offsetLabel}</span>
        {r.primary.abbr && <span className="text-white/50">{r.primary.abbr}</span>}
        {r.primary.isDst && (
          <span className="rounded border border-amber-300/30 px-1.5 py-0.5 text-[9px] tracking-[0.15em] text-amber-200/80">
            DST
          </span>
        )}
      </div>

      <div className="font-mono text-[52px] font-bold leading-none tabular-nums tracking-tight text-white/92">
        {r.primary.hhmmss}
      </div>

      <div className="text-[12px] text-white/40">{r.date}</div>
      {r.longName && <div className="-mt-2 text-[11px] text-white/30">{r.longName}</div>}

      <div className="flex gap-4 text-[11px] tabular-nums text-white/45">
        <span>
          <span className="text-white/30">vs you</span> {signedHours(r.vsLocalMin)}
        </span>
        <span>
          <span className="text-white/30">vs UTC</span> {signedHours(r.vsUtcMin)}
        </span>
      </div>

      {r.nominal && (
        <div className="flex w-full items-baseline justify-between rounded-md border border-white/10 bg-white/[0.03] px-3 py-2">
          <div className="text-[11px] leading-snug text-white/45">
            <div className="font-semibold uppercase tracking-[0.15em] text-white/35">
              {formatOffsetLabel(nominalClock.fixedOffsetMin)} standard
            </div>
            <div className={label}>places in this band not on {place ?? 'the representative'}'s clock</div>
          </div>
          <div className="font-mono text-[22px] font-bold tabular-nums text-white/70">{r.nominal.hhmmss}</div>
        </div>
      )}

      <div className="mt-1 w-full space-y-2 border-t border-white/10 pt-3 text-[11px] leading-relaxed text-white/45">
        {clock.iana ? (
          <div>
            <span className={label}>Clock follows</span>{' '}
            <span className="font-mono text-white/60">{clock.iana}</span>
          </div>
        ) : (
          <div>
            <span className={label}>Fixed offset</span>{' '}
            <span className="font-mono text-white/60">{r.primary.offsetLabel}</span>
            <span className={label}> · no daylight-saving rules known for this band</span>
          </div>
        )}
        {places.length > 0 && (
          <div>
            <span className={label}>Places</span> {places.join(' · ')}
          </div>
        )}
        {dstPlaces.length > 0 && (
          <div>
            <span className={label}>Observes daylight saving</span> {dstPlaces.join(' · ')}
          </div>
        )}
        <div className="text-[10px] text-white/25">
          Band boundaries are Natural Earth's nominal UTC-offset zones; the live clock is the
          representative place's. Somewhere inside the band that keeps a different summer-time
          rule can differ by an hour.
        </div>
      </div>
    </div>
  );
}
