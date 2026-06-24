import type { SmokePolygon } from '../../types';

interface Props {
  payload: SmokePolygon & { date?: string };
}

// Convert HMS Julian datetime "2026173 1200UTC" to a readable string.
function parseHmsTime(raw: string | undefined): string | null {
  if (!raw) return null;
  // Format: YYYYDDD HHMMUTC
  const m = raw.match(/^(\d{4})(\d{3})\s+(\d{2})(\d{2})UTC$/);
  if (!m) return raw; // pass through if unrecognised
  const [, year, doy, hh, mm] = m;
  const d = new Date(Date.UTC(Number(year), 0, Number(doy)));
  const month = d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${month} ${day} ${hh}:${mm} UTC`;
}

const DENSITY_META: Record<string, { label: string; color: string; desc: string }> = {
  Light:  { label: 'Light',  color: 'text-yellow-300',  desc: 'Thin smoke haze — reduced visibility possible' },
  Medium: { label: 'Medium', color: 'text-amber-400',   desc: 'Moderate smoke — noticeable air quality impact' },
  Heavy:  { label: 'Heavy',  color: 'text-orange-400',  desc: 'Dense smoke — significant health risk' },
};

export function SmokeDetails({ payload }: Props) {
  const { density, satellite, startTime, endTime, date } = payload;
  const meta = DENSITY_META[density] ?? DENSITY_META.Light;
  const start = parseHmsTime(startTime);
  const end = parseHmsTime(endTime);

  return (
    <div className="space-y-3">
      <div>
        <div className="text-lg font-bold leading-tight tracking-wide">
          {meta.label} Smoke
        </div>
        <div className="mt-0.5 text-[12px] text-white/50">{meta.desc}</div>
      </div>

      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-[13px]">
        <dt className="text-white/40">Density</dt>
        <dd className={`font-semibold ${meta.color}`}>{density}</dd>

        {satellite && (
          <>
            <dt className="text-white/40">Satellite</dt>
            <dd>{satellite}</dd>
          </>
        )}

        {start && (
          <>
            <dt className="text-white/40">Start</dt>
            <dd className="font-mono text-[12px]">{start}</dd>
          </>
        )}

        {end && (
          <>
            <dt className="text-white/40">End</dt>
            <dd className="font-mono text-[12px]">{end}</dd>
          </>
        )}

        {date && (
          <>
            <dt className="text-white/40">Product</dt>
            <dd>HMS {date.slice(0, 4)}-{date.slice(4, 6)}-{date.slice(6, 8)}</dd>
          </>
        )}

        <dt className="text-white/40">Source</dt>
        <dd>NOAA Hazard Mapping System</dd>
      </dl>
    </div>
  );
}
