import { useEffect, useState } from 'react';
import { useLayersStore } from '../store/layersStore';
import {
  useEarthBasemapStore,
  todayUtc,
  TERRA_START,
  AQUA_START,
} from '../cesium/earthBasemap';

// "Wed, Aug 12 2026" — unambiguous and compact. The date is a UTC day (that's
// how NASA dates the mosaics), so format it in UTC to avoid drifting a day in
// western time zones.
function fmtDate(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

// Floating navigator for the Earth map type (zoom.earth's date bar): step
// through the daily archive, toggle the AM (Terra) / PM (Aqua) pass, jump back
// to today. Mounts only while the Earth basemap is selected.
export function EarthTimeBar() {
  const basemap = useLayersStore((s) => s.basemap);
  const date = useEarthBasemapStore((s) => s.date);
  const pass = useEarthBasemapStore((s) => s.pass);
  const setDate = useEarthBasemapStore((s) => s.setDate);
  const setPass = useEarthBasemapStore((s) => s.setPass);
  const stepDays = useEarthBasemapStore((s) => s.stepDays);

  // "Today" must tick, not be captured: this dashboard runs for days at a
  // time, and a today frozen at render would leave the next-day arrow dead and
  // the calendar's max a day short after UTC midnight. The same tick freshens
  // the store's un-pinned default date, so a wall display left on the latest
  // mosaic rolls forward to each new day's imagery by itself.
  const [today, setToday] = useState(() => todayUtc());
  useEffect(() => {
    if (basemap !== 'earth') return;
    const sync = () => {
      setToday(todayUtc());
      useEarthBasemapStore.getState().freshen();
    };
    sync(); // activation after days on another map type starts from fresh dates
    const id = setInterval(sync, 60_000);
    return () => clearInterval(id);
  }, [basemap]);

  if (basemap !== 'earth') return null;
  const atStart = date <= TERRA_START;
  const atEnd = date >= today;
  const aquaAvailable = date >= AQUA_START;

  const stepBtn =
    'grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white/5 text-[13px] text-white/70 transition hover:bg-white/15 disabled:cursor-default disabled:opacity-30 disabled:hover:bg-white/5';

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-5 z-30 flex justify-center px-4">
      <div className="pointer-events-auto flex items-center gap-2 rounded-2xl border border-white/10 bg-ink-900/85 px-3 py-2 shadow-panel backdrop-blur-md">
        <span className="hidden text-[10px] font-semibold uppercase tracking-wider text-white/30 sm:block">
          🌍 Earth
        </span>

        {/* Day stepper + calendar */}
        <button
          onClick={() => stepDays(-1)}
          disabled={atStart}
          aria-label="Previous day"
          className={stepBtn}
        >
          ‹
        </button>
        <label className="relative cursor-pointer select-none">
          <span className="whitespace-nowrap font-mono text-[13px] font-bold tabular-nums text-white">
            {fmtDate(date)}
          </span>
          {/* Invisible native date input stretched over the label: clicking the
              date opens the browser's calendar without a second visible field. */}
          <input
            type="date"
            value={date}
            min={TERRA_START}
            max={today}
            onChange={(e) => e.target.value && setDate(e.target.value)}
            aria-label="Pick a date"
            className="absolute inset-0 cursor-pointer opacity-0 [color-scheme:dark]"
          />
        </label>
        <button
          onClick={() => stepDays(1)}
          disabled={atEnd}
          aria-label="Next day"
          className={stepBtn}
        >
          ›
        </button>

        {/* AM (Terra) / PM (Aqua) pass toggle */}
        <div className="ml-1 flex overflow-hidden rounded-md">
          <button
            onClick={() => setPass('am')}
            title="Morning pass — Terra MODIS, ~10:30 AM local"
            className={`px-2.5 py-1 text-[11px] font-semibold transition ${
              pass === 'am'
                ? 'bg-accent/25 text-accent'
                : 'bg-white/5 text-white/45 hover:bg-white/10 hover:text-white/70'
            }`}
          >
            AM
          </button>
          <button
            onClick={() => setPass('pm')}
            disabled={!aquaAvailable}
            title={
              aquaAvailable
                ? 'Afternoon pass — Aqua MODIS, ~1:30 PM local'
                : 'No afternoon imagery before Jul 2002 (Aqua launch)'
            }
            className={`px-2.5 py-1 text-[11px] font-semibold transition disabled:cursor-default disabled:opacity-30 ${
              pass === 'pm'
                ? 'bg-accent/25 text-accent'
                : 'bg-white/5 text-white/45 hover:bg-white/10 hover:text-white/70'
            }`}
          >
            PM
          </button>
        </div>

        {/* Jump to today (fills in swath by swath through the day) */}
        {!atEnd && (
          <button
            onClick={() => setDate(today)}
            title="Jump to today — the image fills in as the satellites orbit"
            className="rounded-md bg-white/5 px-2.5 py-1 text-[11px] font-medium text-white/60 transition hover:bg-white/10 hover:text-white/80"
          >
            Today
          </button>
        )}
      </div>
    </div>
  );
}
