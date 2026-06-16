interface Props {
  payload: {
    latitude: number;
    longitude: number;
    frp: number | null;
    brightness: number | null;
    confidence: string;
    satellite: string;
    daynight: string;
    acqDate: string;
    acqTime: string;
  };
}

function formatLat(lat: number): string {
  return `${Math.abs(lat).toFixed(3)}°${lat >= 0 ? 'N' : 'S'}`;
}

function formatLon(lon: number): string {
  return `${Math.abs(lon).toFixed(3)}°${lon >= 0 ? 'E' : 'W'}`;
}

function formatAcq(date: string, time: string): string {
  if (!date) return '—';
  // FIRMS acq_time is "HHMM" (UTC). Render as date + HH:MM Z when present.
  const t = time.padStart(4, '0');
  const hhmm = time ? `${t.slice(0, 2)}:${t.slice(2)} UTC` : '';
  return `${date}${hhmm ? ` ${hhmm}` : ''}`;
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
        <dd>{formatAcq(payload.acqDate, payload.acqTime)}</dd>

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
