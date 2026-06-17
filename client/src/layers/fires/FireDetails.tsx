interface Props {
  payload: {
    latitude: number;
    longitude: number;
    frp: number | null;
    brightness: number | null;
    confidence: string;
    satellite: string | number;
    daynight: string;
    acqDate: string | number | null;
    acqTime: string | number | null;
  };
}

function formatLat(lat: number): string {
  return `${Math.abs(lat).toFixed(3)}°${lat >= 0 ? 'N' : 'S'}`;
}

function formatLon(lon: number): string {
  return `${Math.abs(lon).toFixed(3)}°${lon >= 0 ? 'E' : 'W'}`;
}

// FIRMS fields arrive inconsistently from the ArcGIS GeoJSON feed: acq_date can
// be a 'YYYY-MM-DD' string or epoch-ms (number / numeric string), and acq_time
// can be an 'HHMM' string or a bare integer. Coerce defensively — a numeric
// value here used to crash the whole panel (number has no .padStart).
function formatDate(date: string | number | null | undefined): string {
  if (date == null || date === '') return '';
  if (typeof date === 'number' || /^\d{12,}$/.test(String(date))) {
    const d = new Date(Number(date));
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  return String(date);
}

function formatTime(time: string | number | null | undefined): string {
  if (time == null || time === '') return '';
  const raw = String(time);
  if (!/^\d+$/.test(raw)) return raw; // already formatted / unexpected — show as-is
  const t = raw.padStart(4, '0');
  return `${t.slice(0, 2)}:${t.slice(2)} UTC`;
}

// FIRMS timestamps are UTC. Combine acq_date + acq_time into a real instant so
// we can show it in the viewer's local timezone. Falls back to null on bad input.
function parseAcqInstant(
  date: string | number | null | undefined,
  time: string | number | null | undefined
): Date | null {
  if (date == null || date === '') return null;
  // Epoch-ms encodes the full instant already.
  if (typeof date === 'number' || /^\d{12,}$/.test(String(date))) {
    const d = new Date(Number(date));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const m = String(date).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  let hh = 0;
  let mm = 0;
  if (time != null && time !== '' && /^\d+$/.test(String(time))) {
    const t = String(time).padStart(4, '0');
    hh = Number(t.slice(0, 2));
    mm = Number(t.slice(2, 4));
  }
  const ts = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), hh, mm);
  return Number.isNaN(ts) ? null : new Date(ts);
}

// Local-time label, e.g. "Jun 17, 14:32 EDT". Date-only when no time is present.
function formatAcqLocal(
  date: string | number | null | undefined,
  time: string | number | null | undefined
): string {
  const dt = parseAcqInstant(date, time);
  if (!dt) {
    const d = formatDate(date);
    if (!d) return '—';
    const t = formatTime(time);
    return t ? `${d} ${t}` : d;
  }
  const datePart = dt.toLocaleDateString([], { month: 'short', day: 'numeric' });
  const hasTime = time != null && time !== '';
  if (!hasTime) return datePart;
  const timePart = dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  const tz =
    new Intl.DateTimeFormat([], { timeZoneName: 'short' })
      .formatToParts(dt)
      .find((p) => p.type === 'timeZoneName')?.value ?? '';
  return `${datePart}, ${timePart}${tz ? ` ${tz}` : ''}`;
}

// Original UTC timestamp, kept for the tooltip.
function formatAcqUtc(
  date: string | number | null | undefined,
  time: string | number | null | undefined
): string {
  const d = formatDate(date);
  if (!d) return '';
  const t = formatTime(time);
  return t ? `${d} ${t}` : d;
}

export function FireDetails({ payload }: Props) {
  return (
    <div className="space-y-3">
      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-bold tabular-nums text-accent-warn">
          {payload.frp != null ? `${Math.round(payload.frp)} MW` : '—'}
        </span>
        <span className="text-white/50">fire radiative power</span>
      </div>

      <dl className="grid grid-cols-2 gap-y-1.5 text-[13px]">
        <dt className="text-white/40">Confidence</dt>
        <dd>{payload.confidence}</dd>

        <dt className="text-white/40">Brightness</dt>
        <dd className="tabular-nums">
          {payload.brightness != null ? `${payload.brightness.toFixed(1)} K` : '—'}
        </dd>

        <dt className="text-white/40">Satellite</dt>
        <dd>{payload.satellite || '—'}</dd>

        <dt className="text-white/40">Pass</dt>
        <dd>{payload.daynight === 'D' ? 'Day' : payload.daynight === 'N' ? 'Night' : '—'}</dd>

        <dt className="text-white/40">Detected</dt>
        <dd title={`${formatAcqUtc(payload.acqDate, payload.acqTime)} (satellite UTC)`}>
          {formatAcqLocal(payload.acqDate, payload.acqTime)}
        </dd>

        <dt className="text-white/40">Position</dt>
        <dd className="tabular-nums">
          {formatLat(payload.latitude)} {formatLon(payload.longitude)}
        </dd>
      </dl>

      <p className="text-[11px] leading-snug text-white/35">
        VIIRS thermal anomaly via NASA FIRMS. A detection is a heat signature, not
        a confirmed wildfire — it can also be flares, volcanoes, or agricultural burns.
      </p>
    </div>
  );
}
